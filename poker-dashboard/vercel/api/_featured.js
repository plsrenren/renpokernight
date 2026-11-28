// Game of the Week (Nov 26 2026, Renato's pick, mockup https://claude.ai/artifact/WzSVBFfwQPHRjNk2CA4aov).
// One house game is featured each casino week (weeks start Monday 16:00 UTC, same as the rakeback week), in a fixed rotation:
// blackjack -> UTH -> free bet -> baccarat -> roulette -> around again (the week of Nov 23 2026 is roulette, the site roulette launch).
//   - Losing hands on the featured game put GOTW.cut (4%) into the mystery jackpot instead of JP.cut (2%), see jackpotCmds.
//     A bigger slice also makes those hands twice as likely to be the one that crosses the secret drop point, so the
//     "double odds" need no rule of their own.
//   - Headliner: highest PEAK net on the featured game that week (best running total at any point, Renato's call Nov 28 2026,
//     so cashing out on top isn't punished by playing on), GOTW.minHands hands or more by the end of the week (ties: more hands).
//     Monday's cron (roles.js ?weekly=1) bumps ac:n:<id> gwwin, checkAccolades stamps the title, and one
//     #casino post names the winner and kicks off the new week's game.
//   - Titles (ACC in loot.js): Headliner (gwwin 1), Floor Favorite (gwwin 3), VIP (gwbest 4 = minHands+ featured hands 4 weeks
//     running; gwrun/gwbest kept by awardWeek, gw:run = who has a run going), Comped (gwjack, bumped by the jackpot Lua on a featured hand).
// Live table hands count too: they go through feedCmds like every other house hand.
// Redis: gw:<week> (id -> net on the featured game), gw:n:<week> (id -> hands), gw:pk:<week> (id -> peak net), 30 days; gw:done:<week> (award paid once).
import { kv, money, weekKey, weekStart, paydayStart } from './_blackjack.js';
import { postCasino } from './_rewards.js';

export const GOTW = { cut: 0.04, minHands: 20, near: 5 };
export const FEATURED = ['blackjack', 'UTH', 'free bet', 'baccarat', 'roulette'];
export const GAME_INFO = {
  blackjack: { name: 'Blackjack', short: 'Blackjack', cmd: '/blackjack', route: 'blackjack', color: 0xf1c75b, css: '#f1c75b' },
  UTH: { name: "Ultimate Texas Hold'em", short: 'UTH', cmd: '/uth', route: 'uth', color: 0x8f78f0, css: '#8f78f0' },
  'free bet': { name: 'Free Bet Blackjack', short: 'Free Bet', cmd: '/freebet', route: 'freebet', color: 0xe0507f, css: '#e0507f' },
  baccarat: { name: 'Baccarat', short: 'Baccarat', cmd: '/baccarat', route: 'baccarat', color: 0x7fb6ff, css: '#7fb6ff' },
  roulette: { name: 'Roulette', short: 'Roulette', cmd: '/roulette', route: 'roulette', color: 0x8ee0b0, css: '#8ee0b0' },
};
const WEEK = 7 * 864e5, ANCHOR = Date.UTC(2026, 10, 23), ANCHOR_IDX = 4, KEEP = 30 * 86400;
const SITE = 'https://www.thepoker.study';
// one more week in a row for VIP: gwrun + 1, keep the best in gwbest
const RUN = "local r=redis.call('HINCRBY',KEYS[1],'gwrun',1) if r>tonumber(redis.call('HGET',KEYS[1],'gwbest') or '0') then redis.call('HSET',KEYS[1],'gwbest',r) end return r";

/** The featured game ('blackjack' | 'UTH' | 'free bet' | 'baccarat' | 'roulette') for the casino week holding `now`. */
export function featuredGame(now = Date.now()) {
  const n = Math.round((Date.parse(weekKey(now)) - ANCHOR) / WEEK);
  return FEATURED[(((n + ANCHOR_IDX) % FEATURED.length) + FEATURED.length) % FEATURED.length];
}
/** When this week's game switches (ms). */
export const featuredEnds = (now = Date.now()) => weekStart(now) + WEEK;

// one command per featured hand: net + hand count + peak net for the week, kept 30 days
const COUNT = "local t=redis.call('HINCRBYFLOAT',KEYS[1],ARGV[1],ARGV[2]) local n=tonumber(t) redis.call('HINCRBY',KEYS[2],ARGV[1],1) "
  + "local p=redis.call('HGET',KEYS[3],ARGV[1]) if (not p) or n>tonumber(p) then redis.call('HSET',KEYS[3],ARGV[1],t) end "
  + "for i=1,3 do redis.call('EXPIRE',KEYS[i],ARGV[3]) end return 1";
