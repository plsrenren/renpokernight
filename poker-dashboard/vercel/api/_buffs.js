// Buffs (Nov 26 2026, Renato's picks): coming to the home poker game makes your /daily pay more for a while.
//   RSVP          +25%  reacted to the latest /game invite; lasts until game night ends, and turns into Showed Up once you played
//   Showed Up     +25%  played the last poker night you were at, for 14 days
//   Regular       +10%  played the last 3 game nights in a row (on top of Showed Up), for 21 days
//   Comeback Kid  +75%  played after missing 3+ game nights in a row, for 3 days (Nov 27 2026: a welcome-back burst, was 7)
//   Plus One      +50%  brought a first-timer (their note says "brought by <you>"), for 28 days (the prize buff)
//   Full House    +15%  played a night with FULL (8)+ players at the table, for 14 days (Nov 27 2026)
//   Team Spirit   +25%  bet $50+ at the house games in a week the players beat the house, until the next Monday settle (Nov 27 2026, see _team.js)
// They add up (no cap) and multiply the claim, weekly paycheck included: +35% turns $50 into $67.50.
// "N days" = until the daily reset (16:00 UTC) N+1 days after the night's date, so a night gives N boosted claims after it.
// Stored in Redis so a claim never waits on Google:
//   bf       hash   Discord ID -> JSON { show, reg, back, plus: night date 'YYYY-MM-DD', friend: name } (rewritten by roles.js after every save)
//   bf:rsvp  string JSON { ids: [...], end: ms, at: ms } of the newest invite (written by refreshInvite when the reactions change; expires with it)
//   bf:team  string JSON { ids: [...], until: ms, net } of last week's winning team (written by teamWeek on Monday when the players won; expires at until)
// Only players with a Discord ID on the Members tab get the poker ones (same as the name-based chip rewards). Pure functions only.

export const BUFFS = {
  rsvp: { name: 'RSVP', icon: '✉', pct: 0.25 },
  // Nov 27 2026 (Renato): lower % for longer, since game nights are ~20 days apart; same total value as before, but it carries to the next game
  show: { name: 'Showed Up', icon: '★', pct: 0.25, days: 14 },   // was +50% for 7 days
  reg: { name: 'Regular', icon: '♠', pct: 0.1, days: 21 },       // was +25% for 7 days
  back: { name: 'Comeback Kid', icon: '↺', pct: 0.75, days: 3 }, // a short welcome-back burst
  plus: { name: 'Plus One', icon: '+1', pct: 0.5, days: 28 },    // was +100% for 14 days
  full: { name: 'Full House', icon: '♣', pct: 0.15, days: 14 },  // was +25% for 7 days
  team: { name: 'Team Spirit', icon: '♦', pct: 0.25 },           // until the next Monday settle (bf:team)
};
export const FULL = 8;   // players at one night for Full House
export const AURA = 4;   // buffs running at once on a claim for the Aura Farmer title (Nov 27 2026)
const ORDER = ['rsvp', 'show', 'reg', 'back', 'plus', 'full', 'team'];
const DAY = 864e5;
/** When a buff from the night dated `key` ('YYYY-MM-DD') runs out: the daily reset days+1 after it (7 days unless the buff says otherwise). */
export const buffEnd = (key, k) => { const [y, m, d] = String(key).split('-').map(Number); return Date.UTC(y, m - 1, d + ((BUFFS[k] && BUFFS[k].days) || 7) + 1, 16); };
const nice = key => { const [y, m, d] = String(key).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };

/** Everyone's poker buffs from the sheet rows (nightRows in _rewards.js): { discordId: { show, reg, back, plus, friend } }.
 *  Only buffs still running at `now` are kept. */
