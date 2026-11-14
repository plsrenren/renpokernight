// /api/wrap?q=Q3%202026   "quarter wrapped" card as a PNG: champion and podium, best and toughest night,
// biggest turnaround, iron man, most wins, tournament king. Default q = the last finished quarter.
// POST with JSON { input, members } (the entry page does this when the first night of a new quarter is saved).
// /api/wrap?lottery=Q4%202026   the quarter lottery card instead (odds before the draw, the winner after; see _lottery.js).
// /api/wrap?lottery=Q4%202026&spin=1   that draw's wheel spinning to the winner, as a GIF (_wheelgif.js)
//                               Lives here because the Hobby plan allows only 12 functions.
import { SHEET_URL, MEMBERS_URL, gameRecords, wrapStats, wrapDefault, memberIds } from '../recap-core.js';
import { draw, wrapCardTree, lotteryCardTree } from './_late.js';
import { drawOf, board, quarterOf, shownQuarter } from './_lottery.js';
import { nightRows } from './_rewards.js';
import { avatarPng } from './_discord.js';
import { wheelGif } from './_wheelgif.js';

export async function render(csv, q, membersCsv = '', getPic = avatarPng) {
  const recs = gameRecords(csv);
  if (!recs.length) return null;
  const w = wrapStats(recs, /^Q[1-4] \d{4}$/.test(q || '') ? q : wrapDefault(recs));
  if (!w) return null;
  const ids = memberIds(membersCsv);
  const people = [...new Set([...w.podium.map(p => p.name), w.best.name, w.worst && w.worst.name, w.iron.name, w.wins && w.wins.name, w.tour && w.tour.name, w.turn && w.turn.name])].filter(p => p && ids[p]);
  const pics = Object.fromEntries((await Promise.all(people.map(async p => {
    try { const b = await getPic(ids[p]); return b ? [p, 'data:image/png;base64,' + Buffer.from(b).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  return draw(wrapCardTree(w, pics));
}

/** The lottery card for quarter q (default this quarter): odds before the draw, the winner once drawn. */
export async function renderLottery(csv, q, membersCsv = '', getPic = avatarPng) {
  const rows = nightRows(csv), quarter = /^Q[1-4] \d{4}$/.test(q || '') ? q : await shownQuarter(rows).catch(() => quarterOf());
  const ids = memberIds(membersCsv), b = board(rows, quarter, ids), d = await drawOf(quarter).catch(() => null);
  const people = [...new Set([...b.holders.filter(x => x.in !== false).map(x => x.name), d && d.name])].filter(p => p && ids[p]);
  const pics = Object.fromEntries((await Promise.all(people.map(async p => {
    try { const x = await getPic(ids[p]); return x ? [p, 'data:image/png;base64,' + Buffer.from(x).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  return draw(lotteryCardTree(b, d, pics));
}

/** The spinning wheel GIF of quarter q's draw (only once it is drawn): every player's pfp on their slice. */
export async function renderSpin(csv, q, membersCsv = '', getPic = avatarPng) {
  const d = /^Q[1-4] \d{4}$/.test(q || '') ? await drawOf(q).catch(() => null) : null;
  if (!d) return null;
  const ids = memberIds(membersCsv), b = board(nightRows(csv), q, ids), inDraw = b.holders.filter(x => x.in !== false && x.from);
  const pics = Object.fromEntries((await Promise.all(inDraw.map(async x => {
    try { const p = await getPic(ids[x.name]); return p ? [x.name, 'data:image/png;base64,' + Buffer.from(p).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  // the stored draw is the truth (total + ticket); the board only supplies who holds which range
  return wheelGif({ holders: b.holders, total: d.total, ticket: d.ticket, winner: d.name, quarter: q, jackpot: d.jackpot }, pics);
}

async function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = []; for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  try {
    const sp = new URL(req.url, 'http://x').searchParams, q = sp.get('q') || '', lot = sp.get('lottery');
    let csv = '', members = null;
    if (req.method === 'POST') { const j = JSON.parse(await readBody(req) || '{}'); csv = j.input || ''; members = j.members ?? null; }
    else csv = await fetch(SHEET_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (members == null) members = await fetch(MEMBERS_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (!csv || csv.length > 2_000_000) { res.status(400).send('could not read the sheet'); return; }
    if (lot !== null && sp.has('spin')) {
      const gif = await renderSpin(csv, lot, members);
      if (!gif) { res.status(404).send('That quarter has not been drawn yet'); return; }
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      res.status(200).send(gif); return;
    }
    const png = lot !== null ? await renderLottery(csv, lot, members) : await render(csv, q, members);
    if (!png) { res.status(404).send(`No games in ${q || 'that quarter'}`); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', req.method === 'POST' ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(png);
  } catch (e) {
    res.status(500).send('Could not draw the quarter wrap: ' + e.message);
  }
}
