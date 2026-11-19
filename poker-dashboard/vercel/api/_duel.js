// /duel: player vs player for blackjack chips. Uses the same balances as /blackjack (bj:bal).
//   /duel bet:50                        open challenge, the first person to tap Accept plays
//   /duel opponent:@Kurt bet:50         only Kurt can accept (he can also Decline)
//   game:Rock paper scissors (default)  both pick in secret, picks show once both are in, ties replay
//   game:High card                      one card each the moment it's accepted, aces high, same rank deals again
//   game:Coin flip                      challenger is heads, whoever accepts is tails, the coin flips the moment it's accepted
// Both stakes come off when the duel is accepted; the winner gets the pot. Challenges expire after 10 minutes.
// Rock paper scissors: if someone never picks, either player can tap "Call it off" after 3 minutes (both stakes go back),
// and a duel still waiting after 30 minutes is refunded by sweepDuels (run on /duel and /daily), so chips never vanish.
// Keys: du:<id> (the duel, 1 day), du:lock:<id> (stops double taps), du:rec (hash "<lo id>:<hi id>:<winner id>" → wins),
//       du:live (hash duel id → {a, b, bet, at}: RPS duels with stakes taken and no winner yet).
import { randomBytes } from 'node:crypto';
import { kv, kvUrl, kvToken, money, json, quiet, whoIs, noStorage, freshDeck, MAX_BET, feedCmds } from './_blackjack.js';

const SITE = 'https://renpokernight.vercel.app';
const DEFAULT_BET = 20, EXPIRES = 10 * 60e3, TTL = 86400, CALL_OFF = 3 * 60e3, STUCK = 30 * 60e3;
const GAME = { rps: 'Rock Paper Scissors', high: 'High Card', coin: 'Coin Flip' };
const PICK = { r: ['🪨', 'Rock'], p: ['📄', 'Paper'], s: ['✂️', 'Scissors'] };
const BEATS = { r: 's', p: 'r', s: 'p' };
const VERB = { r: 'Rock smashes scissors.', p: 'Paper covers rock.', s: 'Scissors cut paper.' };
const RANK = '23456789TJQKA';

export const DUEL_COMMAND = { name: 'duel', description: 'Challenge someone for blackjack chips: rock paper scissors, high card or coin flip', type: 1,
  options: [
    { type: 4, name: 'bet', description: `Chips each player puts up ($1 to $${MAX_BET}, default $${DEFAULT_BET})`, min_value: 1, max_value: MAX_BET, required: false },
    { type: 6, name: 'opponent', description: 'Who you are challenging (leave empty and anyone can accept)', required: false },
    { type: 3, name: 'game', description: 'Rock paper scissors (default), high card or coin flip', required: false,
      choices: [{ name: 'Rock paper scissors', value: 'rps' }, { name: 'High card', value: 'high' }, { name: 'Coin flip', value: 'coin' }] }] };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = d => ['SET', 'du:' + d.id, JSON.stringify(d), 'EX', TTL];
const recKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
// takes the stake from both players in one step, or from neither: returns {'ok', a balance, b balance} or {'a'|'b', their balance}
const TAKE2 = "local a=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '-1') local b=tonumber(redis.call('HGET',KEYS[1],ARGV[2]) or '-1') local n=tonumber(ARGV[3]) "
  + "if b<n then return {'b',tostring(b)} end if a<n then return {'a',tostring(a)} end "
  + "return {'ok',redis.call('HINCRBYFLOAT',KEYS[1],ARGV[1],-n),redis.call('HINCRBYFLOAT',KEYS[1],ARGV[2],-n)}";
