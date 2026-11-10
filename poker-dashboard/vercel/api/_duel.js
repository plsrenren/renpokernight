// /duel: player vs player for blackjack chips (play money). Uses the same balances as /blackjack (bj:bal).
//   /duel bet:50                        open challenge, the first person to tap Accept plays
//   /duel opponent:@Kurt bet:50         only Kurt can accept (he can also Decline)
//   game:Rock paper scissors (default)  both pick in secret, picks show once both are in, ties replay
//   game:High card                      one card each the moment it's accepted, aces high, same rank deals again
// Both stakes come off when the duel is accepted; the winner gets the pot. Challenges expire after 10 minutes.
// Keys: du:<id> (the duel, 30 min), du:lock:<id> (stops double taps), du:rec (hash "<lo id>:<hi id>:<winner id>" → wins).
import { randomBytes } from 'node:crypto';
import { kv, kvUrl, kvToken, money, json, quiet, whoIs, noStorage, freshDeck, MAX_BET } from './_blackjack.js';

const SITE = 'https://renpokernight.vercel.app';
const DEFAULT_BET = 20, EXPIRES = 10 * 60e3, TTL = 1800;
const GAME = { rps: 'Rock Paper Scissors', high: 'High Card' };
const PICK = { r: ['🪨', 'Rock'], p: ['📄', 'Paper'], s: ['✂️', 'Scissors'] };
const BEATS = { r: 's', p: 'r', s: 'p' };
const VERB = { r: 'Rock smashes scissors.', p: 'Paper covers rock.', s: 'Scissors cut paper.' };
const RANK = '23456789TJQKA';

export const DUEL_COMMAND = { name: 'duel', description: 'Challenge someone for blackjack chips: rock paper scissors or high card (play money)', type: 1,
  options: [
    { type: 4, name: 'bet', description: `Chips each player puts up ($1 to $${MAX_BET}, default $${DEFAULT_BET})`, min_value: 1, max_value: MAX_BET, required: false },
    { type: 6, name: 'opponent', description: 'Who you are challenging (leave empty and anyone can accept)', required: false },
    { type: 3, name: 'game', description: 'Rock paper scissors (default) or high card', required: false,
      choices: [{ name: 'Rock paper scissors', value: 'rps' }, { name: 'High card', value: 'high' }] }] };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = d => ['SET', 'du:' + d.id, JSON.stringify(d), 'EX', TTL];
const recKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function nameOf(i, s, id) {
  const sheet = s && s.ids ? Object.keys(s.ids).find(n => s.ids[n] === id) : null;
  const r = (i.data && i.data.resolved) || {}, u = (r.users || {})[id] || {}, m = (r.members || {})[id] || {};
  return sheet || m.nick || u.global_name || u.username || 'Someone';
}

// ---------- the message ----------
const btn = (label, emoji, act, id, style) => ({ type: 2, style, label, ...(emoji ? { emoji: { name: emoji } } : {}), custom_id: `du:${act}:${id}` });
const row = (...b) => [{ type: 1, components: b }];
const msg = (embed, components = [], extra = {}) => ({ allowed_mentions: { parse: [] }, ...extra, embeds: [embed], components });

