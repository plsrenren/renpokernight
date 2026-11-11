// "Late Show" look for every Discord image card: Cozy night colours restyled as a sports broadcast
// (hard edges, slanted chyron headers, Bebas numbers, square pfps). Each card is laid out at 1x and drawn at 2x.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { usd, hueFor, initials, words } from '../recap-core.js';

const asset = name => readFileSync(new URL(`./_assets/${name}`, import.meta.url));
let FONTS, LOGO;
function loadAssets() {
  if (FONTS) return;
  const f = (name, file, weight) => ({ name, data: asset(file), weight, style: 'normal' });
  FONTS = [f('Bebas', 'bebas-neue-latin-400-normal.woff', 400), f('Grotesk', 'space-grotesk-latin-500-normal.woff', 500),
    f('Grotesk', 'space-grotesk-latin-700-normal.woff', 700), f('Mono', 'ibm-plex-mono-latin-600-normal.woff', 600)];
  LOGO = 'data:image/png;base64,' + asset('logo.png').toString('base64');
}

export const L = { night: '#15132a', panel: '#201c3b', panel2: '#2a2550', line: '#2c2750', vio: '#8f78f0', pink: '#e0507f', gold: '#f1c75b',
  up: '#8ee0b0', down: '#f59bb0', muted: '#9a94c4', soft: '#cfcaf0', text: '#ece9fb', bronze: '#e39a68', silver: '#d7d3ef', foot: '#0e0c1f' };
const W = 560, PAD = 22, IN = W - PAD * 2;
const svgUri = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
export const h = (style, ...kids) => ({ type: 'div', props: { style: { display: 'flex', boxSizing: 'border-box', ...style }, children: kids.flat(9).filter(k => k !== null && k !== undefined && k !== false && k !== '') } });
const img = (src, w, ht, style = {}) => ({ type: 'img', props: { src, width: w, height: ht, style } });
// size of a PNG data URI (falls back to Discord's 600x240 banner shape)
const pngSize = uri => { try { const b = Buffer.from(uri.slice(uri.indexOf(',') + 1, uri.indexOf(',') + 45), 'base64');
  if (b.toString('ascii', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)]; } catch (e) {} return [600, 240]; };
// fill a w x ht box with the picture, cropping the overflow (satori's objectFit cover is unreliable when the box shape differs a lot)
const cover = (src, w, ht) => { const [iw, ih] = pngSize(src), k = Math.max(w / iw, ht / ih), dw = Math.ceil(iw * k), dh = Math.ceil(ih * k);
  return h({ position: 'absolute', left: 0, top: 0, width: w, height: ht, overflow: 'hidden' }, img(src, dw, dh, { position: 'absolute', left: Math.round((w - dw) / 2), top: Math.round((ht - dh) / 2) })); };
const col = v => v > 0 ? L.up : v < 0 ? L.down : L.muted;
const T = (txt, style) => h({ fontFamily: 'Grotesk', fontWeight: 500, ...style }, String(txt));
const B = (txt, size, color = '#fff', style = {}) => h({ fontFamily: 'Bebas', fontSize: size, lineHeight: 1, color, letterSpacing: size * 0.02, paddingTop: size * 0.08, ...style }, String(txt));
const M = (txt, size, color, style = {}) => h({ fontFamily: 'Mono', fontWeight: 600, fontSize: size, color, ...style }, String(txt));
const money = (v, size, style) => M(usd(v), size, col(v), style);

