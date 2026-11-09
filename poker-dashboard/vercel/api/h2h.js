// /api/h2h?a=Renato&b=Dong&period=Y2026   head-to-head card as a PNG (what /h2h posts in Discord): the "race" layout,
// with both players' Discord banners across the top. (&layout=tape or faces draws the other two mockups.)
// period is "Q4 2026", "Y2026" or "all". Only games both players were in count.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { SHEET_URL, MEMBERS_URL, COLORS as C, gameRecords, findPlayer, pairStats, latestQuarter, memberIds, hueFor, initials, usd, CROWN_SVG } from '../recap-core.js';
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

const S = 2, W = 560, IN = W - 36;
const h = (type, style, ...kids) => ({ type, props: { style: { display: 'flex', ...style }, children: kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '') } });
const img = (src, w, ht, style = {}) => ({ type: 'img', props: { src, width: w, height: ht, style } });
const hsl = (hue, s, l) => `hsl(${hue}, ${s}%, ${l}%)`;
const col = v => v > 0 ? C.up : v < 0 ? C.down : C.soft;
const A = '#a08cf0', B = '#f0b45a'; // each side's colour (violet left, amber right)

const avatar = (pic, name, size, ring) => {
  const base = { width: size * S, height: size * S, borderRadius: 999, flexShrink: 0, boxSizing: 'border-box', ...(ring ? { border: `${ring.w * S}px solid ${ring.c}` } : {}) };
  if (pic) return h('div', { ...base, overflow: 'hidden', backgroundColor: C.panel }, img(pic, size * S, size * S, { objectFit: 'cover' }));
  const hue = hueFor(name);
  return h('div', { ...base, backgroundColor: hsl(hue, 80, 86), color: hsl(hue, 45, 28), alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Nunito', fontWeight: 900, fontSize: size * 0.4 * S }, initials(name));
};
const panel = (title, note, ...body) => h('div', { flexDirection: 'column', backgroundColor: C.panel, borderRadius: 16 * S, padding: `${12 * S}px ${14 * S}px`, gap: 8 * S },
  h('div', { justifyContent: 'space-between', alignItems: 'center' },
    h('div', { fontFamily: 'Bebas', fontSize: 20 * S, letterSpacing: 0.5 * S, color: C.bright }, title),
    h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 11.5 * S, color: C.muted }, note)),
  body);

