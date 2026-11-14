// The lottery prize wheel as an animated GIF: spins and stops on the winning ticket (posted by /lottery draw).
// One slice per player in the draw (ticket-number order, same colours as the site), each with the player's Discord pfp.
// Served by /api/wrap?lottery=<quarter>&spin=1 (no spare function slot on the Hobby plan).
import { Resvg } from '@resvg/resvg-js';
import gifenc from 'gifenc'; // CommonJS build: no named exports under Node ESM
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

export const WHEEL_COLORS = ['#f1c75b', '#e0507f', '#8f78f0', '#8ee0b0', '#7fb6ff', '#ff9f6b', '#c9a2ff', '#5fd3c6', '#f59bb0', '#b8e986', '#d7d3ef', '#e39a68'];

// resvg reads TTF/OTF files (its fontBuffers option is ignored in this version), the assets are WOFF:
// unpack the WOFF tables into a plain sfnt once and keep it in the temp folder
let fontCache = null;
function bebasTtf() {
  if (fontCache) return fontCache;
  const w = readFileSync(new URL('./_assets/bebas-neue-latin-400-normal.woff', import.meta.url)), n = w.readUInt16BE(12);
  let es = 0; while ((1 << (es + 1)) <= n) es++;
  const head = Buffer.alloc(12 + 16 * n), parts = [head];
  head.writeUInt32BE(w.readUInt32BE(4), 0); head.writeUInt16BE(n, 4); head.writeUInt16BE(16 << es, 6); head.writeUInt16BE(es, 8); head.writeUInt16BE(16 * n - (16 << es), 10);
  let off = head.length;
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20, at = w.readUInt32BE(o + 4), comp = w.readUInt32BE(o + 8), orig = w.readUInt32BE(o + 12);
    let d = w.subarray(at, at + comp); if (comp < orig) d = inflateSync(d);
    const e = 12 + 16 * i; head.writeUInt32BE(w.readUInt32BE(o), e); head.writeUInt32BE(w.readUInt32BE(o + 16), e + 4); head.writeUInt32BE(off, e + 8); head.writeUInt32BE(orig, e + 12);
    const p = Buffer.alloc((d.length + 3) & ~3); d.copy(p); parts.push(p); off += p.length;
  }
  const file = join(tmpdir(), 'wheel-bebas-neue.ttf');
  if (!existsSync(file)) writeFileSync(file, Buffer.concat(parts));
  return (fontCache = file);
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const PF = ['#c9b6ff', '#ffd0a8', '#a8e6cf', '#ffb3c7', '#b3d4ff', '#f7e08a', '#d7c4a3', '#9fe0e0'];

