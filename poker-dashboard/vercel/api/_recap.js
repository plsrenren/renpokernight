// /api/recap — the "Late Show" recap card as a PNG (what gets posted to Discord).
//   GET  /api/recap                       latest night, data read live from the Google Sheet
//   GET  /api/recap?night=2026-11-06      a specific night (add &type=Cash or &type=Tournament if a date has both)
//   POST /api/recap?night=...&type=...    same, with the Input tab CSV in the body (the entry page does this right
//                                         after saving, so the image never waits on Google's CSV export)
import { SHEET_URL, toNights, pickNight, model, stories, MEMBERS_URL, memberIds } from '../recap-core.js';
import { draw, recapCard } from './_late.js';
import { avatarPng } from './_discord.js';

export async function render(csv, night, type, membersCsv = '', getPic = avatarPng) {
  const nights = toNights(csv);
  const n = pickNight(nights, night, type);
  if (!n) return null;
  const base = model(nights, n);
  const m = { ...base, stories: stories(nights, n), podiumTitle: base.raceTitle.replace('Race for ', '') + ' leaders' };
  // pfps for everyone on the card (tonight's players, the quarter standings and award winners), fetched in parallel; misses keep initials
  const ids = memberIds(membersCsv);
  const want = [...new Set([...m.rows.map(r => r.player), ...m.standings.rows.map(r => r.name), ...m.stories.awards.map(a => a.who)])].filter(p => ids[p]);
  m.pics = Object.fromEntries((await Promise.all(want.map(async p => {
    try { const png = await getPic(ids[p]); return png ? [p, 'data:image/png;base64,' + Buffer.from(png).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  return draw(recapCard(m));
}

async function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = []; for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const night = url.searchParams.get('night') || '', type = url.searchParams.get('type') || '';
    if (night && !/^\d{4}-\d{2}-\d{2}$/.test(night)) { res.status(400).send('night must look like 2026-11-06'); return; }
    let csv, members = null;
    if (req.method === 'POST') {
      const body = await readBody(req);
      // the entry page sends JSON { input, members }; a plain CSV body (older entry page) still works
      if (body.trim().startsWith('{')) { const j = JSON.parse(body); csv = j.input; members = j.members ?? null; }
      else csv = body;
    } else {
      const r = await fetch(SHEET_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('sheet returned ' + r.status);
      csv = await r.text();
    }
    if (members == null) {
      try { const r = await fetch(MEMBERS_URL, { cache: 'no-store' }); members = r.ok ? await r.text() : ''; } catch (e) { members = ''; }
    }
    if (!csv || csv.length > 2_000_000) { res.status(400).send('missing or oversized CSV'); return; }
    const png = await render(csv, night, type, members);
    if (!png) { res.status(404).send('No night found for ' + (night || 'latest')); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', req.method === 'POST' ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).send(png);
  } catch (e) {
    res.status(500).send('Could not draw the recap: ' + e.message);
  }
}
