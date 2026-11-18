// Casino accolades: titles, pfp borders and a sticker that unlock on their own from casino play (the list and looks are
// ACC in ../loot.js). Nobody sees the numbers behind them; an unlocked one just shows up in /loadout and /shop with a short
// note on how it was earned, and the bot posts a one-line note in #casino.
// Where the numbers come from:
//   ac:n:<id>      hands per house game, /daily claims, tips, blackjacks, royals, lone-number roulette wins (statCmds in _blackjack.js)
//   du:rec         duel wins per pair of players (_duel.js)
//   bj:bal         chips (minus tips received) and who is #1 right now (Chip Leader, the only one that isn't kept)
//   sh:packs, sh:own:<id>   packs opened and the collection (_shop.js)
//   rb:vol:<week>, rb:wk:<week>   what each player bet / won at the house games per casino week (_blackjack.js houseCmds)
//   lt:draw:<quarter>   lottery winners (_lottery.js)
// Unlocked ones are kept in ac:own:<id> (hash accolade key -> when), so they stay even if a number drops later.
// checkAccolades() runs after every bot and site request (waitUntil, after the answer is sent) for the players in ac:dirty,
// which every finished hand, claim, tip, duel and pack adds to. The very first run checks everyone and posts one launch note.
// weeklyAccolades() runs from the Monday cron (after rakeback) for High Roller, Beat the House, Whale and Regular.
import { kv, boardFrom, weekStart, HOUSE_GAMES } from './_blackjack.js';
import { postCasino } from './_rewards.js';
import { ACC, ITEMS, accItem } from '../loot.js';

/** how much of each thing unlocks what */
export const NEED = { duelist: 10, gun: 50, nemesis: 10, whale: 10000, stacked: 5000, bigstack: 10000, mountain: 25000,
  packrat: 25, epic: 10, coll: 50, clockedin: 30, hands: 250, cardshark: 1000, natural: 25, regular: 4 };
/** the first casino week with weekly totals (the house books started then) */
export const FIRST_WEEK = Date.UTC(2026, 10, 16, 16);
const WEEK = 7 * 864e5, DAY_KEEP = 400 * 86400;
const pairs = a => { const o = {}; for (let k = 0; k < (a || []).length; k += 2) o[a[k]] = a[k + 1]; return o; };
const num = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v || 0]));
const KEYS = new Set(ACC.map(a => a.k));

/** duel wins from du:rec (field "<lo id>:<hi id>:<winner id>" -> wins): { id: { wins, best } } (best = most wins vs one person) */
export function duelStats(raw) {
  const out = {};
  for (const [f, v] of Object.entries(pairs(raw))) {
    const w = f.split(':')[2], n = +v || 0;
    if (!w || !n) continue;
    const s = out[w] ||= { wins: 0, best: 0 };
    s.wins += n; s.best = Math.max(s.best, n);
  }
  return out;
}

/** who is #1 on /chips right now (same order as the leaderboard), or null */
export function leaderFrom(balRaw) { const top = boardFrom(balRaw, [])[0]; return top && top.bal > 0 ? top.id : null; }

/** the accolade keys someone has earned from their numbers (not the weekly ones and not Chip Leader).
 *  st = { n: ac:n numbers, bal, packs, owned: {item id: copies}, duel: {wins, best}, weekVol, lucky } */
export function earnedFrom(st) {
  const n = st.n || {}, out = new Set(), d = st.duel || { wins: 0, best: 0 }, add = (k, ok) => { if (ok) out.add(k); };
  add('duelist', d.wins >= NEED.duelist); add('gun', d.wins >= NEED.gun); add('nemesis', d.best >= NEED.nemesis);
  add('whale', (st.weekVol || 0) >= NEED.whale);
  const chips = (st.bal || 0) - Math.max(0, n.tips || 0); // chips other people tipped you don't count
  add('stacked', chips >= NEED.stacked); add('bigstack', chips >= NEED.bigstack); add('mountain', chips >= NEED.mountain);
  const mine = ITEMS.filter(i => (st.owned || {})[i.id] > 0);
  add('packrat', (st.packs || 0) >= NEED.packrat); add('coll', mine.length >= NEED.coll); add('epic', mine.filter(i => i.tier === 'Epic').length >= NEED.epic);
  add('clockedin', (n.daily || 0) >= NEED.clockedin);
  for (const a of ACC) if (a.hands) add(a.k, (n[a.hands] || 0) >= NEED.hands);
  add('cardshark', [...HOUSE_GAMES].reduce((t, g) => t + (n[g] || 0), 0) >= NEED.cardshark);
  add('natural', (n.naturals || 0) >= NEED.natural); add('royal', (n.royal || 0) >= 1); add('believer', (n.believer || 0) >= 1);
  add('lucky', !!st.lucky);
  return out;
}

