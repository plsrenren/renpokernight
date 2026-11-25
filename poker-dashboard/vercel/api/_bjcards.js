// /api/bjcards  the table picture under a /blackjack hand: dealer's cards on top, the player's hand(s) below.
//   d=KH.XX            dealer cards (XX = face down)
//   p=9S.2D-AS.AH      player hands, split hands separated by "-"
//   a=0                hand being played (empty when the hand is over)
//   r=win.lose         result per hand when over (win, bj, push, lose, bust)
//   b=20.20            bet per hand, n=player name
//   f=0.20             Free Bet: free money per hand (gold FREE tag); s=5 Push 22 side bet; x=d22.sw (dealer 22 pushed, side bet won / sl lost)
//                      Up to 6 hands: 3 or more switch to two columns of smaller cards (5+ cards fan out), same width, just taller.
//   m=uth&d=XX.XX&b=7H.6C.KH.__.__&p=9H.8H&n=Renato&ph=Flush&dh=Pair of kings&r=win   the /uth table instead (__ = card not out yet)
//   m=bac&p=9S.KD&b=4H.2C.7S&w=player&n=Renato&s=banker   the /baccarat picture: Player and Banker hands, winner tagged
//   m=duel&c=QS.9H&n=Dong|JP&w=1   the /duel high card picture instead: two cards, names, winner (0 or 1) ringed
//   m=pack&d=allin / m=cards&c=…&f=110   Study Cards: the pack and the three cards (see _shopimg.js)
// Card codes: rank A 2-9 T J Q K + suit S H D C.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { total } from './_blackjack.js';
import { shopImage } from './_shopimg.js';

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
// shared table kit look (same as the site's tables, table-kit.css): four-color deck, green felt, purple rail, casino-color chip stacks
const SUITC = { H: '#c2283e', D: '#2c63d6', C: '#1f8a4c', S: '#1b1b1b' };
const FELT = { backgroundColor: '#1f4433', border: `${5 * S}px solid #3a2a6e` };
const LBL = '#d3e4d9', PILL = '#0d1f17';
// chip stacks: $1 white, $5 red, $25 green, $100 black, $500 purple (biggest first, max 4 stacks, 8 high)
const DEN = [[500, '#8f78f0'], [100, '#22202f'], [25, '#2e9e5b'], [5, '#d93a4a'], [1, '#f2f2f2']];
function chipStacks(amount) {
  let left = Math.floor(amount); const st = [];
  for (const [v, c] of DEN) { const n = Math.floor(left / v); if (n) { st.push([c, Math.min(n, 8), v === 1]); left -= n * v; } }
  const cols = st.slice(0, 4), hgt = 8 + 7 * 3, w = cols.length * 23;
  const body = cols.map(([c, n, white], k) => Array.from({ length: n }, (_, j) => { const x = k * 23 + 10, y = hgt - 4 - j * 3;
    return `<ellipse cx="${x}" cy="${y + 1}" rx="10" ry="4" fill="rgba(0,0,0,.45)"/><ellipse cx="${x}" cy="${y}" rx="10" ry="4" fill="${c}"${c === '#22202f' ? ' stroke="rgba(255,255,255,.55)" stroke-width="1"' : ''}/>` +
      `<ellipse cx="${x}" cy="${y}" rx="6.5" ry="2.4" fill="none" stroke="${white ? '#3b6fd6' : 'rgba(255,255,255,.8)'}" stroke-width="1.6" stroke-dasharray="2.4 2"/>`; }).join('')).join('');
  return img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">${body}</svg>`), w * S, hgt * S);
}
const betTag = amt => +amt ? h('div', { alignItems: 'flex-end', gap: 5 * S }, chipStacks(+amt),
  h('div', { backgroundColor: '#cfcaf0', color: '#15132a', fontFamily: 'Nunito', fontWeight: 900, fontSize: 13 * S, letterSpacing: 0, padding: `${2 * S}px ${7 * S}px` }, `$${amt}`)) : null;
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
  const color = SUITC[code[1]], rank = code[0] === 'T' ? '10' : code[0];
  return h('div', { ...base, backgroundColor: '#f6f3ea', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 * S },
    h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 28 * S, lineHeight: 1, color, letterSpacing: rank === '10' ? -2 * S : 0 }, rank),
    suitImg(code[1], 24, color));
}
const pill = (text, bg, fg) => h('div', { backgroundColor: bg, color: fg, fontFamily: 'Mono', fontWeight: 600, fontSize: 16 * S, padding: `${6 * S}px ${10 * S}px`, borderRadius: 7 * S }, text);
const label = (text, extra) => h('div', { alignItems: 'center', gap: 8 * S, fontFamily: 'Nunito', fontWeight: 800, fontSize: 13 * S, letterSpacing: 1 * S, color: LBL }, text.toUpperCase(), extra);
const RES = { win: ['WIN', '#8ee0b0', '#0e2a1c'], bj: ['BLACKJACK', '#f1c75b', '#2a1f00'], push: ['PUSH', '#9a94c4', '#16132b'], lose: ['LOSE', '#f59bb0', '#3a0d18'], bust: ['BUST', '#f59bb0', '#3a0d18'] };
const tag = r => RES[r] ? h('div', { backgroundColor: RES[r][1], color: RES[r][2], fontFamily: 'Nunito', fontWeight: 900, fontSize: 11 * S, letterSpacing: 1 * S, padding: `${2 * S}px ${7 * S}px`, borderRadius: 5 * S }, RES[r][0]) : null;

