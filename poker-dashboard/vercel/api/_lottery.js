// Quarter lottery. Every $10 a player buys in at poker night during a quarter (Cash_In on the Input tab: buy-ins,
// rebuys, top-ups, cash or tourney) is one free ticket. The jackpot is everything bought in that quarter, 1:1 in
// casino chips (bj:bal). Once a quarter is over, the host runs /lottery draw in Discord (see discord.js): the
// ticket number rolls live in that message, then the winner card (/api/wrap?lottery=<quarter>) drops. The winner gets
// the jackpot and the "Lucky Ticket" role until the next draw. Only players with a Discord ID on the Members tab are in the draw.
// Redis keys: lt:draw:<quarter> (the draw, JSON, written once), lt:last (the latest drawn quarter), lt:lock.
import { randomInt } from 'node:crypto';
import { kv, FEED_KEEP } from './_blackjack.js';
import { nightRows } from './_rewards.js';

const SITE = 'https://renpokernight.vercel.app';
export const TICKET = 10;                 // dollars bought in per ticket
export const FIRST_QUARTER = 'Q4 2026';   // the first quarter with a draw
export const LUCKY_ROLE = 'Lucky Ticket';
const SKIP = new Set(['renato']);         // tickets count and show, but are never drawn (by request)

export const qKey = q => { const [n, y] = String(q).split(' '); return +y * 10 + +String(n).slice(1); };
export const quarterOf = (t = new Date()) => `Q${Math.floor(t.getUTCMonth() / 3) + 1} ${t.getUTCFullYear()}`;
const r2 = n => Math.round(n * 100) / 100;

/** One quarter's tickets: { quarter, holders: [{ name, cin, t, in, from, to }], total, out, jackpot, nights }.
 *  ids = { name: discordId } from the Members tab: only players with a Discord ID are in the draw (in: true, ticket
 *  numbers 1..total, odds out of total). The others still show, as "join Discord to enter" (out = their tickets).
 *  Without ids everyone counts. The jackpot is everything bought in, by everyone. */
export function board(rows, quarter, ids = null) {
  const inQ = rows.filter(r => r.quarter === quarter), per = {};
  inQ.forEach(r => { per[r.player] = r2((per[r.player] || 0) + r.cin); });
  let n = 0;
  const holders = Object.entries(per).map(([name, cin]) => ({ name, cin, t: Math.floor(cin / TICKET + 1e-9), in: !ids || !!ids[name] }))
    .filter(h => h.t > 0).sort((a, b) => (b.in - a.in) || b.t - a.t || a.name.localeCompare(b.name))
    .map(h => h.in ? { ...h, from: n + 1, to: (n += h.t) } : { ...h, from: null, to: null });
  const out = holders.filter(h => !h.in).reduce((a, h) => a + h.t, 0);
  return { quarter, holders, total: n, out, jackpot: Math.round(Object.values(per).reduce((a, v) => a + v, 0)), nights: new Set(inQ.map(r => r.night)).size };
}

/** Draws a ticket: { name, ticket }. Any ticket can come up except the SKIP players' ones. */
export function pickTicket(b, rnd = randomInt) {
  const ok = b.holders.filter(h => h.in && !SKIP.has(h.name.toLowerCase()));
  const count = ok.reduce((a, h) => a + h.t, 0);
  if (!count) return null;
  let k = rnd(count);
  for (const h of ok) { if (k < h.t) return { name: h.name, ticket: h.from + k }; k -= h.t; }
  return null;
}

export const nextQuarter = q => { const [n, y] = q.split(' '); const k = +n.slice(1); return k === 4 ? `Q1 ${+y + 1}` : `Q${k + 1} ${y}`; };
export const prevQuarter = q => { const [n, y] = q.split(' '); const k = +n.slice(1); return k === 1 ? `Q4 ${+y - 1}` : `Q${k - 1} ${y}`; };

/** The quarter /lottery draw would draw now: the last finished one (calendar), or why not: { q } | { err }. */
export async function drawable(rows, ids, now = new Date()) {
  const cur = quarterOf(now), q = prevQuarter(cur);
  if (qKey(q) < qKey(FIRST_QUARTER)) {
    const [n, y] = cur.split(' '), end = new Date(Date.UTC(+y, +n.slice(1) * 3, 0));
    return { err: `${cur} isn't over yet. The draw opens after ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}.` };
  }
  if (await drawOf(q)) return { err: `${q} was already drawn.`, done: true, q };
  if (!pickTicket(board(rows, q, ids))) return { err: `Nobody has tickets for ${q}.` };
  return { q };
}