function view(d, extra = {}) {
  const pot = d.bet * 2, A = d.a.name, B = d.b ? d.b.name : 'anyone';
  if (d.state === 'open') {
    return msg({ color: 0xf1c75b, title: `⚔️ ${A} challenges ${B} to ${GAME[d.game]}`,
      description: `Stakes **${money(d.bet)}** each · winner takes the **${money(pot)}** pot`,
      footer: { text: `${d.b ? `Only ${B} can accept` : 'First person to tap Accept plays'} · expires in 10 min · play money only` } },
    row(btn('Accept', '✅', 'acc', d.id, 3), btn(d.b ? 'Decline' : 'Cancel', null, 'dec', d.id, 4)),
    d.b ? { content: `<@${d.b.id}>`, allowed_mentions: { users: [d.b.id] } } : {});
  }
  if (d.state === 'pick') {
    const line = p => d.picks[p.id] ? `✅ **${p.name}** locked in` : `⏳ **${p.name}** is thinking…`;
    const tie = d.lastTie ? `🤝 Tie! You both picked ${PICK[d.lastTie][0]} ${PICK[d.lastTie][1]}. Pick again.\n\n` : '';
    return msg({ color: 0x5865f2, title: `⚔️ ${A} vs ${B} · ${money(pot)} pot`, description: `${tie}${line(d.a)}\n${line(d.b)}`,
      footer: { text: 'Your pick stays hidden until both are in · play money only' } },
    row(...Object.entries(PICK).map(([k, [e, l]]) => btn(l, e, k, d.id, 2))));
  }
  if (d.state === 'done') {
    const w = d.winner === d.a.id ? d.a : d.b, l = w === d.a ? d.b : d.a;
    let description;
    if (d.game === 'rps') {
      description = `${PICK[d.picks[d.a.id]][0]} **${A}**  vs  ${PICK[d.picks[d.b.id]][0]} **${B}**\n${VERB[d.picks[w.id]]}`;
    } else {
      description = `One card each, high card wins (aces high).${d.redraws ? ` Same rank ${d.redraws === 1 ? 'once' : d.redraws === 2 ? 'twice' : d.redraws + ' times'}, so it dealt again.` : ''}`;
    }
    description += `\n\n**${w.name}** +${money(d.bet)} (now ${money(d.bal[w.id])}) · **${l.name}** −${money(d.bet)} (now ${money(d.bal[l.id])})`;
    const rec = d.rec || {}, foot = `${A} ${rec[d.a.id] || 0}–${rec[d.b.id] || 0} ${B} in duels · play money only`;
    const image = d.game === 'high' ? { image: { url: `${SITE}/api/bjcards?${new URLSearchParams({ m: 'duel', c: `${d.cards[d.a.id]}.${d.cards[d.b.id]}`, n: `${A}|${B}`, w: d.winner === d.a.id ? '0' : '1' })}` } } : {};
    const again = [btn(`Rematch (${money(d.bet)})`, '🔁', 're', d.id, 1)];
    if (d.bet * 2 <= MAX_BET) again.push(btn(`Double or nothing (${money(d.bet * 2)})`, null, 'dn', d.id, 2));
    return msg({ color: 0x8ee0b0, title: `🏆 ${w.name} wins ${money(pot)}!`, description, ...image, footer: { text: foot } }, row(...again));
  }
  return msg({ color: 0x4e5058, title: `⚔️ ${GAME[d.game]} · ${money(d.bet)}`, description: extra.note || 'This duel is over.' }, []);
}

// ---------- money ----------
async function balances(...ids) {
  const res = await kv(...ids.map(id => ['HGET', 'bj:bal', id]));
  return res.map(v => (v === null ? null : +v));
}
const broke = (bal, bet) => bal === null ? `You don't have any chips yet. Use **/daily** to get some free.`
  : bal < bet ? `You only have ${money(bal)}, and this duel needs ${money(bet)}.` : null;

async function finish(d) {
  const [ra] = await kv(['HINCRBYFLOAT', 'bj:bal', d.winner, d.bet * 2], ['HINCRBY', 'du:rec', `${recKey(d.a.id, d.b.id)}:${d.winner}`, 1]);
  const loser = d.winner === d.a.id ? d.b.id : d.a.id;
  const [lb, wa, wb] = await kv(['HGET', 'bj:bal', loser], ['HGET', 'du:rec', `${recKey(d.a.id, d.b.id)}:${d.a.id}`], ['HGET', 'du:rec', `${recKey(d.a.id, d.b.id)}:${d.b.id}`]);
  d.bal = { [d.winner]: +ra, [loser]: +lb || 0 };
  d.rec = { [d.a.id]: +wa || 0, [d.b.id]: +wb || 0 };
  d.state = 'done';
}

function highCard(d) {
  d.redraws = 0;
  for (;;) {
    const deck = freshDeck(), ca = deck.pop(), cb = deck.pop();
    if (ca[0] !== cb[0]) { d.cards = { [d.a.id]: ca, [d.b.id]: cb }; d.winner = RANK.indexOf(ca[0]) > RANK.indexOf(cb[0]) ? d.a.id : d.b.id; return; }
    d.redraws++;
  }
}

async function challenge(me, other, bet, game) {
  const [bal] = await balances(me.id);
  const why = broke(bal, bet);
  if (why) return { err: why };
  const d = { id: randomBytes(5).toString('hex'), a: me, b: other, bet, game, made: Date.now(), state: 'open', picks: {} };
  await kv(save(d), ['HSET', 'bj:name', me.id, me.name]);
  return { d };
}

