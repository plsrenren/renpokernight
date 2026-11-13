// /api/roles   refreshes the results roles in Discord (see _roles.js). The entry page calls this (POST with the
// sheet as JSON { input, members }) right after a night is saved; /roles in Discord does the same.
// Safe to call any time: it only changes roles that don't match the results.
// It also pays the casino chip rewards for poker nights (see _rewards.js); those pay each night only once.
import { SHEET_URL, MEMBERS_URL, gameRecords, memberIds } from '../recap-core.js';
import { syncRoles } from './_roles.js';
import { payRewards } from './_rewards.js';
import { kvUrl, kvToken } from './_blackjack.js';

async function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = []; for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  try {
    if (!process.env.DISCORD_BOT_TOKEN) { res.status(500).json({ error: 'DISCORD_BOT_TOKEN is not set on Vercel' }); return; }
    let csv = '', members = null;
    if (req.method === 'POST') { const j = JSON.parse(await readBody(req) || '{}'); csv = j.input || ''; members = j.members ?? null; }
    if (!csv) csv = await fetch(SHEET_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (members == null) members = await fetch(MEMBERS_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (!csv || csv.length > 2_000_000) { res.status(400).json({ error: 'could not read the sheet' }); return; }
    const ids = memberIds(members);
    let report;
    try { report = await syncRoles(gameRecords(csv), ids); } catch (e) { report = { changes: [], errors: ['Roles: ' + e.message], holders: {} }; }
    if (kvUrl() && kvToken()) {
      try { report.chips = await payRewards(csv, ids); } catch (e) { console.error('rewards', e); report.errors = [...(report.errors || []), 'Chip rewards: ' + e.message]; }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(report);
  } catch (e) {
    res.status(500).json({ error: 'Could not update roles: ' + e.message });
  }
}