/** a player's square: their Discord pfp, or their initial on their colour */
export const sq = (pics, name, s, ring) => {
  // every pfp gets a border: gold on the big ones, soft white on small ones, unless a colour is passed
  const c = ring || (s >= 60 ? L.gold : 'rgba(236,233,251,0.85)');
  const base = { width: s, height: s, flexShrink: 0, boxSizing: 'border-box', border: `${Math.max(2, Math.round(s / 28))}px solid ${c}` };
  const pic = pics && pics[name];
  if (pic) return h({ ...base, overflow: 'hidden', backgroundColor: '#000' }, img(pic, s, s, { objectFit: 'cover' }));
  const hue = hueFor(name);
  return h({ ...base, backgroundColor: `hsl(${hue}, 70%, 80%)`, color: `hsl(${hue}, 45%, 22%)`, alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Bebas', fontSize: s * 0.55, paddingTop: s * 0.06 }, initials(name));
};
const ICON = {
  crown: c => `<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z" fill="${c}"/><rect x="5" y="19" width="14" height="2" rx="1" fill="${c}"/>`,
  trophy: c => `<path d="M7 3h10v3h3v2a4 4 0 0 1-4 4 5 5 0 0 1-3 2.6V17h3v3H8v-3h3v-2.4A5 5 0 0 1 8 12a4 4 0 0 1-4-4V6h3zM6 8a2 2 0 0 0 1 1.7V8zm11 0v1.7A2 2 0 0 0 18 8z" fill="${c}"/>`,
  flame: c => `<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 2 4 1-2 1-5 1-8z" fill="${c}"/>`,
  chair: c => `<path d="M7 3h10v9H7zM5 12h14v3H5zM6 15h2v6H6zM16 15h2v6h-2z" fill="${c}"/>`,
  target: c => `<circle cx="12" cy="12" r="9" fill="none" stroke="${c}" stroke-width="2.4"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="${c}" stroke-width="2.4"/><circle cx="12" cy="12" r="1.6" fill="${c}"/>`,
  chips: c => `<ellipse cx="12" cy="7" rx="8" ry="3" fill="${c}"/><path d="M4 7v4c0 1.7 3.6 3 8 3s8-1.3 8-3V7c0 1.7-3.6 3-8 3S4 8.7 4 7z" fill="${c}" opacity=".75"/><path d="M4 12v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4c0 1.7-3.6 3-8 3s-8-1.3-8-3z" fill="${c}" opacity=".5"/>`,
  gift: c => `<path d="M4 10h16v10H4zM3 7h18v3H3zM11 7h2v13h-2z" fill="${c}"/><path d="M12 7c-2-4-6-3-5-1s5 1 5 1zm0 0c2-4 6-3 5-1s-5 1-5 1z" fill="${c}"/>`,
};
const icon = (n, c, s) => img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${(ICON[n] || ICON.trophy)(c)}</svg>`), s, s);
const slant = cut => `polygon(0 0, 100% 0, calc(100% - ${cut}px) 100%, 0 100%)`;

/** a section header: slanted coloured block on the left edge, optional note on the right */
const chy = (title, note = '', kind = 'vio') => {
  const bg = { vio: L.vio, pink: L.pink, gold: L.gold }[kind], fg = kind === 'gold' ? L.night : '#fff';
  return h({ alignItems: 'center', height: 30, marginTop: 22, marginBottom: 10 },
    h({ height: 30, alignItems: 'center', position: 'relative', paddingLeft: PAD, paddingRight: 24 },
      h({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30" preserveAspectRatio="none" width="100" height="30"><path d="M0 0H100L94 30H0Z" fill="${bg}"/></svg>`), '100%', 30, { width: '100%', height: 30 })),
      h({ position: 'relative' }, B(title.toUpperCase(), 22, fg, { letterSpacing: 1.5 }))),
    note ? T(note, { marginLeft: 'auto', paddingRight: PAD, fontSize: 12, color: L.muted }) : null);
};
const pad = (...kids) => h({ flexDirection: 'column', paddingLeft: PAD, paddingRight: PAD }, kids);
const mast = (title, sub) => h({ height: 84, alignItems: 'stretch' },
  h({ width: 96, backgroundColor: L.pink, alignItems: 'center', paddingLeft: 13, clipPath: 'polygon(0 0, 100% 0, 82% 100%, 0 100%)' }, img(LOGO, 58, 58)),
  h({ flexDirection: 'column', justifyContent: 'center', paddingLeft: 6, flex: 1 },
    B(title.toUpperCase(), 36), T(sub, { fontSize: 12.5, color: L.muted, marginTop: 3 })));
const foot = (l, r = 'renpokernight.vercel.app') => h({ marginTop: 20, height: 34, alignItems: 'center', justifyContent: 'space-between', backgroundColor: L.foot, paddingLeft: PAD, paddingRight: PAD },
  B(l.toUpperCase(), 16, L.gold, { letterSpacing: 1.5 }), T(r, { fontSize: 11.5, color: L.muted }));
const frame = (...kids) => h({ width: W, flexDirection: 'column', backgroundColor: L.night, color: L.text, overflow: 'hidden',
  backgroundImage: 'linear-gradient(115deg, rgba(143,120,240,0.18) 0%, rgba(143,120,240,0.18) 30%, rgba(21,19,42,0) 30%), radial-gradient(circle at 100% 0%, rgba(224,80,127,0.25), rgba(21,19,42,0) 45%)' }, kids);
const tri = (upw, c) => img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 8" width="10" height="8"><path d="${upw ? 'M5 0L10 8H0Z' : 'M0 0H10L5 8Z'}" fill="${c}"/></svg>`), 8, 6.4);
const mv = x => x === '' ? null : x === 'new' ? M('NEW', 10.5, L.gold) : x === 0 ? M('–', 11, '#6d6895') : h({ alignItems: 'center', gap: 2 }, tri(x > 0, x > 0 ? L.up : L.down), M(String(Math.abs(x)), 10.5, x > 0 ? L.up : L.down));
const story = (ws, n) => h({ gap: 12, paddingTop: 7, paddingBottom: 7, borderBottom: `1px solid ${L.line}`, alignItems: 'flex-start' },
  B(String(n), 22, L.pink, { width: 18 }),
  h({ flexWrap: 'wrap', flex: 1, fontFamily: 'Grotesk', fontWeight: 500, fontSize: 14, lineHeight: '21px', color: L.soft },
    ws.map(w => h({ marginLeft: w.space ? 4 : 0, ...(w.kind === 'name' ? { color: '#fff', fontWeight: 700 } : w.kind === 'gold' ? { color: L.gold, fontWeight: 700 } : w.kind === 'up' ? { color: L.up, fontFamily: 'Mono', fontWeight: 600 } : w.kind === 'down' ? { color: L.down, fontFamily: 'Mono', fontWeight: 600 } : {}) }, w.t))));