/** The /duel slash command. */
export async function duelCommand(i, opts, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const me = whoIs(i, s), bet = Math.min(MAX_BET, Math.max(1, Math.floor((opts.bet && opts.bet.value) || DEFAULT_BET)));
  const game = opts.game && opts.game.value === 'high' ? 'high' : 'rps';
  let other = null;
  if (opts.opponent) {
    const id = opts.opponent.value, u = ((i.data.resolved || {}).users || {})[id] || {};
    if (id === me.id) return quiet("You can't duel yourself. Leave opponent empty to let anyone accept.");
    if (u.bot) return quiet("Bots don't gamble. Pick a person.");
    other = { id, name: nameOf(i, s, id) };
  }
  try {
    const out = await challenge(me, other, bet, game);
    if (out.err) return quiet(out.err);
    return json({ type: 4, data: view(out.d) });
  } catch (e) { console.error('duel', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}

/** The buttons (custom_id du:<action>:<duel id>). waitUntil sends the "you picked" note after a secret pick. */
export async function duelButton(i, s, waitUntil) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const [, act, id] = String(i.data.custom_id).split(':');
  const me = whoIs(i, s);
  // both players can tap at the same moment, so wait for the other tap instead of dropping it
  let got = false;
  for (let t = 0; t < 15 && !got; t++) { [got] = await kv(['SET', 'du:lock:' + id, '1', 'NX', 'EX', 5]); if (!got) await sleep(150); }
  if (!got) return json({ type: 6 });
  try {
    const [raw] = await kv(['GET', 'du:' + id]);
    if (!raw) return quiet('This duel has expired. Start a new one with **/duel**.');
    const d = JSON.parse(raw);
    const inIt = me.id === d.a.id || (d.b && me.id === d.b.id);

    if (act === 'acc') {
      if (d.state !== 'open') return json({ type: 6 });
      if (me.id === d.a.id) return quiet("That's your own challenge. Wait for someone to accept it.");
      if (d.b && me.id !== d.b.id) return quiet(`This duel is for ${d.b.name}. Start your own with **/duel**.`);
      if (Date.now() - d.made > EXPIRES) { d.state = 'off'; await kv(save(d)); return json({ type: 7, data: view(d, { note: `⌛ Nobody accepted in time, so it's off. No chips moved.` }) }); }
      const [ba, bb] = await balances(d.a.id, me.id);
      const why = broke(bb, d.bet);
      if (why) return quiet(why);
      if (ba === null || ba < d.bet) { d.state = 'off'; await kv(save(d)); return json({ type: 7, data: view(d, { note: `${d.a.name} doesn't have ${money(d.bet)} anymore, so the duel is off. No chips moved.` }) }); }
      d.b = { id: me.id, name: me.name };
      await kv(['HINCRBYFLOAT', 'bj:bal', d.a.id, -d.bet], ['HINCRBYFLOAT', 'bj:bal', d.b.id, -d.bet], ['HSET', 'bj:name', me.id, me.name]);
      if (d.game === 'high') { highCard(d); await finish(d); } else d.state = 'pick';
      await kv(save(d));
      return json({ type: 7, data: view(d) });
    }

    if (act === 'dec') {
      if (d.state !== 'open') return json({ type: 6 });
      if (me.id === d.a.id) { d.state = 'off'; await kv(save(d)); return json({ type: 7, data: view(d, { note: `${d.a.name} called it off. No chips moved.` }) }); }
      if (d.b && me.id === d.b.id) { d.state = 'off'; await kv(save(d)); return json({ type: 7, data: view(d, { note: `${d.b.name} declined. No chips moved.` }) }); }
      return quiet("That's not your duel. Just let it be.");
    }

    if (PICK[act]) {
      if (d.state !== 'pick') return json({ type: 6 });
      if (!inIt) return quiet(`This is ${d.a.name} vs ${d.b.name}. Start your own with **/duel**.`);
      if (d.picks[me.id]) return quiet(`You already locked in ${PICK[d.picks[me.id]][0]} ${PICK[d.picks[me.id]][1]}.`);
      d.picks[me.id] = act;
      const pa = d.picks[d.a.id], pb = d.picks[d.b.id];
      if (pa && pb) {
        if (pa === pb) { d.lastTie = pa; d.picks = {}; }
        else { d.winner = BEATS[pa] === pb ? d.a.id : d.b.id; await finish(d); }
      } else {
        delete d.lastTie;
        // a private note so the player knows their pick registered
        if (waitUntil) waitUntil(fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flags: 64, content: `You picked ${PICK[act][0]} **${PICK[act][1]}**. Waiting on ${me.id === d.a.id ? d.b.name : d.a.name}.` }) }).catch(() => {}));
      }
      await kv(save(d));
      return json({ type: 7, data: view(d) });
    }

    if (act === 're' || act === 'dn') {
      if (d.state !== 'done') return json({ type: 6 });
      if (!inIt) return quiet('Only the two players can call a rematch. Start your own with **/duel**.');
      const other = me.id === d.a.id ? d.b : d.a;
      const out = await challenge(me, other, act === 'dn' ? d.bet * 2 : d.bet, d.game);
      if (out.err) return quiet(out.err);
      return json({ type: 4, data: view(out.d) });
    }
    return json({ type: 6 });
  } finally { await kv(['DEL', 'du:lock:' + id]).catch(() => {}); }
}
