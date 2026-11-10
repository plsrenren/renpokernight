// /api/card?name=Renato             a player's ratings card as a PNG (current quarter), the same numbers as the dashboard card
// /api/card?name=Renato&period=Y2026  their season card instead (period is "Q4 2026", "Y2026", or "all" for all-time)
// The /player Discord command shows this image.
import { SHEET_URL, MEMBERS_URL, gameRecords, findPlayer, playerCard, memberIds } from '../recap-core.js';
import { draw, playerCardTree } from './_late.js';
import { avatarPng, bannerPng, accentColor } from './_discord.js';

const pngUri = b => 'data:image/png;base64,' + Buffer.from(b).toString('base64');

export async function render(csv, query, period, membersCsv = '', art = {}) {
  const recs = gameRecords(csv), found = findPlayer(recs, query);
  if (!found.name) return { png: null, suggestions: found.suggestions };
  const c = playerCard(recs, found.name, period && /^(Q[1-4] \d{4}|Y\d{4}|all)$/.test(period) ? period : undefined);
  const ids = memberIds(membersCsv), getPic = art.getPic || (id => avatarPng(id, 256)), getBanner = art.getBanner || bannerPng, getColor = art.getColor || accentColor;
  const safe = async (fn, ...a) => { try { return await fn(...a); } catch (e) { return null; } };
  const people = [c.name, c.h2h && c.h2h.best && c.h2h.best.p, c.h2h && c.h2h.worst && c.h2h.worst.p].filter(p => p && ids[p]);
  const [pics, banner, color] = await Promise.all([
    Promise.all(people.map(async p => { const b = await safe(getPic, ids[p]); return b ? [p, pngUri(b)] : null; })).then(l => Object.fromEntries(l.filter(Boolean))),
    ids[c.name] ? safe(getBanner, ids[c.name]) : null,
    ids[c.name] ? safe(getColor, ids[c.name]) : null]);
  const png = await draw(playerCardTree(c, { pics, banner: banner ? pngUri(banner) : null, color }));
  return { png, name: c.name, period: c.period };
}

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    const name = (q.get('name') || '').slice(0, 40);
    if (!name.trim()) { res.status(400).send('add ?name=PlayerName'); return; }
    const [csv, members] = await Promise.all([SHEET_URL, MEMBERS_URL].map(u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '')));
    if (!csv) throw new Error('could not read the sheet');
    const out = await render(csv, name, q.get('period') || '', members);
    if (!out.png) { res.status(404).send(`No player called "${name}"` + (out.suggestions.length ? `. Did you mean ${out.suggestions.join(', ')}?` : '')); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(out.png);
  } catch (e) {
    res.status(500).send('Could not draw the card: ' + e.message);
  }
}
