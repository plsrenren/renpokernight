// Study Cards pictures for Discord, drawn by /api/bjcards (no spare function slot):
//   m=pack&d=allin                         the pack you just bought (d = pack design from PACKS in loot.js)
//   m=cards&c=t:nit.1,o:sunset.0,s:shark.0&f=110   the three cards: item id + .1 for a duplicate; f = which are flipped
// Pfp borders and bars use the simpler LOOK versions from loot.js (satori can't draw the site's CSS ones).
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BY_ID, LOOK, STICKERS, TCOL, REFUND, PACKS } from '../loot.js';

const asset = name => readFileSync(new URL(`./_assets/${name}`, import.meta.url));
let FONTS;
const fonts = () => FONTS || (FONTS = [
  { name: 'Bebas', data: asset('bebas-neue-latin-400-normal.woff'), weight: 400, style: 'normal' },
  { name: 'Grotesk', data: asset('space-grotesk-latin-500-normal.woff'), weight: 500, style: 'normal' },
  { name: 'Grotesk', data: asset('space-grotesk-latin-700-normal.woff'), weight: 700, style: 'normal' }]);
const h = (style, ...kids) => ({ type: 'div', props: { style: { display: 'flex', boxSizing: 'border-box', ...style }, children: kids.flat(9).filter(k => k !== null && k !== undefined && k !== false && k !== '') } });
const svgUri = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const img = (src, w, ht, style = {}) => ({ type: 'img', props: { src, width: w, height: ht, style } });
const B = (t, size, color, style = {}) => h({ fontFamily: 'Bebas', fontSize: size, lineHeight: 1, color, letterSpacing: size * 0.04, paddingTop: size * 0.08, ...style }, String(t));
const T = (t, size, color, style = {}) => h({ fontFamily: 'Grotesk', fontWeight: 500, fontSize: size, color, ...style }, String(t));
const NIGHT = '#15132a', PANEL = '#1d1a37', PANEL2 = '#24204a';

// sticker art has <text> in it: resvg needs real font files for that (Bebas, plus DejaVu's card suits)
export const SVG_FONTS = { fontFiles: ['bebas-neue-400.ttf', 'suits-dejavu.ttf'].map(f => fileURLToPath(new URL(`./_assets/${f}`, import.meta.url))), loadSystemFonts: false, defaultFontFamily: 'Bebas Neue' };
async function png(tree, w, ht) {
  const svg = await satori(tree, { width: w, height: ht, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, font: SVG_FONTS }).render().asPng();
}

