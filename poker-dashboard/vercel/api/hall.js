// /api/hall  the Hall of Fame as a PNG card (what /hall posts in Discord): record holders, the trophy shelf,
// and the latest quarter champions. Worked out from the Input tab, same as the /hall page.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { SHEET_URL, MEMBERS_URL, COLORS as C, toNights, hallOfFame, memberIds, hueFor, initials, usd } from '../recap-core.js';
import { avatarPng } from './_discord.js';

const asset = name => readFileSync(new URL(`./_assets/${name}`, import.meta.url));
let FONTS, LOGO;
function loadAssets() {
  if (FONTS) return;
  const f = (name, file, weight) => ({ name, data: asset(file), weight, style: 'normal' });
  FONTS = [f('Bebas', 'bebas-neue-latin-400-normal.woff', 400), f('Nunito', 'nunito-latin-700-normal.woff', 700),
    f('Nunito', 'nunito-latin-800-normal.woff', 800), f('Nunito', 'nunito-latin-900-normal.woff', 900), f('Mono', 'ibm-plex-mono-latin-600-normal.woff', 600)];
  LOGO = 'data:image/png;base64,' + asset('logo.png').toString('base64');
}

const S = 2, W = 560, IN = W - 36;
const svgUri = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const h = (type, style, ...kids) => ({ type, props: { style: { display: 'flex', ...style }, children: kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '') } });
const img = (src, w, ht, style = {}) => ({ type: 'img', props: { src, width: w, height: ht, style } });
const hsl = (hue, s, l) => `hsl(${hue}, ${s}%, ${l}%)`;
const CAT = { overall: C.gold, cash: '#8f78f0', tour: '#bd8210' };
const cup = (c, px) => img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M7 3h10v5c0 3.3-2.2 6-5 6s-5-2.7-5-6z" fill="${c}"/><path d="M7 5H4c0 3 1.5 5 3.5 5.5M17 5h3c0 3-1.5 5-3.5 5.5" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><rect x="10.5" y="13.5" width="3" height="4" fill="${c}"/><rect x="7.5" y="17.5" width="9" height="3" rx="1" fill="${c}"/></svg>`), px * S, px * S);

const avatar = (pics, name, size, ring) => {
  const pic = pics[name], hue = hueFor(name);
  const base = { width: size * S, height: size * S, borderRadius: 999, flexShrink: 0, boxSizing: 'border-box', ...(ring ? { border: `${ring.w * S}px solid ${ring.c}` } : {}) };
  if (pic) return h('div', { ...base, overflow: 'hidden', backgroundColor: C.panel }, img(pic, size * S, size * S, { objectFit: 'cover' }));
  return h('div', { ...base, backgroundColor: hsl(hue, 80, 86), color: hsl(hue, 45, 28), alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Nunito', fontWeight: 900, fontSize: size * 0.4 * S }, initials(name));
};
const panel = (title, note, ...body) => h('div', { flexDirection: 'column', backgroundColor: C.panel, borderRadius: 16 * S, padding: `${12 * S}px ${14 * S}px`, gap: 10 * S },
  h('div', { justifyContent: 'space-between', alignItems: 'center' },
    h('div', { fontFamily: 'Bebas', fontSize: 20 * S, letterSpacing: 0.5 * S, color: C.bright }, title),
    h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 11.5 * S, color: C.muted }, note)),
  body);