const refundCmds = (aId, bId, bet, id) => [['HINCRBYFLOAT', 'bj:bal', aId, bet], ['HINCRBYFLOAT', 'bj:bal', bId, bet], ['HDEL', 'du:live', id]];

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
      description: `Stakes **${money(d.bet)}** each · winner takes the **${money(pot)}** pot${d.game === 'coin' ? `\n🪙 ${A} is **heads**, ${d.b ? B : 'whoever accepts'} is **tails**` : ''}`,
      footer: { text: `${d.b ? `Only ${B} can accept` : 'First person to tap Accept plays'} · expires in 10 min` } },
    row(btn('Accept', '✅', 'acc', d.id, 3), btn(d.b ? 'Decline' : 'Cancel', null, 'dec', d.id, 4)),
    d.b ? { content: `<@${d.b.id}>`, allowed_mentions: { users: [d.b.id] } } : {});
  }
  if (d.state === 'pick') {
    const line = p => d.picks[p.id] ? `✅ **${p.name}** locked in` : `⏳ **${p.name}** is thinking…`;
    const tie = d.lastTie ? `🤝 Tie! You both picked ${PICK[d.lastTie][0]} ${PICK[d.lastTie][1]}. Pick again.\n\n` : '';
    return msg({ color: 0x5865f2, title: `⚔️ ${A} vs ${B} · ${money(pot)} pot`, description: `${tie}${line(d.a)}\n${line(d.b)}`,
      footer: { text: 'Your pick stays hidden until both are in · either player can call it off after 3 min (both stakes go back)' } },
    row(...Object.entries(PICK).map(([k, [e, l]]) => btn(l, e, k, d.id, 2)), btn('Call it off', null, 'off', d.id, 4)));
  }
  if (d.state === 'done') {
    const w = d.winner === d.a.id ? d.a : d.b, l = w === d.a ? d.b : d.a;
    let description;
    if (d.game === 'rps') {
      description = `${PICK[d.picks[d.a.id]][0]} **${A}**  vs  ${PICK[d.picks[d.b.id]][0]} **${B}**\n${VERB[d.picks[w.id]]}`;
    } else if (d.game === 'coin') {
      const side = d.flip === 'h' ? 'Heads' : 'Tails';
      description = `🪙 The coin lands on **${side}**!\n${A} had heads · ${B} had tails`;
    } else {
      description = `One card each, high card wins (aces high).${d.redraws ? ` Same rank ${d.redraws === 1 ? 'once' : d.redraws === 2 ? 'twice' : d.redraws + ' times'}, so it dealt again.` : ''}`;
    }
    description += `\n\n**${w.name}** +${money(d.bet)} (now ${money(d.bal[w.id])}) · **${l.name}** −${money(d.bet)} (now ${money(d.bal[l.id])})`;
    const rec = d.rec || {}, foot = `${A} ${rec[d.a.id] || 0}–${rec[d.b.id] || 0} ${B} in duels`;
    const image = d.game === 'high' ? { image: { url: `${SITE}/api/bjcards?${new URLSearchParams({ m: 'duel', c: `${d.cards[d.a.id]}.${d.cards[d.b.id]}`, n: `${A}|${B}`, w: d.winner === d.a.id ? '0' : '1' })}` } } : {};
    const again = [btn(`Rematch (${money(d.bet)})`, '🔁', 're', d.id, 1)];
    if (d.bet * 2 <= MAX_BET) again.push(btn(`Double or nothing (${money(d.bet * 2)})`, null, 'dn', d.id, 2));
    return msg({ color: 0x8ee0b0, title: `🏆 ${w.name} wins ${money(pot)}!`, description, ...image, footer: { text: foot } }, row(...again));
  }
  return msg({ color: 0x4e5058, title: `⚔️ ${GAME[d.game]} · ${money(d.bet)}`, description: extra.note || 'This duel is over.' }, []);
}

// ---------- money ----------
const broke = (bal, bet) => bal === null ? `You don't have any chips yet. Use **/daily** to get some free.`
  : bal < bet ? `You only have ${money(bal)}, and this duel needs ${money(bet)}.` : null;

// Pays the winner and saves the finished duel in ONE storage round trip (it used to take four, which made the
// reveal feel slow). `before` runs first in the same batch, `after` runs last (releasing the tap lock).
async function finish(d, before = [], after = []) {
  const loser = d.winner === d.a.id ? d.b.id : d.a.id;
  const W = d.winner === d.a.id ? d.a : d.b, L = d.winner === d.a.id ? d.b : d.a, rk = recKey(d.a.id, d.b.id);
  d.state = 'done';
  const res = await kv(...before, ['HINCRBYFLOAT', 'bj:bal', d.winner, d.bet * 2], ['HGET', 'bj:bal', loser],
    ['HINCRBY', 'du:rec', `${rk}:${d.winner}`, 1], ['HGET', 'du:rec', `${rk}:${loser}`], ['HDEL', 'du:live', d.id], save(d),
    ...feedCmds({ id: L.id, name: L.name }, 'duel vs ' + W.name, -d.bet), ...feedCmds({ id: W.id, name: W.name }, 'duel vs ' + L.name, d.bet), ...after);
  const [ra, lb, wr, lr] = res.slice(before.length);
  d.bal = { [d.winner]: +ra, [loser]: +lb || 0 };
  d.rec = { [d.winner]: +wr || 0, [loser]: +lr || 0 };
}

