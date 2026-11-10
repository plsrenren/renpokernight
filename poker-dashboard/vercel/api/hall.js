// /api/hall  the Hall of Fame as a PNG card (what /hall posts in Discord): record holders, the trophy shelf,
// and the latest quarter champions. Worked out from the Input tab, same as the /hall page.
import { SHEET_URL, MEMBERS_URL, toNights, hallOfFame, memberIds } from '../recap-core.js';
import { draw, hallCardTree } from './_late.js';
import { avatarPng } from './_discord.js';

export async function render(csv, membersCsv = '', getPic = avatarPng) {
  const H = hallOfFame(toNights(csv));
  const ids = memberIds(membersCsv);
  const live = H.quarters.find(q => q.live), done = H.quarters.find(q => !q.live);
  const people = [...new Set([...Object.values(H.records).filter(Boolean).map(r => r.name), ...H.shelf.slice(0, 6).map(t => t.name),
    ...[live, done].filter(Boolean).flatMap(Q => ['overall', 'cash', 'tour'].map(k => Q[k] && Q[k].name))])].filter(p => p && ids[p]);
  const pics = Object.fromEntries((await Promise.all(people.map(async p => {
    try { const b = await getPic(ids[p]); return b ? [p, 'data:image/png;base64,' + Buffer.from(b).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  return draw(hallCardTree(H, pics));
}

export default async function handler(req, res) {
  try {
    const [csv, members] = await Promise.all([SHEET_URL, MEMBERS_URL].map(u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '')));
    if (!csv) throw new Error('could not read the sheet');
    const png = await render(csv, members);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(png);
  } catch (e) {
    res.status(500).send('Could not draw the Hall of Fame: ' + e.message);
  }
}
