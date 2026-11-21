// /api/roles   refreshes the results roles in Discord (see _roles.js). The entry page calls this (POST with the
// sheet as JSON { input, members }) right after a night is saved; /roles in Discord does the same.
// Safe to call any time: it only changes roles that don't match the results.
// It also pays the casino chip rewards for poker nights (see _rewards.js); those pay each night only once.
// /api/roles?rakeback=1 (GET, the Monday cron) pays last week's casino rakeback instead (see _rakeback.js), then hands out the
// weekly casino accolades and checks everyone for new ones (see _accolades.js). After a night, chip rewards can unlock the chip titles too,
// and the poker accolades (from the sheet, checkPoker) are checked then and on the cron.
// The sheet sent in the body is only trusted with the secret key (header X-Roles-Key = Vercel env ROLES_KEY, which the
// entry page keeps in its Script Properties). Without it the body is ignored and the sheet is read from Google itself,
// so nobody can pay themselves chips (or take everyone's back) by posting a made-up sheet.
import { createHash, timingSafeEqual } from 'node:crypto';
import { SHEET_URL, MEMBERS_URL, gameRecords, memberIds } from '../recap-core.js';
import { syncRoles } from './_roles.js';
import { payRewards } from './_rewards.js';
import { kvUrl, kvToken } from './_blackjack.js';
import { payRakeback } from './_rakeback.js';
import { checkAccolades, weeklyAccolades, checkPoker } from './_accolades.js';
import { pokerSweep } from './_poker.js';

/** true when the request carries the right secret key (and one is set on Vercel). */
export function keyOk(sent, want = process.env.ROLES_KEY) {
  if (!want || !sent) return false;
  const h = v => createHash('sha256').update(String(v)).digest();
  return timingSafeEqual(h(sent), h(want.trim()));
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
    // Monday's weekly casino rakeback (Vercel cron, see vercel.json). Pays only last week, only once, so any caller is harmless.
    if (new URL(req.url, 'http://x').searchParams.has('rakeback')) {
      if (!kvUrl() || !kvToken()) { res.status(500).json({ error: 'chip storage not set up' }); return; }
      const out = await payRakeback();
      try { out.accolades = { weekly: await weeklyAccolades(), everyone: await checkAccolades({ all: true }) }; } catch (e) { console.error('accolades', e); out.accolades = { error: e.message }; }
      // poker accolades too, in case nobody saved a night since they shipped (reads Google's copy of the sheet)
      try {
        const [csv, members] = await Promise.all([SHEET_URL, MEMBERS_URL].map(u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '')));
        if (csv) out.poker = await checkPoker(csv, memberIds(members));
      } catch (e) { console.error('poker accolades', e); out.poker = { error: e.message }; }
      try { out.pokerRoom = await pokerSweep(); } catch (e) { out.pokerRoom = { error: e.message }; } // a forgotten poker room cashes everyone out
      res.setHeader('Cache-Control', 'no-store'); res.status(200).json(out); return;
    }
    if (!process.env.DISCORD_BOT_TOKEN) { res.status(500).json({ error: 'DISCORD_BOT_TOKEN is not set on Vercel' }); return; }
    let csv = '', members = null;
    const trusted = keyOk(req.headers['x-roles-key']);
    if (req.method === 'POST' && trusted) { const j = JSON.parse(await readBody(req) || '{}'); csv = j.input || ''; members = j.members ?? null; }
    if (!csv) csv = await fetch(SHEET_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (members == null) members = await fetch(MEMBERS_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    if (!csv || csv.length > 2_000_000) { res.status(400).json({ error: 'could not read the sheet' }); return; }
    const ids = memberIds(members);
    const hasKv = kvUrl() && kvToken();
    let report;
    try { report = await syncRoles(gameRecords(csv), ids); } catch (e) { report = { changes: [], errors: ['Roles: ' + e.message], holders: {} }; }
    if (hasKv) {
      try { report.chips = await payRewards(csv, ids); } catch (e) { console.error('rewards', e); report.errors = [...(report.errors || []), 'Chip rewards: ' + e.message]; }
      try { report.accolades = await checkAccolades({ all: true, ids }); } catch (e) { console.error('accolades', e); }
      try { report.poker = await checkPoker(csv, ids); } catch (e) { console.error('poker accolades', e); }
    }
    res.setHeader('Cache-Control', 'no-store');
    report.source = trusted ? 'entry page' : 'google sheet';
    res.status(200).json(report);
  } catch (e) {
    res.status(500).json({ error: 'Could not update roles: ' + e.message });
  }
}
