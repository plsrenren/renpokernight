// Game of the Week (Nov 26 2026, Renato's pick, mockup https://claude.ai/artifact/WzSVBFfwQPHRjNk2CA4aov).
// One house game is featured each casino week (weeks start Monday 16:00 UTC, same as rakeback), in a fixed rotation:
// blackjack -> UTH -> free bet -> baccarat -> roulette -> around again (the week of Nov 23 2026 is roulette, the site roulette launch).
//   - Losing hands on the featured game put GOTW.cut (4%) into the mystery jackpot instead of JP.cut (2%), see jackpotCmds.
//     A bigger slice also makes those hands twice as likely to be the one that crosses the secret drop point, so the
//     "double odds" need no rule of their own.
//   - Headliner: biggest net win on the featured game that week, GOTW.minHands hands or more (ties: more hands).
//     Monday's cron (roles.js ?rakeback=1, after rakeback) bumps ac:n:<id> gwwin, checkAccolades stamps the title, and one
//     #casino post names the winner and kicks off the new week's game.
//   - Titles (ACC in loot.js): Headliner (gwwin 1), Floor Favorite (gwwin 3), VIP (gwbest 4 = minHands+ featured hands 4 weeks
//     running; gwrun/gwbest kept by awardWeek, gw:run = who has a run going), Comped (gwjack, bumped by the jackpot Lua on a featured hand).
// Live table hands count too: they go through feedCmds like every other house hand.
// Redis: gw:<week> (id -> net on the featured game), gw:n:<week> (id -> hands), 30 days; gw:done:<week> (award paid once).
import { kv, money, weekKey, weekStart } from './_blackjack.js';
import { postCasino } from './_rewards.js';

export const GOTW = { cut: 0.04, minHands: 20 };
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

// one command per featured hand: net + hand count for the week, kept 30 days
const COUNT = "redis.call('HINCRBYFLOAT',KEYS[1],ARGV[1],ARGV[2]) redis.call('HINCRBY',KEYS[2],ARGV[1],1) redis.call('EXPIRE',KEYS[1],ARGV[3]) redis.call('EXPIRE',KEYS[2],ARGV[3]) return 1";
/** Headliner race counters for one finished house hand ([] unless it was the featured game). Appended by feedCmds. */
export function featuredCmds(id, game, net) {
  if (!id || game !== featuredGame()) return [];
  const wk = weekKey();
  return [['EVAL', COUNT, 2, 'gw:' + wk, 'gw:n:' + wk, id, Math.round((+net || 0) * 100) / 100, KEEP]];
}
/** Redis reads for the lobby's race box (this week). */
export const raceReads = (now = Date.now()) => [['HGETALL', 'gw:' + weekKey(now)], ['HGETALL', 'gw:n:' + weekKey(now)]];

const pairs = a => { const o = {}; for (let k = 0; k < (a || []).length; k += 2) o[a[k]] = a[k + 1]; return o; };
/** [{ id, name, net, hands, ok }] best first: qualified (minHands+) players by net, then the rest. nameOf(id) -> shown name. */
export function race(netRaw, nRaw, nameOf = () => 'Someone') {
  const net = pairs(netRaw), n = pairs(nRaw);
  return Object.keys(n).map(id => ({ id, name: nameOf(id), net: Math.round((+net[id] || 0) * 100) / 100, hands: +n[id] || 0 }))
    .map(r => ({ ...r, ok: r.hands >= GOTW.minHands }))
    .sort((a, b) => (b.ok - a.ok) || (b.net - a.net) || (b.hands - a.hands));
}
/** The week's winner: top qualified player who's up on the game, or null. */
export const winnerOf = list => list.find(r => r.ok && r.net > 0) || null;

/** What the lobby shows: this week's game, when it switches, the race (top 5) and your own line. */
export function featuredView(netRaw, nRaw, nameOf, meId, now = Date.now()) {
  const game = featuredGame(now), list = race(netRaw, nRaw, nameOf), mine = list.find(r => r.id === meId);
  return { game, ...GAME_INFO[game], ends: featuredEnds(now), cut: GOTW.cut, minHands: GOTW.minHands,
    race: list.slice(0, 5), me: meId ? { net: mine ? mine.net : 0, hands: mine ? mine.hands : 0, rank: mine && mine.ok ? list.filter(r => r.ok).indexOf(mine) + 1 : null } : null };
}

/** Monday (cron, after rakeback): names last week's Headliner once, moves VIP runs, then posts the new week's game in #casino. */
export async function awardWeek(now = Date.now(), pot = null) {
  const last = weekKey(weekStart(now) - 1), lastGame = featuredGame(weekStart(now) - 1), game = featuredGame(now), G = GAME_INFO[game];
  const [first] = await kv(['SET', 'gw:done:' + last, String(now), 'NX', 'EX', 120 * 86400]);
  if (!first) return { week: last, skipped: 'already done' };
  const [netRaw, nRaw, names, runs] = await kv(['HGETALL', 'gw:' + last], ['HGETALL', 'gw:n:' + last], ['HGETALL', 'bj:name'], ['SMEMBERS', 'gw:run']);
  const nm = pairs(names), list = race(netRaw, nRaw, id => nm[id] || 'Someone'), w = winnerOf(list);
  // VIP: weeks in a row with minHands+ featured hands (a week without them ends the run)
  const ok = list.filter(r => r.ok).map(r => r.id), broke = (runs || []).filter(id => !ok.includes(id));
  const cmds = [...ok.flatMap(id => [['EVAL', RUN, 1, 'ac:n:' + id], ['SADD', 'ac:dirty', id]]), ...broke.map(id => ['HSET', 'ac:n:' + id, 'gwrun', 0]),
    ['DEL', 'gw:run'], ...(ok.length ? [['SADD', 'gw:run', ...ok]] : [])];
  if (w) cmds.push(['HINCRBY', 'ac:n:' + w.id, 'gwwin', 1], ['SADD', 'ac:dirty', w.id]);
  await kv(...cmds);
  const lines = [];
  if (w) lines.push(`🏆 **Headliner:** <@${w.id}>, **+${money(w.net)}** on ${GAME_INFO[lastGame].short} over ${w.hands} hands. New title unlocked.`);
  const embed = { color: G.color, title: `⭐ Game of the Week: ${G.name}`, url: `${SITE}/casino#${G.route}`,
    description: `Every losing ${G.short} hand puts **${Math.round(GOTW.cut * 100)}%** into the mystery jackpot this week (other games 2%), so ${G.short} hands are twice as likely to drop it.\n`
      + `Biggest ${G.short} winner by next Monday (${GOTW.minHands}+ hands) is the week's **Headliner**.`,
    fields: [...(pot != null ? [{ name: 'Jackpot now', value: money(pot), inline: true }] : []),
      { name: 'Ends', value: `<t:${Math.floor(featuredEnds(now) / 1000)}:F>`, inline: true },
      { name: 'Play', value: `\`${G.cmd}\` or the site`, inline: true }] };
  let posted;
  try { posted = await postCasino({ content: lines.join('\n') || undefined, embeds: [embed], allowed_mentions: { parse: [] } }); } catch (e) { console.error('gotw post', e); posted = 'failed: ' + e.message; }
  return { week: last, lastGame, winner: w ? { name: w.name, net: w.net, hands: w.hands } : null, game, posted };
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
