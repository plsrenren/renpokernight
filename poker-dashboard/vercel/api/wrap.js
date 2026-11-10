// /api/wrap?q=Q3%202026   "quarter wrapped" card as a PNG: champion and podium, best and toughest night,
// biggest turnaround, iron man, most wins, tournament king. Default q = the last finished quarter.
// POST with JSON { input, members } (the entry page does this when the first night of a new quarter is saved).
import { SHEET_URL, MEMBERS_URL, gameRecords, wrapStats, wrapDefault, memberIds } from '../recap-core.js';
import { draw, wrapCardTree } from './_late.js';
import { avatarPng } from './_discord.js';

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

async function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = []; for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
    let csv = '', members = null;
    if (req.method === 'POST') { const j = JSON.parse(await readBody(req) || '{}'); csv = j.input || ''; members = j.members ?? null; }
    else csv = await fetch(SHEET_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (members == null) members = await fetch(MEMBERS_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (!csv || csv.length > 2_000_000) { res.status(400).send('could not read the sheet'); return; }
    const png = await render(csv, q, members);
    if (!png) { res.status(404).send(`No games in ${q || 'that quarter'}`); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', req.method === 'POST' ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(png);
  } catch (e) {
    res.status(500).send('Could not draw the quarter wrap: ' + e.message);
  }
}