// ---------- the pack ----------
const ZIG = (c, flip) => svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 16" width="240" height="16" preserveAspectRatio="none"><path d="${flip ? 'M0 16' : 'M0 0'} ${Array.from({ length: 24 }, (_, k) => `L${k * 10 + 5} ${flip ? 0 : 16} L${k * 10 + 10} ${flip ? 16 : 0}`).join(' ')} L240 ${flip ? 16 : 0} Z" fill="${c}"/></svg>`);
const chipStack = (c, n) => `<g>${Array.from({ length: n }, (_, k) => `<ellipse cx="0" cy="${-k * 7}" rx="22" ry="8" fill="${c}" stroke="#15132a" stroke-width="1.5"/><path d="M-22 ${-k * 7}v4a22 8 0 0 0 44 0v-4" fill="${c}" stroke="#15132a" stroke-width="1.5"/>`).join('')}<ellipse cx="0" cy="${-(n - 1) * 7}" rx="13" ry="4.5" fill="none" stroke="#fff" stroke-opacity=".7" stroke-dasharray="4 3" stroke-width="2"/></g>`;
const SPADE = c => `<path fill="${c}" d="M12 2s-8 6.5-8 11.5c0 2.6 2 4.5 4.4 4.5 1.4 0 2.6-.6 3.2-1.6-.3 1.9-1 3.4-2.4 4.6h5.6c-1.4-1.2-2.1-2.7-2.4-4.6.6 1 1.8 1.6 3.2 1.6 2.4 0 4.4-1.9 4.4-4.5C20 8.5 12 2 12 2z"/>`;
const HEART = c => `<path fill="${c}" d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.2 5 6.6 5c2.1 0 3.6 1.2 5.4 3.3C13.8 6.2 15.3 5 17.4 5c3.4 0 5.4 3.6 4.1 6.8C19.5 16.4 12 21 12 21z"/>`;
// text on the art is drawn by satori on top (resvg has no fonts for SVG text): [text, x, y, size, colour, rotate]
const at = (t, x, y, size, color, rot = 0) => h({ position: 'absolute', left: x - 40, top: y - size * 0.55, width: 80, justifyContent: 'center', transform: rot ? `rotate(${rot}deg)` : undefined }, B(t, size, color, { letterSpacing: 0 }));
const miniCard = (x, r) => `<g transform="translate(${x} 70) rotate(${r})"><rect x="-18" y="-50" width="36" height="52" rx="3" fill="#fbf8ef" stroke="#15132a" stroke-width="1.5"/></g>`;
const bigCard = (x, r, suit, c) => `<g transform="translate(${x} 62) rotate(${r})"><rect x="-26" y="-38" width="52" height="76" rx="4" fill="#fbf8ef" stroke="#15132a" stroke-width="2"/><g transform="translate(-13 -6) scale(1.1)">${suit(c)}</g></g>`;
const ART = {
  foil: () => [`<circle cx="80" cy="60" r="44" fill="#e0507f" stroke="#fff" stroke-width="5" stroke-dasharray="14 9"/><circle cx="80" cy="60" r="30" fill="#15132a" stroke="#f0c75e" stroke-width="3"/>`, [at('?', 80, 60, 40, '#f0c75e')]],
  royal: () => [['10', 'J', 'Q', 'K', 'A'].map((t, k) => miniCard(40 + k * 20, (k - 2) * 12)).join(''), ['10', 'J', 'Q', 'K', 'A'].map((t, k) => at(t, 40 + k * 20 + (k - 2) * 5, 36 + Math.abs(k - 2) * 3, 16, k % 2 ? '#d42a46' : '#15132a', (k - 2) * 12))],
  aces: () => [bigCard(58, -10, SPADE, '#15132a') + bigCard(102, 10, HEART, '#d42a46'), [at('A', 46, 34, 18, '#15132a', -10), at('A', 92, 34, 18, '#d42a46', 10)]],
  allin: () => [`<g transform="translate(46 96)">${chipStack('#8f78f0', 6)}</g><g transform="translate(80 100)">${chipStack('#e0507f', 9)}</g><g transform="translate(114 96)">${chipStack('#f0c75e', 7)}</g>`, []],
  btn: () => [`<ellipse cx="80" cy="72" rx="46" ry="14" fill="#b9b2a3"/><ellipse cx="80" cy="62" rx="46" ry="14" fill="#fff"/>`, [at('DEALER', 80, 62, 17, '#15132a')]],
  flash: () => [`<rect x="40" y="18" width="80" height="84" fill="#fbf8ef" stroke="#15132a" stroke-width="3" transform="rotate(-6 80 60)"/>`, [at('?', 80, 60, 76, '#e0507f', -6)]],
  neon: () => [`<circle cx="80" cy="60" r="36" fill="#f6dd8a"/><circle cx="96" cy="50" r="32" fill="#1a1238"/><circle cx="30" cy="20" r="2" fill="#fff"/><circle cx="130" cy="36" r="1.6" fill="#fff"/><circle cx="120" cy="96" r="1.6" fill="#fff"/>`, []],
};
const PACKLOOK = {
  foil: ['#6e3fb8', '#e0507f', '#f0c75e'], royal: ['#13583a', '#2f9a63', '#f0c75e'], aces: ['#2a1238', '#8a1f3c', '#fbf8ef'],
  allin: ['#2a1426', '#5a2340', '#f0c75e'], btn: ['#1e3a6e', '#3b78b8', '#fff'], flash: ['#c9962a', '#e9b949', '#15132a'], neon: ['#1a1238', '#3a2a6e', '#ff7fb0'] };
