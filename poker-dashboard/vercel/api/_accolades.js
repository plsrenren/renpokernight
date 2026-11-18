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
// The home poker ones (poker: 1 in ACC) come from the sheet instead: pokerFrom() below, run by checkPoker() after each saved
// night and on the Monday cron (api/roles.js), past nights included; their notes go in #the-table.
// Unlocked ones are kept in ac:own:<id> (hash accolade key -> when), so they stay even if a number drops later.
// checkAccolades() runs after every bot and site request (waitUntil, after the answer is sent) for the players in ac:dirty,
// which every finished hand, claim, tip, duel and pack adds to. The very first run checks everyone and posts nothing (already-earned ones arrive quietly).
// weeklyAccolades() runs from the Monday cron (after rakeback) for High Roller, Beat the House, Whale and Regular.
import { kv, boardFrom, weekStart, HOUSE_GAMES } from './_blackjack.js';
import { postCasino, postChannel, nightRows, inServer } from './_rewards.js';
import { ACC, ITEMS, accItem } from '../loot.js';

/** how much of each thing unlocks what */
export const NEED = { wins3: 3, tourWins: 5, cashWins: 5, seconds: 5, nights25: 25, nights100: 100, bounty: 100, boughtIn: 1000, monster: 300, missed: 5,
  duelist: 10, gun: 50, nemesis: 10, whale: 10000, stacked: 5000, bigstack: 10000, mountain: 25000,
  packrat: 25, epic: 10, coll: 50, clockedin: 30, hands: 250, cardshark: 1000, natural: 25, regular: 4 };
/** Got the Milk only counts nights from here on (Renato: not for the past; the count started 4 nights before launch) */
export const MILK_FROM = '2026-09-19';
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
/** only the unlocks of people who are in the Discord server right now (they still keep the accolade either way) */
const onlyMembers = async news => { const ok = await inServer(news.map(x => x.id)); return news.filter(x => ok.has(x.id)); };
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
  // the first run hands out what people already earned before launch without posting anything (by request); only later unlocks post
  if (news.length && !quiet && !launch) { const shown = await onlyMembers(news); posted = shown.length ? await post(unlockText(shown)) : 'nobody in the server'; }
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
  const shown = news.length && !quiet ? await onlyMembers(news) : [];
  const posted = shown.length ? await post(unlockText(shown)) : null;
  return { weeks: go.map(key), unlocked: news, posted };
}

// ---------- home poker night (from the sheet) ----------
/** Places for one night's rows (same order as the chip rewards: tournaments by cash out, cash by net; only people who
 *  finished up, or cashed in a tournament): { player: place } with 1 = won, ties share a place. */
export function placesOf(list) {
  const tourney = list[0].type === 'Tournament', out = {};
  const ranked = list.filter(r => r.net > 0 || (tourney && r.cout > 0)).sort((a, b) => tourney ? (b.cout - a.cout) || (b.net - a.net) : b.net - a.net);
  let place = 0;
  ranked.forEach((r, k) => {
    const prev = ranked[k - 1], tied = prev && (tourney ? prev.cout === r.cout && prev.net === r.net : prev.net === r.net);
    if (!tied) place = k;
    out[r.player] = place + 1;
  });
  return out;
}

