// Weekly rakeback: every Monday at the daily reset (16:00 UTC), everyone who played the house games last week
// (blackjack, free bet, UTH, baccarat, roulette) gets RAKE.loss of their net loss plus RAKE.volume of everything they bet,
// up to RAKE.cap, and the bot posts a plain-text "who got what" note in #casino. The note only shows what people get back,
// never what they lost (Renato's call). Nets and bets are counted as hands finish (houseCmds in _blackjack.js).
// Run by the Vercel cron (vercel.json -> /api/roles?rakeback=1). Safe to call any time: each finished week pays once.
import { kv, money, FEED_KEEP, weekStart, weekKey, rakeFor, RAKE } from './_blackjack.js';
import { postCasino } from './_rewards.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = ms => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const pairs = a => { const o = {}; for (let k = 0; k < (a || []).length; k += 2) o[a[k]] = a[k + 1]; return o; };

/** Who gets what from a week's rb:wk (nets) and rb:vol (bets) hashes: [{ id, net, vol, amt }], biggest first. */
export function rakeList(netRaw, volRaw) {
  const net = pairs(netRaw), vol = pairs(volRaw);
  return [...new Set([...Object.keys(net), ...Object.keys(vol)])]
    .map(id => ({ id, net: Math.round((+net[id] || 0) * 100) / 100, vol: Math.round((+vol[id] || 0) * 100) / 100, amt: rakeFor(net[id], vol[id]) }))
    .filter(p => p.amt >= 0.01).sort((a, b) => b.amt - a.amt);
}

/** The #casino note. Mentions show names without pinging anyone. */
export function rakeText(people, from, to) {
  const lines = people.map(p => `<@${p.id}> **+${money(p.amt)}**`);
  let text = [`💸 **Weekly rakeback** · ${day(from)} to ${day(to)} · thanks for playing`, ...lines,
    `-# Already in your balance · blackjack, free bet, UTH, baccarat and roulette count · up to ${money(RAKE.cap)} a week · new week starts now`].join('\n');
  if (text.length > 1990) text = text.slice(0, 1985) + '…';
  return text;
}

/** Pays last week's rakeback once. Returns a short report. */
export async function payRakeback(now = Date.now()) {
  const to = weekStart(now), from = to - 7 * 864e5, wk = weekKey(from);
  const [first] = await kv(['SET', 'rb:done:' + wk, String(now), 'NX', 'EX', 120 * 86400]);
  if (!first) return { week: wk, skipped: 'already paid' };
  const [netRaw, volRaw, names] = await kv(['HGETALL', 'rb:wk:' + wk], ['HGETALL', 'rb:vol:' + wk], ['HGETALL', 'bj:name']);
  const people = rakeList(netRaw, volRaw), nm = pairs(names);
  if (!people.length) return { week: wk, paid: [] };
  const total = Math.round(people.reduce((s, p) => s + p.amt, 0) * 100) / 100;
  const cmds = [];
  for (const p of people) {
    cmds.push(['HINCRBYFLOAT', 'bj:bal', p.id, p.amt], ['HSET', 'rb:paid:' + wk, p.id, p.amt],
      ['LPUSH', 'cas:feed', JSON.stringify({ id: p.id, name: nm[p.id] || 'Someone', game: 'rakeback', why: `${day(from)} to ${day(to)}`, net: p.amt, src: 'night', at: now })]);
  }
  cmds.push(['EXPIRE', 'rb:paid:' + wk, 120 * 86400], ['LTRIM', 'cas:feed', 0, FEED_KEEP - 1],
    ['HINCRBYFLOAT', 'hs:wk:' + wk, 'rakeback', -total], ['HINCRBYFLOAT', 'hs:all', 'rakeback', -total]);
  await kv(...cmds);
  let posted;
  try { posted = await postCasino({ content: rakeText(people, from, to), allowed_mentions: { parse: [] } }); } catch (e) { console.error('rakeback post', e); posted = 'failed: ' + e.message; }
  return { week: wk, total, posted, paid: people.map(p => ({ name: nm[p.id] || p.id, net: p.net, bet: p.vol, amt: p.amt })) };
}

/** The house's books: { all: { game: won }, week: { game: won } } (what the house won; 'rakeback' is negative). */
export async function houseBooks(now = Date.now()) {
  const [all, week] = await kv(['HGETALL', 'hs:all'], ['HGETALL', 'hs:wk:' + weekKey(now)]);
  const num = o => Object.fromEntries(Object.entries(pairs(o)).map(([k, v]) => [k, Math.round(+v * 100) / 100]));
  return { all: num(all), week: num(week) };
}

const LABEL = { blackjack: 'Blackjack', 'free bet': 'Free Bet', UTH: "Ultimate Hold'em", baccarat: 'Baccarat', roulette: 'Roulette', rakeback: 'Rakeback paid', jackpot: 'Jackpot slices', 'jackpot seed': 'Jackpot seeds', 'free seat': 'Poker free seats', beg: 'Begging (house paid)', 'beg flip': 'Beg roulette' };
const PAID_OUT = new Set(['rakeback', 'jackpot', 'jackpot seed', 'free seat', 'beg']); // money handed back, listed after the games
const signed = n => (n < 0 ? '−' : '+') + money(Math.abs(n));
const block = o => {
  const rows = Object.entries(o).filter(([, v]) => v).sort(([a], [b]) => PAID_OUT.has(a) - PAID_OUT.has(b) || o[b] - o[a]);
  const total = Math.round(rows.reduce((t, [, v]) => t + v, 0) * 100) / 100;
  return rows.length ? rows.map(([k, v]) => `${LABEL[k] || k} **${signed(v)}**`).join('\n') + `\n**Total ${signed(total)}**` : 'Nothing yet.';
};
/** The /house answer (pitbosses only): the house's win by game this week and all-time, plus rakeback owed so far. */
export async function houseEmbed(now = Date.now()) {
  const wk = weekKey(now);
  const [all, week, net, vol] = await kv(['HGETALL', 'hs:all'], ['HGETALL', 'hs:wk:' + wk], ['HGETALL', 'rb:wk:' + wk], ['HGETALL', 'rb:vol:' + wk]);
  const num = o => Object.fromEntries(Object.entries(pairs(o)).map(([k, v]) => [k, Math.round(+v * 100) / 100]));
  const owed = rakeList(net, vol), owedTotal = Math.round(owed.reduce((t, p) => t + p.amt, 0) * 100) / 100;
  const bet = Math.round(Object.values(pairs(vol)).reduce((t, v) => t + +v, 0) * 100) / 100;
  return { color: 0xf1c75b, title: '🏦 The house books',
    fields: [
      { name: `This week (since ${day(weekStart(now))})`, value: block(num(week)), inline: true },
      { name: 'All time', value: block(num(all)), inline: true },
      { name: 'Rakeback so far this week', value: `${money(owedTotal)} to ${owed.length} player${owed.length === 1 ? '' : 's'}, paid Monday · ${money(bet)} bet this week` },
    ],
    footer: { text: 'What the house won (+) or lost (−) at blackjack, free bet, UTH, baccarat and roulette. Jackpot slices = 2% of hands the house won (4% on the Game of the Week), moved into the pot; jackpot seeds = new chips that restart the pot; poker free seats = chips the house gave out as free seats in the poker room; begging = what /beg paid out; beg roulette = /beg Gamble spins. Counted since rakeback went live.' } };
}