/** Headliner race counters for one finished house hand ([] unless it was the featured game). Appended by feedCmds. */
export function featuredCmds(id, game, net) {
  if (!id || game !== featuredGame()) return [];
  const wk = weekKey();
  return [['EVAL', COUNT, 3, 'gw:' + wk, 'gw:n:' + wk, 'gw:pk:' + wk, id, Math.round((+net || 0) * 100) / 100, KEEP]];
}
/** Redis reads for the lobby's race box (this week). */
export const raceReads = (now = Date.now()) => [['HGETALL', 'gw:' + weekKey(now)], ['HGETALL', 'gw:n:' + weekKey(now)], ['HGETALL', 'gw:pk:' + weekKey(now)]];

const pairs = a => { const o = {}; for (let k = 0; k < (a || []).length; k += 2) o[a[k]] = a[k + 1]; return o; };
const r2 = x => Math.round((+x || 0) * 100) / 100;
/** [{ id, name, net, peak, hands, ok }] best first: qualified (minHands+) players by peak net, then the rest. nameOf(id) -> shown name.
 *  Peak = best running net this week; hands from before peaks were kept (Nov 28 2026) fall back to the current net. */
export function race(netRaw, nRaw, pkRaw, nameOf = () => 'Someone') {
  const net = pairs(netRaw), n = pairs(nRaw), pk = pairs(pkRaw);
  return Object.keys(n).map(id => { const now = r2(net[id]); return { id, name: nameOf(id), net: now, peak: pk[id] != null ? Math.max(r2(pk[id]), now) : now, hands: +n[id] || 0 }; })
    .map(r => ({ ...r, ok: r.hands >= GOTW.minHands }))
    .sort((a, b) => (b.ok - a.ok) || (b.peak - a.peak) || (b.hands - a.hands));
}
/** The week's winner: top qualified player whose peak was up on the game, or null. */
export const winnerOf = list => list.find(r => r.ok && r.peak > 0) || null;

/** What the lobby shows: this week's game, when it switches, the race (top 5) and your own line. */
export function featuredView(netRaw, nRaw, pkRaw, nameOf, meId, now = Date.now()) {
  const game = featuredGame(now), list = race(netRaw, nRaw, pkRaw, nameOf), mine = list.find(r => r.id === meId);
  return { game, ...GAME_INFO[game], ends: featuredEnds(now), cut: GOTW.cut, minHands: GOTW.minHands,
    race: list.slice(0, 5), me: meId ? { net: mine ? mine.net : 0, peak: mine ? mine.peak : 0, hands: mine ? mine.hands : 0, rank: mine && mine.ok ? list.filter(r => r.ok).indexOf(mine) + 1 : null } : null };
}

/** Monday (cron): names last week's Headliner once, moves VIP runs, then posts the new week's game in #casino. */
export async function awardWeek(now = Date.now(), pot = null) {
  const last = weekKey(weekStart(now) - 1), lastGame = featuredGame(weekStart(now) - 1), game = featuredGame(now), G = GAME_INFO[game];
  const [first] = await kv(['SET', 'gw:done:' + last, String(now), 'NX', 'EX', 120 * 86400]);
  if (!first) return { week: last, skipped: 'already done' };
  const [netRaw, nRaw, pkRaw, names, runs] = await kv(['HGETALL', 'gw:' + last], ['HGETALL', 'gw:n:' + last], ['HGETALL', 'gw:pk:' + last], ['HGETALL', 'bj:name'], ['SMEMBERS', 'gw:run']);
  const nm = pairs(names), list = race(netRaw, nRaw, pkRaw, id => nm[id] || 'Someone'), w = winnerOf(list);
  // VIP: weeks in a row with minHands+ featured hands (a week without them ends the run)
  const ok = list.filter(r => r.ok).map(r => r.id), broke = (runs || []).filter(id => !ok.includes(id));
  const cmds = [...ok.flatMap(id => [['EVAL', RUN, 1, 'ac:n:' + id], ['SADD', 'ac:dirty', id]]), ...broke.map(id => ['HSET', 'ac:n:' + id, 'gwrun', 0]),
    ['DEL', 'gw:run'], ...(ok.length ? [['SADD', 'gw:run', ...ok]] : [])];
  if (w) cmds.push(['HINCRBY', 'ac:n:' + w.id, 'gwwin', 1], ['SADD', 'ac:dirty', w.id]);
  await kv(...cmds);
  const lines = [];
  if (w) lines.push(`🏆 **Headliner:** <@${w.id}>, peaked at **+${money(w.peak)}** on ${GAME_INFO[lastGame].short} over ${w.hands} hands. New title unlocked.`);
  const embed = { color: G.color, title: `⭐ Game of the Week: ${G.name}`, url: `${SITE}/casino#${G.route}`,
    description: `Every losing ${G.short} hand puts **${Math.round(GOTW.cut * 100)}%** into the mystery jackpot this week (other games 2%), so ${G.short} hands are twice as likely to drop it.\n`
      + `Highest ${G.short} peak by next Monday (your best point of the week, ${GOTW.minHands}+ hands) is the week's **Headliner**.`,
    fields: [...(pot != null ? [{ name: 'Jackpot now', value: money(pot), inline: true }] : []),
      { name: 'Ends', value: `<t:${Math.floor(featuredEnds(now) / 1000)}:F>`, inline: true },
      { name: 'Play', value: `\`${G.cmd}\` or the site`, inline: true }] };
  let posted;
  try { posted = await postCasino({ content: lines.join('\n') || undefined, embeds: [embed], allowed_mentions: { parse: [] } }); } catch (e) { console.error('gotw post', e); posted = 'failed: ' + e.message; }
  return { week: last, lastGame, winner: w ? { name: w.name, net: w.net, peak: w.peak, hands: w.hands } : null, game, posted };
}