/** The poker accolade keys each player has earned from the Input rows (nightRows): { player name: Set(keys) }. */
export function pokerFrom(rows) {
  const nights = {}, byPlayer = {}, out = {};
  rows.forEach(r => { (nights[r.night] ||= []).push(r); (byPlayer[r.player] ||= []).push(r); });
  const place = {}; for (const [night, list] of Object.entries(nights)) place[night] = placesOf(list);
  const order = Object.keys(nights).sort();
  const add = (p, k) => (out[p] ||= new Set()).add(k);
  // Perfect Attendance: finished quarters only (a later quarter has a night), every night of it
  const qNights = {}; Object.keys(nights).forEach(n => (qNights[nights[n][0].quarter] ||= new Set()).add(n));
  const qKey = q => { const [n, y] = q.split(' '); return +y * 10 + +String(n).slice(1); };
  const lastQ = Math.max(...Object.keys(qNights).map(qKey));
  const finished = Object.keys(qNights).filter(q => qKey(q) < lastQ);
  // MLM Manager: a first-time player whose note says "brought by <name>" (same rule as the chip reward)
  const firstNight = {}, nameOf = {};
  rows.forEach(r => { const l = r.player.toLowerCase(); if (!(l in firstNight)) firstNight[l] = r.night; nameOf[l] = r.player; });
  rows.forEach(r => { const host = nameOf[(r.broughtBy || '').toLowerCase()]; if (r.broughtBy && firstNight[r.player.toLowerCase()] === r.night && host && host !== r.player) add(host, 'mlm'); });
  for (const [p, g] of Object.entries(byPlayer)) {
    const won = g.filter(r => place[r.night][p] === 1), tw = won.filter(r => r.type === 'Tournament').length, cw = won.length - tw;
    if (won.length >= 1) add(p, 'firstblood');
    if (won.length >= NEED.wins3) add(p, 'hattrick');
    if (g.some((r, k) => k && place[r.night][p] === 1 && place[g[k - 1].night][p] === 1)) add(p, 'backtoback');
    if (tw >= NEED.tourWins) add(p, 'laststanding');
    if (cw >= NEED.cashWins) add(p, 'payday');
    if (tw && cw) add(p, 'switchhitter');
    if (won.some(r => r.buys >= 2)) add(p, 'comebackkid');
    if (won.some(r => r.type === 'Tournament' && r.buys <= 1)) add(p, 'wiretowire');
    if (g.filter(r => place[r.night][p] === 2).length >= NEED.seconds) add(p, 'bubble');
    const played = new Set(g.map(r => r.night));
    if (played.size >= NEED.nights25) add(p, 'usualsuspect');
    if (played.size >= NEED.nights100) add(p, 'centurion');
    if (finished.some(q => [...qNights[q]].every(n => played.has(n)))) add(p, 'perfect');
    if (g.reduce((t, r) => t + (r.pko || 0), 0) >= NEED.bounty) add(p, 'headhunter');
    if (g.reduce((t, r) => t + (r.cin || 0), 0) >= NEED.boughtIn) add(p, 'sponsor');
    if (g.some(r => r.net >= NEED.monster)) add(p, 'monster');
    if (g.some(r => r.type !== 'Tournament' && r.cin > 0 && r.cout >= 2 * r.cin)) add(p, 'doubleup');
    // Got the Milk: back after missing 5+ nights in a row, counting only nights from MILK_FROM (and only after they'd played once)
    let gone = -1;
    for (const n of order) { if (played.has(n)) { if (gone >= NEED.missed && n >= MILK_FROM) add(p, 'gotmilk'); gone = 0; } else if (gone >= 0 && n >= MILK_FROM) gone++; }
  }
  return out;
}

/** After a night is saved (and on the Monday cron): keeps any new poker accolades for players with a Discord ID and posts
 *  the note in #the-table. The first run is silent: past nights are handed out without a note. ids = { sheet name: Discord id } */
export async function checkPoker(csv, ids, { now = Date.now(), quiet = false } = {}) {
  const byName = {}; for (const [name, id] of Object.entries(ids || {})) if (/^\d{5,25}$/.test(String(id))) byName[name.toLowerCase()] = String(id);
  const got = {};
  for (const [p, keys] of Object.entries(pokerFrom(nightRows(csv)))) { const id = byName[p.toLowerCase()]; if (id) (got[id] ||= []).push(...keys); }
  // ac:pseen = Discord ids already checked once. Someone whose ID is added to the Members tab later gets their past ones quietly
  // too (no catch-up note), same as everyone at launch; only unlocks after that post.
  const linked = Object.values(byName);
  const [init, ...fresh] = await kv(['SET', 'ac:pinit', String(now), 'NX'], ...linked.map(id => ['SADD', 'ac:pseen', id]));
  const firstLook = new Set(linked.filter((id, j) => +fresh[j] === 1));
  const news = await stamp(got, now);
  const loud = init ? [] : news.filter(x => !firstLook.has(x.id));
  let posted = null;
  // the first run quietly hands out everything earned on past nights (by request); only later unlocks post
  if (loud.length && !quiet) {
    try { const shown = await onlyMembers(loud); posted = shown.length ? await postChannel({ content: unlockText(shown), allowed_mentions: { parse: [] } }, 'table') : 'nobody in the server'; } catch (e) { console.error('poker accolade post', e); posted = 'failed: ' + e.message; }
  }
  return { players: Object.keys(got).length, launch: !!init, unlocked: news, posted };
}
