// /api/seats  the table picture under /seats: everyone's pfp and name around one oval table.
//   p=<discord id>~<name>|<id>~<name>|...   players in seat order (seat 1 at the bottom, clockwise); id can be empty
//   d=6                                       index of the player with the dealer button
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { avatarPng } from './_discord.js';
import { unpackSeats } from './_seats.js';

const asset = name => readFileSync(new URL(`./_assets/${name}`, import.meta.url));
let FONTS;
const fonts = () => FONTS || (FONTS = [
  { name: 'Nunito', data: asset('nunito-latin-800-normal.woff'), weight: 800, style: 'normal' },
  { name: 'Nunito', data: asset('nunito-latin-900-normal.woff'), weight: 900, style: 'normal' }]);

const S = 2, W = 560, H = 390;
const h = (type, style, ...kids) => ({ type, props: { style: { display: 'flex', ...style }, children: kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '') } });
const img = (src, w, ht) => ({ type: 'img', props: { src, width: w, height: ht, style: { objectFit: 'cover' } } });
const pngUri = b => 'data:image/png;base64,' + Buffer.from(b).toString('base64');
const hueFor = n => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = n => n.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

export function table(players, dealer, pics = {}) {
  const n = players.length, AV = n <= 10 ? 48 : n <= 13 ? 42 : 36, cx = W / 2, cy = H / 2 + 2, rx = W / 2 - 46, ry = H / 2 - 52;
  const felt = h('div', { position: 'absolute', left: 92 * S, top: 92 * S, width: (W - 184) * S, height: (H - 180) * S, borderRadius: 999,
    backgroundImage: 'radial-gradient(ellipse at 50% 40%, #2f7d5b, #1d5a40)', border: `${11 * S}px solid #5a3a22`, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', fontFamily: 'Nunito', fontWeight: 900, fontSize: 15 * S, letterSpacing: 2.5 * S, color: 'rgba(255,255,255,0.28)' },
    h('div', {}, 'POKER CLUB'), h('div', {}, '@ THE STUDY'));
  const seats = players.map((p, k) => {
    const a = 2 * Math.PI * k / n, x = cx - rx * Math.sin(a), y = cy + ry * Math.cos(a), hue = hueFor(p.name);
    const face = pics[k] ? h('div', { width: AV * S, height: AV * S, borderRadius: 999, overflow: 'hidden' }, img(pics[k], AV * S, AV * S))
      : h('div', { width: AV * S, height: AV * S, borderRadius: 999, backgroundColor: `hsl(${hue}, 55%, 42%)`, color: '#fff', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Nunito', fontWeight: 900, fontSize: AV * 0.36 * S }, initials(p.name));
    return h('div', { position: 'absolute', left: (x - 45) * S, top: (y - AV / 2 - 4) * S, width: 90 * S, flexDirection: 'column', alignItems: 'center', gap: 3 * S },
      h('div', { position: 'relative', border: `${3 * S}px solid #1f2024`, borderRadius: 999 }, face,
        h('div', { position: 'absolute', left: -7 * S, top: -6 * S, width: 20 * S, height: 20 * S, borderRadius: 999, backgroundColor: '#f2f3f5', color: '#1e1f22',
          alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito', fontWeight: 900, fontSize: 11 * S }, String(k + 1))),
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 13 * S, color: '#f2f3f5', maxWidth: 90 * S, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, p.name));
  });
  const kids = [felt, ...seats];
  if (dealer >= 0 && dealer < n) { // the button sits on the felt, just in front of the dealer
    const a = 2 * Math.PI * dealer / n, x = cx - (rx - 66) * Math.sin(a), y = cy + (ry - 58) * Math.cos(a);
    kids.push(h('div', { position: 'absolute', left: (x - 12) * S, top: (y - 12) * S, width: 24 * S, height: 24 * S, borderRadius: 999, backgroundColor: '#fff', color: '#111',
      alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito', fontWeight: 900, fontSize: 12 * S, boxShadow: '0 2px 4px rgba(0,0,0,0.6)' }, 'D'));
  }
  return h('div', { position: 'relative', width: W * S, height: H * S, backgroundColor: '#1f2024' }, kids);
}

export async function render(q, getPic = id => avatarPng(id, 128)) {
  const players = unpackSeats(q.get('p')).slice(0, 16), dealer = +(q.get('d') || -1);
  const pics = {};
  await Promise.all(players.map(async (p, k) => { if (/^\d{17,20}$/.test(p.id)) { try { const b = await getPic(p.id); if (b) pics[k] = pngUri(b); } catch (e) { /* initials */ } } }));
  const svg = await satori(table(players, dealer, pics), { width: W * S, height: H * S, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W * S } }).render().asPng();
}

export default async function handler(req, res) {
  try {
    const png = await render(new URL(req.url, 'http://x').searchParams);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400'); // each draw has its own URL (v=)
    res.status(200).send(png);
  } catch (e) { res.status(500).send('Could not draw the table: ' + e.message); }
}
