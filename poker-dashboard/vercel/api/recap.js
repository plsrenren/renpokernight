// /api/recap — the "Cozy night" recap card as a PNG (what gets posted to Discord).
//   GET  /api/recap                       latest night, data read live from the Google Sheet
//   GET  /api/recap?night=2026-11-06      a specific night (add &type=Cash or &type=Tournament if a date has both)
//   POST /api/recap?night=...&type=...    same, with the Input tab CSV in the body (the entry page does this right
//                                         after saving, so the image never waits on Google's CSV export)
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { SHEET_URL, COLORS as C, toNights, pickNight, model, usd, initials, hueFor, sparkSvg, raceChart, CROWN_SVG, stories, words, iconSvg, MEMBERS_URL, memberIds } from '../recap-core.js';
import { avatarPng } from './_discord.js';

const asset = name => readFileSync(new URL(`./_assets/${name}`, import.meta.url));
let FONTS, LOGO;
function loadAssets() {
  if (FONTS) return;
  const f = (name, file, weight) => ({ name, data: asset(file), weight, style: 'normal' });
  FONTS = [
    f('Bebas', 'bebas-neue-latin-400-normal.woff', 400),
    f('Nunito', 'nunito-latin-700-normal.woff', 700), f('Nunito', 'nunito-latin-800-normal.woff', 800), f('Nunito', 'nunito-latin-900-normal.woff', 900),
    f('Mono', 'ibm-plex-mono-latin-600-normal.woff', 600),
  ];
  LOGO = 'data:image/png;base64,' + asset('logo.png').toString('base64');
}

const S = 2; // drawn at 2x so it stays sharp in Discord
const svgUri = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const h = (type, style, ...kids) => ({ type, props: { style: { display: 'flex', ...style }, children: kids.flat().filter(k => k !== null && k !== undefined && k !== false && k !== '') } });
const img = (src, w, ht, style = {}) => ({ type: 'img', props: { src, width: w, height: ht, style } });
const col = v => v > 0 ? C.up : v < 0 ? C.down : C.soft;
const hsl = (hue, s, l) => `hsl(${hue}, ${s}%, ${l}%)`;
// a player's circle: their Discord pfp when we have one, else initials on their colour
const avatar = (m, name, size, ring, font) => {
  const pic = m.pics && m.pics[name], hue = hueFor(name);
  const base = { width: size * S, height: size * S, borderRadius: 999, flexShrink: 0, ...(ring ? { border: `${ring.w * S}px solid ${ring.c}` } : {}) };
  if (pic) return h('div', { ...base, overflow: 'hidden', backgroundColor: C.panel }, img(pic, size * S, size * S, { objectFit: 'cover' }));
  return h('div', { ...base, backgroundColor: hsl(hue, 80, 86), color: hsl(hue, 45, 28), alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Nunito', fontWeight: 900, fontSize: font * S }, initials(name));
};
const tri = (up, color) => svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 8" width="10" height="8"><path d="${up ? 'M5 0 L10 8 L0 8 Z' : 'M0 0 L10 0 L5 8 Z'}" fill="${color}"/></svg>`);

const PANEL_W = 496; // inner width of a chart panel at 1x
const BARS_H = 176, NAMES_H = 56, PODIUM_H = BARS_H + NAMES_H;
const TILE_H = 48, Q_ROW = 24, LEGEND_H = 40, STORY_LINE = 20, SEC_H = 16, AWARD_H = 58;
// rough wrap estimate for a storyline at 13.5px Nunito in the 440px text column
const storyLines = parts => Math.max(1, Math.ceil(words(parts).reduce((n, w) => n + w.t.length + (w.space ? 1 : 0), 0) / 58));

export function layout(m) {
  const tileRows = Math.ceil(m.rows.length / 2);
  const qRows = Math.ceil(m.standings.rows.length / 2);
  const race = raceChart(m.race), st = m.stories;
  const listH = list => list.reduce((a, p) => a + storyLines(p) * STORY_LINE + 4, -4);
  const awardRows = Math.ceil(st.awards.length / 2);
  const heights = [52, 74, 14, tileRows * TILE_H + (tileRows - 1) * 6,
    12 + 20 + 8 + PODIUM_H + 12,
    12 + 20 + 8 + qRows * Q_ROW + 12,
    12 + 20 + 8 + listH(st.night) + 12,
    12 + 20 + 8 + listH(st.quarter) + 12 + SEC_H + 4 + awardRows * AWARD_H + (awardRows - 1) * 6 + 12];
  const height = 18 * 2 + heights.reduce((a, b) => a + b, 0) + 14 * (heights.length - 1) - 6; // the tiles label sits 6px closer
  return { width: 560 * S, height: height * S, tileRows, qRows, race };
}

function plot(ch) {
  return h('div', { position: 'relative', width: ch.w * S, height: ch.h * S },
    img(svgUri(ch.svg), ch.w * S, ch.h * S, { position: 'absolute', left: 0, top: 0 }),
    ch.labels.map(l => {
      const w = 90;
      const left = l.anchor === 'end' ? l.x - w : l.anchor === 'middle' ? l.x - w / 2 : l.x;
      return h('div', { position: 'absolute', left: left * S, top: (l.y - 7) * S, width: w * S, height: 14 * S, alignItems: 'center',
        justifyContent: l.anchor === 'end' ? 'flex-end' : l.anchor === 'middle' ? 'center' : 'flex-start',
        fontFamily: 'Mono', fontWeight: 600, fontSize: (l.hot ? 11.5 : 10.5) * S, color: l.hot ? '#fff' : l.hot === false ? C.soft : C.muted }, l.text);
    }));
}
const panel = (title, note, ...body) => h('div', { flexDirection: 'column', backgroundColor: C.panel, borderRadius: 16 * S, padding: `${12 * S}px ${14 * S}px`, gap: 8 * S },
  h('div', { height: 20 * S, justifyContent: 'space-between', alignItems: 'center' },
    h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 15 * S, color: C.bright }, title),
    h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 12 * S, color: C.muted }, note)),
  body);