/** One frame. rot = degrees; done = the stopped frame with the ticket + winner in the hub. pics: { name: 'data:image/png;base64,…' } */
export function wheelFrameSvg({ holders, total, ticket, winner, quarter, jackpot }, pics, rot, done, caption = true) {
  const W = 400, H = caption ? W + 40 : 395, c = 200, cy = 215, R = 170, inDraw = holders.filter(x => x.in !== false && x.from);
  let a0 = -Math.PI / 2, g = '';
  const pt = a => `${(c + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`;
  inDraw.forEach((x, i) => {
    const a1 = a0 + 2 * Math.PI * x.t / total, mid = (a0 + a1) / 2, deg = (mid * 180 / Math.PI + 90).toFixed(1);
    g += inDraw.length === 1 ? `<circle cx="${c}" cy="${cy}" r="${R}" fill="${WHEEL_COLORS[0]}"/>`
      : `<path d="M${c},${cy} L${pt(a0)} A${R},${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)} Z" fill="${WHEEL_COLORS[i % WHEEL_COLORS.length]}" stroke="#15132a" stroke-width="3"/>`;
    // the pfp: as big as the slice allows at that radius, square, turned to face outwards
    const sz = Math.max(20, Math.min(48, (a1 - a0) * 108 * 0.6)), px = c + 108 * Math.cos(mid), py = cy + 108 * Math.sin(mid);
    const face = pics[x.name] ? `<image href="${pics[x.name]}" x="${px - sz / 2}" y="${py - sz / 2}" width="${sz}" height="${sz}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect x="${px - sz / 2}" y="${py - sz / 2}" width="${sz}" height="${sz}" fill="${PF[i % PF.length]}"/><text x="${px}" y="${py + sz * 0.3}" text-anchor="middle" font-family="Bebas Neue" font-size="${sz * 0.8}" fill="#15132a">${esc(x.name[0].toUpperCase())}</text>`;
    g += `<g transform="rotate(${deg} ${px} ${py})"><rect x="${px - sz / 2 - 2.5}" y="${py - sz / 2 - 2.5}" width="${sz + 5}" height="${sz + 5}" fill="#15132a"/>${face}</g>`;
    if (x.t / total >= 0.06) {
      const nx = c + 150 * Math.cos(mid), ny = cy + 150 * Math.sin(mid);
      g += `<text x="${nx.toFixed(1)}" y="${(ny + 6).toFixed(1)}" text-anchor="middle" font-family="Bebas Neue" font-size="17" fill="#15132a" transform="rotate(${deg} ${nx.toFixed(1)} ${ny.toFixed(1)})">${esc(x.name.toUpperCase().slice(0, 10))}</text>`;
    }
    a0 = a1;
  });
  const num = '#' + String(ticket).padStart(3, '0'), jp = '$' + Number(jackpot).toLocaleString('en-US');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${caption ? '<rect width="100%" height="100%" fill="#15132a"/>' : ''}
  <g transform="rotate(${rot.toFixed(2)} ${c} ${cy})">${g}</g><circle cx="${c}" cy="${cy}" r="56" fill="#15132a" stroke="#f1c75b" stroke-width="4"/>
  <text x="${c}" y="${cy + (done ? 4 : 11)}" text-anchor="middle" font-family="Bebas Neue" font-size="${done ? 34 : 30}" fill="#fff">${done ? num : esc(jp)}</text>
  ${done ? `<text x="${c}" y="${cy + 30}" text-anchor="middle" font-family="Bebas Neue" font-size="20" fill="#f1c75b">${esc(winner.toUpperCase().slice(0, 10))}</text>` : ''}
  <path d="M${c - 16},10 L${c + 16},10 L${c},44 Z" fill="#fff" stroke="#15132a" stroke-width="2.5"/>
  ${caption ? `<text x="${c}" y="${W + 32}" text-anchor="middle" font-family="Bebas Neue" font-size="24" fill="${done ? '#f1c75b' : '#8d87b8'}" letter-spacing="1">${done ? esc(`TICKET ${num} · ${winner.toUpperCase()} WINS ${jp}`) : esc(`${quarter} LOTTERY · SPINNING…`)}</text>` : ''}</svg>`;
}

const fontOpts = () => ({ font: { fontFiles: [bebasTtf()], loadSystemFonts: false, defaultFontFamily: 'Bebas Neue' } });

/** A still wheel as a PNG data URI (for the lottery card): turned to the winning ticket once drawn (w.ticket set). */
export function wheelPngUri(w, pics = {}, size = 420) {
  const rot = w.ticket ? -360 * (w.ticket - 0.5) / w.total : 0;
  const png = new Resvg(wheelFrameSvg(w, pics, rot, !!w.ticket, false), { ...fontOpts(), fitTo: { mode: 'width', value: size } }).render().asPng();
  return 'data:image/png;base64,' + Buffer.from(png).toString('base64');
}

/** The whole spin as a GIF Buffer: ~3.5s of easing turns (5 full turns + the ticket's angle), then the stopped frame, played once. */
export function wheelGif(w, pics = {}, frames = 70) {
  const end = -360 * (w.ticket - 0.5) / w.total - 360 * 5, ease = t => 1 - Math.pow(1 - t, 3.2), gif = GIFEncoder();
  const opts = fontOpts();
  for (let i = 0; i <= frames; i++) {
    const done = i === frames, img = new Resvg(wheelFrameSvg(w, pics, end * ease(i / frames), done), opts).render();
    const pal = quantize(img.pixels, 128), idx = applyPalette(img.pixels, pal);
    gif.writeFrame(idx, img.width, img.height, { palette: pal, delay: done ? 60000 : 50, repeat: -1 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}
