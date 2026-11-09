// /api/card?name=Renato             a player's ratings card as a PNG (current quarter), the same numbers as the dashboard card
// /api/card?name=Renato&period=Y2026  their season card instead (period is "Q4 2026", "Y2026", or "all" for all-time)
// The /player Discord command shows this image.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { SHEET_URL, MEMBERS_URL, COLORS as C, gameRecords, findPlayer, playerCard, memberIds, hueFor, initials, usd } from '../recap-core.js';
import { avatarPng, bannerPng, accentColor } from './_discord.js';

const asset = name => readFileSync(new URL(`./_assets/${name}`, import.meta.url));
let FONTS, LOGO;
function loadAssets() {
  if (FONTS) return;
  const f = (name, file, weight) => ({ name, data: asset(file), weight, style: 'normal' });
  FONTS = [f('Bebas', 'bebas-neue-latin-400-normal.woff', 400), f('Nunito', 'nunito-latin-700-normal.woff', 700),
    f('Nunito', 'nunito-latin-800-normal.woff', 800), f('Nunito', 'nunito-latin-900-normal.woff', 900), f('Mono', 'ibm-plex-mono-latin-600-normal.woff', 600)];
  LOGO = 'data:image/png;base64,' + asset('logo.png').toString('base64');
}

const S = 2, W = 380, IN = W - 40; // 18px padding + 2px border each side
const svgUri = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const pngUri = b => 'data:image/png;base64,' + Buffer.from(b).toString('base64');
const h = (type, style, ...kids) => ({ type, props: { style: { display: 'flex', ...style }, children: kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '') } });
const img = (src, w, ht, style = {}) => ({ type: 'img', props: { src, width: w, height: ht, style } });
const col = v => v > 0 ? C.up : v < 0 ? C.down : C.soft;
const hsl = (hue, s, l) => `hsl(${hue}, ${s}%, ${l}%)`;
const usd0 = v => usd(Math.round(v), { cents: false });
const PERI = '#a9b4f6';

