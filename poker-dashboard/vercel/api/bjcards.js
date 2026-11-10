// /api/bjcards  the table picture under a /blackjack hand: dealer's cards on top, the player's hand(s) below.
//   d=KH.XX            dealer cards (XX = face down)
//   p=9S.2D-AS.AH      player hands, split hands separated by "-"
//   a=0                hand being played (empty when the hand is over)
//   r=win.lose         result per hand when over (win, bj, push, lose, bust)
//   b=20.20            bet per hand, n=player name
// Card codes: rank A 2-9 T J Q K + suit S H D C.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { total } from './_blackjack.js';

const asset = name => readFileSync(new URL(`./_assets/${name}`, import.meta.url));
let FONTS;
const fonts = () => FONTS || (FONTS = [
  { name: 'Nunito', data: asset('nunito-latin-800-normal.woff'), weight: 800, style: 'normal' },
  { name: 'Nunito', data: asset('nunito-latin-900-normal.woff'), weight: 900, style: 'normal' },
  { name: 'Mono', data: asset('ibm-plex-mono-latin-600-normal.woff'), weight: 600, style: 'normal' }]);

const S = 2, W = 520;
const h = (type, style, ...kids) => ({ type, props: { style: { display: 'flex', ...style }, children: kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '') } });
const svgUri = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const img = (src, w, ht) => ({ type: 'img', props: { src, width: w, height: ht } });
const RED = '#c2283e', INK = '#1b1b1b';
const SUIT = {
  H: c => `<path fill="${c}" d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.2 5 6.6 5c2.1 0 3.6 1.2 5.4 3.3C13.8 6.2 15.3 5 17.4 5c3.4 0 5.4 3.6 4.1 6.8C19.5 16.4 12 21 12 21z"/>`,
  D: c => `<path fill="${c}" d="M12 2l8 10-8 10-8-10z"/>`,
  S: c => `<path fill="${c}" d="M12 2s-8 6.5-8 11.5c0 2.6 2 4.5 4.4 4.5 1.4 0 2.6-.6 3.2-1.6-.3 1.9-1 3.4-2.4 4.6h5.6c-1.4-1.2-2.1-2.7-2.4-4.6.6 1 1.8 1.6 3.2 1.6 2.4 0 4.4-1.9 4.4-4.5C20 8.5 12 2 12 2z"/>`,
  C: c => `<g fill="${c}"><circle cx="12" cy="7" r="4.2"/><circle cx="7" cy="13" r="4.2"/><circle cx="17" cy="13" r="4.2"/><path d="M10.6 12h2.8l1.2 10h-5.2z"/></g>`,
};
const suitImg = (s, px, c) => img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${SUIT[s](c)}</svg>`), px * S, px * S);
const BACK = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="82" viewBox="0 0 56 82"><defs><pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#5a40ad"/><rect width="5" height="10" fill="#6e52c8"/></pattern></defs><rect width="56" height="82" fill="url(#p)"/></svg>`);

const CW = 62, CH = 88;
function card(code) {
  const base = { width: CW * S, height: CH * S, borderRadius: 7 * S, flexShrink: 0 };
  if (!/^[A2-9TJQK][SHDC]$/.test(code)) return h('div', { ...base, backgroundColor: '#f6f3ea', padding: 3 * S, boxSizing: 'border-box' }, h('div', { width: (CW - 6) * S, height: (CH - 6) * S, borderRadius: 5 * S, overflow: 'hidden' }, img(BACK, (CW - 6) * S, (CH - 6) * S)));
  const color = 'HD'.includes(code[1]) ? RED : INK, rank = code[0] === 'T' ? '10' : code[0];
  return h('div', { ...base, backgroundColor: '#f6f3ea', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 * S },
    h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 28 * S, lineHeight: 1, color, letterSpacing: rank === '10' ? -2 * S : 0 }, rank),
    suitImg(code[1], 24, color));
}
const pill = (text, bg, fg) => h('div', { backgroundColor: bg, color: fg, fontFamily: 'Mono', fontWeight: 600, fontSize: 16 * S, padding: `${6 * S}px ${10 * S}px`, borderRadius: 7 * S }, text);
const label = (text, extra) => h('div', { alignItems: 'center', gap: 8 * S, fontFamily: 'Nunito', fontWeight: 800, fontSize: 13 * S, letterSpacing: 1 * S, color: '#b5bac1' }, text.toUpperCase(), extra);
const RES = { win: ['WIN', '#8ee0b0', '#0e2a1c'], bj: ['BLACKJACK', '#f1c75b', '#2a1f00'], push: ['PUSH', '#9a94c4', '#16132b'], lose: ['LOSE', '#f59bb0', '#3a0d18'], bust: ['BUST', '#f59bb0', '#3a0d18'] };
const tag = r => RES[r] ? h('div', { backgroundColor: RES[r][1], color: RES[r][2], fontFamily: 'Nunito', fontWeight: 900, fontSize: 11 * S, letterSpacing: 1 * S, padding: `${2 * S}px ${7 * S}px`, borderRadius: 5 * S }, RES[r][0]) : null;

export function table({ dealer, hands, activeIdx, results, bets, name }) {
  const shown = dealer.filter(c => c !== 'XX');
  const dTot = total(shown).t, hidden = shown.length < dealer.length;
  const row = (cards, tot, dim) => h('div', { alignItems: 'center', gap: 8 * S, opacity: dim ? 0.5 : 1 }, cards.map(card), h('div', { marginLeft: 6 * S }, pill(tot, '#1e1f22', '#f2f3f5')));
  const handTot = (cs, k) => { const t = total(cs); return t.soft && t.t < 21 && activeIdx === k ? `${t.t - 10} / ${t.t}` : String(t.t); };
  return h('div', { width: W * S, flexDirection: 'column', gap: 12 * S, padding: `${14 * S}px ${16 * S}px`, backgroundColor: '#2b2d31', boxSizing: 'border-box' },
    h('div', { flexDirection: 'column', gap: 6 * S }, label('Dealer'), row(dealer, hidden ? `${dTot} + ?` : String(dTot), false)),
    hands.map((cs, k) => h('div', { flexDirection: 'column', gap: 6 * S },
      label(hands.length > 1 ? `${name} · hand ${k + 1}` : name,
        [bets[k] ? h('div', { color: '#949ba4', fontWeight: 800, textTransform: 'none', letterSpacing: 0 }, `$${bets[k]}`) : null,
         activeIdx === k && hands.length > 1 ? h('div', { color: '#a9b4f6' }, '· PLAYING') : null, tag(results[k])]),
      row(cs, handTot(cs, k), activeIdx !== null && hands.length > 1 && activeIdx !== k))));
}

export async function render(q) {
  const split = (v, sep) => String(v || '').split(sep).filter(Boolean);
  const dealer = split(q.get('d'), '.').slice(0, 12);
  const hands = split(q.get('p'), '-').slice(0, 2).map(x => split(x, '.').slice(0, 12));
  const a = q.get('a'), activeIdx = a === null || a === '' ? null : +a;
  const svg = await satori(table({ dealer, hands, activeIdx, results: split(q.get('r'), '.'), bets: split(q.get('b'), '.'), name: (q.get('n') || 'You').slice(0, 24) }),
    { width: W * S, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W * S } }).render().asPng();
}

export default async function handler(req, res) {
  try {
    const png = await render(new URL(req.url, 'http://x').searchParams);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // each picture's URL is unique to one moment of one hand
    res.status(200).send(png);
  } catch (e) { res.status(500).send('Could not draw the table: ' + e.message); }
}
