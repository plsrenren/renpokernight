// /api/h2h?a=Renato&b=Dong&period=Y2026   head-to-head card as a PNG (what /h2h posts in Discord): the "race" layout,
// with both players' Discord banners across the top, then the race chart, tale of the tape and latest meetings.
// period is "Q4 2026", "Y2026" or "all". Only games both players were in count.
import { SHEET_URL, MEMBERS_URL, gameRecords, findPlayer, pairStats, latestQuarter, memberIds } from '../recap-core.js';
import { draw, h2hCardTree } from './_late.js';
import { avatarPng, bannerPng, accentColor } from './_discord.js';

export async function render(csv, qa, qb, period, membersCsv = '', getPic = id => avatarPng(id, 256), layout = 'race', getBanner = bannerPng, getColor = accentColor) {
  const recs = gameRecords(csv), a = findPlayer(recs, qa), b = findPlayer(recs, qb);
  if (!a.name || !b.name) return { error: `No player called "${!a.name ? qa : qb}"` };
  const q = latestQuarter(recs), p = /^(Q[1-4] \d{4}|Y\d{4}|all)$/.test(period || '') ? period : 'Y' + q.split(' ')[1];
  const st = pairStats(recs, a.name, b.name, p);
  if (!st.n) return { error: `${a.name} and ${b.name} haven't played the same game in ${st.label}` };
  const ids = memberIds(membersCsv);
  const pics = Object.fromEntries((await Promise.all([a.name, b.name].filter(n => ids[n]).map(async n => {
    try { const x = await getPic(ids[n]); return x ? [n, 'data:image/png;base64,' + Buffer.from(x).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  const safe = async (fn, id) => { try { return await fn(id); } catch (e) { return null; } };
  const both = [a.name, b.name].filter(n => ids[n]);
  const [bn, cl] = await Promise.all([
    Promise.all(both.map(async n => { const x = await safe(getBanner, ids[n]); return x ? [n, 'data:image/png;base64,' + Buffer.from(x).toString('base64')] : null; })),
    Promise.all(both.map(async n => { const c = await safe(getColor, ids[n]); return c ? [n, c] : null; }))]);
  const art = { banners: Object.fromEntries(bn.filter(Boolean)), colors: Object.fromEntries(cl.filter(Boolean)) };
  return { png: await draw(h2hCardTree(st, pics, art)) };
}

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    const a = (q.get('a') || '').slice(0, 40), b = (q.get('b') || '').slice(0, 40);
    if (!a || !b) { res.status(400).send('add ?a=Player&b=Player'); return; }
    const [csv, members] = await Promise.all([SHEET_URL, MEMBERS_URL].map(u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '')));
    if (!csv) throw new Error('could not read the sheet');
    const out = await render(csv, a, b, q.get('period') || '', members, undefined, q.get('layout') || 'race');
    if (!out.png) { res.status(404).send(out.error); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(out.png);
  } catch (e) {
    res.status(500).send('Could not draw the head to head: ' + e.message);
  }
}