function topBand(p, pics, art = {}) {
  const lead = p.aw === p.bw ? null : p.aw > p.bw ? 'a' : 'b';
  const side = (k) => { const name = p[k], win = lead === k;
    return h('div', { width: 150 * S, flexDirection: 'column', alignItems: 'center', gap: 6 * S },
      h('div', { position: 'relative', width: 92 * S, height: 92 * S, alignItems: 'center', justifyContent: 'center' },
        avatar(pics[name], name, 92, { w: 4, c: k === 'a' ? A : B }),
        win ? h('div', { position: 'absolute', top: -8 * S, right: -4 * S, width: 34 * S, height: 34 * S, borderRadius: 999, backgroundColor: C.gold, border: `${3 * S}px solid ${C.panel}`, alignItems: 'center', justifyContent: 'center' },
          img('data:image/svg+xml;base64,' + Buffer.from(CROWN_SVG).toString('base64'), 18 * S, 18 * S)) : null),
      h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 20 * S, color: win ? C.gold : C.bright, maxWidth: 150 * S, overflow: 'hidden', whiteSpace: 'nowrap', textShadow: `0 ${2 * S}px ${6 * S}px rgba(0,0,0,0.7)` }, name)); };
  const record = h('div', { flexDirection: 'column', alignItems: 'center', flexGrow: 1 },
    h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, letterSpacing: 1.4 * S, color: C.muted }, p.label.toUpperCase() + ' · HEAD TO HEAD'),
    h('div', { alignItems: 'center', gap: 10 * S, marginTop: 2 * S },
      h('div', { fontFamily: 'Bebas', fontSize: 64 * S, lineHeight: 1, color: A }, String(p.aw)),
      h('div', { fontFamily: 'Bebas', fontSize: 30 * S, color: C.muted }, 'VS'),
      h('div', { fontFamily: 'Bebas', fontSize: 64 * S, lineHeight: 1, color: B }, String(p.bw))),
    h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 12.5 * S, color: C.soft },
      lead ? `${p[lead]} leads` : 'All square'),
    h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 11 * S, color: C.muted, marginTop: 2 * S },
      `${p.n} game${p.n === 1 ? '' : 's'} together${p.ties ? ` · ${p.ties} tie${p.ties === 1 ? '' : 's'}` : ''}`));
  // each player's Discord banner fills their half (else their profile colour, else their side colour), fading to dark in the middle
  const BH = 172, half = IN * 0.62, banners = art.banners || {}, colors = art.colors || {};
  // the two halves overlap in the middle and each fades out toward the centre, so the banners melt into each other
  const halfBg = (k) => { const name = p[k], left = k === 'a' ? 0 : IN - half;
    const wrap = { position: 'absolute', left: left * S, top: 0, width: half * S, height: BH * S, overflow: 'hidden',
      maskImage: `linear-gradient(${k === 'a' ? 'to right' : 'to left'}, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 100%)` };
    return h('div', wrap, banners[name] ? img(banners[name], half * S, BH * S, { objectFit: 'cover' })
      : h('div', { width: half * S, height: BH * S, backgroundImage: `linear-gradient(${k === 'a' ? 135 : 225}deg, ${colors[name] || (k === 'a' ? '#5a46b0' : '#a8702a')}, ${C.panel})` })); };
  // bare: only the faces and record, for the layout where the banners fill the whole card behind it
  if (art.bare) return h('div', { height: BH * S, alignItems: 'center', padding: `0 ${10 * S}px` }, side('a'), record, side('b'));
  const top = h('div', { position: 'relative', height: BH * S, borderRadius: 18 * S, overflow: 'hidden', backgroundColor: C.panel },
    halfBg('a'), halfBg('b'),
    h('div', { position: 'absolute', left: 0, top: 0, width: IN * S, height: BH * S,
      backgroundImage: 'radial-gradient(ellipse 34% 75% at 50% 50%, rgba(21,19,42,0.85), rgba(21,19,42,0.35) 70%, rgba(21,19,42,0.15))' }),
    h('div', { position: 'absolute', left: 0, top: 0, width: IN * S, height: BH * S, backgroundImage: 'linear-gradient(180deg, rgba(21,19,42,0) 55%, rgba(21,19,42,0.55))' }),
    h('div', { position: 'absolute', left: 0, top: 0, width: IN * S, height: BH * S, alignItems: 'center', padding: `0 ${10 * S}px`, boxSizing: 'border-box' },
      side('a'), record, side('b')));

  return top;
}
const footer = () => h('div', { justifyContent: 'center', alignItems: 'center', gap: 7 * S, fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, color: C.muted },
    img(LOGO, 20 * S, 20 * S), 'Poker Club @ The Study');