export function packTree(id) {
  const d = PACKS.find(p => p.id === id) || PACKS[0], [c1, c2, fg] = PACKLOOK[d.id], art = ART[d.id]();
  return h({ width: 300, height: 400, alignItems: 'center', justifyContent: 'center', backgroundColor: '#100e22', backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(143,120,240,0.35), rgba(16,14,34,0) 65%)' },
    h({ width: 240, height: 340, flexDirection: 'column', position: 'relative', backgroundImage: `linear-gradient(160deg, ${c2}, ${c1} 70%)`, boxShadow: '0 18px 30px rgba(0,0,0,0.55)' },
      img(ZIG(c1, false), 240, 16, { position: 'absolute', left: 0, top: -14 }),
      h({ height: 26, backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 4px, rgba(0,0,0,0) 4px, rgba(0,0,0,0) 9px)' }),
      h({ flex: 1, flexDirection: 'column', alignItems: 'center', paddingTop: 22 },
        h({ width: 160, height: 120, position: 'relative' }, img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" width="320" height="240">${art[0]}</svg>`), 160, 120), art[1]),
        B(d.name.toUpperCase(), d.name.length > 10 ? 40 : 50, fg, { marginTop: 10, textShadow: '3px 3px 0 rgba(0,0,0,0.45)' }),
        B('STUDY CARDS', 17, 'rgba(255,255,255,0.85)', { letterSpacing: 5, marginTop: 4 }),
        h({ marginTop: 16, backgroundColor: '#e0507f', padding: '6px 14px 3px' }, B('3 CARDS · $100', 18, '#fff', { letterSpacing: 2 }))),
      h({ height: 26, backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.25) 0px, rgba(0,0,0,0.25) 4px, rgba(0,0,0,0) 4px, rgba(0,0,0,0) 9px)' }),
      img(ZIG(c1, true), 240, 16, { position: 'absolute', left: 0, bottom: -14 })));
}

// ---------- the cards ----------
const CW = 156, CH = 222;
const silhouette = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="120" height="120"><rect width="60" height="60" fill="#b8e4f4"/><circle cx="30" cy="24" r="12" fill="#6d7fa6"/><path d="M8 60c2-14 12-20 22-20s20 6 22 20z" fill="#6d7fa6"/></svg>');
/** a pfp with a border (LOOK.border), pfp size s */
export function borderBox(key, s, pic = silhouette) {
  const L = LOOK.border[key] || { bg: '#f1c75b', pad: 3 }, k = s / 72, pad = Math.max(2, Math.round(L.pad * k));
  const shadow = [L.ring ? `0 0 0 ${Math.max(1, Math.round(2 * k))}px ${L.ring}` : '', L.glow ? `0 0 ${Math.round(14 * k)}px ${L.glow}` : ''].filter(Boolean).join(', ');
  const b = L.badge, bs = Math.round((b && b.big ? 26 : 20) * k);
  const badge = b ? h({ position: 'absolute', zIndex: 3, backgroundColor: b.bg, color: b.fg, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 3px rgba(0,0,0,0.5)',
    ...(b.round ? { width: bs, height: bs, borderRadius: bs, border: `${Math.max(1, Math.round(1.5 * k))}px solid #15132a` } : { padding: `${Math.round(2 * k)}px ${Math.round(5 * k)}px 0` }),
    ...(b.at === 'tr' ? { right: -Math.round(bs * 0.35), top: -Math.round(bs * 0.35) } : b.at === 'tl' ? { left: -Math.round(4 * k), top: -Math.round(10 * k) }
      : b.at === 'tc' ? { left: 0, right: 0, top: -Math.round(10 * k), justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0)' } : { left: 0, right: 0, bottom: -Math.round(8 * k), justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0)' }) },
    b.at === 'tc' || b.at === 'bc' ? h({ backgroundColor: b.bg, padding: `${Math.round(2 * k)}px ${Math.round(6 * k)}px 0` }, B(b.t, Math.round(11 * k), b.fg)) : B(b.t, Math.round((b.round ? 11 : 12) * k), b.fg)) : null;
  return h({ position: 'relative', padding: pad, backgroundImage: L.bg.includes('gradient') ? L.bg : undefined, backgroundColor: L.bg.includes('gradient') ? undefined : L.bg, boxShadow: shadow || undefined },
    img(pic, s, s, { objectFit: 'cover' }), badge);
}
/** an overall bar strip (LOOK.bar) */
export function barStrip(key, w, ht, ovr = '80', rest = '+$75') {
  const L = LOOK.bar[key] || { bg: '#f1c75b', fg: NIGHT, ovr: '#f1c75b' };
  return h({ width: w, height: ht, backgroundImage: L.bg.includes('gradient') ? L.bg : undefined, backgroundColor: L.bg.includes('gradient') ? undefined : L.bg, alignItems: 'center' },
    h({ height: ht, paddingLeft: 8, paddingRight: 8, alignItems: 'center', backgroundColor: L.ovrBg || NIGHT, border: `2px solid ${L.ovr}` }, B(ovr, ht * 0.7, L.ovrBg ? NIGHT : L.ovr)),
    h({ flex: 1, justifyContent: 'center' }, B(rest, ht * 0.5, L.fg)));
}
/** a sticker as a PNG data URI (pre-drawn with resvg: SVG text inside satori pictures loses its fonts), w x ht at 1x */
const stkCache = {};
export function stickerPng(name, s, outline = 0) {
  const svg = STICKERS[name] || '', vb = (svg.match(/viewBox="([^"]+)"/) || [, '0 0 100 100'])[1].split(/\s+/).map(Number);
  // outline = white die-cut edge (in viewBox units), drawn around the art like a real sticker
  const o = outline, box = [vb[0] - o, vb[1] - o, vb[2] + 2 * o, vb[3] + 2 * o];
  const r = box[2] / box[3], w = r >= 1 ? s : Math.round(s * r), ht = r >= 1 ? Math.round(s / r) : s, key = name + '|' + s + '|' + o;
  if (!stkCache[key]) {
    const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const src = !o ? svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ') : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}"><defs><filter id="die" x="-30%" y="-30%" width="160%" height="160%"><feMorphology in="SourceAlpha" operator="dilate" radius="${o * 0.8}" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="w"/><feGaussianBlur in="d" stdDeviation="${o * 0.6}" result="b"/><feOffset in="b" dy="${o * 0.5}" result="sh"/><feFlood flood-color="#000" flood-opacity=".45"/><feComposite in2="sh" operator="in" result="s2"/><feMerge><feMergeNode in="s2"/><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#die)">${inner}</g></svg>`;
    stkCache[key] = 'data:image/png;base64,' + Buffer.from(new Resvg(src, { fitTo: { mode: 'width', value: w * 3 }, font: SVG_FONTS }).render().asPng()).toString('base64');
  }
  return { src: stkCache[key], w, ht };
}
const stickerImg = (name, s) => { const p = stickerPng(name, s); return img(p.src, p.w, p.ht); };
function preview(it) {
  if (it.slot === 'Title') return B(it.name.toUpperCase(), it.name.length > 14 ? 19 : 24, TCOL[it.tier], { textAlign: 'center', justifyContent: 'center', maxWidth: CW - 30 });
  if (it.slot === 'Pfp border') return borderBox(it.key, 62);
  if (it.slot === 'Overall bar') return barStrip(it.key, CW - 30, 30);
  return stickerImg(it.name, 78);
}
function face(c, up) {
  if (!up) return h({ width: CW, height: CH, padding: 6, backgroundColor: '#6e3fb8', backgroundImage: 'repeating-linear-gradient(45deg, #5a40ad 0px, #5a40ad 8px, #7a4fc8 8px, #7a4fc8 16px)', boxShadow: '0 10px 18px rgba(0,0,0,0.5)' },
    h({ flex: 1, border: '3px solid #f0c75e', alignItems: 'center', justifyContent: 'center' }, B('?', 80, '#f0c75e')));
  const it = c.it, col = TCOL[it.tier], nm = it.name.toUpperCase();
  return h({ width: CW, height: CH, flexDirection: 'column', backgroundColor: PANEL, border: `3px solid ${col}`, boxShadow: `0 0 18px ${col}55, 0 10px 18px rgba(0,0,0,0.5)` },
    h({ justifyContent: 'space-between', alignItems: 'flex-start' },
      h({ backgroundColor: col, padding: '3px 7px 1px' }, B(it.tier.toUpperCase(), 13, NIGHT)),
      c.dup ? null : h({ backgroundColor: '#fff', padding: '2px 6px 0', margin: '5px 5px 0 0' }, B('NEW', 12, NIGHT))),
    h({ flex: 1, margin: '6px 8px 0', backgroundColor: '#15132a', backgroundImage: `radial-gradient(circle at 50% 50%, ${col}33, rgba(21,19,42,0) 70%)`, alignItems: 'center', justifyContent: 'center', position: 'relative' },
      preview(it),
      c.dup ? h({ position: 'absolute', left: 14, right: 14, top: 34, flexDirection: 'column', alignItems: 'center', border: '3px solid #f0c75e', backgroundColor: 'rgba(21,19,42,0.88)', transform: 'rotate(-12deg)', padding: '4px 0 2px' },
        B('DUPLICATE', 13, '#f0c75e', { letterSpacing: 3 }), B('+$' + REFUND[it.tier], 32, '#f0c75e')) : null),
    h({ justifyContent: 'center', padding: '8px 6px 0' }, B(nm, nm.length > 16 ? 17 : nm.length > 12 ? 21 : 25, '#fff')),
    h({ justifyContent: 'center', paddingBottom: 9 }, T(it.slot, 11.5, '#a9a3c9')));
}
export function cardsTree(cards, flipped) {
  return h({ width: 540, height: 270, alignItems: 'center', justifyContent: 'center', gap: 18, backgroundColor: '#100e22' }, cards.map((c, k) => face(c, flipped[k])));
}
/** cards param "t:nit.1,o:sunset.0,s:shark.0" → [{ it, dup }] */
export const parseCards = s => String(s || '').split(',').slice(0, 3).map(x => { const m = x.match(/^(.*)\.([01])$/); const it = m && BY_ID[m[1]]; return it ? { it, dup: m[2] === '1' } : null; }).filter(Boolean);
export const cardsParam = cards => cards.map(c => `${c.it.id}.${c.dup ? 1 : 0}`).join(',');

export async function shopImage(q) {
  if (q.get('m') === 'pack') return png(packTree(q.get('d')), 300, 400);
  const cards = parseCards(q.get('c'));
  if (cards.length !== 3) throw new Error('bad cards');
  const f = String(q.get('f') || '000');
  return png(cardsTree(cards, [0, 1, 2].map(k => f[k] === '1')), 540, 270);
}
