// /beg: ask for chips.
//   /beg                     beg the house: usually crumbs or nothing (a funny line either way), rarely more, very rarely a
//                            pickpocket takes a few. 1 hour apart, 3 a day (reset with /daily at 16:00 UTC), only under $250.
//                            What it pays goes in the house books as 'beg' (not a house game: no rakeback, no jackpot).
//   /beg who amount note     beg a player (default $10, max $100). Only they can answer, with buttons:
//                            Give (the ask moves to the beggar, like /tip), Gamble (one roulette spin on red or black for the
//                            ask: hit = they keep their chips and the house pays the beggar, miss or 0 = the house takes their
//                            chips, beggar gets nothing; house books 'beg flip'), Toss $1, Nah. 10 minutes to answer.
//                            One open beg at a time, the same person at most 3 times a day.
// Keys: bg:last (hash id -> last house beg), bg:n:<reset> (hash id -> house begs that day), bg:p:<reset> (hash from:to -> begs),
// bg:a:<ask id> (an ask, JSON, a day), bg:open:<id> (their open ask id, 10 min), bg:lock:<id> (double taps), bg:done:<ask id>.
import { randomBytes, randomInt } from 'node:crypto';
import { kv, kvUrl, kvToken, money, json, quiet, whoIs, noStorage, feedCmds, DEBIT, lastReset, weekKey } from './_blackjack.js';

export const BEG = { cooldown: 3600e3, perDay: 3, under: 250, def: 10, max: 100, answer: 600e3, pairPerDay: 3 };
const DAY = 86400e3, KEEP_WEEKS = 120 * 86400;
export const BEG_COMMAND = { name: 'beg', description: 'Beg the house for spare chips, or beg another player', type: 1, options: [
  { type: 6, name: 'who', description: 'Beg this person (leave empty to beg the house)', required: false },
  { type: 4, name: 'amount', description: `How much to ask them for (default $${BEG.def})`, min_value: 1, max_value: BEG.max, required: false },
  { type: 3, name: 'note', description: 'Optional sob story, like "rent is due"', max_length: 120, required: false }] };

// ---------- lines ----------
// $X = the amount. {P} = one random casino player, {P1} {P2} {P3} = three different ones (shown as @mentions, nobody is pinged).
export const CRUMBS = [
  "🥫 The dealer sighs and slides you $X. Don't spend it all in one hand.",
  '🪙 You found $X under the blackjack table. Finders keepers.',
  '🍟 The pit boss tossed you $X and told you to go buy some fries.',
  '🧹 The janitor swept $X toward you. Nobody saw anything.',
  '🎰 A slot machine coughed up $X out of pity.',
  '🍸 The bartender slid you $X with your water. "Tap water\'s free, by the way."',
  '🃏 A dealer on break flicked $X your way. "Don\'t tell my manager."',
  '👵 A grandma at the penny slots handed you $X and patted your head.',
  '🛋️ You dug $X out of the lobby couch cushions.',
  "🎟️ Someone dropped $X on the way to cash out. It's yours now.",
  '🤝 The doorman felt bad and spotted you $X.',
  '🐟 The table fish gave you $X. Even they feel sorry for you.',
];
export const NOTHING = [
  '😂 {P} laughs at you.',
  "📸 {P} took a picture of you begging. It's in the group chat now.",
  '🙈 {P} saw you coming and hid behind a slot machine.',
  '🍿 {P1}, {P2} and {P3} pulled up chairs and grabbed popcorn to watch you beg.',
  '💅 {P} looked at their stack, then at you, then back at their stack.',
  '🫡 {P} saluted you on the way to the cashier. No chips though.',
  '🗣️ {P} yelled "DON\'T FEED IT" across the casino.',
  '🤑 {P} fanned themself with their chips in front of you.',
  '🚪 Security walks you to the parking lot. Try again in an hour.',
  '🙄 The dealer looks right through you.',
  '🃏 The pit boss says "Have you tried winning?"',
  '🦗 You beg. The casino answers with crickets.',
  '📵 The house put you on hold. Your call is very important to them.',
  '🧾 The cashier hands you a receipt that just says "No."',
  '🪞 You beg in front of a mirror. The mirror also has no chips.',
  '🐀 Even the casino rat walked away from you.',
  '🎲 You asked the dice for help. They rolled away.',
  '🫏 The dealer tried to give you chips, then saw your last hand.',
  '⛔ Begging is not a recognized poker strategy. Denied.',
  '🧊 The house is fresh out of sympathy. Check back later.',
  '🎻 The world\'s tiniest violin plays for you. That\'s all you get.',
  "🍞 You get one breadstick from the buffet. It's not even warm.",
];
const REGULAR = ['🍻 A regular felt bad and bought you a stack: $X.', '🎂 Someone at the next table is celebrating. They threw you $X.'];
const WHALE = ['🐋 A guy in a gold chain flicks $X at you without looking up.'];
const PICKPOCKET = ['🫳 While you were begging, someone lifted $X from your pocket. Rough night.'];
const NAH = ['🙅 {G} looked {B} dead in the eye and said no.', '🚪 {G} pretended not to hear. Classic.', '📉 {G} says "I\'ve seen how you play."', "🫏 {G} doesn't fund donkeys."];