/** weekly ones for week i of weeks = [{ wk, vol: {id: bet}, net: {id: net} }] (oldest first, one per casino week, gaps allowed as empty):
 *  { id: [keys] } for High Roller (most bet, ties share it), Beat the House (finished up), Whale ($10k bet), Regular (played 4 weeks running) */
export function weeklyFrom(weeks, i) {
  const w = weeks[i], out = {}, add = (id, k) => (out[id] ||= []).push(k);
  const vol = w.vol || {}, net = w.net || {};
  const top = Math.max(0, ...Object.values(vol));
  for (const [id, v] of Object.entries(vol)) {
    if (top > 0 && v === top) add(id, 'high');
    if (v >= NEED.whale) add(id, 'whale');
    if (i >= NEED.regular - 1 && weeks.slice(i - NEED.regular + 1, i + 1).every(x => ((x.vol || {})[id] || 0) > 0)) add(id, 'regular');
  }
  for (const [id, v] of Object.entries(net)) if (v > 0.004) add(id, 'house');
  return out;
}

/** the earned item ids someone can wear now: their kept accolades plus Chip Leader while they're #1. ownRaw = HGETALL ac:own:<id> */
export function earnedIds(uid, ownRaw, balRaw) {
  const ids = Object.keys(pairs(ownRaw)).filter(k => KEYS.has(k) && k !== 'leader').map(k => 'a:' + k);
  if (uid && leaderFrom(balRaw) === uid) ids.push('a:leader');
  return ids;
}

/** keeps (HSETNX) the new ones and returns what was really new: [{ id, keys }]. got = { id: [keys] } */
async function stamp(got, now) {
  const list = Object.entries(got).flatMap(([id, keys]) => [...new Set(keys)].filter(k => KEYS.has(k) && k !== 'leader').map(k => [id, k]));
  if (!list.length) return [];
  const res = await kv(...list.map(([id, k]) => ['HSETNX', 'ac:own:' + id, k, String(now)]));
  const out = {};
  list.forEach(([id, k], j) => { if (+res[j] === 1) (out[id] ||= []).push(k); });
  return Object.entries(out).map(([id, keys]) => ({ id, keys }));
}

const nameOf = k => accItem('a:' + k).name, whyOf = k => accItem('a:' + k).why;
const clip = t => t.length > 1990 ? t.slice(0, 1985) + '…' : t;
const FOOT = '-# Wear it with /loadout or on the site shop';
/** the #casino note for new unlocks. Mentions show names without pinging anyone. */
export function unlockText(news, head = '') {
  const lines = news.map(({ id, keys }) => keys.length === 1 ? `🏅 <@${id}> unlocked **${nameOf(keys[0])}** · ${whyOf(keys[0])}`
    : `🏅 <@${id}> unlocked ${keys.map(k => `**${nameOf(k)}**`).join(', ')}`);
  return clip([head, ...lines, FOOT].filter(Boolean).join('\n'));
}
/** the one-time note when accolades go live: everyone's already-earned ones, one line each */
export const launchText = news => clip([LAUNCH_HEAD, ...news.map(({ id, keys }) => `<@${id}> ${keys.map(k => `**${nameOf(k)}**`).join(', ')}`), FOOT].join('\n'));
export const LAUNCH_HEAD = '🏅 **Casino accolades are here.** Titles, pfp borders and a sticker you earn by playing. They show up in /loadout and the site shop with how you earned them. Already earned:';
const post = async text => { try { return await postCasino({ content: text, allowed_mentions: { parse: [] } }); } catch (e) { console.error('accolade post', e); return 'failed: ' + e.message; } };

