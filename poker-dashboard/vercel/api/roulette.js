// /api/roulette?n=17  the wheel picture after a /roulette spin: European wheel, ball on the winning number.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';

const asset = name => readFileSync(new URL(`./_assets/${name}`, import.meta.url));
let FONTS;
const fonts = () => FONTS || (FONTS = [{ name: 'Nunito', data: asset('nunito-latin-900-normal.woff'), weight: 900, style: 'normal' }]);

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const fill = n => (n === 0 ? '#248046' : REDS.has(n) ? '#c2283e' : '#1b1b1b');
const SIZE = 520, C = SIZE / 2, R = 240, IN = 160, N = 37;
const h = (type, style, ...kids) => ({ type, props: { style: { display: 'flex', ...style }, children: kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '') } });

/** The wheel rotated so the winning pocket sits at the top, under the ball. */
export function wheel(win) {
  const at = ORDER.indexOf(win), step = 360 / N, rot = -at * step; // degrees, pocket 'at' moved to 12 o'clock
  const rad = d => (d - 90) * Math.PI / 180, pt = (r, d) => [C + r * Math.cos(rad(d)), C + r * Math.sin(rad(d))];
  let paths = '';
  ORDER.forEach((num, k) => {
    const a0 = rot + (k - 0.5) * step, a1 = a0 + step;
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(IN, a1), [x3, y3] = pt(IN, a0);
    paths += `<path d="M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} L${x2},${y2} A${IN},${IN} 0 0 0 ${x3},${y3}Z" fill="${fill(num)}" stroke="#d6b25e" stroke-width="1.5"/>`;
  });
  const [bx, by] = pt(IN + 14, 0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><circle cx="${C}" cy="${C}" r="${C - 2}" fill="#3a2414"/>${paths}`
    + `<circle cx="${C}" cy="${C}" r="${IN}" fill="#5a3a22"/><circle cx="${C}" cy="${C}" r="${IN - 58}" fill="#2f7d5b" stroke="#d6b25e" stroke-width="3"/>`
    + `<circle cx="${bx}" cy="${by}" r="11" fill="#ffffff" stroke="#888" stroke-width="2"/><path d="M${C - 14},4 L${C + 14},4 L${C},26Z" fill="#f1c75b"/></svg>`;
  const labels = ORDER.map((num, k) => {
    const d = rot + k * step, [x, y] = pt((R + IN) / 2 + 6, d);
    return h('div', { position: 'absolute', left: x - 20, top: y - 14, width: 40, height: 28, alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontFamily: 'Nunito', fontWeight: 900, fontSize: 19, transform: `rotate(${d}deg)` }, String(num));
  });
  return h('div', { position: 'relative', width: SIZE, height: SIZE, backgroundColor: '#2b2d31' },
    { type: 'img', props: { src: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), width: SIZE, height: SIZE, style: { position: 'absolute', left: 0, top: 0 } } },
    labels,
    h('div', { position: 'absolute', left: C - 80, top: C - 50, width: 160, height: 100, alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontFamily: 'Nunito', fontWeight: 900, fontSize: 84 }, String(win)));
}

export async function render(n) {
  const svg = await satori(wheel(n), { width: SIZE, height: SIZE, fonts: fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng();
}

export default async function handler(req, res) {
  try {
    const n = +(new URL(req.url, 'http://x').searchParams.get('n'));
    if (!Number.isInteger(n) || n < 0 || n > 36) { res.status(400).send('n must be 0 to 36'); return; }
    const png = await render(n);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(png);
  } catch (e) { res.status(500).send('Could not draw the wheel: ' + e.message); }
}