const frame = (...kids) => h('div', { width: W * S, boxSizing: 'border-box', flexDirection: 'column', gap: 14 * S, padding: 18 * S, borderRadius: 22 * S, color: C.text,
    backgroundColor: C.night, backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(110,82,200,0.3), rgba(21,19,42,0) 60%)' }, ...kids);

export function card(p, pics, art) {
  const top = topBand(p, pics, art);
  // share of games each finished ahead, as one split bar
  const tot = Math.max(1, p.aw + p.bw + p.ties), BW = IN - 28;
  const seg = (n, c) => n ? h('div', { width: (BW * n / tot) * S, height: 14 * S, backgroundColor: c }) : null;
  const bar = h('div', { width: BW * S, height: 14 * S, borderRadius: 7 * S, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
    seg(p.aw, A), seg(p.ties, '#6d6895'), seg(p.bw, B));
  const stat = (label, va, vb, fmt = v => String(v), colour = () => C.bright) => h('div', { height: 26 * S, alignItems: 'center' },
    h('div', { width: 120 * S, fontFamily: 'Mono', fontWeight: 600, fontSize: 14 * S, color: colour(va) }, fmt(va)),
    h('div', { flexGrow: 1, justifyContent: 'center', fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, letterSpacing: 0.8 * S, color: C.muted }, label),
    h('div', { width: 120 * S, justifyContent: 'flex-end', fontFamily: 'Mono', fontWeight: 600, fontSize: 14 * S, color: colour(vb) }, fmt(vb)));
  const tale = panel('TALE OF THE TAPE', 'only games they both played',
    bar,
    h('div', { justifyContent: 'space-between', fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, color: C.muted, marginTop: -2 * S },
      h('div', { color: A }, `${p.a} ahead ${p.aw}`), h('div', { color: B }, `${p.b} ahead ${p.bw}`)),
    stat('NET IN THESE GAMES', p.an, p.bn, v => usd(v), col),
    stat('NIGHTS FINISHED UP', p.aUp, p.bUp, v => `${v} of ${p.n}`),
    p.best ? h('div', { height: 22 * S, justifyContent: 'center', alignItems: 'center', fontFamily: 'Nunito', fontWeight: 700, fontSize: 12 * S, color: C.soft },
      `Biggest gap: ${p.best.who} by ${usd(p.best.gap, { sign: false })} on ${p.best.date}`) : null);

  const row = g => { const aw = g.x > g.y, bw = g.y > g.x;
    return h('div', { height: 30 * S, alignItems: 'center', borderRadius: 8 * S, padding: `0 ${8 * S}px`, backgroundColor: 'rgba(255,255,255,0.03)' },
      h('div', { width: 120 * S, alignItems: 'center', gap: 6 * S },
        h('div', { width: 8 * S, height: 8 * S, borderRadius: 4 * S, backgroundColor: aw ? A : 'rgba(0,0,0,0)' }),
        h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 13 * S, color: col(g.x) }, usd(g.x))),
      h('div', { flexGrow: 1, justifyContent: 'center', fontFamily: 'Nunito', fontWeight: 800, fontSize: 12 * S, color: C.soft }, `${g.date}${g.tour ? ' · Tourney' : ' · Cash'}`),
      h('div', { width: 120 * S, justifyContent: 'flex-end', alignItems: 'center', gap: 6 * S },
        h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 13 * S, color: col(g.y) }, usd(g.y)),
        h('div', { width: 8 * S, height: 8 * S, borderRadius: 4 * S, backgroundColor: bw ? B : 'rgba(0,0,0,0)' }))); };
  const last = panel('LATEST MEETINGS', 'dot = finished ahead', h('div', { flexDirection: 'column', gap: 4 * S }, p.last.map(row)));

  const foot = h('div', { justifyContent: 'center', alignItems: 'center', gap: 7 * S, fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, color: C.muted },
    img(LOGO, 20 * S, 20 * S), 'Poker Club @ The Study');
  return h('div', { width: W * S, boxSizing: 'border-box', flexDirection: 'column', gap: 14 * S, padding: 18 * S, borderRadius: 22 * S, color: C.text,
      backgroundColor: C.night, backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(110,82,200,0.3), rgba(21,19,42,0) 60%)' },
    top, tale, last, foot);
}