export function buffsFrom(rows, ids = {}, now = Date.now()) {
  const dates = [...new Set(rows.map(r => r.key))].sort();
  const played = {}; rows.forEach(r => (played[r.player] ||= new Set()).add(r.key));
  const live = (key, k) => key && buffEnd(key, k) > now, out = {};
  const put = (name, k, v, extra) => { const id = ids[name]; if (!id || !live(v, k)) return; const b = out[id] ||= {}; if (!b[k] || b[k] < v) { b[k] = v; Object.assign(b, extra); } };
  for (const [p, set] of Object.entries(played)) {
    const mine = [...set].sort(), last = mine[mine.length - 1], at = dates.indexOf(last);
    put(p, 'show', last);
    // Regular: the last 3 game nights up to (and including) their latest one, all played
    if (at >= 2 && dates.slice(at - 2, at + 1).every(d => set.has(d))) put(p, 'reg', last);
    // Comeback Kid: they'd played before, then 3+ game nights went by without them
    const prev = mine[mine.length - 2];
    if (prev && at - dates.indexOf(prev) - 1 >= 3) put(p, 'back', last);
  }
  // Full House: played a night (one date, any game type) with FULL+ different players
  const seen = {}; rows.forEach(r => (seen[r.key] ||= new Set()).add(r.player.toLowerCase()));
  rows.forEach(r => { const n = seen[r.key].size; if (n >= FULL) put(r.player, 'full', r.key, { fullN: n }); });
  // Plus One: a first-timer whose note says "brought by <name>" (same rule as the bring-a-friend chips)
  const byName = {}; rows.forEach(r => { byName[r.player.toLowerCase()] = r.player; });
  const first = {}; rows.forEach(r => { const k = r.player.toLowerCase(); if (!first[k] || r.key < first[k]) first[k] = r.key; });
  rows.forEach(r => {
    const host = byName[(r.broughtBy || '').toLowerCase()];
    if (r.broughtBy && host && host !== r.player && first[r.player.toLowerCase()] === r.key) put(host, 'plus', r.key, { friend: r.player });
  });
  return out;
}
/** Redis commands that replace the stored poker buffs with `all` (from buffsFrom). */
export const saveBuffCmds = all => [['DEL', 'bf'], ...(Object.keys(all).length ? [['HSET', 'bf', ...Object.entries(all).flatMap(([id, b]) => [id, JSON.stringify(b)])]] : [])];
/** The two reads a claim or a page needs for one player (put them in the same pipeline as everything else). */
export const buffReads = id => [['HGET', 'bf', id || '-'], ['MGET', 'bf:rsvp', 'bf:team']];   // 2nd answer = [rsvp, team]

/** Buffs running for one player at time `at`, from the two reads above: [{ k, name, icon, pct, until, why }], plus .pct = the total. */
export function activeBuffs(raw, rsvpRaw, id, at = Date.now()) {
  let b = {}, rs = null, tm = null;
  const [rsRaw, tmRaw] = Array.isArray(rsvpRaw) ? rsvpRaw : [rsvpRaw, null];
  try { b = raw ? JSON.parse(raw) : {}; } catch (e) {}
  try { rs = rsRaw ? JSON.parse(rsRaw) : null; } catch (e) {}
  try { tm = tmRaw ? JSON.parse(tmRaw) : null; } catch (e) {}
  const list = [];
  const add = (k, until, why) => { if (until > at) list.push({ k, ...BUFFS[k], until, why }); };
  if (b.show) add('show', buffEnd(b.show, 'show'), `Played ${nice(b.show)}`);
  if (b.reg) add('reg', buffEnd(b.reg, 'reg'), '3+ nights in a row');
  if (b.back) add('back', buffEnd(b.back, 'back'), `Back at the table ${nice(b.back)}`);
  if (b.plus) add('plus', buffEnd(b.plus, 'plus'), b.friend ? `Brought ${b.friend}` : 'Brought a new player');
  if (b.full) add('full', buffEnd(b.full, 'full'), `${b.fullN || FULL}+ at the table ${nice(b.full)}`);
  if (tm && id && (tm.ids || []).includes(id)) add('team', tm.until, 'The players beat the house');
  // RSVP turns into Showed Up: once you have a Showed Up from a night since the invite went out, the RSVP one stops
  const showSince = b.show && Date.UTC(...b.show.split('-').map((v, k) => k === 1 ? v - 1 : +v)) >= (rs ? rs.at : 0) - DAY;
  if (rs && id && (rs.ids || []).includes(id) && !showSince) add('rsvp', rs.end, "RSVP'd to the next game");
  list.sort((x, y) => ORDER.indexOf(x.k) - ORDER.indexOf(y.k));
  list.pct = Math.round(list.reduce((a, x) => a + x.pct, 0) * 100) / 100;
  return list;
}
/** A claim of `base` with these buffs. */
export const boosted = (base, list) => Math.round(base * (1 + ((list && list.pct) || 0)) * 100) / 100;
/** What the site gets: plain objects (no functions), for the badge card and the casino lobby. */
export const buffView = list => ({ pct: list.pct || 0, list: list.map(({ k, name, icon, pct, until, why }) => ({ k, name, icon, pct, until, why })) });