// challenger (a) is heads, the one who accepted (b) is tails
function coinFlip(d) {
  d.flip = randomBytes(1)[0] & 1 ? 'h' : 't';
  d.winner = d.flip === 'h' ? d.a.id : d.b.id;
}

function highCard(d) {
  d.redraws = 0;
  for (;;) {
    const deck = freshDeck(), ca = deck.pop(), cb = deck.pop();
    if (ca[0] !== cb[0]) { d.cards = { [d.a.id]: ca, [d.b.id]: cb }; d.winner = RANK.indexOf(ca[0]) > RANK.indexOf(cb[0]) ? d.a.id : d.b.id; return; }
    d.redraws++;
  }
}

// balance check and save in one round trip; if the challenger turns out to be short, the saved duel is never
// shown to anyone and just expires (no chips move until Accept)
async function challenge(me, other, bet, game) {
  const d = { id: randomBytes(5).toString('hex'), a: me, b: other, bet, game, made: Date.now(), state: 'open', picks: {} };
  const [raw] = await kv(['HGET', 'bj:bal', me.id], save(d), ['HSET', 'bj:name', me.id, me.name]);
  const why = broke(raw === null ? null : +raw, bet);
  return why ? { err: why } : { d };
}

/** The /duel slash command. */
export async function duelCommand(i, opts, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const me = whoIs(i, s), bet = Math.min(MAX_BET, Math.max(1, Math.floor((opts.bet && opts.bet.value) || DEFAULT_BET)));
  const game = opts.game && GAME[opts.game.value] ? opts.game.value : 'rps';
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
  // both players can tap at the same moment, so wait for the other tap instead of dropping it.
  // The lock and the duel are read in one round trip, and the lock is released in the same batch as the save.
  const lock = 'du:lock:' + id, unlock = ['DEL', lock];
  let got = false, raw = null, released = false, d;
  for (let t = 0; t < 20 && !got; t++) {
    [got, raw] = await kv(['SET', lock, '1', 'NX', 'EX', 5], ['GET', 'du:' + id]);
    if (!got) await sleep(100);
  }
  if (!got) return json({ type: 6 });
  const store = async (...cmds) => { await kv(...cmds, unlock); released = true; };
  const done = async (...pre) => { await finish(d, pre, [unlock]); released = true; };
  try {
    if (!raw) return quiet('This duel has expired. Start a new one with **/duel**.');
    d = JSON.parse(raw);
    const inIt = me.id === d.a.id || (d.b && me.id === d.b.id);

    if (act === 'acc') {
      if (d.state !== 'open') return json({ type: 6 });
      if (me.id === d.a.id) return quiet("That's your own challenge. Wait for someone to accept it.");
      if (d.b && me.id !== d.b.id) return quiet(`This duel is for ${d.b.name}. Start your own with **/duel**.`);
      if (Date.now() - d.made > EXPIRES) { d.state = 'off'; await store(save(d)); return json({ type: 7, data: view(d, { note: `⌛ Nobody accepted in time, so it's off. No chips moved.` }) }); }
      // both stakes in one step, so neither player can spend them in another game at the same moment
      const [r] = await kv(['EVAL', TAKE2, 1, 'bj:bal', d.a.id, me.id, d.bet]);
      if (r[0] === 'b') return quiet(broke(+r[1] < 0 ? null : +r[1], d.bet));
      if (r[0] === 'a') { d.state = 'off'; await store(save(d)); return json({ type: 7, data: view(d, { note: `${d.a.name} doesn't have ${money(d.bet)} anymore, so the duel is off. No chips moved.` }) }); }
      d.b = { id: me.id, name: me.name };
      const name = ['HSET', 'bj:name', me.id, me.name];
      if (d.game === 'high' || d.game === 'coin') { (d.game === 'high' ? highCard : coinFlip)(d); await done(name); }
      else { d.state = 'pick'; d.pickAt = Date.now(); await store(name, ['HSET', 'du:live', d.id, JSON.stringify({ a: d.a.id, b: d.b.id, bet: d.bet, at: d.pickAt })], save(d)); }
      return json({ type: 7, data: view(d) });
    }

    if (act === 'dec') {
      if (d.state !== 'open') return json({ type: 6 });
      if (me.id === d.a.id) { d.state = 'off'; await store(save(d)); return json({ type: 7, data: view(d, { note: `${d.a.name} called it off. No chips moved.` }) }); }
      if (d.b && me.id === d.b.id) { d.state = 'off'; await store(save(d)); return json({ type: 7, data: view(d, { note: `${d.b.name} declined. No chips moved.` }) }); }
      return quiet("That's not your duel. Just let it be.");
    }

    if ((PICK[act] || act === 'off') && d.state === 'off') return json({ type: 7, data: view(d, { note: 'This duel was called off. Both stakes went back.' }) });
    if (act === 'off') {
      if (d.state !== 'pick') return json({ type: 6 });
      if (!inIt) return quiet(`This is ${d.a.name} vs ${d.b.name}. Start your own with **/duel**.`);
      const wait = (d.pickAt || d.made) + CALL_OFF - Date.now();
      if (wait > 0) return quiet(`Give them a moment. You can call it off in ${Math.ceil(wait / 60e3)} min if they still haven't picked.`);
      d.state = 'off';
      await store(...refundCmds(d.a.id, d.b.id, d.bet, d.id), save(d));
      return json({ type: 7, data: view(d, { note: `${me.name} called it off. Both stakes (${money(d.bet)} each) went back.` }) });
    }

    if (PICK[act]) {
      if (d.state !== 'pick') return json({ type: 6 });
      if (!inIt) return quiet(`This is ${d.a.name} vs ${d.b.name}. Start your own with **/duel**.`);
      if (d.picks[me.id]) return quiet(`You already locked in ${PICK[d.picks[me.id]][0]} ${PICK[d.picks[me.id]][1]}.`);
      d.picks[me.id] = act;
      const pa = d.picks[d.a.id], pb = d.picks[d.b.id];
      if (pa && pb) {
        if (pa === pb) { d.lastTie = pa; d.picks = {}; d.pickAt = Date.now(); }
        else { d.winner = BEATS[pa] === pb ? d.a.id : d.b.id; await done(); return json({ type: 7, data: view(d) }); }
      } else {
        delete d.lastTie;
        // a private note so the player knows their pick registered
        if (waitUntil) waitUntil(pickNote(i, `You picked ${PICK[act][0]} **${PICK[act][1]}**. Waiting on ${me.id === d.a.id ? d.b.name : d.a.name}.`));
      }
      await store(save(d));
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
  } finally { if (!released) await kv(unlock).catch(() => {}); }
}

// The follow-up only works once Discord has our reply to the tap, and it's sent while that reply is still on its way,
// so retry a couple of times instead of losing it.
async function pickNote(i, content) {
  for (let t = 0; t < 3; t++) {
    await sleep(t ? 600 : 250);
    const r = await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flags: 64, content }) }).catch(() => null);
    if (r && r.ok) return;
  }
}

/** Refunds rock paper scissors duels that have waited on a pick for over 30 minutes. Safe to run any time; returns how many it refunded. */
export async function sweepDuels(now = Date.now()) {
  const [all] = await kv(['HGETALL', 'du:live']);
  let n = 0;
  for (let k = 0; k < (all || []).length; k += 2) {
    const id = all[k]; let e; try { e = JSON.parse(all[k + 1]); } catch (x) { e = null; }
    if (e && now - e.at < STUCK) continue;
    const [got] = await kv(['SET', 'du:lock:' + id, '1', 'NX', 'EX', 5]);
    if (!got) continue;
    try {
      const [raw] = await kv(['GET', 'du:' + id]);
      const d = raw ? JSON.parse(raw) : null;
      if (!e || (d && d.state !== 'pick')) { await kv(['HDEL', 'du:live', id]); continue; } // already settled or called off
      if (d && now - (d.pickAt || 0) < STUCK) continue; // a tie restarted the clock
      if (d) d.state = 'off';
      await kv(...refundCmds(e.a, e.b, e.bet, id), ...(d ? [save(d)] : []));
      n++;
    } finally { await kv(['DEL', 'du:lock:' + id]).catch(() => {}); }
  }
  return n;
}
