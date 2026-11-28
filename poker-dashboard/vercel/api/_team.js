// Players vs the house, as a team (Nov 27 2026, Renato's picks; mockup https://claude.ai/artifact/JnoJa7rYN4sh8ipxhhvA2U).
// The score for a casino week (Monday 16:00 UTC on) = what everyone together won or lost against the house:
//   the house games (blackjack, free bet, madness, UTH, baccarat, roulette) + what the house hands back through
//   rakeback and the jackpot (slices + seeds). Poker free seats and /beg are left out (Renato's call).
// Rakeback only lands in the books the Wednesday after the week, so until then the rakeback owed is counted instead
// (the score doesn't jump when it's paid, and Monday's settle counts it even though it isn't paid yet).
// Shown on the casino lobby (Vs the house card: everyone + you), on the public /house in #casino, and settled on
// Monday by teamWeek() (Vercel cron, roles.js ?weekly=1; rakeback is paid Wednesday by ?rakeback=1):
//   - everyone who bet TEAM.minBet+ that week gets TEAM.playing chips, win or lose. New chips, not in the house books.
//   - if the players finished up: TEAM.win more each (house books line 'team bonus'), the Bust the House title, and the
//     team streak goes up; at TEAM.streak weeks in a row everyone who played that week gets the Bank Run overall bar.
//   - one #casino post with the result either way.
// Keys: tm (hash: streak, best, last = last settled week, lastNet), tm:done:<week> (settles once).
import { kv, money, weekKey, weekStart, rakeFor, FEED_KEEP, HOUSE_GAMES } from './_blackjack.js';
import { postCasino } from './_rewards.js';

export const TEAM = { perks: ['rakeback', 'jackpot', 'jackpot seed'], playing: 25, win: 25, minBet: 50, streak: 3, cap: 1000, capYou: 250 };
const WEEK = 7 * 864e5, KEEP = 120 * 86400;
const r2 = n => Math.round(n * 100) / 100;
const pairs = a => { const o = {}; for (let k = 0; k < (a || []).length; k += 2) o[a[k]] = a[k + 1]; return o; };

/** Rakeback owed so far from a week's rb:wk (nets) and rb:vol (bets). */
export const owedFrom = (netRaw, volRaw) => { const n = pairs(netRaw), v = pairs(volRaw);
  return r2([...new Set([...Object.keys(n), ...Object.keys(v)])].reduce((t, id) => t + rakeFor(n[id], v[id]), 0)); };

/** The players' result against the house for one week (+ = players up), from its hs:wk hash.
 *  owed = rakeback owed so far, used while the week's rakeback isn't in the books yet. */
export function teamNet(hsRaw, owed = 0) {
  const h = pairs(hsRaw);
  let house = 0;
  for (const k of [...HOUSE_GAMES, ...TEAM.perks]) house += +h[k] || 0;
  if (!(+h.rakeback)) house -= owed;
  return r2(-house);
}

/** Per game, for /house: [{ k, players }] (+ = players up), games first then the perks. */
export function teamLines(hsRaw, owed = 0) {
  const h = pairs(hsRaw), out = [];
  for (const k of HOUSE_GAMES) if (+h[k]) out.push({ k, players: r2(-h[k]) });
  const rake = +h.rakeback ? -h.rakeback : owed;
  if (rake) out.push({ k: 'rakeback', players: r2(rake), owed: !(+h.rakeback) });
  const jp = -(+h.jackpot || 0) - (+h['jackpot seed'] || 0);
  if (jp) out.push({ k: 'jackpot', players: r2(jp) });
  return out;
}

/** The lobby card: { team, you, ends, streak, players } (you = your own net at the house games, null if you haven't played). */
export function teamView(hsRaw, netRaw, volRaw, tmRaw, meId, now = Date.now()) {
  const n = pairs(netRaw), v = pairs(volRaw), t = pairs(tmRaw);
  return { team: teamNet(hsRaw, owedFrom(netRaw, volRaw)), you: meId && (n[meId] !== undefined || v[meId] !== undefined) ? r2(+n[meId] || 0) : null,
    ends: weekStart(now) + WEEK, streak: +t.streak || 0, players: Object.keys(v).filter(id => +v[id] > 0).length, cap: TEAM.cap, capYou: TEAM.capYou };
}

/** The line under the bar: what it takes this week. */
export function goalLine(team, ends, now = Date.now()) {
  const ms = Math.max(0, ends - now), d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24;
  const left = d > 0 ? `${d}d ${h}h left` : `${h}h ${Math.floor(ms / 6e4) % 60}m left`;
  return team > 0 ? `Hold the lead · ${left}` : `${money(Math.max(0.01, -team))} to get it back · ${left}`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = ms => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };

/** Monday: settles last week once. Its rakeback isn't paid until Wednesday, so the rakeback owed is counted (owedFrom). Returns a short report. */
export async function teamWeek(now = Date.now()) {
  const to = weekStart(now), from = to - WEEK, last = weekKey(from), cur = weekKey(now);
  const [first] = await kv(['SET', 'tm:done:' + last, String(now), 'NX', 'EX', KEEP]);
  if (!first) return { week: last, skipped: 'already done' };
  const [hs, vol, names, tm, net] = await kv(['HGETALL', 'hs:wk:' + last], ['HGETALL', 'rb:vol:' + last], ['HGETALL', 'bj:name'], ['HGETALL', 'tm'], ['HGETALL', 'rb:wk:' + last]);
  const team = teamNet(hs, owedFrom(net, vol)), won = team > 0.004, t = pairs(tm), nm = pairs(names), v = pairs(vol);
  const streak = won ? (+t.streak || 0) + 1 : 0, best = Math.max(+t.best || 0, streak);
  const who = Object.keys(v).filter(id => +v[id] >= TEAM.minBet);
  const each = TEAM.playing + (won ? TEAM.win : 0);
  const cmds = [['HSET', 'tm', 'streak', streak, 'best', best, 'last', last, 'lastNet', team]];
  for (const id of who) {
    cmds.push(['HINCRBYFLOAT', 'bj:bal', id, each],
      ['LPUSH', 'cas:feed', JSON.stringify({ id, name: nm[id] || 'Someone', game: 'team bonus', why: won ? 'players beat the house' : 'thanks for playing', net: each, src: 'night', at: now })]);
    if (won) cmds.push(['HINCRBY', 'ac:n:' + id, 'bust', 1], ...(streak >= TEAM.streak ? [['HINCRBY', 'ac:n:' + id, 'bust3', 1]] : []), ['SADD', 'ac:dirty', id]);
  }
  if (who.length) cmds.push(['LTRIM', 'cas:feed', 0, FEED_KEEP - 1]);
  // the win bonus comes from the house (its own books line, not part of the score); the $25 for playing is new chips
  // Team Spirit buff (_buffs.js): +25% on /daily for the same players until next Monday's settle
  if (won && who.length) cmds.push(['SET', 'bf:team', JSON.stringify({ ids: who, until: to + WEEK, net: team }), 'PXAT', to + WEEK]);
  if (won && who.length) { const cost = TEAM.win * who.length; cmds.push(['HINCRBYFLOAT', 'hs:wk:' + cur, 'team bonus', -cost], ['EXPIRE', 'hs:wk:' + cur, KEEP], ['HINCRBYFLOAT', 'hs:all', 'team bonus', -cost]); }
  await kv(...cmds);
  let posted;
  try { posted = await postCasino({ content: teamText({ team, won, streak, n: who.length, each, from, to }), allowed_mentions: { parse: [] } }); }
  catch (e) { console.error('team post', e); posted = 'failed: ' + e.message; }
  return { week: last, team, won, streak, paid: who.length, each, posted };
}

/** The Monday #casino post. */
export function teamText({ team, won, streak, n, each, from, to }) {
  const head = won ? `🏦 **Players beat the house by ${money(team)}** · ${day(from)} to ${day(to)} 🎉` : `🏦 **The house took ${money(-team)}** · ${day(from)} to ${day(to)}. Run it back.`;
  const lines = [head];
  if (won) lines.push(`${streak >= 2 ? `🔥 ${streak} weeks in a row. ` : ''}Everyone who played gets the **Bust the House** title${streak >= TEAM.streak ? ' and the **Bank Run** bar' : ''}.`);
  if (n) lines.push(`💰 **+${money(each)}** to all ${n} player${n === 1 ? '' : 's'} who bet ${money(TEAM.minBet)}+ (${money(TEAM.playing)} for playing${won ? ` + ${money(TEAM.win)} team bonus` : ''}).`);
  lines.push('-# New week starts now · /house shows the score');
  return lines.join('\n');
}

const LABEL = { blackjack: 'blackjack', 'free bet': 'free bet', madness: 'madness', UTH: 'UTH', baccarat: 'baccarat', roulette: 'roulette', rakeback: 'rakeback', jackpot: 'jackpot' };
const sg = n => (n < 0 ? '−' : '+') + money(Math.abs(n));
/** The public /house embed (D1): players vs the house this week. */
export async function houseEmbed(now = Date.now()) {
  const wk = weekKey(now);
  const [hs, net, vol, tm] = await kv(['HGETALL', 'hs:wk:' + wk], ['HGETALL', 'rb:wk:' + wk], ['HGETALL', 'rb:vol:' + wk], ['HGETALL', 'tm']);
  const owed = owedFrom(net, vol), team = teamNet(hs, owed), up = team > 0, t = pairs(tm);
  const pos = Math.round(5 - Math.max(-1, Math.min(1, team / TEAM.cap)) * 5);
  const meter = 'Players ' + '▬'.repeat(pos) + '🔘' + '▬'.repeat(10 - pos) + ' House';
  const rows = teamLines(hs, owed).map(l => (LABEL[l.k] || l.k).padEnd(10) + sg(l.players).padStart(12) + '  ' + (l.players >= 0 ? '🟢' : '🔴'));
  const players = Object.keys(pairs(vol)).length;
  return { color: up ? 0x5fd38d : 0xff6b7d, title: '🏦 Players vs the House',
    description: [`**${up ? `🟢 Players are up ${money(team)}` : `🔴 The house is up ${money(-team || 0)}`} this week**`, meter, goalLine(team, weekStart(now) + WEEK, now)].join('\n'),
    fields: [
      { name: `This week · ${players} player${players === 1 ? '' : 's'}`, value: rows.length ? '```\n' + rows.join('\n') + '\n```' : 'Nobody has played yet.' },
      { name: 'Monday', value: `Bet ${money(TEAM.minBet)}+ → **${money(TEAM.playing)}**. Players win → **+${money(TEAM.win)}** each + **Bust the House** title${+t.streak ? ` · 🔥 ${t.streak} week${+t.streak === 1 ? '' : 's'} in a row` : ''}` },
    ],
    footer: { text: '+ = players won · thepoker.study/casino' } };
}