// ---- Layout B: the race. Running total in the games they shared, one line each, pfps riding the line ends ----
export function cardRace(p, pics, art) {
  const G = p.games, PW = IN - 28, PH = 190, L = 8, R = 46, T = 22, BM = 26;
  const vals = [0, ...G.map(g => g.ca), ...G.map(g => g.cb)], hi = Math.max(...vals), lo = Math.min(...vals), rng = hi - lo || 1;
  const x = i => L + (G.length <= 1 ? (PW - L - R) : i * (PW - L - R) / (G.length - 1)), y = v => T + (hi - v) / rng * (PH - T - BM);
  const pts = k => G.map((g, i) => `${x(i).toFixed(1)},${y(g[k]).toFixed(1)}`).join(' ');
  const dots = k => G.map((g, i) => (g.win === (k === 'ca' ? 'a' : 'b')) ? `<circle cx="${x(i).toFixed(1)}" cy="${y(g[k]).toFixed(1)}" r="3.5" fill="${k === 'ca' ? A : B}"/>` : '').join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW * S}" height="${PH * S}">`
    + [0.25, 0.5, 0.75].map(f => `<line x1="${L}" x2="${PW - R}" y1="${T + f * (PH - T - BM)}" y2="${T + f * (PH - T - BM)}" stroke="${C.grid}" stroke-width="1"/>`).join('')
    + `<line x1="${L}" x2="${PW - R}" y1="${y(0)}" y2="${y(0)}" stroke="${C.muted}" stroke-opacity=".5" stroke-dasharray="4 4"/>`
    + `<polyline points="${pts('cb')}" fill="none" stroke="${B}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<polyline points="${pts('ca')}" fill="none" stroke="${A}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    + dots('cb') + dots('ca') + `</svg>`;
  const end = k => { const v = G[G.length - 1][k], name = k === 'ca' ? p.a : p.b, c = k === 'ca' ? A : B;
    return h('div', { position: 'absolute', left: (x(G.length - 1) - 17) * S, top: (y(v) - 17) * S }, avatar(pics[name], name, 34, { w: 3, c })); };
  // keep the two end pfps from sitting on top of each other
  const ya = y(G[G.length - 1].ca), yb = y(G[G.length - 1].cb), nudge = Math.abs(ya - yb) < 36 ? (36 - Math.abs(ya - yb)) / 2 : 0;
  const endAt = (k, dy) => { const v = G[G.length - 1][k], name = k === 'ca' ? p.a : p.b, c = k === 'ca' ? A : B;
    return h('div', { position: 'absolute', left: (x(G.length - 1) - 17) * S, top: (y(v) - 17 + dy) * S }, avatar(pics[name], name, 34, { w: 3, c })); };
  const label = (t, left, anchor) => h('div', { position: 'absolute', left: (anchor === 'end' ? left - 80 : left) * S, width: 80 * S, top: (PH - 18) * S, justifyContent: anchor === 'end' ? 'flex-end' : 'flex-start',
    fontFamily: 'Nunito', fontWeight: 800, fontSize: 10.5 * S, color: C.muted }, t);
  const chart = h('div', { position: 'relative', width: PW * S, height: PH * S },
    img('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), PW * S, PH * S, { position: 'absolute', left: 0, top: 0 }),
    endAt('cb', ya < yb ? nudge : -nudge), endAt('ca', ya < yb ? -nudge : nudge),
    label(G[0].date, L, 'start'), label(G[G.length - 1].date, PW - R, 'end'));
  const legend = h('div', { justifyContent: 'space-between' },
    ...[['a', 'ca', A], ['b', 'cb', B]].map(([k, c, colr]) => h('div', { alignItems: 'center', gap: 8 * S },
      avatar(pics[p[k]], p[k], 26, { w: 2, c: colr }),
      h('div', { flexDirection: 'column' },
        h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 13 * S, color: C.bright }, p[k]),
        h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 13 * S, color: col(G[G.length - 1][c]) }, usd(G[G.length - 1][c]))))));
  const race = panel('THE RACE', `running total in ${p.n} shared game${p.n === 1 ? '' : 's'}`, chart, legend,
    h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 11 * S, color: C.muted, justifyContent: 'center' }, 'dot = finished ahead of the other that night'));
  if (art.full) return race;
  return frame(topBand(p, pics, art), race, footer());
}

// ---- Layout D: the race with both banners filling the whole card behind everything, darkened toward the bottom ----
export function cardFull(p, pics, art = {}) {
  const FH = 640, half = W * 0.62, banners = art.banners || {}, colors = art.colors || {};
  const layer = (k) => { const name = p[k], left = k === 'a' ? 0 : W - half;
    return h('div', { position: 'absolute', left: left * S, top: 0, width: half * S, height: FH * S, overflow: 'hidden',
        maskImage: `linear-gradient(${k === 'a' ? 'to right' : 'to left'}, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%)` },
      banners[name] ? img(banners[name], half * S, FH * S, { objectFit: 'cover' })
        : h('div', { width: half * S, height: FH * S, backgroundImage: `linear-gradient(${k === 'a' ? 160 : 200}deg, ${colors[name] || (k === 'a' ? '#5a46b0' : '#a8702a')}, ${C.night})` })); };
  const cover = (bg) => h('div', { position: 'absolute', left: 0, top: 0, width: W * S, height: FH * S, backgroundImage: bg });
  const race = cardRace(p, pics, { ...art, full: true });
  race.props.style.backgroundColor = 'rgba(21,19,42,0.62)';
  race.props.style.border = `${1 * S}px solid rgba(255,255,255,0.08)`;
  return h('div', { position: 'relative', width: W * S, flexDirection: 'column', borderRadius: 22 * S, overflow: 'hidden', backgroundColor: C.night, color: C.text },
    layer('a'), layer('b'),
    cover('radial-gradient(ellipse 30% 22% at 50% 15%, rgba(21,19,42,0.8), rgba(21,19,42,0))'),
    cover('linear-gradient(180deg, rgba(21,19,42,0.1), rgba(21,19,42,0.35) 30%, rgba(21,19,42,0.7) 60%, rgba(21,19,42,0.85))'),
    h('div', { position: 'relative', flexDirection: 'column', gap: 14 * S, padding: 18 * S },
      topBand(p, pics, { ...art, bare: true }), race, footer()));
}

// ---- Layout C: faces. Every shared game as the face of whoever finished ahead, plus streaks ----
export function cardFaces(p, pics, art) {
  const G = p.games.slice(-24), per = 12, size = Math.floor((IN - 28 - (per - 1) * 6) / per);
  const face = g => g.win ? h('div', { flexDirection: 'column', alignItems: 'center', gap: 2 * S, width: size * S },
      avatar(pics[p[g.win]], p[g.win], size, { w: 2, c: g.win === 'a' ? A : B }),
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 8.5 * S, color: C.muted }, g.date.replace(/^(\w{3}) /, '$1 ')))
    : h('div', { flexDirection: 'column', alignItems: 'center', gap: 2 * S, width: size * S },
      h('div', { width: size * S, height: size * S, borderRadius: 999, border: `${2 * S}px dashed ${C.muted}`, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito', fontWeight: 900, fontSize: 10 * S, color: C.muted }, '='),
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 8.5 * S, color: C.muted }, g.date));
  const rows = []; for (let i = 0; i < G.length; i += per) rows.push(G.slice(i, i + per));
  // current streak and longest streak for each
  let cur = { who: '', n: 0 }, best = { a: 0, b: 0 }, run = { who: '', n: 0 };
  p.games.forEach(g => { if (g.win && g.win === run.who) run.n++; else run = { who: g.win, n: g.win ? 1 : 0 }; if (run.who) best[run.who] = Math.max(best[run.who], run.n); });
  cur = run;
  const streakTile = (k, colr) => h('div', { width: ((IN - 28 - 10) / 2) * S, alignItems: 'center', gap: 10 * S, padding: `${10 * S}px ${12 * S}px`, boxSizing: 'border-box', borderRadius: 12 * S, backgroundColor: 'rgba(255,255,255,0.04)' },
    avatar(pics[p[k]], p[k], 40, { w: 3, c: colr }),
    h('div', { flexDirection: 'column' },
      h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 14 * S, color: C.bright }, p[k]),
      h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 11.5 * S, color: C.soft }, `Best streak: ${best[k]} in a row`),
      h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 12 * S, color: col(k === 'a' ? p.an : p.bn) }, `${usd(k === 'a' ? p.an : p.bn)} together`)));
  const facesPanel = panel('GAME BY GAME', G.length < p.games.length ? `last ${G.length} of ${p.n} shared games` : `all ${p.n} shared games`,
    h('div', { flexDirection: 'column', gap: 8 * S }, rows.map(r => h('div', { gap: 6 * S }, r.map(face)))),
    cur.who && cur.n >= 2 ? h('div', { justifyContent: 'center', alignItems: 'center', gap: 6 * S, marginTop: 2 * S, fontFamily: 'Nunito', fontWeight: 800, fontSize: 12.5 * S, color: C.gold },
      avatar(pics[p[cur.who]], p[cur.who], 20), `${p[cur.who]} has finished ahead ${cur.n} game${cur.n === 1 ? '' : 's'} in a row`) : null);
  const streaks = h('div', { gap: 10 * S }, streakTile('a', A), streakTile('b', B));
  return frame(topBand(p, pics, art), facesPanel, panel('STREAKS', 'finished ahead of the other', streaks), footer());
}

/** { png } or { error } */
export async function render(csv, qa, qb, period, membersCsv = '', getPic = id => avatarPng(id, 256), layout = 'race', getBanner = bannerPng, getColor = accentColor) {
  loadAssets();
  const recs = gameRecords(csv), a = findPlayer(recs, qa), b = findPlayer(recs, qb);
  if (!a.name || !b.name) return { error: `No player called "${!a.name ? qa : qb}"` };
  const q = latestQuarter(recs), p = /^(Q[1-4] \d{4}|Y\d{4}|all)$/.test(period || '') ? period : 'Y' + q.split(' ')[1];
  const st = pairStats(recs, a.name, b.name, p);
  if (!st.n) return { error: `${a.name} and ${b.name} haven't played the same game in ${st.label}` };
  const ids = memberIds(membersCsv);
  const pics = Object.fromEntries((await Promise.all([a.name, b.name].filter(n => ids[n]).map(async n => {
    try { const x = await getPic(ids[n]); return x ? [n, 'data:image/png;base64,' + Buffer.from(x).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  const safe = async (fn, id) => { try { return await fn(id); } catch (e) { return null; } };
  const both = [a.name, b.name].filter(n => ids[n]);
  const [bn, cl] = await Promise.all([
    Promise.all(both.map(async n => { const x = await safe(getBanner, ids[n]); return x ? [n, 'data:image/png;base64,' + Buffer.from(x).toString('base64')] : null; })),
    Promise.all(both.map(async n => { const c = await safe(getColor, ids[n]); return c ? [n, c] : null; }))]);
  const art = { banners: Object.fromEntries(bn.filter(Boolean)), colors: Object.fromEntries(cl.filter(Boolean)) };
  const draw = { tape: card, race: cardRace, faces: cardFaces, full: cardFull }[layout] || cardRace;
  const svg = await satori(draw(st, pics, art), { width: W * S, fonts: FONTS });
  return { png: new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng() };
}

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    const a = (q.get('a') || '').slice(0, 40), b = (q.get('b') || '').slice(0, 40);
    if (!a || !b) { res.status(400).send('add ?a=Player&b=Player'); return; }
    const [csv, members] = await Promise.all([SHEET_URL, MEMBERS_URL].map(u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '')));
    if (!csv) throw new Error('could not read the sheet');
    const out = await render(csv, a, b, q.get('period') || '', members, undefined, q.get('layout') || 'race');
    if (!out.png) { res.status(404).send(out.error); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(out.png);
  } catch (e) {
    res.status(500).send('Could not draw the head to head: ' + e.message);
  }
}
