// Quarter lottery. Every $10 a player buys in at poker night during a quarter (Cash_In on the Input tab: buy-ins,
// rebuys, top-ups, cash or tourney) is one free ticket. The jackpot is everything bought in that quarter, 1:1 in
// casino chips (bj:bal). One ticket is drawn per quarter, when the first night of the next quarter is saved
// (api/roles.js runs runDraws after each entry-page save, before the roles refresh). The winner gets the jackpot,
// a post with the card (/api/wrap?lottery=<quarter>) in #casino, and the "Lucky Ticket" role until the next draw.
// Redis keys: lt:draw:<quarter> (the draw, JSON, written once), lt:last (the latest drawn quarter), lt:lock.
import { randomInt } from 'node:crypto';
import { kv, FEED_KEEP } from './_blackjack.js';
import { nightRows, postCasino } from './_rewards.js';

const SITE = 'https://renpokernight.vercel.app';
export const TICKET = 10;                 // dollars bought in per ticket
export const FIRST_QUARTER = 'Q4 2026';   // the first quarter with a draw
export const LUCKY_ROLE = 'Lucky Ticket';
const SKIP = new Set(['renato']);         // tickets count and show, but are never drawn (by request)

export const qKey = q => { const [n, y] = String(q).split(' '); return +y * 10 + +String(n).slice(1); };
export const quarterOf = (t = new Date()) => `Q${Math.floor(t.getUTCMonth() / 3) + 1} ${t.getUTCFullYear()}`;
const r2 = n => Math.round(n * 100) / 100;

/** One quarter's tickets: { quarter, holders: [{ name, cin, t, from, to }], total, jackpot, nights }. Ticket numbers run 1..total. */
export function board(rows, quarter) {
  const inQ = rows.filter(r => r.quarter === quarter), per = {};
  inQ.forEach(r => { per[r.player] = r2((per[r.player] || 0) + r.cin); });
  let n = 0;
  const holders = Object.entries(per).map(([name, cin]) => ({ name, cin, t: Math.floor(cin / TICKET + 1e-9) }))
    .filter(h => h.t > 0).sort((a, b) => b.t - a.t || a.name.localeCompare(b.name))
    .map(h => ({ ...h, from: n + 1, to: (n += h.t) }));
  return { quarter, holders, total: n, jackpot: Math.round(Object.values(per).reduce((a, v) => a + v, 0)), nights: new Set(inQ.map(r => r.night)).size };
}

/** Draws a ticket: { name, ticket }. Any ticket can come up except the SKIP players' ones. */
export function pickTicket(b, rnd = randomInt) {
  const ok = b.holders.filter(h => !SKIP.has(h.name.toLowerCase()));
  const count = ok.reduce((a, h) => a + h.t, 0);
  if (!count) return null;
  let k = rnd(count);
  for (const h of ok) { if (k < h.t) return { name: h.name, ticket: h.from + k }; k -= h.t; }
  return null;
}

/** Quarters that are over (a later quarter has a night) and still need a draw, oldest first. */
export function dueQuarters(rows) {
  const qs = [...new Set(rows.map(r => r.quarter))].sort((a, b) => qKey(a) - qKey(b));
  const latest = qs[qs.length - 1];
  return qs.filter(q => qKey(q) >= qKey(FIRST_QUARTER) && q !== latest);
}

const nextQuarter = q => { const [n, y] = q.split(' '); const k = +n.slice(1); return k === 4 ? `Q1 ${+y + 1}` : `Q${k + 1} ${y}`; };

/** Runs any draw that's due and pays any drawn jackpot not paid yet (a winner without a Discord ID is paid once it's added). */
export async function runDraws(csv, ids) {
  const rows = nightRows(csv), due = dueQuarters(rows);
  if (!due.length) return { draws: [] };
  const [lock] = await kv(['SET', 'lt:lock', '1', 'NX', 'EX', 25]);
  if (!lock) return { skipped: 'already running' };
  const report = [];
  try {
    const saved = await kv(...due.map(q => ['GET', 'lt:draw:' + q]));
    for (let k = 0; k < due.length; k++) {
      const q = due[k];
      let d = saved[k] ? JSON.parse(saved[k]) : null, fresh = false;
      if (!d) {
        const b = board(rows, q), pick = pickTicket(b);
        if (!pick) continue;
        d = { quarter: q, name: pick.name, ticket: pick.ticket, total: b.total, tickets: b.holders.find(h => h.name === pick.name).t, jackpot: b.jackpot, at: Date.now(), paid: 0 };
        const [ok] = await kv(['SET', 'lt:draw:' + q, JSON.stringify(d), 'NX']);
        if (!ok) continue; // someone else drew it a moment ago
        fresh = true;
        await kv(['SET', 'lt:last', q]);
      }
      const id = ids[d.name];
      if (!d.paid && id) {
        d.paid = d.jackpot;
        await kv(['HINCRBYFLOAT', 'bj:bal', id, d.jackpot], ['HSETNX', 'bj:name', id, d.name], ['SET', 'lt:draw:' + q, JSON.stringify(d)],
          ['LPUSH', 'cas:feed', JSON.stringify({ id, name: d.name, game: 'lottery', why: `${q} lottery jackpot`, net: d.jackpot, src: 'night', at: Date.now() })],
          ['LTRIM', 'cas:feed', 0, FEED_KEEP - 1]);
      }
      let posted = null;
      if (fresh) {
        const who = id ? `<@${id}>` : `**${d.name}**`;
        try {
          posted = await postCasino({
            content: `🎟️ **${q} lottery draw!** ${who} wins the **$${d.jackpot.toLocaleString('en-US')}** jackpot and the ${LUCKY_ROLE} role. Tickets start over for ${nextQuarter(q)}.`,
            embeds: [{ color: 0xf1c75b, url: `${SITE}/casino`, image: { url: `${SITE}/api/wrap?lottery=${encodeURIComponent(q)}&v=${d.at}` } }],
            allowed_mentions: { users: id ? [id] : [] } });
        } catch (e) { posted = 'failed: ' + e.message; }
      }
      report.push({ quarter: q, winner: d.name, ticket: d.ticket, jackpot: d.jackpot, paid: !!d.paid, fresh, posted });
    }
  } finally { await kv(['DEL', 'lt:lock']).catch(() => {}); }
  return { draws: report };
}

/** Who holds the Lucky Ticket role: [name] of the latest draw, [] before the first one. */
export async function luckyHolder() {
  const [q] = await kv(['GET', 'lt:last']);
  if (!q) return [];
  const [raw] = await kv(['GET', 'lt:draw:' + q]);
  return raw ? [JSON.parse(raw).name] : [];
}

/** What the lobby, /lottery and the card show: this quarter's board plus the latest draw (if any). */
export async function lotteryView(csv, quarter = quarterOf()) {
  const rows = nightRows(csv), b = board(rows, quarter);
  const [lastQ] = await kv(['GET', 'lt:last']);
  const [raw] = lastQ ? await kv(['GET', 'lt:draw:' + lastQ]) : [null];
  let last = null; try { last = raw ? JSON.parse(raw) : null; } catch (e) {}
  const past = lastQ ? await pastDraws(lastQ) : [];
  return { ...b, ticket: TICKET, last, past };
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