export function table({ dealer, hands, activeIdx, results, bets, frees = [], side = 0, flags = [], name }) {
  const shown = dealer.filter(c => c !== 'XX');
  const dTot = total(shown).t, hidden = shown.length < dealer.length;
  const many = hands.length > 2;
  const row = (cards, tot, dim, small) => h('div', { alignItems: 'center', gap: (small ? 5 : 8) * S, opacity: dim ? 0.5 : 1 },
    small ? smallCards(cards) : cards.map(card), h('div', { marginLeft: (small ? 2 : 6) * S }, pill(tot, PILL, '#f2f3f5')));
  const handTot = (cs, k) => { const t = total(cs); return t.soft && t.t < 21 && activeIdx === k ? `${t.t - 10} / ${t.t}` : String(t.t); };
  const handBox = (cs, k) => h('div', { flexDirection: 'column', gap: 6 * S, width: many ? 229 * S : undefined },
    label(hands.length > 1 ? (many ? `Hand ${k + 1}` : `${name} · hand ${k + 1}`) : name,
      [betTag(bets[k]),
       +frees[k] ? tagText(`FREE $${frees[k]}`, '#f1c75b', '#2a1f00') : null,
       activeIdx === k && hands.length > 1 ? h('div', { color: '#a9b4f6' }, '· PLAYING') : null, tag(results[k])]),
    row(cs, handTot(cs, k), activeIdx !== null && hands.length > 1 && activeIdx !== k, many));
  const d22 = flags.includes('d22'), sw = flags.includes('sw'), sl = flags.includes('sl');
  return h('div', { width: W * S, flexDirection: 'column', gap: 12 * S, padding: `${14 * S}px ${16 * S}px`, ...FELT, boxSizing: 'border-box' },
    h('div', { flexDirection: 'column', gap: 6 * S }, label('Dealer', d22 ? tagText('22 PUSHES', '#9a94c4', '#16132b') : null), row(dealer, hidden ? `${dTot} + ?` : String(dTot), false, false)),
    many ? h('div', { flexWrap: 'wrap', columnGap: 16 * S, rowGap: 10 * S }, hands.map(handBox)) : hands.map(handBox),
    side ? label('Push 22 side bet', [betTag(side), sw ? tagText('WIN 12:1', '#8ee0b0', '#0e2a1c') : sl ? tag('lose') : null]) : null);
}
const tagText = (t, bg, fg) => h('div', { backgroundColor: bg, color: fg, fontFamily: 'Nunito', fontWeight: 900, fontSize: 11 * S, letterSpacing: 1 * S, padding: `${2 * S}px ${7 * S}px`, borderRadius: 5 * S }, t);