// ---------- the house beg ----------
const pick = a => a[randomInt(0, a.length)];
const between = (lo, hi) => randomInt(lo, hi + 1);
/** One roll: { kind, amt } (amt is what the beggar gets, negative for the pickpocket). Odds in percent: 50 nothing,
 *  33 $1-5, 12 $6-12, 3 $20, 1 $50, 1 pickpocket $1-5. Average about $3. */
export function roll(r = randomInt(0, 100)) {
  if (r < 50) return { kind: 'nothing', amt: 0 };
  if (r < 83) return { kind: 'crumbs', amt: between(1, 5) };
  if (r < 95) return { kind: 'crumbs', amt: between(6, 12) };
  if (r < 98) return { kind: 'regular', amt: 20 };
  if (r < 99) return { kind: 'whale', amt: 50 };
  return { kind: 'pickpocket', amt: -between(1, 5) };
}
/** fills {P}/{P1..3} with random other players' mentions; null when there aren't enough players for that line */
export function fill(line, others) {
  const need = /\{P3\}/.test(line) ? 3 : /\{P\}/.test(line) ? 1 : 0;
  if (others.length < need) return null;
  const pool = [...others], got = [];
  for (let k = 0; k < need; k++) got.push(pool.splice(randomInt(0, pool.length), 1)[0]);
  return need === 3 ? line.replace('{P1}', `<@${got[0]}>`).replace('{P2}', `<@${got[1]}>`).replace('{P3}', `<@${got[2]}>`)
    : need === 1 ? line.replace('{P}', `<@${got[0]}>`) : line;
}
const bookCmds = (game, houseWon) => { const wk = weekKey();
  return [['HINCRBYFLOAT', 'hs:wk:' + wk, game, houseWon], ['EXPIRE', 'hs:wk:' + wk, KEEP_WEEKS], ['HINCRBYFLOAT', 'hs:all', game, houseWon]]; };
const lock = async id => { const [got] = await kv(['SET', 'bg:lock:' + id, '1', 'NX', 'PX', 3000]); return !!got; };
const unlock = id => kv(['DEL', 'bg:lock:' + id]).catch(() => {});
const rel = ms => `<t:${Math.ceil(ms / 1000)}:R>`;

export async function begHouse(me, now = Date.now()) {
  if (!(await lock(me.id))) return quiet('Hang on, your last beg is still going through.');
  try {
    const day = lastReset(now), nKey = 'bg:n:' + day;
    const [bal, last, n, names] = await kv(['HGET', 'bj:bal', me.id], ['HGET', 'bg:last', me.id], ['HGET', nKey, me.id], ['HKEYS', 'bj:name']);
    const b = +bal || 0;
    if (b >= BEG.under) return quiet(`🧐 You have **${money(b)}**. The house doesn't hand out chips to people in a nicer coat than the dealer. (Begging works under ${money(BEG.under)}.)`);
    if ((+n || 0) >= BEG.perDay) return quiet(`⏳ You've begged ${BEG.perDay} times today. The house opens its heart again ${rel(day + DAY)}.`);
    const wait = (+last || 0) + BEG.cooldown - now;
    if (wait > 0) return quiet(`⏳ The dealer still remembers your face. Try again ${rel(now + wait)}. (${BEG.perDay} begs a day, resets with /daily.)`);
    let r = roll();
    if (r.kind === 'pickpocket' && b < -r.amt) r = { kind: 'nothing', amt: 0 }; // nothing to steal
    const others = (names || []).filter(id => id && id !== me.id);
    let line = null;
    if (r.kind === 'nothing') { for (let k = 0; k < 10 && !line; k++) line = fill(pick(NOTHING), others); }
    else line = pick(r.kind === 'crumbs' ? CRUMBS : r.kind === 'regular' ? REGULAR : r.kind === 'whale' ? WHALE : PICKPOCKET).replace('$X', `**${money(Math.abs(r.amt))}**`);
    const cmds = [['HSET', 'bg:last', me.id, now], ['HINCRBY', nKey, me.id, 1], ['EXPIRE', nKey, 2 * 86400], ['HSET', 'bj:name', me.id, me.name]];
    if (r.amt) cmds.push(['HINCRBYFLOAT', 'bj:bal', me.id, r.amt], ...bookCmds('beg', -r.amt), ...feedCmds(me, 'beg', r.amt));
    await kv(...cmds);
    const left = BEG.perDay - (+n || 0) - 1;
    const foot = r.amt ? `\n-# You have ${money(Math.round((b + r.amt) * 100) / 100)} now · ${left ? `${left} beg${left === 1 ? '' : 's'} left today` : 'no begs left today'}` : '';
    if (r.kind === 'whale') return json({ type: 4, data: { allowed_mentions: { parse: [] }, embeds: [{ color: 0xf1c75b, title: '🐋 A whale tossed you a chip', description: line,
      footer: { text: `${me.name} has ${money(b + r.amt)} now · next beg in 1h` } }] } });
    return json({ type: 4, data: { content: `**${me.name}** begged the house.\n${line}${foot}`, allowed_mentions: { parse: [] } } });
  } finally { await unlock(me.id); }
}