/** Checks players for new accolades, keeps them and posts the note. all = everyone with chips (the cron). ids = { sheet name: Discord id }
 *  (only used to match an older lottery draw that has no id stored). Returns a short report. */
export async function checkAccolades({ all = false, ids = null, now = Date.now(), quiet = false } = {}) {
  const [init] = await kv(['SET', 'ac:init', String(now), 'NX']);
  const launch = !!init;
  let uids;
  if (launch || all) {
    const [everyone, dirty] = await kv(['HKEYS', 'bj:bal'], ['SMEMBERS', 'ac:dirty']);
    uids = [...new Set([...(everyone || []), ...(dirty || [])])];
    if ((dirty || []).length) await kv(['SREM', 'ac:dirty', ...dirty]);
  } else {
    const [popped] = await kv(['SPOP', 'ac:dirty', 100]);
    uids = popped ? [].concat(popped) : [];
  }
  uids = uids.filter(u => /^\d{5,25}$/.test(u));
  if (!uids.length) return { checked: 0 };
  const wk = new Date(weekStart(now)).toISOString().slice(0, 10);
  const per = uid => [['HGETALL', 'ac:n:' + uid], ['HGET', 'bj:bal', uid], ['HGET', 'sh:packs', uid], ['HGETALL', 'sh:own:' + uid], ['HGET', 'rb:vol:' + wk, uid]];
  const res = await kv(['HGETALL', 'du:rec'], ['GET', 'lt:last'], ...uids.flatMap(per));
  const duels = duelStats(res[0]);
  let luckyId = null;
  if (res[1]) {
    const [raw] = await kv(['GET', 'lt:draw:' + res[1]]);
    try { const d = JSON.parse(raw || 'null'); luckyId = d && (d.id || (ids && ids[d.name])) || null; } catch (e) { luckyId = null; }
  }
  const got = {};
  uids.forEach((uid, j) => {
    const [n, bal, packs, own, weekVol] = res.slice(2 + j * 5, 7 + j * 5);
    const keys = earnedFrom({ n: num(pairs(n)), bal: +bal || 0, packs: +packs || 0, owned: num(pairs(own)), duel: duels[uid], weekVol: +weekVol || 0, lucky: uid === luckyId });
    if (keys.size) got[uid] = [...keys];
  });
  const news = await stamp(got, now);
  let posted = null;
  if (news.length && !quiet) posted = await post(launch ? launchText(news) : unlockText(news));
  return { checked: uids.length, launch, unlocked: news, posted };
}

/** Monday cron: hands out the weekly ones for every finished casino week not done yet (each week once). */
export async function weeklyAccolades(now = Date.now(), quiet = false) {
  const lastDone = weekStart(now) - WEEK, key = t => new Date(t).toISOString().slice(0, 10);
  const todo = [];
  for (let t = FIRST_WEEK; t <= lastDone; t += WEEK) todo.push(t);
  if (!todo.length) return { weeks: [] };
  const fresh = await kv(...todo.map(t => ['SET', 'ac:wk:' + key(t), String(now), 'NX', 'EX', DAY_KEEP]));
  const go = todo.filter((t, j) => fresh[j]);
  if (!go.length) return { weeks: [] };
  // each week needs the 3 before it too (Regular)
  const span = []; for (let t = Math.max(FIRST_WEEK, go[0] - (NEED.regular - 1) * WEEK); t <= go[go.length - 1]; t += WEEK) span.push(t);
  const raw = await kv(...span.flatMap(t => [['HGETALL', 'rb:vol:' + key(t)], ['HGETALL', 'rb:wk:' + key(t)]]));
  const weeks = span.map((t, j) => ({ t, wk: key(t), vol: num(pairs(raw[j * 2])), net: num(pairs(raw[j * 2 + 1])) }));
  const got = {};
  for (const t of go) { const i = weeks.findIndex(w => w.t === t); for (const [id, keys] of Object.entries(weeklyFrom(weeks, i))) (got[id] ||= []).push(...keys); }
  const news = await stamp(got, now);
  const posted = news.length && !quiet ? await post(unlockText(news)) : null;
  return { weeks: go.map(key), unlocked: news, posted };
}
