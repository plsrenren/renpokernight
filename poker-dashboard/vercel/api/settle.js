// /api/settle   the settle-up Discord message for a night (who sends the banker what, who the banker pays).
// The entry page calls this (POST JSON { input, members }) right after a save with "Post to Discord" ticked, then
// posts the result to its webhook. ?night=yyyy-mm-dd&type=Cash picks the night (default: the latest).
// GET works too (reads the live sheet), handy for checking: /api/settle?night=2026-11-08
import { SHEET_URL, MEMBERS_URL, toNights, pickNight, memberIds, memberVenmo, settleMessage } from '../recap-core.js';

const SITE = 'https://renpokernight.vercel.app';
async function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = []; for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  try {
    let csv = '', members = null;
    if (req.method === 'POST') { const j = JSON.parse(await readBody(req) || '{}'); csv = j.input || ''; members = j.members ?? null; }
    if (!csv) csv = await fetch(SHEET_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (members == null) members = await fetch(MEMBERS_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (!csv || csv.length > 2_000_000) { res.status(400).json({ error: 'could not read the sheet' }); return; }
    const q = req.query || Object.fromEntries(new URL(req.url, SITE).searchParams);
    const night = pickNight(toNights(csv), q.night, q.type);
    if (!night) { res.status(404).json({ error: 'no such night' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(settleMessage(night, memberVenmo(members), memberIds(members), { site: SITE }));
  } catch (e) {
    res.status(500).json({ error: 'Could not work out the settle-up: ' + e.message });
  }
}