const avatar = (pic, name, size, ring) => {
  const base = { width: size * S, height: size * S, borderRadius: 999, flexShrink: 0, boxSizing: 'border-box', ...(ring ? { border: `${ring.w * S}px solid ${ring.c}` } : {}) };
  if (pic) return h('div', { ...base, overflow: 'hidden', backgroundColor: C.panel }, img(pic, size * S, size * S, { objectFit: 'cover' }));
  const hue = hueFor(name);
  return h('div', { ...base, backgroundColor: hsl(hue, 80, 86), color: hsl(hue, 45, 28), alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Nunito', fontWeight: 900, fontSize: size * 0.38 * S }, initials(name));
};
const lab = (l, r) => h('div', { height: 14 * S, justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Nunito', fontWeight: 800, fontSize: 10.5 * S, letterSpacing: 1 * S, color: C.muted }, h('div', {}, l), h('div', {}, r));
const rule = () => h('div', { height: 1 * S, backgroundColor: 'rgba(241,199,91,0.18)' });

function lineSvg(form) {
  const w = IN, ht = 64, L = 6, R = 6, T = 8, B = 8, vals = form.map(f => f.net);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals), rng = hi - lo || 1;
  const x = i => L + (vals.length === 1 ? (w - L - R) / 2 : i * (w - L - R) / (vals.length - 1)), y = v => T + (hi - v) / rng * (ht - T - B);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${ht}" width="${w * S}" height="${ht * S}">`
    + `<line x1="${L}" x2="${w - R}" y1="${y(0)}" y2="${y(0)}" stroke="${C.muted}" stroke-opacity=".45" stroke-dasharray="3 3"/>`
    + (vals.length > 1 ? `<polyline points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="#c9c3f0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '')
    + vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === vals.length - 1 ? 4.5 : 3.5}" fill="${v > 0 ? C.up : v < 0 ? C.down : '#cfcaf0'}" stroke="${C.panel}" stroke-width="2"/>`).join('')
    + `</svg>`;
}
const BADGE = { up: [C.up, '<path d="M6 2 L10.5 8 H1.5 Z" fill="#1a1630"/>', 'VS EASIEST'], down: [C.down, '<path d="M6 10 L10.5 4 H1.5 Z" fill="#1a1630"/>', 'VS NEMESIS'],
  even: [PERI, '<rect x="2" y="5" width="8" height="2" rx="1" fill="#1a1630"/>', 'BEST MATCHUP'] };
function matchup(m, kind, pics) {
  const [bg, path, word] = BADGE[kind];
  return h('div', { width: (IN - 8) / 2 * S, height: 54 * S, boxSizing: 'border-box', alignItems: 'center', gap: 10 * S, padding: `0 ${10 * S}px`, borderRadius: 12 * S, backgroundColor: 'rgba(255,255,255,0.04)' },
    h('div', { position: 'relative', flexShrink: 0, width: 38 * S, height: 38 * S },
      avatar(pics[m.p], m.p, 38),
      h('div', { position: 'absolute', right: -4 * S, bottom: -4 * S, width: 19 * S, height: 19 * S, borderRadius: 999, backgroundColor: bg, border: `${2 * S}px solid ${C.panel}`, alignItems: 'center', justifyContent: 'center' },
        img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12">${path}</svg>`), 10 * S, 10 * S))),
    h('div', { flexDirection: 'column' },
      h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 16 * S, color: C.bright }, `${m.ahead}–${m.n - m.ahead}`),
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 10 * S, letterSpacing: 0.6 * S, color: C.muted }, word)));
}

export function layout(c) {
  const heights = [120, 34, 18, c.badges && c.badges.length ? 22 : 0,
    c.empty ? 0 : (c.ovr ? 3 * 18 + 2 * 10 : 18),
    c.empty ? 0 : 1 + 14 + 6 + 64,
    c.empty ? 0 : 1 + [c.cash, c.tour, 1].filter(Boolean).length * 20 + 2,
    c.empty || !c.h2h.best ? 0 : 54,
    c.empty ? 0 : 1 + 40,
    22].filter(Boolean);
  return { width: W * S, height: (18 * 2 + heights.reduce((a, b) => a + b, 0) + 10 * (heights.length - 1)) * S };
}

export function card(c, L, art) {
  const pics = art.pics || {};
  const bannerBg = art.banner ? {} : { backgroundImage: art.color ? `linear-gradient(135deg, ${art.color}, ${C.panel})` : `linear-gradient(120deg, #3a2a6e, ${C.maroon})` };
  const ovrBox = c.ovr
    ? [h('div', { fontFamily: 'Bebas', fontSize: 62 * S, lineHeight: 0.9, color: C.gold }, String(c.ovr.value)),
       h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 11 * S, letterSpacing: 1.5 * S, color: C.gold }, 'OVR'),
       h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, color: C.soft, marginTop: 3 * S }, `${c.ovr.rank} of ${c.ovr.of}`)]
    : [h('div', { fontFamily: 'Bebas', fontSize: 40 * S, lineHeight: 0.9, color: C.muted }, '–'),
       h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 11 * S, letterSpacing: 1.5 * S, color: C.gold }, 'OVR'),
       h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 10 * S, color: C.soft, marginTop: 3 * S }, c.empty ? 'no games' : `needs ${c.needs} nights`)];
  const full = !!art.full;
  const top = h('div', { position: 'relative', flexShrink: 0, height: 120 * S, margin: `${-18 * S}px ${-18 * S}px 0`, width: (W - 4) * S, borderRadius: `${22 * S}px ${22 * S}px 0 0`, overflow: 'hidden', ...(full ? {} : bannerBg) },
    art.banner && !full ? img(art.banner, (W - 4) * S, 120 * S, { position: 'absolute', left: 0, top: 0, objectFit: 'cover' }) : null,
    full ? null : h('div', { position: 'absolute', left: 0, top: 0, width: (W - 4) * S, height: 120 * S, backgroundImage: `linear-gradient(180deg, rgba(21,19,42,0.1), rgba(21,19,42,0.3) 55%, ${C.panel})` }),
    h('div', { position: 'absolute', left: 16 * S, top: 16 * S, width: 76 * S, height: 92 * S, flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(21,19,42,0.6)', borderRadius: 12 * S }, ovrBox),
    h('div', { position: 'absolute', left: ((W - 4) / 2 - 54) * S, top: 10 * S, width: 108 * S, height: 108 * S, borderRadius: 999, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center' },
      avatar(pics[c.name], c.name, 100, { w: 4, c: C.panel })));
  const name = h('div', { height: 34 * S, justifyContent: 'center', alignItems: 'center', fontFamily: 'Nunito', fontWeight: 900, fontSize: 30 * S, color: C.bright }, c.name);
  const sub = h('div', { height: 18 * S, justifyContent: 'center', alignItems: 'center', fontFamily: 'Nunito', fontWeight: 700, fontSize: 13 * S, color: C.muted },
    c.empty ? `no games in ${c.label}` : `${c.label} · played ${c.played} of ${c.nights} nights`);
  const badges = c.badges && c.badges.length ? h('div', { height: 22 * S, justifyContent: 'center', gap: 6 * S },
    c.badges.map(b => h('div', { height: 22 * S, alignItems: 'center', padding: `0 ${9 * S}px`, borderRadius: 999, border: `${1 * S}px solid rgba(201,195,240,0.5)`, fontFamily: 'Nunito', fontWeight: 700, fontSize: 11.5 * S, color: C.soft }, b))) : null;
  const foot = h('div', { height: 22 * S, justifyContent: 'center', alignItems: 'center', gap: 7 * S, fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, color: C.muted },
    img(LOGO, 20 * S, 20 * S), 'Poker Club @ The Study');
  // full: the banner (or profile colour) fills the whole card behind everything, darkened so the stats stay readable
  const BW = (W - 4) * S, BHt = L.height - 4 * S;
  const mode = art.full, bw = Math.round(BHt * 2.5);
  const bannerLayer = (style, size, pos, extra = {}) => art.banner
    ? h('div', { position: 'absolute', left: 0, width: BW, backgroundImage: `url(${art.banner})`, backgroundSize: size, backgroundPosition: pos, backgroundRepeat: 'no-repeat', ...style, ...extra })
    : h('div', { position: 'absolute', left: 0, width: BW, ...bannerBg, ...style });
  const shade = (style, bg) => h('div', { position: 'absolute', left: 0, width: BW, backgroundImage: bg, ...style });
  const HH = 230 * S, hw = Math.round(HH * 2.5);
  const backdrop = !full ? [] : mode === 'hero' ? [
      bannerLayer({ top: 0, height: HH }, `${hw}px ${HH}px`, 'center top'),
      shade({ top: 0, height: HH }, `linear-gradient(180deg, rgba(34,30,61,0.05), rgba(34,30,61,0.35) 45%, ${C.panel})`)]
    : mode === 'frame' ? [
      bannerLayer({ top: 0, height: BHt }, `${bw}px ${BHt}px`, 'center', { filter: `blur(${3 * S}px)` }),
      h('div', { position: 'absolute', left: 7 * S, top: 132 * S, width: BW - 14 * S, height: BHt - 139 * S, borderRadius: 16 * S, backgroundColor: 'rgba(34,30,61,0.9)', border: `${1 * S}px solid rgba(255,255,255,0.12)` })]
    : mode === 'bookend' ? [
      bannerLayer({ top: 0, height: 150 * S }, `${BW}px ${Math.round(BW / 2.5)}px`, 'center top'),
      shade({ top: 0, height: 150 * S }, `linear-gradient(180deg, rgba(34,30,61,0.05), rgba(34,30,61,0.4) 50%, ${C.panel})`),
      bannerLayer({ top: BHt - 70 * S, height: 70 * S }, `${BW}px ${Math.round(BW / 2.5)}px`, 'center bottom'),
      shade({ top: BHt - 70 * S, height: 70 * S }, `linear-gradient(0deg, rgba(34,30,61,0.45), rgba(34,30,61,0.8) 55%, ${C.panel})`)]
    : [
      bannerLayer({ top: 0, height: BHt }, `${bw}px ${BHt}px`, 'center', mode === 'blur' ? { filter: `blur(${6 * S}px)` } : {}),
      shade({ top: 0, height: BHt }, 'linear-gradient(180deg, rgba(21,19,42,0.15), rgba(21,19,42,0.45) 22%, rgba(21,19,42,0.72) 40%, rgba(21,19,42,0.8))')];
  const wrap = (...kids) => full
    ? h('div', { position: 'relative', width: L.width, boxSizing: 'border-box', borderRadius: 22 * S, overflow: 'hidden', backgroundColor: C.panel, border: `${2 * S}px solid rgba(241,199,91,0.55)` },
        ...backdrop, h('div', { position: 'relative', width: BW, flexDirection: 'column', gap: 10 * S, padding: 18 * S, boxSizing: 'border-box' }, ...kids))
    : h('div', { width: L.width, boxSizing: 'border-box', flexDirection: 'column', gap: 10 * S, padding: 18 * S, borderRadius: 22 * S,
    backgroundColor: C.panel, backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(74,58,142,0.9), rgba(34,30,61,0) 62%)', border: `${2 * S}px solid rgba(241,199,91,0.55)` }, ...kids);
  if (c.empty) return wrap(top, name, sub, foot);

  const attrW = (IN - 18) / 2;
  const attr = a => h('div', { width: attrW * S, height: 18 * S, alignItems: 'center', gap: 8 * S },
    h('div', { width: 32 * S, fontFamily: 'Nunito', fontWeight: 900, fontSize: 11 * S, letterSpacing: 0.9 * S, color: C.text }, a.k),
    h('div', { flexGrow: 1, height: 7 * S, borderRadius: 4 * S, backgroundColor: 'rgba(255,255,255,0.08)' },
      h('div', { width: `${a.v}%`, height: 7 * S, borderRadius: 4 * S, backgroundColor: a.v >= 90 ? C.gold : a.v >= 75 ? C.up : PERI })),
    h('div', { width: 26 * S, justifyContent: 'flex-end', fontFamily: 'Mono', fontWeight: 600, fontSize: 14 * S, color: C.bright }, String(a.v)));
  const attrs = c.ovr ? h('div', { flexWrap: 'wrap', rowGap: 10 * S, columnGap: 18 * S }, c.attrs.map(attr))
    : h('div', { height: 18 * S, justifyContent: 'center', fontFamily: 'Nunito', fontWeight: 700, fontSize: 12 * S, color: C.muted }, `Ratings start at ${c.needs} nights in ${c.label}.`);
  const upN = c.form.filter(f => f.net > 0).length;
  const form = [rule(), lab(`LAST ${c.form.length} NIGHT${c.form.length === 1 ? '' : 'S'}`, `${upN} UP · ${c.form.length - upN} DOWN`), img(svgUri(lineSvg(c.form)), IN * S, 64 * S, { marginTop: -4 * S })];
  const row = (l, v, txt) => h('div', { height: 20 * S, justifyContent: 'space-between', alignItems: 'center', fontSize: 13 * S },
    h('div', { fontFamily: 'Nunito', fontWeight: 700, color: C.muted }, l), h('div', { fontFamily: 'Mono', fontWeight: 600, color: col(v) }, txt ?? usd(v)));
  const split = h('div', { flexDirection: 'column' },
    c.cash ? row(`Cash · ${c.cash.n} night${c.cash.n === 1 ? '' : 's'}`, c.cash.net) : null,
    c.tour ? row(`Tournament · ${c.tour.n} night${c.tour.n === 1 ? '' : 's'}`, c.tour.net) : null,
    c.best ? row(`Best night · ${c.best.date}`, c.best.net) : row('Best night', 0, '–'));
  const h2h = c.h2h.best ? h('div', { gap: 8 * S }, matchup(c.h2h.best, c.h2h.best.rate > 0.5 ? 'up' : 'even', pics), c.h2h.worst ? matchup(c.h2h.worst, 'down', pics) : null) : null;
  const stat = (v, l, color) => h('div', { flexGrow: 1, flexBasis: 0, flexDirection: 'column', alignItems: 'center' },
    h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 15 * S, color }, v), h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 10.5 * S, letterSpacing: 0.6 * S, color: C.muted }, l));
  const totals = h('div', { height: 40 * S, alignItems: 'center' }, stat(usd0(c.net), 'NET', col(c.net)), stat(String(c.wins), 'WINS', C.bright), stat(`#${c.rank}`, `OF ${c.of}`, C.bright));
  return wrap(top, name, sub, badges, attrs, ...[h('div', { flexDirection: 'column', gap: 6 * S }, ...form)], h('div', { flexDirection: 'column', gap: 1 * S }, rule(), split), h2h,
    h('div', { flexDirection: 'column' }, h('div', { height: 1 * S, backgroundColor: 'rgba(241,199,91,0.25)' }), totals), foot);
}

/** The card PNG, or null when nobody by that name has played. art: { getPic, getBanner, getColor } (Discord lookups by default). */
export async function render(csv, query, period, membersCsv = '', art = {}) {
  loadAssets();
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
  const L = layout(c);
  const svg = await satori(card(c, L, { pics, banner: banner ? pngUri(banner) : null, color, full: art.full === undefined ? 'hero' : art.full }), { width: L.width, fonts: FONTS });
  return { png: new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng(), name: c.name, period: c.period };
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