// ---------- begging a player ----------
const askColor = { open: 0xf0c75e, give: 0x248046, hit: 0x248046, toss: 0x4e5058, miss: 0xda373c, no: 0xda373c, late: 0x4e5058 };
const btn = (label, emoji, act, id, style) => ({ type: 2, style, label, emoji: { name: emoji }, custom_id: `bg:${act}:${id}` });
function askView(a, result, kind = 'open') {
  const lines = [`<@${a.to.id}>, **${a.from.name}** is begging you for **${money(a.amt)}**.`];
  if (a.note) lines.push(`“${a.note}”`);
  if (result) lines.push('', result); else lines.push(`-# Only ${a.to.name} can answer · expires ${rel(a.at + BEG.answer)}`);
  const e = { color: askColor[kind], title: `🥺 ${a.from.name} is on their knees`, description: lines.join('\n') };
  return { allowed_mentions: { parse: [] }, embeds: [e], components: result ? [] : [{ type: 1, components: [
    btn(`Give ${money(a.amt)}`, '💸', 'give', a.id, 3), btn(`Gamble ${money(a.amt)}`, '🎰', 'gamble', a.id, 1),
    btn('Toss $1', '🪙', 'toss', a.id, 2), btn('Nah', '🙅', 'no', a.id, 4)] }] };
}

export async function begPlayer(i, me, to, amt, note, now = Date.now()) {
  if (to.id === me.id) return quiet("You can't beg yourself. That's just counting.");
  if (to.bot) return quiet("Bots don't carry chips. Beg a person.");
  const day = lastReset(now), pKey = 'bg:p:' + day, pair = me.id + ':' + to.id;
  const [open, n, theirs] = await kv(['GET', 'bg:open:' + me.id], ['HGET', pKey, pair], ['HGET', 'bj:bal', to.id]);
  if (open) {
    const [raw] = await kv(['GET', 'bg:a:' + open]);
    const o = raw && JSON.parse(raw);
    if (o && !o.done && now - o.at < BEG.answer) return quiet(`You already have a beg waiting on ${o.to.name}. Give them a minute.`);
  }
  if ((+n || 0) >= BEG.pairPerDay) return quiet(`You've begged ${to.name} ${BEG.pairPerDay} times today. Have some dignity, try again tomorrow.`);
  if ((+theirs || 0) < amt) return quiet(`${to.name} only has ${money(+theirs || 0)}. Beg someone who can afford it.`);
  const a = { id: randomBytes(6).toString('hex'), from: me, to: { id: to.id, name: to.name }, amt, note, at: now };
  await kv(['SET', 'bg:a:' + a.id, JSON.stringify(a), 'EX', 86400], ['SET', 'bg:open:' + me.id, a.id, 'PX', BEG.answer],
    ['HINCRBY', pKey, pair, 1], ['EXPIRE', pKey, 2 * 86400], ['HSET', 'bj:name', me.id, me.name], ['HSETNX', 'bj:name', to.id, to.name]);
  const v = askView(a);
  return json({ type: 4, data: { ...v, content: `<@${to.id}>`, allowed_mentions: { users: [to.id] } } });
}

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const EM = { red: '🔴', black: '⚫', green: '🟢' };
export const colorOf = n => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
// moves ARGV[3] chips from ARGV[1] to ARGV[2] if ARGV[1] has that many (same as /tip)
const MOVE = "local b=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0') if b<tonumber(ARGV[3]) then return {'-1',tostring(b)} end local a=redis.call('HINCRBYFLOAT',KEYS[1],ARGV[1],-tonumber(ARGV[3])) local c=redis.call('HINCRBYFLOAT',KEYS[1],ARGV[2],tonumber(ARGV[3])) return {a,c}";