// small cards for 3+ hands; with 5+ cards they fan out with the rank in the top-left corner, so overlapping cards still read
const SW = 38, SH = 54;
function smallCard(code, k, fan) {
  const base = { width: SW * S, height: SH * S, borderRadius: 5 * S, flexShrink: 0, marginLeft: k && fan ? -16 * S : 0, boxShadow: `${-1 * S}px 0 ${2 * S}px rgba(0,0,0,.35)` };
  if (!/^[A2-9TJQK][SHDC]$/.test(code)) return h('div', { ...base, backgroundColor: '#f6f3ea', padding: 2 * S, boxSizing: 'border-box' }, h('div', { width: (SW - 4) * S, height: (SH - 4) * S, borderRadius: 4 * S, overflow: 'hidden' }, img(BACK, (SW - 4) * S, (SH - 4) * S)));
  const color = SUITC[code[1]], rank = code[0] === 'T' ? '10' : code[0];
  return h('div', { ...base, backgroundColor: '#f6f3ea', flexDirection: 'column', alignItems: fan ? 'flex-start' : 'center', justifyContent: fan ? 'flex-start' : 'center', padding: fan ? `${4 * S}px 0 0 ${4 * S}px` : 0, gap: 2 * S, boxSizing: 'border-box' },
    h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: (fan ? 15 : 18) * S, lineHeight: 1, color, letterSpacing: rank === '10' ? -1.5 * S : 0 }, rank),
    suitImg(code[1], fan ? 11 : 14, color));
}
const smallCards = cs => { const fan = cs.length >= 5; return h('div', { alignItems: 'center', gap: fan ? 0 : 5 * S }, cs.map((c, k) => smallCard(c, k, fan))); };

const slot = () => h('div', { width: CW * S, height: CH * S, borderRadius: 7 * S, border: `${2 * S}px dashed rgba(255,255,255,.22)`, boxSizing: 'border-box', flexShrink: 0 });
const UTH_RES = { ...RES, fold: ['FOLD', '#9a94c4', '#16132b'] };
export function uth({ dealer, board, me, name, ph, dh, r }) {
  const cards = cs => h('div', { gap: 8 * S }, cs.map(c => (c === '__' ? slot() : card(c))));
  const hn = t => t ? h('div', { color: '#f1c75b', textTransform: 'none', letterSpacing: 0, fontSize: 14 * S }, t) : null;
  const rt = UTH_RES[r] ? h('div', { backgroundColor: UTH_RES[r][1], color: UTH_RES[r][2], fontFamily: 'Nunito', fontWeight: 900, fontSize: 11 * S, letterSpacing: 1 * S, padding: `${2 * S}px ${7 * S}px`, borderRadius: 5 * S }, UTH_RES[r][0]) : null;
  return h('div', { width: W * S, flexDirection: 'column', gap: 10 * S, padding: `${14 * S}px ${16 * S}px`, ...FELT, boxSizing: 'border-box' },
    h('div', { flexDirection: 'column', gap: 6 * S }, label('Dealer', hn(dh)), cards(dealer)),
    h('div', { flexDirection: 'column', gap: 6 * S }, label('Board'), cards(board)),
    h('div', { flexDirection: 'column', gap: 6 * S }, label(name, [hn(ph), rt]), cards(me)));
}

const bacPts = cs => cs.reduce((a, c) => a + (c[0] === 'A' ? 1 : 'TJQK'.includes(c[0]) ? 0 : +c[0]), 0) % 10;
export function baccarat({ p, b, w, name, side }) {
  const SIDE = { player: 'Player', banker: 'Banker', tie: 'Tie' };
  const row = (who, cs, key) => h('div', { flexDirection: 'column', gap: 6 * S, opacity: w !== 'tie' && w !== key ? 0.55 : 1 },
    label(who, [side === key ? h('div', { color: '#a9b4f6', textTransform: 'none', letterSpacing: 0 }, `${name}'s bet`) : null, w === key ? tag('win') : null]),
    h('div', { alignItems: 'center', gap: 8 * S }, cs.map(card), h('div', { marginLeft: 6 * S }, pill(String(bacPts(cs)), PILL, '#f2f3f5'))));
  return h('div', { width: W * S, flexDirection: 'column', gap: 12 * S, padding: `${14 * S}px ${16 * S}px`, ...FELT, boxSizing: 'border-box' },
    row('Player', p, 'player'), row('Banker', b, 'banker'),
    w === 'tie' ? h('div', { alignItems: 'center', gap: 8 * S }, tag('push'), h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 13 * S, color: LBL }, side === 'tie' ? `TIE · ${name.toUpperCase()} WINS 8:1` : 'TIE · PLAYER AND BANKER PUSH')) : null);
}