function sparkSvg(vals, w, ht, o = {}) {
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), rng = hi - lo || 1, p = o.pad ?? 4;
  const xs = vals.map((_, i) => vals.length === 1 ? w / 2 : p + i * (w - 2 * p) / (vals.length - 1)), y = v => p + (hi - v) / rng * (ht - 2 * p);
  const pts = vals.map((v, i) => `${xs[i].toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = (o.all ? vals.map((_, i) => i) : [vals.length - 1]).map(i => `<circle cx="${xs[i]}" cy="${y(vals[i])}" r="${o.r ?? 2.6}" fill="${vals[i] >= 0 ? L.up : L.down}"/>`).join('');
  const area = o.fill && vals.length > 1 ? `<polygon points="${xs[0]},${y(0)} ${pts} ${xs[xs.length - 1]},${y(0)}" fill="${o.fill}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${ht}" width="${w * 2}" height="${ht * 2}">${area}<line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" stroke="#3b3566" stroke-dasharray="3 3"/>`
    + (vals.length > 1 ? `<polyline points="${pts}" fill="none" stroke="#b9b0f0" stroke-width="${o.sw ?? 1.6}" stroke-linejoin="round" stroke-linecap="round"/>` : '') + dots + '</svg>';
}
const spark = (vals, w, ht, o) => img(svgUri(sparkSvg(vals, w, ht, o)), w, ht);

export async function draw(tree) {
  loadAssets();
  const svg = await satori(tree, { width: W, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 } }).render().asPng();
}
export const withAssets = fn => (...a) => { loadAssets(); return fn(...a); };

