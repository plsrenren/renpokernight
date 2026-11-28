// Weekly rakeback: every Wednesday at the daily reset (16:00 UTC; Monday until Nov 28 2026, moved so the free chips are spread
// over the week), everyone who played the house games in the casino week that ended that Monday
// (blackjack, free bet, UTH, baccarat, roulette) gets RAKE.loss of their net loss plus RAKE.volume of everything they bet,
// up to RAKE.cap, and the bot posts a plain-text "who got what" note in #casino. The note only shows what people get back,
// never what they lost (Renato's call). Nets and bets are counted as hands finish (houseCmds in _blackjack.js).
// Run by the Vercel cron (vercel.json -> /api/roles?rakeback=1). Safe to call any time: each finished week pays once.
import { kv, money, FEED_KEEP, weekStart, weekKey, rakeFor, RAKE, RAKE_DAY } from './_blackjack.js';
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
    `-# Already in your balance · up to ${money(RAKE.cap)} a week · every Wednesday`].join('\n');
  if (text.length > 1990) text = text.slice(0, 1985) + '…';
  return text;
}

/** Pays last week's rakeback once, from Wednesday's reset on (RAKE_DAY). Returns a short report. */
export async function payRakeback(now = Date.now()) {
  const to = weekStart(now), from = to - 7 * 864e5, wk = weekKey(from);
  if (now < to + RAKE_DAY * 864e5) return { week: wk, skipped: 'pays on Wednesday' };
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