const swatch = c => h('div', { width: 10 * S, height: 10 * S, borderRadius: 3 * S, backgroundColor: c });

export function card(m, L) {
  const top = h('div', { height: 52 * S, alignItems: 'center', gap: 12 * S },
    img(LOGO, 52 * S, 52 * S),
    h('div', { flexDirection: 'column', flexGrow: 1 },
      h('div', { fontFamily: 'Bebas', fontSize: 30 * S, lineHeight: 1, color: '#fff' }, m.title.toUpperCase()),
      h('div', { fontFamily: 'Nunito', fontWeight: 700, fontSize: 13 * S, color: '#b9b3e0', marginTop: 4 * S }, m.sub + (m.off ? ' · ' + m.off : ''))));

  const win = h('div', { height: 74 * S, alignItems: 'center', gap: 14 * S, padding: `0 ${16 * S}px`, borderRadius: 18 * S,
      backgroundImage: `linear-gradient(120deg, #3a2a6e, ${C.maroon})` },
    m.pics && m.pics[m.winner.name] ? avatar(m, m.winner.name, 46, { w: 3, c: C.gold }, 18)
      : h('div', { width: 46 * S, height: 46 * S, borderRadius: 999, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center' },
        img(svgUri(CROWN_SVG), 24 * S, 24 * S)),
    h('div', { flexDirection: 'column', flexGrow: 1 },
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, letterSpacing: 1.3 * S, color: '#ffd7e1' }, 'WINNER WINNER'),
      h('div', { alignItems: 'baseline', gap: 8 * S },
        h('div', { fontFamily: 'Nunito', fontWeight: 900, fontSize: 24 * S, color: '#fff' }, m.winner.name),
        h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 20 * S, color: '#ffe9a3' }, usd(m.winner.net)))),
    h('div', { flexDirection: 'column', alignItems: 'flex-end', fontFamily: 'Nunito', fontWeight: 800, fontSize: 12 * S, color: '#ffd7e1', lineHeight: 1.25 },
      ...m.winner.note.split('<br>').map(t => h('div', {}, t))));

  const label = h('div', { height: 14 * S, marginBottom: -6 * S, fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, letterSpacing: 0.9 * S, color: C.muted },
    "TONIGHT · LINE SHOWS EACH PLAYER'S LAST 6 NIGHTS");

  const tile = r => h('div', { width: 259 * S, height: TILE_H * S, boxSizing: 'border-box', alignItems: 'center', gap: 8 * S, backgroundColor: C.panel, borderRadius: 14 * S, padding: `0 ${10 * S}px` },
    avatar(m, r.player, 34, null, 14),
    h('div', { flexDirection: 'column', flexGrow: 1, width: 0, overflow: 'hidden' },
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 14 * S, color: C.bright, whiteSpace: 'nowrap' }, r.player),
      h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 12.5 * S, color: col(r.net) }, usd(r.net))),
    img(svgUri(sparkSvg(r.form)), 78 * S, 26 * S));
  const tiles = h('div', { flexWrap: 'wrap', gap: 6 * S }, m.rows.map(tile));

  const legend = h('div', { height: LEGEND_H * S, flexWrap: 'wrap', alignContent: 'flex-start', columnGap: 12 * S, rowGap: 4 * S },
    m.race.series.map(s => h('div', { alignItems: 'center', gap: 5 * S, height: 18 * S, fontFamily: 'Nunito', fontWeight: 700, fontSize: 12 * S, color: C.soft },
      swatch(s.color), s.name, h('div', { fontFamily: 'Mono', fontWeight: 600, color: C.text }, usd(s.values[s.values.length - 1])))));
  // quarter leaders as bars: top 5, medal colours for the podium three, zero line so losses hang below
  const MEDAL = [
    { top: '#ffe08a', bot: '#d9a72e', ink: '#4a3400' },
    { top: '#e6e3f7', bot: '#a9a4c8', ink: '#2e2a4a' },
    { top: '#f0b48a', bot: '#b46a3c', ink: '#3d1f0c' },
    { top: '#a08cf0', bot: '#6e52c8', ink: '#ffffff' },
    { top: '#a08cf0', bot: '#6e52c8', ink: '#ffffff' },
  ];
  const lead = m.standings.rows.slice(0, 5);
  const PW = PANEL_W - 4, TOPPAD = 22, BOTPAD = 22, PLOT = BARS_H - TOPPAD - BOTPAD;
  const hi = Math.max(0, ...lead.map(r => r.net)), lo = Math.min(0, ...lead.map(r => r.net));
  const k = PLOT / Math.max(1, hi - lo), zeroY = TOPPAD + hi * k, slot = PW / lead.length, bw = Math.min(64, slot - 24);
  const bars = h('div', { position: 'relative', width: PW * S, height: BARS_H * S },
    lead.flatMap((r, i) => {
      const md = MEDAL[i], x = i * slot + (slot - bw) / 2, hgt = Math.max(3, Math.abs(r.net) * k), y = r.net >= 0 ? zeroY - hgt : zeroY;
      const round = r.net >= 0 ? `${8 * S}px ${8 * S}px 0 0` : `0 0 ${8 * S}px ${8 * S}px`;
      return [
        h('div', { position: 'absolute', left: x * S, top: y * S, width: bw * S, height: hgt * S, borderRadius: round,
          backgroundImage: r.net >= 0 ? `linear-gradient(180deg, ${md.top}, ${md.bot})` : `linear-gradient(0deg, ${md.top}, ${md.bot})`,
          boxSizing: 'border-box' }),
        h('div', { position: 'absolute', left: (i * slot) * S, width: slot * S, top: (r.net >= 0 ? y - 19 : y + hgt + 3) * S, height: 16 * S, justifyContent: 'center',
          fontFamily: 'Mono', fontWeight: 600, fontSize: (i ? 12 : 13) * S, color: col(r.net) }, usd(r.net)),
      ];
    }),
    h('div', { position: 'absolute', left: 0, top: (zeroY - 1) * S, width: PW * S, height: 2 * S, backgroundColor: C.axis }));
  const names = h('div', { width: PW * S, height: NAMES_H * S },
    lead.map((r, i) => h('div', { width: slot * S, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
      avatar(m, r.name, 30, { w: 2, c: MEDAL[i].top }, 12),
      h('div', { marginTop: 3 * S, maxWidth: (slot - 4) * S, overflow: 'hidden', whiteSpace: 'nowrap', fontFamily: 'Nunito', fontWeight: 900, fontSize: 13 * S, color: i ? C.bright : C.gold }, r.name))));
  const race = panel(m.podiumTitle, `top ${lead.length} so far`, h('div', { flexDirection: 'column' }, bars, names));

  const mvEl = mv => h('div', { width: 30 * S, justifyContent: 'flex-end', alignItems: 'center', fontFamily: 'Mono', fontWeight: 600, fontSize: 10.5 * S,
      color: mv === 'new' ? C.gold : mv > 0 ? C.up : mv < 0 ? C.down : '#6d6895' },
    mv === '' ? null : mv === 'new' ? 'new' : mv === 0 ? '–' : [img(tri(mv > 0, mv > 0 ? C.up : C.down), 8 * S, 6.4 * S, { marginRight: 2 * S }), String(Math.abs(mv))]);
  const qItem = r => h('div', { height: Q_ROW * S, boxSizing: 'border-box', alignItems: 'center', gap: 6 * S, padding: `0 ${6 * S}px`, borderRadius: 8 * S,
      backgroundColor: r.rank === 1 ? 'rgba(241,199,91,0.16)' : 'rgba(0,0,0,0)' },
    h('div', { width: 18 * S, fontFamily: 'Mono', fontWeight: 600, fontSize: 11 * S, color: C.muted }, String(r.rank)),
    avatar(m, r.name, 18, null, 8),
    h('div', { flexGrow: 1, width: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontFamily: 'Nunito', fontWeight: 800, fontSize: 13 * S, color: r.rank === 1 ? C.gold : C.bright }, r.name),
    mvEl(r.mv),
    h('div', { width: 76 * S, justifyContent: 'flex-end', fontFamily: 'Mono', fontWeight: 600, fontSize: 12 * S, color: col(r.net) }, usd(r.net)));
  const qa = m.standings.rows.slice(0, L.qRows), qb = m.standings.rows.slice(L.qRows);
  const standings = panel(m.standings.title, m.standings.note,
    h('div', { gap: 14 * S },
      h('div', { flexDirection: 'column', width: 241 * S }, qa.map(qItem)),
      h('div', { flexDirection: 'column', width: 241 * S }, qb.map(qItem))));

  const st = m.stories;
  const KIND = { name: { color: C.bright, fontWeight: 900 }, up: { color: C.up, fontFamily: 'Mono', fontWeight: 600 }, down: { color: C.down, fontFamily: 'Mono', fontWeight: 600 }, gold: { color: C.gold, fontWeight: 900 } };
  const story = (parts, i, icon, iconCol) => h('div', { alignItems: 'flex-start', gap: 10 * S, marginTop: i ? 4 * S : 0 },
    h('div', { width: 20 * S, height: STORY_LINE * S, alignItems: 'center', justifyContent: 'center' }, img(svgUri(iconSvg(icon, iconCol, 24)), 14 * S, 14 * S)),
    h('div', { flexWrap: 'wrap', width: 440 * S, fontFamily: 'Nunito', fontWeight: 700, fontSize: 13.5 * S, lineHeight: `${STORY_LINE * S}px`, color: C.soft },
      words(parts).map(w => h('div', { marginLeft: w.space ? 3.8 * S : 0, ...(KIND[w.kind] || {}) }, w.t))));
  const sec = t => h('div', { height: SEC_H * S, alignItems: 'center', fontFamily: 'Nunito', fontWeight: 800, fontSize: 11 * S, letterSpacing: 0.9 * S, color: C.muted, marginBottom: 4 * S }, t);
  const storiesPanel = panel("Tonight's storylines", '', h('div', { flexDirection: 'column' }, st.night.map((p, i) => story(p, i, 'spark', C.gold))));

  const AW = { flame: '#ff9d6b', chair: '#a9b4f6', target: C.up, chips: C.cash, gift: C.down };
  const award = a => h('div', { width: 241 * S, height: AWARD_H * S, boxSizing: 'border-box', alignItems: 'center', gap: 10 * S, padding: `0 ${10 * S}px`, borderRadius: 12 * S, backgroundColor: 'rgba(255,255,255,0.04)' },
    h('div', { width: 34 * S, height: 34 * S, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
      img(svgUri(iconSvg(a.icon, AW[a.icon], 24)), 20 * S, 20 * S)),
    h('div', { flexDirection: 'column', flexGrow: 1, width: 0, overflow: 'hidden' },
      h('div', { fontFamily: 'Nunito', fontWeight: 800, fontSize: 10.5 * S, letterSpacing: 0.9 * S, color: C.gold }, a.title.toUpperCase()),
      h('div', { alignItems: 'center', gap: 5 * S, fontFamily: 'Nunito', fontWeight: 900, fontSize: 14 * S, color: C.bright, whiteSpace: 'nowrap' },
        m.pics[a.who] ? avatar(m, a.who, 16, null, 7) : null, a.who),
      h('div', { fontFamily: 'Mono', fontWeight: 600, fontSize: 11 * S, color: C.soft, whiteSpace: 'nowrap' }, a.what)));
  const awardsPanel = panel(st.quarterTitle, st.awardsNote,
    h('div', { flexDirection: 'column' }, st.quarter.map((p, i) => story(p, i, 'spark', '#a9b4f6'))),
    h('div', { height: 4 * S }),
    sec(st.awardsLabel),
    h('div', { flexWrap: 'wrap', rowGap: 6 * S, columnGap: 14 * S }, st.awards.map(award)));

  return h('div', { width: L.width, height: L.height, boxSizing: 'border-box', flexDirection: 'column', gap: 14 * S, padding: 18 * S, borderRadius: 22 * S, color: C.text,
      backgroundColor: C.night, backgroundImage: 'radial-gradient(circle at 0% 0%, rgba(110,82,200,0.35), rgba(21,19,42,0) 60%)' },
    top, win, label, tiles, storiesPanel, race, standings, awardsPanel);
}

export async function render(csv, night, type, membersCsv = '', getPic = avatarPng) {
  loadAssets();
  const nights = toNights(csv);
  const n = pickNight(nights, night, type);
  if (!n) return null;
  const base = model(nights, n);
  const m = { ...base, stories: stories(nights, n), podiumTitle: base.raceTitle.replace('Race for ', '') + ' leaders' };
  // pfps for everyone on the card (tonight's players, the quarter standings and award winners), fetched in parallel; misses keep initials
  const ids = memberIds(membersCsv);
  const want = [...new Set([...m.rows.map(r => r.player), ...m.standings.rows.map(r => r.name), ...m.stories.awards.map(a => a.who)])].filter(p => ids[p]);
  m.pics = Object.fromEntries((await Promise.all(want.map(async p => {
    try { const png = await getPic(ids[p]); return png ? [p, 'data:image/png;base64,' + Buffer.from(png).toString('base64')] : null; } catch (e) { return null; }
  }))).filter(Boolean));
  const L = layout(m);
  const svg = await satori(card(m, L), { width: L.width, height: L.height, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
}

async function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = []; for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const night = url.searchParams.get('night') || '', type = url.searchParams.get('type') || '';
    if (night && !/^\d{4}-\d{2}-\d{2}$/.test(night)) { res.status(400).send('night must look like 2026-11-06'); return; }
    let csv, members = null;
    if (req.method === 'POST') {
      const body = await readBody(req);
      // the entry page sends JSON { input, members }; a plain CSV body (older entry page) still works
      if (body.trim().startsWith('{')) { const j = JSON.parse(body); csv = j.input; members = j.members ?? null; }
      else csv = body;
    } else {
      const r = await fetch(SHEET_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('sheet returned ' + r.status);
      csv = await r.text();
    }
    if (members == null) {
      try { const r = await fetch(MEMBERS_URL, { cache: 'no-store' }); members = r.ok ? await r.text() : ''; } catch (e) { members = ''; }
    }
    if (!csv || csv.length > 2_000_000) { res.status(400).send('missing or oversized CSV'); return; }
    const png = await render(csv, night, type, members);
    if (!png) { res.status(404).send('No night found for ' + (night || 'latest')); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', req.method === 'POST' ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).send(png);
  } catch (e) {
    res.status(500).send('Could not draw the recap: ' + e.message);
  }
}