// ---------- recap (/api/recap) ----------
export const recapCard = withAssets(m => {
  const pics = m.pics || {}, st = m.stories, half = Math.ceil(m.standings.rows.length / 2);
  const lead = m.standings.rows.slice(0, 5), hi = Math.max(0, ...lead.map(r => r.net)), lo = Math.min(0, ...lead.map(r => r.net));
  const BH = 130, k = BH / Math.max(1, hi - lo), zero = 20 + hi * k, MED = [L.gold, L.silver, L.bronze, L.vio, L.vio];
  const tile = (r, i) => h({ width: (IN - 6) / 2, height: 48, alignItems: 'center', backgroundColor: L.panel, borderLeft: `4px solid ${r.net > 0 ? L.up : r.net < 0 ? L.down : L.muted}` },
    B(String(i + 1), 22, L.muted, { width: 30, justifyContent: 'center' }), sq(pics, r.player, 34),
    h({ flexDirection: 'column', flex: 1, paddingLeft: 9, overflow: 'hidden' }, T(r.player, { fontWeight: 700, fontSize: 14.5, color: '#fff', whiteSpace: 'nowrap' }), money(r.net, 12.5)),
    h({ paddingRight: 8 }, spark(r.form, 70, 26)));
  const bars = h({ position: 'relative', width: IN, height: BH + 40 },
    ...lead.flatMap((r, i) => { const slot = IN / lead.length, x = i * slot + 14, bw = slot - 28, ht = Math.max(3, Math.abs(r.net) * k), y = r.net >= 0 ? zero - ht : zero;
      return [h({ position: 'absolute', left: x, top: y, width: bw, height: ht, backgroundColor: MED[i], opacity: i > 2 ? 0.75 : 1 }),
        h({ position: 'absolute', left: i * slot, width: slot, top: r.net >= 0 ? y - 18 : y + ht + 3, justifyContent: 'center' }, money(r.net, 12)),
        ht >= 34 ? h({ position: 'absolute', left: x, width: bw, top: y + 4, justifyContent: 'center' }, B(String(i + 1), 24, i < 3 ? L.night : '#fff')) : null]; }),
    h({ position: 'absolute', left: 0, top: zero, width: IN, height: 2, backgroundColor: '#4a4570' }));
  const names = h({}, lead.map((r, i) => h({ width: IN / lead.length, flexDirection: 'column', alignItems: 'center', gap: 3 }, sq(pics, r.name, 28),
    T(r.name, { fontWeight: 700, fontSize: 13, color: i ? '#fff' : L.gold, whiteSpace: 'nowrap' }))));
  const row = r => h({ height: 30, alignItems: 'center', borderBottom: `1px solid ${L.panel2}` },
    h({ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: r.rank === 1 ? L.gold : L.panel2, marginRight: 8 }, B(String(r.rank), 19, r.rank === 1 ? L.night : L.muted)),
    pics[r.name] ? h({ marginRight: 7 }, sq(pics, r.name, 20)) : null,
    T(r.name, { flex: 1, fontWeight: 700, fontSize: 14, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden' }),
    h({ width: 34, justifyContent: 'flex-end' }, mv(r.mv)), h({ width: 84, justifyContent: 'flex-end', paddingRight: 6 }, money(r.net, 13)));
  const award = a => h({ width: (IN - 6) / 2, alignItems: 'stretch', backgroundColor: L.panel },
    h({ width: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: L.line }, icon(a.icon, L.gold, 24)),
    h({ flexDirection: 'column', padding: '8px 10px', flex: 1, overflow: 'hidden' }, B(a.title.toUpperCase(), 15, L.gold, { letterSpacing: 1.8 }),
      T(a.who, { fontWeight: 700, color: '#fff', fontSize: 14, whiteSpace: 'nowrap' }), M(a.what, 11.5, L.muted)));
  return frame(
    mast(m.title, m.sub + (m.off ? ' · ' + m.off : '')),
    h({ marginTop: 16, marginLeft: PAD, marginRight: PAD, height: 96, backgroundImage: 'linear-gradient(100deg, #3a2a6e, #a23b58)' },
      h({ width: 96, backgroundColor: L.gold, alignItems: 'center', justifyContent: 'center' }, sq(pics, m.winner.name, 70, L.night)),
      h({ flex: 1, flexDirection: 'column', justifyContent: 'center', paddingLeft: 16 }, B(m.winner.name.toUpperCase(), 54)),
      h({ flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', paddingRight: 16 }, M(usd(m.winner.net), 28, L.gold), T(m.winner.note.replace('<br>', ' '), { fontSize: 12, color: '#ffd7e1' }))),
    chy('Tonight', 'line = last 6 nights'),
    h({ paddingLeft: PAD, paddingRight: PAD, flexWrap: 'wrap', gap: 6 }, m.rows.map(tile)),
    chy("Tonight's storylines", '', 'pink'), pad(st.night.map((w, i) => story(words(w), i + 1))),
    chy(m.podiumTitle, `top ${lead.length} so far`, 'gold'), pad(bars, names),
    chy(m.standings.title, m.standings.note),
    h({ paddingLeft: PAD, paddingRight: PAD, gap: 12 }, h({ flexDirection: 'column', flex: 1 }, m.standings.rows.slice(0, half).map(row)), h({ flexDirection: 'column', flex: 1 }, m.standings.rows.slice(half).map(row))),
    chy(st.quarterTitle, st.awardsNote, 'pink'),
    pad(st.quarter.map((w, i) => story(words(w), i + 1)), h({ flexWrap: 'wrap', gap: 6, marginTop: 12 }, st.awards.map(award))),
    foot('Poker Club @ The Study', 'renpokernight.vercel.app/recap'));
});
export const toWords = words;

// ---------- player (/api/card) ----------
export const playerCardTree = withAssets((c, art = {}) => {
  const pics = art.pics || {}, ov = c.ovr, hh = c.h2h || {};
  const heroBg = art.banner ? {} : { backgroundImage: art.color ? `linear-gradient(135deg, ${art.color}, ${L.panel})` : 'linear-gradient(120deg, #3a2a6e, #a23b58)' };
  const hero = h({ position: 'relative', height: 220, ...heroBg },
    art.banner ? cover(art.banner, W, 220) : null,
    art.banner ? h({ position: 'absolute', left: 0, top: 0, width: W, height: 220, backgroundImage: 'linear-gradient(90deg, rgba(21,19,42,0.6), rgba(21,19,42,0.15) 45%, rgba(21,19,42,0.35))' }) : null,
    art.banner ? h({ position: 'absolute', left: 0, top: 0, width: W, height: 220, backgroundImage: 'linear-gradient(180deg, rgba(21,19,42,0) 55%, rgba(21,19,42,0.9))' }) : null,
    ov ? h({ position: 'absolute', right: -10, top: -38, fontFamily: 'Bebas', fontSize: 250, lineHeight: 1, color: 'rgba(255,255,255,0.08)' }, String(ov.value)) : null,
    h({ width: 190, alignItems: 'center', justifyContent: 'center', position: 'relative' }, sq(pics, c.name, 140)),
    // darker fade behind the text side so it reads on busy banners
    art.banner ? h({ position: 'absolute', left: 0, top: 0, width: W, height: 220, backgroundImage: 'linear-gradient(90deg, rgba(21,19,42,0) 25%, rgba(21,19,42,0.78) 55%, rgba(21,19,42,0.78))' }) : null,
    h({ flex: 1, flexDirection: 'column', justifyContent: 'center', paddingRight: 12, position: 'relative' },
      B(c.name.toUpperCase(), c.name.length > 9 ? 50 : 66, '#fff'),
      T(`${c.label} · played ${c.played} of ${c.nights}`, { fontSize: 13, color: 'rgba(236,233,251,0.75)', marginTop: 2 }),
      h({ gap: 6, marginTop: 8, flexWrap: 'wrap' }, (c.badges || []).map(b => h({ backgroundColor: 'rgba(0,0,0,0.35)', padding: '4px 10px' }, T(b, { fontSize: 12, fontWeight: 700, color: '#fff' }))))));
  if (c.empty) return frame(hero, pad(T(`No games in ${c.label}.`, { fontSize: 15, color: L.muted, marginTop: 24 })), foot('Poker Club @ The Study'));
  const stat = (v, l) => h({ flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }, B(v, 30, L.night), T(l, { fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, color: L.night }));
  const strip = h({ marginTop: -26, marginLeft: PAD, marginRight: PAD, height: 66, backgroundColor: L.gold, position: 'relative' },
    h({ alignItems: 'center', gap: 10, paddingLeft: 18, paddingRight: 18, backgroundColor: L.night, border: `2px solid ${L.gold}` },
      B(ov ? String(ov.value) : '–', 52, L.gold),
      h({ flexDirection: 'column' }, B('OVERALL', 18, L.gold, { letterSpacing: 2 }), T(ov ? `${ov.rank} of ${ov.of} regulars` : `needs ${c.needs} nights`, { fontSize: 11, color: L.muted }))),
    stat(usd(Math.round(c.net), { cents: false }), 'NET'), stat(String(c.wins), 'WINS'), stat('#' + c.rank, 'OF ' + c.of));
  const attr = a => h({ width: (IN - 12) / 3, height: 58, backgroundColor: L.panel, alignItems: 'center', paddingLeft: 12, gap: 10, position: 'relative' },
    h({ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${a.v}%`, backgroundColor: a.v >= 80 ? L.up : a.v >= 60 ? L.gold : L.down }),
    B(a.k, 20, L.muted, { width: 40, letterSpacing: 1.5 }), B(String(a.v), 38));
  const ups = c.form.filter(f => f.net > 0).length, downs = c.form.filter(f => f.net < 0).length;
  const shown = c.form.slice(-4);
  const nightBox = f => h({ flex: 1, flexDirection: 'column', backgroundColor: L.panel, padding: '10px 12px', borderTop: `4px solid ${f.net > 0 ? L.up : f.net < 0 ? L.down : L.muted}` },
    T(f.date, { fontSize: 12, color: L.muted }), money(f.net, shown.length > 3 ? 15 : 20));
  const kv = (l, v) => h({ height: 30, alignItems: 'center', borderBottom: `1px solid ${L.panel2}` }, T(l, { flex: 1, fontSize: 14, color: L.text }), h({ paddingRight: 6 }, money(v, 13.5)));
  const mu = (x, l, colr) => x ? h({ flex: 1, alignItems: 'center', gap: 10, backgroundColor: L.panel, borderLeft: `4px solid ${colr}` }, sq(pics, x.p, 48),
    h({ flexDirection: 'column' }, B(l, 15, colr, { letterSpacing: 1.8 }), h({ alignItems: 'baseline', gap: 6 }, T(x.p, { fontWeight: 700, color: '#fff', fontSize: 15 }), M(`${x.ahead}–${x.n - x.ahead}`, 14, '#fff')))) : null;
  return frame(hero, strip,
    c.attrs.length ? chy('Ratings') : null,
    c.attrs.length ? h({ paddingLeft: PAD, paddingRight: PAD, flexWrap: 'wrap', gap: 6 }, c.attrs.map(attr)) : null,
    chy(`Last ${c.form.length} night${c.form.length === 1 ? '' : 's'}`, `${ups} up · ${downs} down`, 'pink'),
    pad(h({ gap: 6 }, shown.map(nightBox)),
      h({ marginTop: 6, backgroundColor: L.panel, padding: '8px 6px' }, spark(c.form.map(f => f.net), IN - 12, 56, { all: true, r: 4.5, sw: 2.2, pad: 8, fill: 'rgba(143,120,240,0.15)' }))),
    chy('The book', '', 'gold'),
    pad(c.cash ? kv(`Cash · ${c.cash.n} night${c.cash.n === 1 ? '' : 's'}`, c.cash.net) : null,
      c.tour ? kv(`Tournament · ${c.tour.n} night${c.tour.n === 1 ? '' : 's'}`, c.tour.net) : null,
      c.best ? kv(`Best night · ${c.best.date}`, c.best.net) : null,
      hh.best || hh.worst ? h({ gap: 6, marginTop: 10 }, mu(hh.best, hh.best && hh.worst ? 'VS EASIEST' : 'BEST MATCHUP', L.up), mu(hh.worst, 'VS NEMESIS', L.down)) : null),
    foot('Poker Club @ The Study'));
});

// ---------- hall of fame (/api/hall) ----------
export const hallCardTree = withAssets((H, pics = {}) => {
  const R = H.records, live = H.quarters.find(q => q.live), done = H.quarters.find(q => !q.live), shelf = H.shelf.slice(0, 6), max = Math.max(1, ...shelf.map(t => t.total));
  const rec = (key, t, c) => R[key] ? h({ flex: 1, flexDirection: 'column', alignItems: 'center', backgroundColor: L.panel, borderTop: `5px solid ${c}`, padding: '12px 6px 14px' },
    B(t.toUpperCase(), 16, c, { letterSpacing: 2 }), h({ marginTop: 8, marginBottom: 8 }, sq(pics, R[key].name, 62)), B(R[key].name.toUpperCase(), 28), money(R[key].net, 15)) : h({ flex: 1 });
  const cell = k => h({ width: 300 / max - 3, height: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: k }, icon('trophy', 'rgba(21,19,42,0.65)', 13));
  const shelfRow = (t, i) => h({ height: 34, alignItems: 'center', gap: 10 },
    B(String(i + 1), 22, i ? L.muted : L.gold, { width: 22 }), sq(pics, t.name, 26), T(t.name, { width: 84, fontWeight: 700, fontSize: 14, color: i ? '#fff' : L.gold, whiteSpace: 'nowrap', overflow: 'hidden' }),
    h({ flex: 1, gap: 3 }, [...Array(t.overall).fill(L.gold), ...Array(t.cash).fill(L.vio), ...Array(t.tour).fill(L.bronze)].map(cell)),
    B(String(t.total), 26, '#fff', { width: 26, justifyContent: 'flex-end' }));
  const champ = Q => Q ? h({ flex: 1, flexDirection: 'column' },
    h({ justifyContent: 'space-between', alignItems: 'center', backgroundColor: Q.live ? L.gold : L.line, padding: '4px 10px 2px' }, B(Q.q, 24, Q.live ? L.night : '#fff'), B(Q.live ? 'IN PROGRESS' : 'CHAMPIONS', 14, Q.live ? L.night : '#fff', { letterSpacing: 2 })),
    ...[['overall', 'OVERALL', L.gold], ['cash', 'CASH', L.vio], ['tour', 'TOURNEY', L.bronze]].map(([k, l, c]) => Q[k] ? h({ height: 42, alignItems: 'center', gap: 8, borderBottom: `1px solid ${L.panel2}`, backgroundColor: L.panel, paddingLeft: 8, paddingRight: 8 },
      sq(pics, Q[k].name, 28), h({ flex: 1, flexDirection: 'column' }, B(l, 13, c, { letterSpacing: 1.5 }), T(Q[k].name, { fontWeight: 700, fontSize: 14, color: '#fff' })), money(Q[k].net, 13)) : null)) : h({ flex: 1 });
  return frame(
    mast('Hall of Fame', 'Poker Club @ The Study · every quarter since night one'),
    chy('Record holders', 'best all-time totals', 'gold'),
    h({ paddingLeft: PAD, paddingRight: PAD, gap: 6 }, rec('overall', 'Overall', L.gold), rec('cash', 'Cash games', L.vio), rec('tour', 'Tournaments', L.bronze)),
    chy('Trophy shelf', 'quarter titles won'),
    pad(shelf.map(shelfRow), h({ gap: 14, marginTop: 6 }, ...[['overall', L.gold], ['cash', L.vio], ['tourney', L.bronze]].map(([l, c]) => h({ alignItems: 'center', gap: 5 }, h({ width: 9, height: 9, backgroundColor: c }), T(l, { fontSize: 11.5, color: L.muted }))))),
    chy('Latest champions', 'best net each quarter', 'pink'),
    h({ paddingLeft: PAD, paddingRight: PAD, gap: 8 }, champ(done), champ(live)),
    foot('Poker Club @ The Study', 'renpokernight.vercel.app/hall'));
});

// ---------- quarter wrap (/api/wrap) ----------
export const wrapCardTree = withAssets((w, pics = {}) => {
  const [k, s2, s3] = w.podium;
  const aw = (t, name, amt, note, c) => h({ width: (IN - 6) / 2, alignItems: 'center', gap: 10, backgroundColor: L.panel, borderLeft: `4px solid ${c}`, padding: '9px 10px' },
    sq(pics, name, 40), h({ flex: 1, flexDirection: 'column', overflow: 'hidden' }, B(t.toUpperCase(), 15, c, { letterSpacing: 1.8 }),
      h({ justifyContent: 'space-between', alignItems: 'baseline' }, T(name, { fontWeight: 700, color: '#fff', fontSize: 15, whiteSpace: 'nowrap' }), typeof amt === 'number' ? money(amt, 13.5) : M(amt, 13.5, '#fff')),
      T(note, { fontSize: 12, color: L.muted })));
  const list = [
    aw('Best night', w.best.name, w.best.net, w.best.date + (w.best.record ? ' · all-time record' : ''), L.up),
    w.turn ? aw('Biggest turnaround', w.turn.name, w.turn.gain, `from ${usd(w.turn.from)} to ${usd(w.turn.to)}`, '#7fb8ff') : null,
    aw('Iron man', w.iron.name, `${w.iron.n} of ${w.nights}`, 'nights played', L.vio),
    w.wins ? aw('Most wins', w.wins.name, String(w.wins.n), w.wins.n === 1 ? 'night won' : 'nights won', L.gold) : null,
    w.tour ? aw('Tournament king', w.tour.name, w.tour.net, `${w.tourNights} tourney night${w.tourNights === 1 ? '' : 's'}`, L.bronze) : null,
    w.worst ? aw('Toughest night', w.worst.name, w.worst.net, w.worst.date, L.down) : null].filter(Boolean);
  return frame(
    mast(`${w.q} Wrapped`, `${w.nights} night${w.nights === 1 ? '' : 's'} · ${w.players} players · ${usd(w.pot, { sign: false, cents: !Number.isInteger(w.pot) })} in buy-ins`),
    h({ marginTop: 18, marginLeft: PAD, marginRight: PAD, height: 250, position: 'relative', overflow: 'hidden', backgroundImage: 'linear-gradient(120deg, #3a2a6e, #a23b58)' },
      h({ position: 'absolute', right: -6, bottom: -50, fontFamily: 'Bebas', fontSize: 240, lineHeight: 1, color: 'rgba(255,255,255,0.07)' }, '#1'),
      h({ width: 200, alignItems: 'center', justifyContent: 'center', position: 'relative' }, sq(pics, k.name, 150),
        h({ position: 'absolute', top: 28, left: 80 }, icon('crown', L.gold, 40))),
      h({ flex: 1, flexDirection: 'column', justifyContent: 'center' }, B(k.name.toUpperCase(), k.name.length > 7 ? 60 : 80, '#fff'), M(usd(k.net), 30, L.gold))),
    h({ marginLeft: PAD, marginRight: PAD }, ...[[s2, '2ND', L.silver], [s3, '3RD', L.bronze]].filter(x => x[0]).map(([p, l, c]) => h({ flex: 1, alignItems: 'center', gap: 10, height: 46, backgroundColor: L.foot, paddingLeft: 12, paddingRight: 12, borderBottom: `3px solid ${c}` },
      B(l, 22, c), T(p.name, { flex: 1, fontWeight: 700, color: '#fff', fontSize: 15 }), money(p.net, 14)))),
    chy('The awards', '', 'gold'),
    h({ paddingLeft: PAD, paddingRight: PAD, flexWrap: 'wrap', gap: 6 }, list),
    foot('Poker Club @ The Study', 'on to the next one'));
});

// ---------- head to head (/api/h2h) ----------
export const h2hCardTree = withAssets((p, pics = {}, art = {}) => {
  const banners = art.banners || {}, colors = art.colors || {}, lead = p.aw === p.bw ? 'All square' : `${p.bw > p.aw ? p.b : p.a} leads`;
  // each player's banner fills their side, wall to wall; the sides meet on a slash through the middle that fades a little
  // in the middle. Drawn as one SVG picture (satori shrinks images inside clipPath boxes).
  const SL = 22, TH = 245, seam = [W / 2 + SL, W / 2 - SL];
  const sideSvg = (name, k) => {
    const pts = k ? `${seam[0]},0 ${W},0 ${W},${TH} ${seam[1]},${TH}` : `0,0 ${seam[0]},0 ${seam[1]},${TH} 0,${TH}`;
    const [c1, c2] = colors[name] ? [colors[name], '#201c3b'] : k ? ['#b8456a', '#4a1f3a'] : ['#4a3a9a', '#2a2150'];
    const [t1, t2] = k ? ['rgba(184,69,106,0.5)', 'rgba(21,19,42,0.75)'] : ['rgba(74,58,154,0.55)', 'rgba(21,19,42,0.75)'];
    const x0 = k ? seam[1] : 0, x1 = k ? W : seam[0];
    return `<clipPath id="c${k}"><polygon points="${pts}"/></clipPath>`
      + `<linearGradient id="g${k}" x1="${k ? 1 : 0}" y1="0" x2="${k ? 0 : 1}" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`
      + `<linearGradient id="t${k}" x1="${k ? 1 : 0}" y1="0" x2="${k ? 0 : 1}" y2="1"><stop offset="0" stop-color="${t1}"/><stop offset="1" stop-color="${t2}"/></linearGradient>`
      + `<g clip-path="url(#c${k})"><rect x="0" y="0" width="${W}" height="${TH}" fill="url(#g${k})"/>`
      + (banners[name] ? `<image href="${banners[name]}" x="${x0}" y="0" width="${x1 - x0}" height="${TH}" preserveAspectRatio="xMidYMid slice"/><rect x="0" y="0" width="${W}" height="${TH}" fill="url(#t${k})"/>` : '')
      + '</g>';
  };
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${TH}" width="${W * 2}" height="${TH * 2}">`
    + sideSvg(p.a, 0) + sideSvg(p.b, 1)
    + `<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.night}" stop-opacity="1"/><stop offset=".5" stop-color="${L.night}" stop-opacity=".35"/><stop offset="1" stop-color="${L.night}" stop-opacity="1"/></linearGradient>`
    + `<line x1="${seam[0]}" y1="-2" x2="${seam[1]}" y2="${TH + 2}" stroke="url(#f)" stroke-width="7"/></svg>`;
  // rasterised here with resvg: pictures nested inside an SVG image don't survive satori
  const backdrop = img('data:image/png;base64,' + Buffer.from(new Resvg(topSvg, { fitTo: { mode: 'width', value: W * 2 } }).render().asPng()).toString('base64'), W, TH, { position: 'absolute', left: 0, top: 0 });
  const who = (name, x, color) => h({ position: 'absolute', left: x, top: 26, width: 200, flexDirection: 'column', alignItems: 'center' }, sq(pics, name, 104), B(name.toUpperCase(), 40, color, { marginTop: 22 }));
  const top = h({ position: 'relative', height: 245 },
    backdrop,
    // darker fade behind the names so they read on busy banners
    banners[p.a] || banners[p.b] ? h({ position: 'absolute', left: 0, top: 0, width: W, height: TH, backgroundImage: 'linear-gradient(180deg, rgba(21,19,42,0) 45%, rgba(21,19,42,0.85) 85%)' }) : null,
    who(p.a, 30, '#fff'), who(p.b, W - 230, L.gold),
    h({ position: 'absolute', left: 0, width: W, top: 50, flexDirection: 'column', alignItems: 'center' },
      h({ alignItems: 'center', backgroundColor: L.night, border: `2px solid ${L.gold}`, padding: '0 14px' }, B(String(p.aw), 64), B('VS', 22, L.muted, { marginLeft: 8, marginRight: 8 }), B(String(p.bw), 64, L.gold)),
      h({ backgroundColor: L.gold, padding: '0 10px' }, B(`${p.label} · ${lead} · ${p.n} game${p.n === 1 ? '' : 's'}${p.ties ? ` · ${p.ties} tie${p.ties === 1 ? '' : 's'}` : ''}`.toUpperCase(), 16, L.night, { letterSpacing: 1.5 }))));
  // the race: both running totals over every shared game
  const G = p.games, CW = IN, CH = 190, Lp = 50, Rp = 30, Tp = 16, Bp = 16, A = L.vio, Bc = L.pink;
  const vals = [0, ...G.map(g => g.ca), ...G.map(g => g.cb)], hi = Math.max(...vals), lo = Math.min(...vals), rng = hi - lo || 1;
  const x = i => Lp + (G.length <= 1 ? (CW - Lp - Rp) / 2 : i * (CW - Lp - Rp) / (G.length - 1)), y = v => Tp + (hi - v) / rng * (CH - Tp - Bp);
  const pts = key => G.map((g, i) => `${x(i).toFixed(1)},${y(g[key]).toFixed(1)}`).join(' ');
  const dots = key => G.map((g, i) => g.win === (key === 'ca' ? 'a' : 'b') ? `<rect x="${x(i) - 3.5}" y="${y(g[key]) - 3.5}" width="7" height="7" fill="${key === 'ca' ? A : Bc}"/>` : '').join('');
  const ticks = [hi, (hi + lo) / 2, lo];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="${CW * 2}" height="${CH * 2}">`
    + ticks.map(v => `<line x1="${Lp}" x2="${CW - Rp}" y1="${y(v)}" y2="${y(v)}" stroke="#2c2750"/>`).join('')
    + `<line x1="${Lp}" x2="${CW - Rp}" y1="${y(0)}" y2="${y(0)}" stroke="${L.muted}" stroke-opacity=".5" stroke-dasharray="4 4"/>`
    + (G.length > 1 ? `<polyline points="${pts('cb')}" fill="none" stroke="${Bc}" stroke-width="3" stroke-linejoin="round"/><polyline points="${pts('ca')}" fill="none" stroke="${A}" stroke-width="3" stroke-linejoin="round"/>` : '')
    + dots('cb') + dots('ca') + '</svg>';
  const last = G[G.length - 1], ya = y(last.ca), yb = y(last.cb), nud = Math.abs(ya - yb) < 34 ? (34 - Math.abs(ya - yb)) / 2 : 0;
  const end = (name, yy, c) => h({ position: 'absolute', left: x(G.length - 1) - 15, top: yy - 15 }, sq(pics, name, 30, c));
  const chart = h({ position: 'relative', width: CW, height: CH }, img(svgUri(svg), CW, CH, { position: 'absolute', left: 0, top: 0 }),
    ...ticks.map(v => h({ position: 'absolute', left: 0, width: Lp - 6, top: y(v) - 7, justifyContent: 'flex-end' }, M(usd(Math.round(v), { cents: false }), 10, L.muted))),
    end(p.b, ya < yb ? yb + nud : yb - nud, Bc), end(p.a, ya < yb ? ya - nud : ya + nud, A));
  const tapeRow = (a, l, b) => h({ height: 36, alignItems: 'center', borderBottom: `1px solid ${L.panel2}` }, h({ flex: 1 }, a), B(l, 16, L.muted, { letterSpacing: 2 }), h({ flex: 1, justifyContent: 'flex-end' }, b));
  const meet = g => h({ height: 38, marginBottom: 4, alignItems: 'center', backgroundColor: L.panel },
    h({ width: 5, height: 38, backgroundColor: g.x > g.y ? A : 'rgba(0,0,0,0)' }), h({ flex: 1, paddingLeft: 10 }, money(g.x, 14)),
    h({ flex: 1.2, justifyContent: 'center' }, B(`${g.date} · ${g.tour ? 'Tourney' : 'Cash'}`.toUpperCase(), 19)),
    h({ flex: 1, justifyContent: 'flex-end', paddingRight: 10 }, money(g.y, 14)), h({ width: 5, height: 38, backgroundColor: g.y > g.x ? Bc : 'rgba(0,0,0,0)' }));
  return frame(top,
    chy('The race', `running total in ${p.n} shared game${p.n === 1 ? '' : 's'}`, 'gold'),
    pad(h({ backgroundColor: L.panel, paddingTop: 10, paddingBottom: 8, flexDirection: 'column' }, chart,
        h({ justifyContent: 'space-between', paddingLeft: Lp, paddingRight: Rp }, T(G[0].date, { fontSize: 11, color: L.muted }), G.length > 1 ? T(last.date, { fontSize: 11, color: L.muted }) : null)),
      h({ justifyContent: 'space-between', marginTop: 8 }, ...[[p.a, 'ca', A], [p.b, 'cb', Bc]].map(([n, key, c]) => h({ alignItems: 'center', gap: 8, borderLeft: `4px solid ${c}`, paddingLeft: 8 }, T(n, { fontWeight: 700, color: '#fff', fontSize: 15 }), money(last[key], 14)))),
      h({ justifyContent: 'center', marginTop: 6 }, T('square = finished ahead of the other that night', { fontSize: 11.5, color: L.muted }))),
    chy('Tale of the tape', 'only games they both played', 'pink'),
    pad(h({ height: 16, backgroundColor: L.panel2 }, ...[[p.aw, A], [p.ties, '#6d6895'], [p.bw, Bc]].filter(([v]) => v > 0).map(([v, c]) => h({ flexGrow: v, flexBasis: 0, backgroundColor: c }))),
      h({ justifyContent: 'space-between', marginTop: 5, marginBottom: 4 }, T(`${p.a} ahead ${p.aw}`, { fontSize: 12, color: L.muted }),
        p.ties ? T(`${p.ties} tie${p.ties === 1 ? '' : 's'}`, { fontSize: 12, color: L.muted }) : null, T(`${p.b} ahead ${p.bw}`, { fontSize: 12, color: L.muted })),
      tapeRow(money(p.an, 16), 'NET IN THESE GAMES', money(p.bn, 16)),
      tapeRow(M(`${p.aUp} of ${p.n}`, 16, L.text), 'NIGHTS FINISHED UP', M(`${p.bUp} of ${p.n}`, 16, L.text)),
      p.best ? h({ justifyContent: 'center', marginTop: 10, gap: 5, flexWrap: 'wrap' }, T('Biggest gap:', { fontSize: 13, color: L.soft }), T(p.best.who, { fontSize: 13, fontWeight: 700, color: '#fff' }),
        T('by', { fontSize: 13, color: L.soft }), M(usd(p.best.gap, { sign: false }), 13, L.gold), T(`on ${p.best.date}`, { fontSize: 13, color: L.soft })) : null),
    chy('Latest meetings', 'bar = finished ahead'),
    pad(p.last.map(meet)),
    foot('Poker Club @ The Study'));
});
