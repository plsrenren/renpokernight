// /api/wrap?q=Q3%202026   "quarter wrapped" card as a PNG: champion and podium, best and toughest night,
// biggest turnaround, iron man, most wins, tournament king. Default q = the last finished quarter.
// POST with JSON { input, members } (the entry page does this when the first night of a new quarter is saved).
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { SHEET_URL, MEMBERS_URL, COLORS as C, gameRecords, wrapStats, wrapDefault, memberIds, hueFor, initials, usd, CROWN_SVG } from '../recap-core.js';
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

const crown = px => img(svgUri(CROWN_SVG), px * S, px * S);

export function card(w, pics) {
  const [yr] = [w.q.split(' ')[1]];
  const band = h('div', { alignItems: 'center', gap: 14 * S, padding: `${14 * S}px ${16 * S}px`, borderRadius: 18 * S,
      backgroundImage: `linear-gradient(120deg, #3a2a6e, ${C.maroon})` },
    img(LOGO, 52 * S, 52 * S),
    h('div', { flexDirection: 'column', flexGrow: 1 },
      h('div', { fontFamily: 'Bebas', fontSize: 40 * S, lineHeight: 1, color: '#fff' }, `${w.q} WRAPPED`),
      h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 12.5 * S, color: '#ffd7e1', marginTop: 2 * S },
        `${w.nights} night${w.nights === 1 ? '' : 's'} · ${w.players} players · ${usd(w.pot, { sign: false, cents: false })} in buy-ins`)));

  const [first, second, third] = w.podium;
  const champ = h('div', { flexDirection: 'column', alignItems: 'center', gap: 6 * S, padding: `${16 * S}px ${14 * S}px ${14 * S}px`, borderRadius: 18 * S,
      backgroundColor: C.panel, backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(241,199,91,0.28), rgba(34,30,61,0) 65%)' },
    h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, letterSpacing: 1.6 * S, color: C.gold }, 'QUARTER CHAMPION'),
    h('div', { position: 'relative', width: 104 * S, height: 104 * S, alignItems: 'center', justifyContent: 'center', marginTop: 4 * S },
      avatar(pics, first.name, 96, { w: 4, c: C.gold }),
      h('div', { position: 'absolute', top: -6 * S, right: -2 * S, width: 36 * S, height: 36 * S, borderRadius: 999, backgroundColor: C.gold, border: `${3 * S}px solid ${C.panel}`, alignItems: 'center', justifyContent: 'center' }, crown(20))),
    h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 28 * S, color: C.bright }, first.name),
    h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 20 * S, color: first.net >= 0 ? C.up : C.down }, usd(first.net)),
    second ? h('div', { gap: 10 * S, marginTop: 6 * S }, [[second, '2ND'], [third, '3RD']].filter(([p]) => p).map(([p, t]) =>
      h('div', { alignItems: 'center', gap: 8 * S, padding: `${6 * S}px ${12 * S}px ${6 * S}px ${6 * S}px`, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)' },
        avatar(pics, p.name, 30, { w: 2, c: 'rgba(201,195,240,0.45)' }),
        h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 10 * S, letterSpacing: 1 * S, color: C.muted }, t),
        h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 13.5 * S, color: C.bright }, p.name),
        h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 12.5 * S, color: p.net >= 0 ? C.up : C.down }, usd(p.net))))) : null);

  const tiles = [
    { t: w.best.record ? 'BEST NIGHT · ALL-TIME RECORD' : 'BEST NIGHT', name: w.best.name, v: usd(w.best.net), c: C.up, sub: w.best.date, accent: w.best.record ? C.gold : C.up },
    w.turn && { t: 'BIGGEST TURNAROUND', name: w.turn.name, v: usd(w.turn.gain), c: C.up, sub: `from ${usd(w.turn.from)} to ${usd(w.turn.to)}`, accent: '#2f8fd6' },
    { t: 'IRON MAN', name: w.iron.name, v: `${w.iron.n} of ${w.nights}`, c: C.bright, sub: 'nights played', accent: '#8f78f0' },
    w.wins && { t: 'MOST WINS', name: w.wins.name, v: `${w.wins.n}`, c: C.bright, sub: `night${w.wins.n === 1 ? '' : 's'} won`, accent: C.gold },
    w.tour && { t: 'TOURNAMENT KING', name: w.tour.name, v: usd(w.tour.net), c: C.up, sub: `${w.tourNights} tourney night${w.tourNights === 1 ? '' : 's'}`, accent: '#bd8210' },
    w.worst && { t: 'TOUGHEST NIGHT', name: w.worst.name, v: usd(w.worst.net), c: C.down, sub: w.worst.date, accent: C.down },
  ].filter(Boolean);
  const tw = (IN - 10) / 2;
  const tile = x => h('div', { width: tw * S, alignItems: 'center', gap: 10 * S, boxSizing: 'border-box', padding: `${10 * S}px ${12 * S}px`, borderRadius: 14 * S,
      backgroundColor: C.panel, borderLeft: `${4 * S}px solid ${x.accent}` },
    avatar(pics, x.name, 40, null),
    h('div', { flexDirection: 'column', flexGrow: 1, width: 0 },
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 9.5 * S, letterSpacing: 1 * S, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden' }, x.t),
      h('div', { justifyContent: 'space-between', alignItems: 'baseline', gap: 6 * S },
        h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 15 * S, color: C.bright, whiteSpace: 'nowrap', overflow: 'hidden' }, x.name),
        h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 13.5 * S, color: x.c, flexShrink: 0 }, x.v)),
      h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 11 * S, color: C.soft, whiteSpace: 'nowrap', overflow: 'hidden' }, x.sub)));
  const grid = h('div', { flexWrap: 'wrap', gap: 10 * S }, tiles.map(tile));

  const foot = h('div', { justifyContent: 'center', alignItems: 'center', gap: 7 * S, fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, color: C.muted },
    img(LOGO, 20 * S, 20 * S), `Poker Club @ The Study · on to the next one`);
  return h('div', { width: W * S, boxSizing: 'border-box', flexDirection: 'column', gap: 14 * S, padding: 18 * S, borderRadius: 22 * S, color: C.text,
      backgroundColor: C.night, backgroundImage: 'radial-gradient(circle at 100% 0%, rgba(110,82,200,0.35), rgba(21,19,42,0) 60%)' },
    band, champ, grid, foot);
}

/** PNG, or null when that quarter has no games. */
export async function render(csv, q, membersCsv = '', getPic = avatarPng) {
  loadAssets();
  const recs = gameRecords(csv);
  if (!recs.length) return null;
  const w = wrapStats(recs, /^Q[1-4] \d{4}$/.test(q || '') ? q : wrapDefault(recs));
  if (!w) return null;
  const ids = memberIds(membersCsv);
  const people = [...new Set([...w.podium.map(p => p.name), w.best.name, w.worst && w.worst.name, w.iron.name, w.wins && w.wins.name, w.tour && w.tour.name, w.turn && w.turn.name])].filter(p => p && ids[p]);
  const pics = Object.fromEntries((await Promise.all(people.map(async p => {
    try { const b = await getPic(ids[p]); return b ? [p, 'data:image/png;base64,' + Buffer.from(b).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  const svg = await satori(card(w, pics), { width: W * S, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
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