export function duel(cards, names, w) {
  const side = k => h('div', { flexDirection: 'column', alignItems: 'center', gap: 8 * S, opacity: k === w ? 1 : 0.55 },
    h('div', { padding: 4 * S, borderRadius: 11 * S, backgroundColor: k === w ? '#8ee0b0' : 'transparent' }, card(cards[k] || 'XX')),
    h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 16 * S, color: '#f2f3f5' }, (names[k] || '').slice(0, 20)),
    k === w ? tag('win') : null);
  return h('div', { width: W * S, justifyContent: 'center', alignItems: 'center', gap: 40 * S, padding: `${16 * S}px ${16 * S}px`, ...FELT, boxSizing: 'border-box' },
    side(0), h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 22 * S, color: LBL }, 'VS'), side(1));
}

export async function render(q) {
  if (q.get('m') === 'pack' || q.get('m') === 'cards') return shopImage(q); // Study Cards pictures (see _shopimg.js)
  if (q.get('m') === 'bac') {
    const cs = k => String(q.get(k) || '').split('.').filter(Boolean).slice(0, 3);
    const svg = await satori(baccarat({ p: cs('p'), b: cs('b'), w: q.get('w') || '', name: (q.get('n') || 'You').slice(0, 24), side: q.get('s') || '' }), { width: W * S, fonts: fonts() });
    return new Resvg(svg, { fitTo: { mode: 'width', value: W * S } }).render().asPng();
  }
  if (q.get('m') === 'uth') {
    const cs = (k, n) => String(q.get(k) || '').split('.').filter(Boolean).slice(0, n);
    const svg = await satori(uth({ dealer: cs('d', 2), board: cs('b', 5), me: cs('p', 2), name: (q.get('n') || 'You').slice(0, 24), ph: (q.get('ph') || '').slice(0, 60), dh: (q.get('dh') || '').slice(0, 70), r: q.get('r') || '' }), { width: W * S, fonts: fonts() });
    return new Resvg(svg, { fitTo: { mode: 'width', value: W * S } }).render().asPng();
  }
  if (q.get('m') === 'duel') {
    const svg = await satori(duel(String(q.get('c') || '').split('.'), String(q.get('n') || '').split('|'), +q.get('w')), { width: W * S, fonts: fonts() });
    return new Resvg(svg, { fitTo: { mode: 'width', value: W * S } }).render().asPng();
  }
  const split = (v, sep) => String(v || '').split(sep).filter(Boolean);
  const dealer = split(q.get('d'), '.').slice(0, 12);
  const hands = split(q.get('p'), '-').slice(0, 6).map(x => split(x, '.').slice(0, 12));
  const a = q.get('a'), activeIdx = a === null || a === '' ? null : +a;
  const svg = await satori(table({ dealer, hands, activeIdx, results: split(q.get('r'), '.'), bets: split(q.get('b'), '.'), frees: split(q.get('f'), '.'),
    side: Math.min(25, Math.max(0, Math.floor(+q.get('s') || 0))), flags: split(q.get('x'), '.'), name: (q.get('n') || 'You').slice(0, 24) }),
    { width: W * S, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W * S } }).render().asPng();
}

export default async function handler(req, res) {
  try {
    const png = await render(new URL(req.url, 'http://x').searchParams);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable'); // each picture's URL is unique to one moment of one hand; s-maxage lets Vercel's CDN keep it too
    res.status(200).send(png);
  } catch (e) { res.status(500).send('Could not draw the table: ' + e.message); }
}