/** Draws quarter q once and pays the winner. Returns { d } (the draw record) or { err }. */
export async function drawQuarter(csv, ids, q, rnd = randomInt) {
  const rows = nightRows(csv);
  const [lock] = await kv(['SET', 'lt:lock', '1', 'NX', 'EX', 25]);
  if (!lock) return { err: 'A draw is already running.' };
  try {
    if (await drawOf(q)) return { err: `${q} was already drawn.` };
    const b = board(rows, q, ids), pick = pickTicket(b, rnd);
    if (!pick) return { err: `Nobody has tickets for ${q}.` };
    const id = ids[pick.name];
    const d = { quarter: q, name: pick.name, id, ticket: pick.ticket, total: b.total, tickets: b.holders.find(h => h.name === pick.name).t, jackpot: b.jackpot, at: Date.now(), paid: b.jackpot };
    const [ok] = await kv(['SET', 'lt:draw:' + q, JSON.stringify(d), 'NX']);
    if (!ok) return { err: `${q} was already drawn.` };
    await kv(['SET', 'lt:last', q], ['HINCRBYFLOAT', 'bj:bal', id, d.jackpot], ['HSETNX', 'bj:name', id, d.name],
      ['LPUSH', 'cas:feed', JSON.stringify({ id, name: d.name, game: 'lottery', why: `${q} lottery jackpot`, net: d.jackpot, src: 'night', at: Date.now() })],
      ['LTRIM', 'cas:feed', 0, FEED_KEEP - 1], ['SADD', 'ac:dirty', id]); // ac:dirty: the next request gives them the Lucky Ticket sticker
    return { d, id, board: b };
  } finally { await kv(['DEL', 'lt:lock']).catch(() => {}); }
}

/** Who holds the Lucky Ticket role: [name] of the latest draw, [] before the first one. */
export async function luckyHolder() {
  const [q] = await kv(['GET', 'lt:last']);
  if (!q) return [];
  const [raw] = await kv(['GET', 'lt:draw:' + q]);
  return raw ? [JSON.parse(raw).name] : [];
}

/** What the lobby, /lottery and the card show: this quarter's board plus the latest draw (if any). */
export async function lotteryView(csv, quarter, ids = null) {
  const rows = nightRows(csv), b = board(rows, quarter || await shownQuarter(rows), ids);
  const [lastQ] = await kv(['GET', 'lt:last']);
  const [raw] = lastQ ? await kv(['GET', 'lt:draw:' + lastQ]) : [null];
  let last = null; try { last = raw ? JSON.parse(raw) : null; } catch (e) {}
  const past = lastQ ? await pastDraws(lastQ) : [];
  // a draw from the last 2 weeks: its board too, so the lobby can spin that quarter's wheel to the winner
  const lastBoard = last && last.quarter !== b.quarter && Date.now() - last.at < 14 * 864e5 ? board(rows, last.quarter, ids).holders.map(({ name, t, in: i, from }) => ({ name, t, in: i, from })) : null;
  return { ...b, ticket: TICKET, last, past, lastBoard, pending: qKey(b.quarter) < qKey(quarterOf()) };
}
/** The quarter to show: this calendar quarter, except that last quarter stays up (pending: waiting for the first night
 *  of the new quarter, which runs its draw) until it has been drawn and the new quarter has tickets. */
export async function shownQuarter(rows, now = new Date()) {
  const q = quarterOf(now);
  if (board(rows, q).total) return q;
  const [n, y] = q.split(' '), k = +n.slice(1), prev = k === 1 ? `Q4 ${+y - 1}` : `Q${k - 1} ${y}`;
  if (qKey(prev) < qKey(FIRST_QUARTER) || !board(rows, prev).total) return q;
  return (await drawOf(prev)) ? q : prev;
}
/** Up to 6 most recent draws, newest first. */
async function pastDraws(lastQ) {
  const qs = []; let q = lastQ;
  while (qs.length < 6 && qKey(q) >= qKey(FIRST_QUARTER)) { qs.push(q); const [n, y] = q.split(' '), k = +n.slice(1); q = k === 1 ? `Q4 ${+y - 1}` : `Q${k - 1} ${y}`; }
  const got = await kv(...qs.map(x => ['GET', 'lt:draw:' + x]));
  return got.map(x => { try { return x ? JSON.parse(x) : null; } catch (e) { return null; } }).filter(Boolean).map(d => ({ quarter: d.quarter, name: d.name, jackpot: d.jackpot, ticket: d.ticket }));
}

/** A drawn quarter's record (or null). */
export async function drawOf(q) {
  const [raw] = await kv(['GET', 'lt:draw:' + q]);
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