export function card(H, pics) {
  const band = h('div', { alignItems: 'center', gap: 14 * S, padding: `${14 * S}px ${16 * S}px`, borderRadius: 18 * S,
      backgroundImage: `linear-gradient(120deg, #3a2a6e, ${C.maroon})` },
    h('div', { width: 54 * S, height: 54 * S, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }, cup(C.gold, 36)),
    h('div', { flexDirection: 'column', flexGrow: 1 },
      h('div', { fontFamily: 'Bebas', fontSize: 40 * S, lineHeight: 1, color: '#fff' }, 'HALL OF FAME'),
      h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 12.5 * S, color: '#ffd7e1', marginTop: 2 * S }, 'Poker Club @ The Study · every quarter since night one')),
    img(LOGO, 48 * S, 48 * S));

  const recW = (IN - 2 * 8) / 3;
  const rec = (t, k) => { const r = H.records[k]; if (!r) return null;
    return h('div', { width: recW * S, flexDirection: 'column', alignItems: 'center', gap: 5 * S, boxSizing: 'border-box', padding: `${12 * S}px ${8 * S}px`,
        borderRadius: 14 * S, backgroundColor: C.panel, borderTop: `${4 * S}px solid ${CAT[k]}` },
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 10.5 * S, letterSpacing: 1.1 * S, color: C.muted }, t),
      avatar(pics, r.name, 48, { w: 3, c: CAT[k] }),
      h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 16 * S, color: C.bright, maxWidth: (recW - 16) * S, overflow: 'hidden', whiteSpace: 'nowrap' }, r.name),
      h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 15 * S, color: C.up }, usd(r.net))); };
  const records = h('div', { flexDirection: 'column', gap: 6 * S },
    h('div', { justifyContent: 'space-between', alignItems: 'center' },
      h('div', { fontFamily: 'Bebas', fontSize: 20 * S, letterSpacing: 0.5 * S, color: C.bright }, 'RECORD HOLDERS'),
      h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 11.5 * S, color: C.muted }, 'best all-time totals')),
    h('div', { gap: 8 * S }, rec('OVERALL', 'overall'), rec('CASH GAMES', 'cash'), rec('TOURNAMENTS', 'tour')));

  const shelfList = H.shelf.slice(0, 6), slot = (IN - 28) / Math.max(shelfList.length, 1);
  const shelf = panel('TROPHY SHELF', 'quarter titles won',
    h('div', {}, shelfList.map((t, i) => h('div', { width: slot * S, flexDirection: 'column', alignItems: 'center', gap: 4 * S },
      h('div', { position: 'relative', width: 58 * S, height: 58 * S },
        avatar(pics, t.name, 54, { w: 3, c: i === 0 ? C.gold : 'rgba(201,195,240,0.35)' }),
        h('div', { position: 'absolute', right: -4 * S, bottom: -2 * S, minWidth: 24 * S, height: 24 * S, padding: `0 ${5 * S}px`, borderRadius: 12 * S, backgroundColor: C.gold,
          border: `${2 * S}px solid ${C.panel}`, alignItems: 'center', justifyContent: 'center', fontFamily: 'Bebas', fontSize: 17 * S, color: '#2a1f00' }, String(t.total))),
      h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 13 * S, color: i === 0 ? C.gold : C.bright, maxWidth: (slot - 4) * S, overflow: 'hidden', whiteSpace: 'nowrap' }, t.name),
      h('div', { gap: 5 * S, fontFamily: 'Mono', fontWeight: 600, fontSize: 11 * S, color: C.soft },
        [['overall', t.overall], ['cash', t.cash], ['tour', t.tour]].filter(([, n]) => n).map(([k, n]) => h('div', { alignItems: 'center', gap: 1 * S }, cup(CAT[k], 12), String(n))))))),
    h('div', { gap: 14 * S, justifyContent: 'center', fontFamily: 'Nunito', fontWeight: 700, fontSize: 11 * S, color: C.muted },
      [['Overall', 'overall'], ['Cash game', 'cash'], ['Tournament', 'tour']].map(([t, k]) => h('div', { alignItems: 'center', gap: 4 * S }, cup(CAT[k], 12), t))));

  const live = H.quarters.find(q => q.live), done = H.quarters.find(q => !q.live);
  const colW = (IN - 28 - 14) / 2;
  const champs = (Q, tag) => h('div', { width: colW * S, flexDirection: 'column', gap: 7 * S },
    h('div', { justifyContent: 'space-between', alignItems: 'baseline' },
      h('div', { fontFamily: 'Bebas', fontSize: 20 * S, color: C.bright }, Q.q),
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 10 * S, letterSpacing: 1 * S, color: Q.live ? C.gold : C.muted }, tag)),
    [['OVERALL', 'overall'], ['CASH', 'cash'], ['TOURNEY', 'tour']].map(([t, k]) => { const c = Q[k];
      return h('div', { alignItems: 'center', gap: 8 * S, height: 32 * S },
        c ? avatar(pics, c.name, 28, k === 'overall' ? { w: 2, c: C.gold } : null) : h('div', { width: 28 * S, height: 28 * S }),
        h('div', { flexDirection: 'column', flexGrow: 1, width: 0 },
          h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 9.5 * S, letterSpacing: 1 * S, color: CAT[k] }, t),
          h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 13 * S, color: C.bright, overflow: 'hidden', whiteSpace: 'nowrap' }, c ? `${c.name}` : '–')),
        c ? h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 12 * S, color: C.up }, usd(c.net)) : null); }));
  const quarters = [done && champs(done, 'CHAMPIONS'), live && champs(live, 'IN PROGRESS')].filter(Boolean);
  const qPanel = quarters.length ? panel('LATEST CHAMPIONS', 'best net each quarter', h('div', { gap: 14 * S }, quarters)) : null;

  const foot = h('div', { justifyContent: 'center', fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, color: C.muted }, 'Full history at renpokernight.vercel.app/hall');
  return h('div', { width: W * S, boxSizing: 'border-box', flexDirection: 'column', gap: 14 * S, padding: 18 * S, borderRadius: 22 * S, color: C.text,
      backgroundColor: C.night, backgroundImage: 'radial-gradient(circle at 0% 0%, rgba(110,82,200,0.35), rgba(21,19,42,0) 60%)' },
    band, records, shelf, qPanel, foot);
}

export async function render(csv, membersCsv = '', getPic = avatarPng) {
  loadAssets();
  const H = hallOfFame(toNights(csv));
  const ids = memberIds(membersCsv);
  const live = H.quarters.find(q => q.live), done = H.quarters.find(q => !q.live);
  const people = [...new Set([...Object.values(H.records).filter(Boolean).map(r => r.name), ...H.shelf.slice(0, 6).map(t => t.name),
    ...[live, done].filter(Boolean).flatMap(Q => ['overall', 'cash', 'tour'].map(k => Q[k] && Q[k].name))])].filter(p => p && ids[p]);
  const pics = Object.fromEntries((await Promise.all(people.map(async p => {
    try { const b = await getPic(ids[p]); return b ? [p, 'data:image/png;base64,' + Buffer.from(b).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  const svg = await satori(card(H, pics), { width: W * S, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
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