/** buttons: custom_id bg:<give|gamble|toss|no>:<ask id> */
export async function begButton(i, s, now = Date.now()) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const [, act, id] = String(i.data.custom_id).split(':');
  const me = whoIs(i, s);
  const [raw] = await kv(['GET', 'bg:a:' + id]);
  if (!raw) return json({ type: 7, data: { components: [] } });
  const a = JSON.parse(raw);
  if (me.id !== a.to.id) return quiet(`This one's for ${a.to.name}.`);
  if (a.done) return json({ type: 7, data: askView(a, a.result, a.kind) });
  const G = `**${a.to.name}**`, B = `<@${a.from.id}>`;
  const finish = async (result, kind, cmds = []) => {
    a.done = true; a.result = result; a.kind = kind;
    await kv(['SET', 'bg:a:' + a.id, JSON.stringify(a), 'EX', 86400], ['DEL', 'bg:open:' + a.from.id], ...cmds);
    return json({ type: 7, data: askView(a, result, kind) });
  };
  // one answer per ask, even with two taps at once
  const [got] = await kv(['SET', 'bg:done:' + a.id, '1', 'NX', 'EX', 86400]);
  if (!got) { const [r2] = await kv(['GET', 'bg:a:' + id]); const b2 = r2 && JSON.parse(r2); return json(b2 && b2.done ? { type: 7, data: askView(b2, b2.result, b2.kind) } : { type: 6 }); }
  const release = () => kv(['DEL', 'bg:done:' + a.id]).catch(() => {});
  try {
    if (now - a.at > BEG.answer) return await finish(`⌛ ${G} left **${a.from.name}** on read.`, 'late');
    if (act === 'no') return await finish(pick(NAH).replace('{G}', G).replace('{B}', `**${a.from.name}**`), 'no');
    if (act === 'give' || act === 'toss') {
      const amt = act === 'toss' ? 1 : a.amt;
      const [r] = await kv(['EVAL', MOVE, 1, 'bj:bal', a.to.id, a.from.id, amt]);
      if (String(r[0]) === '-1') { await release(); return quiet(`You only have ${money(+r[1])}.`); }
      const feed = [...feedCmds(me, 'tip to ' + a.from.name, -amt), ...feedCmds(a.from, 'tip from ' + a.to.name, amt)];
      return await finish(act === 'toss' ? `🪙 ${G} flicked a single **$1** chip at ${B}. Brutal.` : `💸 ${G} came through. ${B} got **${money(amt)}**. Say thank you.`, act, feed);
    }
    if (act === 'gamble') {
      const bet = pick(['red', 'black']), n = randomInt(0, 37), c = colorOf(n);
      const head = `🎰 ${G} put **${money(a.amt)}** on ${EM[bet]} ${bet} for ${B}… ball lands on ${EM[c]} **${n}**.`;
      const [left] = await kv(['EVAL', DEBIT, 1, 'bj:bal', a.to.id, a.amt]); // they put the chips up first, win or lose
      if (String(left) === '-1') { await release(); return quiet(`You need ${money(a.amt)} to gamble it.`); }
      if (c === bet) {
        return await finish(`${head}\n${G} keeps their ${money(a.amt)} and the house pays ${B} **${money(a.amt)}**.`, 'hit',
          [['HINCRBYFLOAT', 'bj:bal', a.to.id, a.amt], ['HINCRBYFLOAT', 'bj:bal', a.from.id, a.amt], ...bookCmds('beg flip', -a.amt), ...feedCmds(a.from, 'beg flip', a.amt)]);
      }
      return await finish(`${head}\n${n === 0 ? 'Green! ' : ''}The house keeps ${G}'s ${money(a.amt)}. ${a.from.name} gets nothing.`, 'miss',
        [...bookCmds('beg flip', a.amt), ...feedCmds(me, 'beg flip', -a.amt)]);
    }
    await release();
    return json({ type: 6 });
  } catch (e) { await release(); throw e; }
}

/** /beg. Returns null for other commands. */
export async function begCommand(i, opts, s) {
  if (i.data.name !== 'beg') return null;
  if (!kvUrl() || !kvToken()) return noStorage();
  try {
    const me = whoIs(i, s);
    const id = opts.who && opts.who.value;
    if (!id) return await begHouse(me);
    const r = (i.data.resolved || {}), u = (r.users || {})[id] || {}, m = (r.members || {})[id] || {};
    const sheet = s && s.ids ? Object.keys(s.ids).find(n => s.ids[n] === id) : null;
    const to = { id, bot: !!u.bot, name: sheet || m.nick || u.global_name || u.username || 'Someone' };
    const amt = Math.min(BEG.max, Math.max(1, Math.floor(+(opts.amount && opts.amount.value) || BEG.def)));
    const note = opts.note ? String(opts.note.value).trim().replace(/[\r\n]+/g, ' ').replace(/[<@>*_~`|]/g, '').slice(0, 120) : '';
    return await begPlayer(i, me, to, amt, note);
  } catch (e) { console.error('beg', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}