/** Thursday (cron, 16:05 UTC, right after payday's reset): one #casino post with the Headliner race so far. Top 3 by peak (only peaks
 *  above $0, nobody's losses), who's close to qualifying (GOTW.near+ hands, under minHands), the jackpot. Once per week (gw:mid:<week>),
 *  refused before Thursday's payday reset, so any caller is harmless. 1 SET + 5 reads. Renato's pick Nov 28 2026. */
export async function midweekPost(now = Date.now()) {
  const wk = weekKey(now), game = featuredGame(now), G = GAME_INFO[game];
  if (paydayStart(now) < weekStart(now)) return { week: wk, skipped: 'before Thursday' };
  const [first] = await kv(['SET', 'gw:mid:' + wk, String(now), 'NX', 'EX', 30 * 86400]);
  if (!first) return { week: wk, skipped: 'already posted' };
  const [netRaw, nRaw, pkRaw, names, jpRaw] = await kv(['HGETALL', 'gw:' + wk], ['HGETALL', 'gw:n:' + wk], ['HGETALL', 'gw:pk:' + wk], ['HGETALL', 'bj:name'], ['HGET', 'jp', 'pot']);
  const nm = pairs(names), list = race(netRaw, nRaw, pkRaw, id => nm[id] || 'Someone');
  const top = list.filter(r => r.ok && r.peak > 0).slice(0, 3);
  const near = list.filter(r => !r.ok && r.hands >= GOTW.near).sort((a, b) => b.hands - a.hands).slice(0, 4);
  const pot = jpRaw == null ? null : Math.round(+jpRaw * 100) / 100;
  const lines = [];
  lines.push(top.length ? top.map((r, i) => `**${i + 1}.** ${r.name}, peak **+${money(r.peak)}** · ${r.hands} hands`).join('\n')
    : `Nobody has qualified up yet. ${GOTW.minHands} ${G.short} hands and a winning run takes the lead.`);
  if (near.length) lines.push(`Close to qualifying: ${near.map(r => `**${r.name}** (${r.hands} of ${GOTW.minHands})`).join(', ')}`);
  if (pot != null) lines.push(`Jackpot now **${money(pot)}**, and ${G.short} hands feed it double.`);
  const embed = { color: G.color, title: `⭐ Headliner race: ${G.name}, halfway`, url: `${SITE}/casino#${G.route}`, description: lines.join('\n\n'),
    fields: [{ name: 'Ends', value: `<t:${Math.floor(featuredEnds(now) / 1000)}:F>`, inline: true }, { name: 'Play', value: `\`${G.cmd}\` or the site`, inline: true }],
    footer: { text: 'Headliner = highest peak this week, 20+ hands' } };
  let posted;
  try { posted = await postCasino({ embeds: [embed], allowed_mentions: { parse: [] } }); } catch (e) { console.error('gotw midweek', e); posted = 'failed: ' + e.message; }
  return { week: wk, game, top: top.map(r => ({ name: r.name, peak: r.peak, hands: r.hands })), near: near.map(r => ({ name: r.name, hands: r.hands })), posted };
}

// Discord replies on the featured game get a "⭐ Game of the Week" footer (no jackpot talk in game replies, by request).
const BY_CMD = { blackjack: 'blackjack', freebet: 'free bet', uth: 'UTH', baccarat: 'baccarat', roulette: 'roulette', ba: 'baccarat', ro: 'roulette' };
/** Wraps an interaction reply: adds the footer tag when the reply is a table on this week's game. Anything odd = unchanged. */
export async function featuredTag(res, i) {
  try {
    if (!res || !(res.headers.get('content-type') || '').includes('application/json')) return res;
    const j = JSON.parse(await res.clone().text()), d = j && j.data, e = d && d.embeds && d.embeds[0];
    if (!e || (d.flags & 64) || ![4, 7].includes(j.type)) return res;
    const key = i.type === 2 ? i.data.name : String(i.data.custom_id || '').split(':')[0];
    let game = BY_CMD[key];
    if (key === 'bj') { const t = `${e.title || ''} ${(e.footer && e.footer.text) || ''}`; game = /Madness|Double as often/.test(t) ? 'madness' : /Free Bet|Free doubles/.test(t) ? 'free bet' : 'blackjack'; }
    if (!game || game !== featuredGame()) return res;
    const was = (e.footer && e.footer.text) || '';
    if (was.startsWith('⭐')) return res;
    e.footer = { ...(e.footer || {}), text: ('⭐ Game of the Week' + (was ? ' · ' + was : '')).slice(0, 2000) };
    return new Response(JSON.stringify(j), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err) { return res; }
}
