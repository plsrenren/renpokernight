// Shared recap logic for the /recap page (browser) and /api/recap (the Discord image).
// Turns the Input tab CSV into everything the "Cozy night" card shows. No dependencies.

export const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1YxoWSWgeTRrEiPlm1Ys85s4UsHKxSzpPHEssynXEytM/gviz/tq?tqx=out:csv&sheet=Input';
export const COLORS = {
  night: '#15132a', panel: '#221e3d', text: '#ece9fb', bright: '#f3f1ff', muted: '#9a94c4', soft: '#cfcaf0',
  axis: '#4a4570', grid: '#2f2a52', up: '#8ee0b0', down: '#f59bb0', gold: '#f1c75b', violet: '#6e52c8', maroon: '#a23b58',
  cash: '#8f78f0', tournament: '#bd8210',
  // validated categorical order for the race lines (dark surface #221e3d)
  series: ['#8f78f0', '#bd8210', '#e0507f', '#2f8fd6', '#279e68'],
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- parsing ----------
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const money = s => { const n = parseFloat(String(s).replace(/[$,\s]/g, '')); return isNaN(n) ? 0 : n; };
export const r2 = n => Math.round(n * 100) / 100;

/** Nights, newest first. Each night: { id, key, y, m, d, type, no, rows: [{ player, cin, cout, buys, net }] } */
export function toNights(text) {
  const [head, ...body] = parseCSV(String(text).trim());
  const ix = name => head.findIndex(h => h.trim() === name);
  const c = { date: ix('Event_Date'), type: ix('Game_Type'), player: ix('Player_Name'), cin: ix('Cash_In'), buys: ix('Buy_In'), cout: ix('Cash_Out') };
  const map = new Map();
  for (const r of body) {
    const ds = (r[c.date] || '').trim();
    if (!/^\d+\/\d+\/\d{4}$/.test(ds) || !(r[c.player] || '').trim()) continue;
    const [m, d, y] = ds.split('/').map(Number);
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const type = (r[c.type] || '').trim() || 'Cash';
    const id = key + '|' + type;
    if (!map.has(id)) map.set(id, { id, key, y, m, d, type, rows: [] });
    const cin = money(r[c.cin]), cout = money(r[c.cout]);
    map.get(id).rows.push({ player: r[c.player].trim(), cin, cout, buys: Number(r[c.buys]) || 0, net: r2(cout - cin) });
  }
  const nights = [...map.values()].sort((a, b) => a.id < b.id ? 1 : -1);
  const byYear = {};
  for (const n of nights) (byYear[n.y] ||= new Set()).add(n.key);
  for (const n of nights) n.no = [...byYear[n.y]].filter(k => k <= n.key).length;
  return nights;
}
export function pickNight(nights, key, type) {
  if (!key) return nights[0];
  return nights.find(x => x.key === key && (!type || x.type.toLowerCase() === String(type).toLowerCase()));
}

// ---------- formatting ----------
export const usd = (v, { sign = true, cents = true } = {}) => {
  const s = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return sign ? (v > 0 ? '+' : v < 0 ? '−' : '') + s : s;
};
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
export const hueFor = name => [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
export const initials = name => name.length <= 2 ? name.toUpperCase() : name[0].toUpperCase();
const shortDate = n => `${MONTHS[n.m - 1]} ${n.d}`;

// ---------- the card's data ----------
export function model(nights, n) {
  const chrono = [...nights].reverse();
  const upTo = chrono.filter(x => x.id <= n.id);
  const date = new Date(n.y, n.m - 1, n.d);
  const rows = [...n.rows].sort((a, b) => b.net - a.net || a.player.localeCompare(b.player));
  const top = rows[0];
  const pot = r2(rows.reduce((s, r) => s + r.cin, 0));
  const diff = r2(rows.reduce((s, r) => s + r.cout, 0) - pot);

  // winner note: their win count (top net of a night) so far
  const topOf = x => [...x.rows].sort((a, b) => b.net - a.net)[0].player;
  const played = upTo.filter(x => x.rows.some(r => r.player === top.player)).length;
  const wins = upTo.filter(x => topOf(x) === top.player).length;
  const winNote = played <= 1 ? 'Won their<br>first night' : wins === 1 ? `1st win<br>in ${played} nights` : `${ordinal(wins)} win<br>in ${played} nights`;

  // each player's last 6 nights (up to tonight)
  const form = Object.fromEntries(rows.map(r => [r.player,
    upTo.flatMap(x => x.rows.filter(o => o.player === r.player).map(o => o.net)).slice(-6)]));

  // the quarter race: running totals for the current top 5, from 0 before the quarter's first night
  const qOf = x => Math.floor((x.m - 1) / 3) + 1;
  const q = qOf(n);
  const qNights = upTo.filter(x => x.y === n.y && qOf(x) === q);
  const totals = {}; qNights.forEach(x => x.rows.forEach(r => totals[r.player] = r2((totals[r.player] || 0) + r.net)));
  const top5 = Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(e => e[0]);
  const race = {
    labels: ['Start', ...qNights.map(shortDate)],
    series: top5.map((p, i) => {
      let acc = 0;
      return { name: p, color: COLORS.series[i], values: [0, ...qNights.map(x => (acc = r2(acc + (x.rows.find(r => r.player === p)?.net || 0))))] };
    }),
  };

  // full quarter standings after tonight, with movement since the quarter's previous night
  const before = qNights.filter(x => x.id !== n.id);
  const rank = list => { const t = {}; list.forEach(x => x.rows.forEach(r => t[r.player] = r2((t[r.player] || 0) + r.net))); return Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  const prev = {}; rank(before).forEach(([p], i) => prev[p] = i + 1);
  const standings = {
    title: `Q${q} ${n.y} standings`, note: `after ${qNights.length} night${qNights.length === 1 ? '' : 's'}`,
    rows: rank(qNights).map(([p, v], i) => ({ rank: i + 1, name: p, net: v, mv: !before.length ? '' : prev[p] == null ? 'new' : prev[p] - (i + 1) })),
  };

  // every pot this year so far
  const yearNights = upTo.filter(x => x.y === n.y);
  const pots = yearNights.map(x => ({ id: x.id, label: shortDate(x), pot: r2(x.rows.reduce((s, r) => s + r.cin, 0)), type: x.type, tonight: x.id === n.id }));
  const sameType = pots.filter(p => p.type === n.type);
  const maxAll = Math.max(...pots.map(p => p.pot));
  const potNote = pot >= maxAll ? 'tonight: biggest pot of the year'
    : pot >= Math.max(...sameType.map(p => p.pot)) ? `tonight: biggest ${n.type.toLowerCase()} pot of the year` : 'tonight is highlighted';

  return {
    title: `${DAYS[date.getDay()]} Night @ The Study`,
    sub: `${shortDate(n)} · ${n.type === 'Tournament' ? 'Tournament' : 'Cash game'} · ${rows.length} players put ${usd(pot, { sign: false, cents: !Number.isInteger(pot) })} on the table`,
    off: Math.abs(diff) >= 0.01 ? `Books off by ${usd(Math.abs(diff), { sign: false })}` : '',
    winner: { name: top.player, net: top.net, note: winNote },
    rows: rows.map(r => ({ ...r, form: form[r.player], hue: hueFor(r.player) })),
    standings,
    race, raceTitle: `Race for Q${q}`, raceNote: `running total, top ${top5.length}`,
    pots, potTitle: `Pot size, every ${n.y} night`, potNote,
    fileKey: n.key,
  };
}

// ---------- charts: SVG with no text (so the image renderer needs no fonts); labels come back as positions ----------
export function sparkSvg(vals, w = 78, h = 26) {
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), rng = hi - lo || 1;
  const xs = vals.map((_, i) => vals.length === 1 ? w / 2 : 3 + i * (w - 6) / (vals.length - 1));
  const y = v => 3 + (hi - v) / rng * (h - 6);
  const last = vals[vals.length - 1];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
    + `<line x1="2" x2="${w - 2}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="${COLORS.axis}" stroke-width="1" stroke-dasharray="2 2"/>`
    + (vals.length > 1 ? `<polyline points="${xs.map((x, i) => `${x.toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ')}" fill="none" stroke="#c9c3f0" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` : '')
    + `<circle cx="${xs[xs.length - 1].toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.2" fill="${last > 0 ? COLORS.up : last < 0 ? COLORS.down : COLORS.soft}" stroke="${COLORS.panel}" stroke-width="1.5"/></svg>`;
}

const niceStep = span => { const raw = span / 2.5, p = 10 ** Math.floor(Math.log10(raw || 1)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || raw; };

export function raceChart(race, W = 496, H = 176) {
  const L = 48, R = 12, T = 10, B = 24;
  const all = race.series.flatMap(s => s.values);
  const step = niceStep(Math.max(1, Math.max(...all) - Math.min(0, ...all)));
  const lo = Math.min(0, Math.floor(Math.min(...all) / step) * step), hi = Math.max(step, Math.ceil(Math.max(...all) / step) * step);
  const nx = race.labels.length;
  const x = i => L + i * (W - L - R) / Math.max(1, nx - 1);
  const y = v => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  let svg = '', labels = [];
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${v === 0 ? COLORS.axis : COLORS.grid}" stroke-width="1"/>`;
    labels.push({ x: L - 8, y: y(v), text: usd(v, { sign: v < 0, cents: false }), anchor: 'end' });
  }
  race.labels.forEach((t, i) => labels.push({ x: x(i), y: H - 8, text: t, anchor: i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle' }));
  for (const s of [...race.series].reverse()) {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${COLORS.panel}" stroke-width="5" stroke-linejoin="round"/>`
      + `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
      + `<circle cx="${x(nx - 1).toFixed(1)}" cy="${y(s.values[nx - 1]).toFixed(1)}" r="4" fill="${s.color}" stroke="${COLORS.panel}" stroke-width="2"/>`;
  }
  return { w: W, h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${svg}</svg>`, labels };
}

export function potChart(pots, W = 496, H = 118) {
  const L = 48, R = 6, T = 18, B = 20;
  const step = niceStep(Math.max(...pots.map(p => p.pot)));
  const hi = Math.max(step, Math.ceil(Math.max(...pots.map(p => p.pot)) / step) * step);
  const n = pots.length, slot = (W - L - R) / n, bw = Math.max(2, slot - 3);
  const y = v => T + (hi - v) / hi * (H - T - B);
  const maxPot = Math.max(...pots.map(p => p.pot));
  let svg = '', labels = [];
  for (let v = 0; v <= hi + 1e-9; v += step) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${v === 0 ? COLORS.axis : COLORS.grid}" stroke-width="1"/>`;
    labels.push({ x: L - 8, y: y(v), text: usd(v, { sign: false, cents: false }), anchor: 'end' });
  }
  pots.forEach((p, i) => {
    const x0 = L + i * slot + 1.5, top = y(p.pot), base = y(0), r = Math.min(4, bw / 2, base - top);
    const col = p.type === 'Tournament' ? COLORS.tournament : COLORS.cash;
    svg += `<path d="M${x0.toFixed(1)},${base.toFixed(1)} V${(top + r).toFixed(1)} Q${x0.toFixed(1)},${top.toFixed(1)} ${(x0 + r).toFixed(1)},${top.toFixed(1)} H${(x0 + bw - r).toFixed(1)} Q${(x0 + bw).toFixed(1)},${top.toFixed(1)} ${(x0 + bw).toFixed(1)},${(top + r).toFixed(1)} V${base.toFixed(1)} Z" fill="${col}" fill-opacity="${p.tonight ? 1 : 0.55}"/>`;
    if (p.tonight || (p.pot === maxPot && !pots.some(o => o.tonight && o.pot === maxPot)))
      labels.push({ x: x0 + bw / 2, y: top - 9, text: usd(p.pot, { sign: false, cents: false }), anchor: 'middle', hot: p.tonight });
  });
  labels.push({ x: L, y: H - 6, text: pots[0].label, anchor: 'start' }, { x: W - R, y: H - 6, text: pots[n - 1].label, anchor: 'end' });
  return { w: W, h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${svg}</svg>`, labels };
}

export const CROWN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M3 8 L7.5 12 L12 5 L16.5 12 L21 8 L19 18 H5 Z" fill="#3a2a00"/><rect x="5" y="19" width="14" height="2" rx="1" fill="#3a2a00"/></svg>`;

// ---------- storylines + awards ----------
// Each storyline is a list of parts: plain strings, or { name } / { up } / { down } / { gold } for highlighted bits.
// "Random" is seeded by the night, so the page, the Discord card and any re-post of the same night all agree.
const seeded = str => { let a = [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pick = (cands, k, rnd) => {
  // shuffle, but a "big" story (weight 2) is more likely to make the cut than a filler (weight 0)
  // ...and spread across different players where possible
  const order = cands.map(c => ({ c, k: rnd() + (c.w ?? 1) * 0.35 })).sort((a, b) => b.k - a.k).map(x => x.c);
  const who = c => (c.parts.find(p => p && p.name) || {}).name, used = new Set(), out = [];
  for (const c of order) if (out.length < k && !(who(c) && used.has(who(c)))) { out.push(c); used.add(who(c)); }
  for (const c of order) if (out.length < k && !out.includes(c)) out.push(c);
  return out.map(c => c.parts);
};
const andList = a => a.length <= 2 ? a.join(' & ') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
const money0 = v => usd(v, { sign: false, cents: !Number.isInteger(v) });

export function stories(nights, n) {
  const chrono = [...nights].reverse();
  const upTo = chrono.filter(x => x.id <= n.id), before = upTo.filter(x => x.id !== n.id);
  const hist = p => before.flatMap(x => x.rows.filter(r => r.player === p).map(r => r.net)); // older nights, oldest first
  const rnd = seeded(n.id);
  const tonight = [...n.rows].sort((a, b) => b.net - a.net);
  const winner = tonight[0].player;
  const N = [];

  for (const r of tonight) {
    const h = hist(r.player), p = r.player;
    if (!h.length) continue;
    if (h.length >= 3 && r.net > 0 && r.net > Math.max(...h)) N.push({ w: 2, parts: [{ name: p }, "'s best night ever: ", { up: usd(r.net) }] });
    if (h.length >= 3 && r.net < 0 && r.net < Math.min(...h)) N.push({ w: 0.5, parts: ['Rough one for ', { name: p }, ': their biggest loss yet, ', { down: usd(r.net) }] });
    let up = 0; for (const v of [...h, r.net].reverse()) { if (v > 0) up++; else break; }
    if (up >= 3) N.push({ w: 2, parts: [{ name: p }, ' is up ', { gold: up + ' nights' }, ' in a row'] });
    let cold = 0; for (const v of [...h].reverse()) { if (v < 0) cold++; else break; }
    if (r.net > 0 && cold >= 3) N.push({ w: 2, parts: [{ name: p }, ' snapped a ', { gold: cold + '-night' }, ' cold streak'] });
    const nth = h.length + 1;
    if ([10, 25, 50, 75, 100, 150, 200].includes(nth)) N.push({ w: 1.5, parts: [{ name: p }, "'s ", { gold: ordinal(nth) }, ' night @ The Study'] });
    const life = h.reduce((s, v) => s + v, 0);
    if (life <= 0 && life + r.net > 0 && h.length >= 3) N.push({ w: 2, parts: [{ name: p }, ' is in the green all-time for the first time'] });
  }
  const fresh = tonight.filter(r => !hist(r.player).length).map(r => r.player);
  if (!before.length) N.push({ w: 9, parts: ['The very first night @ The Study'] });
  else if (fresh.length) N.push({ w: 2, parts: ['Welcome ', { name: andList(fresh) }, '! First night @ The Study'] });
  const roi = tonight.filter(r => r.cin > 0 && r.cout / r.cin >= 2).sort((a, b) => b.cout / b.cin - a.cout / a.cin)[0];
  if (roi) N.push({ w: 1, parts: [{ name: roi.player }, ' turned ', money0(roi.cin), ' into ', { up: money0(roi.cout) }, ` (${(roi.cout / roi.cin).toFixed(1)}x)`] });
  const reb = [...tonight].sort((a, b) => b.buys - a.buys)[0];
  if (reb.buys >= 3) N.push({ w: 1, parts: [{ name: reb.player }, ' bought in ', { gold: reb.buys + ' times' }, ...(reb.net > 0 ? [' and still finished ', { up: usd(reb.net) }] : [])] });
  const beat = tonight.map(r => { const h = hist(r.player); return { r, d: h.length >= 3 ? r.net - h.reduce((s, v) => s + v, 0) / h.length : -Infinity }; })
    .filter(x => x.r.player !== winner).sort((a, b) => b.d - a.d)[0];
  if (beat && beat.d >= 25) N.push({ w: 0.5, parts: [{ name: beat.r.player }, ' beat their usual result by ', { up: money0(Math.round(beat.d)) }] });
  if (tonight.length >= 3) N.push({ w: 0, parts: [{ up: money0(tonight[0].net - tonight[tonight.length - 1].net) }, ' between first and last tonight'] });

  // ----- the quarter -----
  const qOf = x => Math.floor((x.m - 1) / 3) + 1, q = qOf(n), Q = `Q${q}`;
  const qN = upTo.filter(x => x.y === n.y && qOf(x) === q), qB = qN.filter(x => x.id !== n.id);
  const tot = list => { const t = {}; list.forEach(x => x.rows.forEach(r => t[r.player] = r2((t[r.player] || 0) + r.net))); return t; };
  const rankOf = t => Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const now = rankOf(tot(qN)), was = rankOf(tot(qB)), nowT = tot(qN), wasT = tot(qB);
  const QS = [];
  if (now.length >= 2) {
    const tookLead = qB.length && was[0] && was[0][0] !== now[0][0];
    if (tookLead) QS.push({ w: 3, parts: [{ name: now[0][0] }, ` took the ${Q} lead from `, { name: was[0][0] }] });
    QS.push({ w: tookLead ? 0 : 1.5, parts: [...(tookLead ? ['Lead is '] : [{ name: now[0][0] }, ` leads ${Q} by `]), { up: money0(r2(now[0][1] - now[1][1])) }, ' over ', { name: now[1][0] }] });
  }
  if (qB.length) {
    const prev = Object.fromEntries(was.map(([p], i) => [p, i + 1]));
    const climb = now.map(([p], i) => ({ p, to: i + 1, by: prev[p] ? prev[p] - (i + 1) : 0 })).sort((a, b) => b.by - a.by)[0];
    if (climb && climb.by >= 2) QS.push({ w: 2, parts: [{ name: climb.p }, ' jumped ', { gold: climb.by + ' spots' }, ` to #${climb.to}`] });
  }
  let leader = null, changes = 0;
  qN.forEach((x, i) => { const l = rankOf(tot(qN.slice(0, i + 1)))[0][0]; if (leader && l !== leader) changes++; leader = l; });
  if (changes >= 2) QS.push({ w: 1, parts: ['The lead has changed hands ', { gold: changes + ' times' }, ` in ${Q}`] });
  if (now.length >= 3 && Math.abs(now[1][1] - now[2][1]) <= 25)
    QS.push({ w: 1, parts: ['Only ', { gold: money0(r2(Math.abs(now[1][1] - now[2][1]))) }, ' between #2 ', { name: now[1][0] }, ' and #3 ', { name: now[2][0] }] });
  const regulars = Object.keys(nowT).filter(p => qN.every(x => x.rows.some(r => r.player === p)));
  if (qN.length >= 3 && regulars.length && regulars.length <= 4) QS.push({ w: 1, parts: [{ name: andList(regulars) }, regulars.length === 1 ? " hasn't" : " haven't", ` missed a ${Q} night`] });
  const green = Object.keys(nowT).filter(p => (wasT[p] ?? 0) < 0 && nowT[p] > 0);
  if (qB.length && green.length) QS.push({ w: 1.5, parts: [{ name: andList(green) }, green.length === 1 ? ' is' : ' are', ` back in the green for ${Q}`] });
  const perfect = Object.keys(nowT).filter(p => { const v = qN.flatMap(x => x.rows.filter(r => r.player === p).map(r => r.net)); return v.length >= 3 && v.every(x => x > 0); });
  if (perfect.length) QS.push({ w: 2, parts: [{ name: andList(perfect) }, ` ${perfect.length === 1 ? 'has' : 'have'} won every ${Q} night they've played`] });

  // ----- awards, quarter so far -----
  const qRows = qN.flatMap(x => x.rows.map(r => ({ ...r, x })));
  const byP = {}; qRows.forEach(r => (byP[r.player] ||= []).push(r));
  const best = [...qRows].sort((a, b) => b.net - a.net)[0];
  const tieName = (list, val) => { const top = list.filter(e => e[1] === list[0][1]).map(e => e[0]); return top.length > 2 ? `${top.slice(0, 2).join(', ')} & ${top.length - 2} more` : andList(top); };
  const att = Object.entries(byP).map(([p, v]) => [p, v.length]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sharp = Object.entries(byP).filter(([, v]) => v.length >= 2 && v.filter(r => r.net > 0).length * 2 > v.length)
    .map(([p, v]) => [p, v.filter(r => r.net > 0).length / v.length, v.filter(r => r.net > 0).length, v.length])
    .sort((a, b) => b[1] - a[1] || b[3] - a[3] || a[0].localeCompare(b[0]));
  const reb2 = Object.entries(byP).map(([p, v]) => [p, v.reduce((s, r) => s + r.buys, 0)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const gen = Object.entries(nowT).sort((a, b) => a[1] - b[1])[0];
  const awards = [
    { icon: 'flame', title: 'Heater', who: best.player, what: `${usd(best.net)} on ${MONTHS[best.x.m - 1]} ${best.x.d}`, note: 'best single night' },
    { icon: 'chair', title: 'Iron Man', who: tieName(att), what: qN.length === 1 ? 'night 1' : att[0][1] === qN.length ? `all ${qN.length} nights` : `${att[0][1]} of ${qN.length} nights`, note: 'most nights played' },
    sharp.length && { icon: 'target', title: 'Sharpshooter', who: sharp[0][0], what: `up ${sharp[0][2]} of ${sharp[0][3]} nights`, note: 'best win rate (2+ nights)' },
    { icon: 'chips', title: 'Rebuy King', who: tieName(reb2), what: `${reb2[0][1]} buy-ins`, note: 'most buy-ins' },
    gen && gen[1] < 0 && { icon: 'gift', title: 'Most Generous', who: gen[0], what: `${usd(gen[1])} in ${Q}`, note: 'thanks for the chips' },
  ].filter(Boolean).slice(0, 4);

  return {
    night: pick(N, N.length >= 3 ? 3 : 2, rnd),
    quarter: pick(QS, QS.length >= 3 ? 3 : 2, rnd),
    awards, quarterTitle: `${Q} so far`, awardsNote: `${qN.length} night${qN.length === 1 ? '' : 's'} in`, awardsLabel: `${Q} AWARDS`,
  };
}

const ICONS = {
  flame: c => `<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3-1-3 0-6 1-9.5z" fill="${c}"/>`,
  chair: c => `<rect x="4" y="5" width="16" height="15" rx="3" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M4 10h16M9 3v4M15 3v4" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="15" r="2" fill="${c}"/>`,
  target: c => `<circle cx="12" cy="12" r="9" fill="none" stroke="${c}" stroke-width="2.2"/><circle cx="12" cy="12" r="5" fill="none" stroke="${c}" stroke-width="2.2"/><circle cx="12" cy="12" r="1.8" fill="${c}"/>`,
  chips: c => `<ellipse cx="12" cy="17" rx="8" ry="3" fill="${c}"/><ellipse cx="12" cy="12.5" rx="8" ry="3" fill="${c}" opacity=".75"/><ellipse cx="12" cy="8" rx="8" ry="3" fill="${c}" opacity=".5"/>`,
  gift: c => `<rect x="3.5" y="9" width="17" height="11" rx="2" fill="${c}"/><rect x="2.5" y="6.5" width="19" height="4" rx="1.5" fill="${c}" opacity=".7"/><path d="M12 6.5V20" stroke="#221e3d" stroke-width="2"/><path d="M12 6.5c-1.5-3-5-3.5-5-1.5S10 6.5 12 6.5c2 0 5 .5 5-1.5s-3.5-1.5-5 1.5z" fill="none" stroke="${c}" stroke-width="1.8"/>`,
  spark: c => `<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z" fill="${c}"/>`,
};
export const iconSvg = (name, color, size = 24) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${ICONS[name](color)}</svg>`;

/** Storyline parts as words, so a renderer can wrap them: [{ t, kind, space }] where space = a gap before the word. */
export function words(parts) {
  const out = []; let gap = false;
  for (const part of parts) {
    const kind = typeof part === 'string' ? '' : Object.keys(part)[0], text = typeof part === 'string' ? part : Object.values(part)[0];
    const toks = kind ? [text] : text.split(/(\s+)/);
    for (const t of toks) {
      if (!t) continue;
      if (/^\s+$/.test(t)) { gap = true; continue; }
      out.push({ t, kind, space: gap && out.length > 0 }); gap = false;
    }
  }
  return out;
}

// ---------- Members tab: Discord IDs for pfps ----------
export const MEMBERS_URL = SHEET_URL.replace('sheet=Input', 'sheet=Members');
/** { playerName: discordId } from the Members tab CSV. Name is column A; the ID column is any header containing "discord". */
export function memberIds(text) {
  const rows = parseCSV(String(text || '').trim());
  if (rows.length < 2) return {};
  const col = rows[0].findIndex(h => /discord/i.test(h));
  if (col < 0) return {};
  const out = {};
  for (const r of rows.slice(1)) {
    const name = (r[0] || '').trim(), id = String(r[col] || '').replace(/[^\d]/g, '');
    if (name && /^\d{17,20}$/.test(id)) out[name] = id;
  }
  return out;
}
export const avatarUrl = id => `/api/avatar?id=${id}`;

// ---------- Hall of Fame, worked out from the game results ----------
// Per quarter: overall champion (best total net), cash game champion (best net in cash games) and tournament
// champion (best net in tournaments), each with which title number it was for them in that category.
// Plus all-time record holders, every player's title count, and three all-time Top 5 boards.
export function hallOfFame(nights) {
  const chrono = [...nights].reverse();
  const qKey = n => `Q${Math.floor((n.m - 1) / 3) + 1} ${n.y}`;
  const isT = n => n.type === 'Tournament';
  const sum = (list, pick) => { const t = {}; list.forEach(n => n.rows.forEach(r => { if (pick(n)) t[r.player] = r2((t[r.player] || 0) + r.net); })); return t; };
  const top = t => Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  const order = [...new Set(chrono.map(qKey))];
  const latest = chrono.length ? qKey(chrono[chrono.length - 1]) : null;
  const counts = { overall: {}, cash: {}, tour: {} };
  const quarters = order.map(q => {
    const ns = chrono.filter(n => qKey(n) === q), out = { q, live: q === latest };
    for (const [k, pick] of [['overall', () => true], ['cash', n => !isT(n)], ['tour', isT]]) {
      const w = top(sum(ns, pick));
      if (!w || w[1] <= 0) { out[k] = null; continue; }
      counts[k][w[0]] = (counts[k][w[0]] || 0) + 1;
      out[k] = { name: w[0], net: w[1], nth: counts[k][w[0]] };
    }
    return out;
  });
  const allNet = sum(chrono, () => true), allCash = sum(chrono, n => !isT(n)), allTour = sum(chrono, isT);
  const top5 = t => Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, net]) => ({ name, net }));
  const shelf = {};
  for (const k of ['overall', 'cash', 'tour']) for (const [n, c] of Object.entries(counts[k])) { const s = shelf[n] ||= { name: n, overall: 0, cash: 0, tour: 0, total: 0 }; s[k] += c; s.total += c; }
  const rec = t => { const w = top(t); return w ? { name: w[0], net: w[1] } : null; };
  return {
    quarters: quarters.reverse(), // newest first
    records: { overall: rec(allNet), cash: rec(allCash), tour: rec(allTour) },
    shelf: Object.values(shelf).sort((a, b) => b.total - a.total || b.overall - a.overall || a.name.localeCompare(b.name)),
    boards: [
      { title: 'Overall P&L', when: 'All-time', rows: top5(allNet) },
      { title: 'Cash games', when: 'All-time', rows: top5(allCash) },
      { title: 'Tournaments', when: 'All-time', rows: top5(allTour) },
    ],
  };
}

// ---------- Player ratings card (same numbers as the dashboard card), for /api/card and the /player command ----------
export function gameRecords(text) {
  const [head, ...body] = parseCSV(String(text || '').trim());
  if (!head) return [];
  const ix = name => head.findIndex(h => h.trim() === name);
  const c = { date: ix('Event_Date'), type: ix('Game_Type'), player: ix('Player_Name'), cin: ix('Cash_In'), buys: ix('Buy_In'), cout: ix('Cash_Out'), win: ix('Win'), q: ix('Quarter') };
  return body.filter(r => /^\d+\/\d+\/\d{4}$/.test((r[c.date] || '').trim()) && (r[c.player] || '').trim()).map(r => {
    const [m, d, y] = r[c.date].trim().split('/').map(Number);
    const cin = money(r[c.cin]), cout = money(r[c.cout]);
    return { y, m, d, key: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, type: (r[c.type] || '').trim() || 'Cash',
      player: r[c.player].trim(), net: r2(cout - cin), cin, buys: parseInt(r[c.buys], 10) || 1,
      win: String(r[c.win]).toUpperCase() === 'TRUE', quarter: (r[c.q] || '').trim() || `Q${Math.floor((m - 1) / 3) + 1} ${y}` };
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
const qSort = (a, b) => { const [qa, ya] = a.split(' '), [qb, yb] = b.split(' '); return (yb - ya) || (qb.slice(1) - qa.slice(1)); };
export const latestQuarter = recs => [...new Set(recs.map(r => r.quarter))].sort(qSort)[0];
const inP = (r, p) => p === 'all' || (p[0] === 'Y' ? r.y === +p.slice(1) : r.quarter === p);

/** Finds a player by name, ignoring case and spaces. Returns { name } or { suggestions: [...] }. */
export function findPlayer(recs, query) {
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = [...new Set(recs.map(r => r.player))], q = norm(query);
  const hit = names.find(n => norm(n) === q) || (q && names.filter(n => norm(n).startsWith(q)).length === 1 && names.find(n => norm(n).startsWith(q)));
  if (hit) return { name: hit };
  const near = names.filter(n => q && (norm(n).includes(q) || q.includes(norm(n)))).slice(0, 5);
  return { name: null, suggestions: near };
}

function ratingsFor(scope) {
  const nights = new Set(scope.map(r => r.key)).size, per = {};
  scope.forEach(r => { const p = per[r.player] ||= { days: new Set(), n: 0, net: 0, up: 0, wins: 0, cn: 0, cnet: 0, tn: 0, tnet: 0 };
    p.days.add(r.key); p.n++; p.net += r.net; p.up += r.net > 0 ? 1 : 0; p.wins += r.win ? 1 : 0;
    if (r.type === 'Tournament') { p.tn++; p.tnet += r.net; } else { p.cn++; p.cnet += r.net; } });
  const min = Math.max(2, Math.ceil(nights * 0.25));
  const regs = Object.keys(per).filter(p => per[p].days.size >= min);
  const M = { PRO: p => p.net / p.n, CON: p => p.up / p.n, CLO: p => p.wins / p.n, CSH: p => p.cn ? p.cnet / p.cn : null, TRN: p => p.tn ? p.tnet / p.tn : null };
  const out = {};
  regs.forEach(p => out[p] = { ATT: Math.round(45 + 54 * per[p].days.size / nights) });
  for (const [k, f] of Object.entries(M)) {
    const vals = regs.map(p => [p, f(per[p])]).filter(v => v[1] !== null);
    const lo = Math.min(...vals.map(v => v[1])), hi = Math.max(...vals.map(v => v[1]));
    vals.forEach(([p, v]) => out[p][k] = Math.round(hi === lo ? 72 : 45 + 54 * (v - lo) / (hi - lo)));
  }
  regs.forEach(p => { const v = ['PRO', 'CON', 'CLO', 'ATT', 'CSH', 'TRN'].map(k => out[p][k]).filter(x => x != null); out[p].OVR = Math.round(v.reduce((a, b) => a + b, 0) / v.length); });
  return { ratings: out, order: regs.slice().sort((a, b) => out[b].OVR - out[a].OVR), min, nights };
}
function headToHead(name, scope) {
  const games = {}; scope.forEach(r => (games[r.key + '|' + r.type] ||= []).push(r));
  const h = {};
  Object.values(games).forEach(rows => { const me = rows.find(r => r.player === name); if (!me) return;
    rows.forEach(o => { if (o.player === name) return; const x = h[o.player] ||= { ahead: 0, n: 0 }; x.n++; if (me.net > o.net) x.ahead++; }); });
  const mine = scope.filter(r => r.player === name).length, need = Math.max(2, Math.ceil(mine / 2));
  const list = Object.entries(h).filter(([, x]) => x.n >= need).map(([p, x]) => ({ p, ...x, rate: x.ahead / x.n })).sort((a, b) => b.rate - a.rate || b.n - a.n);
  return list.length < 2 ? { best: list[0] || null, worst: null } : { best: list[0], worst: list[list.length - 1] };
}
function badgesFor(name, games, run, scope, allGames) {
  const per = {};
  scope.forEach(r => { const p = per[r.player] ||= { n: 0, net: 0, wins: 0, buys: 0 }; p.n++; p.net += r.net; p.wins += r.win ? 1 : 0; p.buys += r.buys; });
  const nights = new Set(scope.map(r => r.key)).size;
  const regs = Object.entries(per).filter(([, p]) => p.n >= Math.max(2, Math.ceil(nights * 0.4)));
  const leader = fn => regs.reduce((a, b) => fn(b[1]) > fn(a[1]) ? b : a, regs[0])?.[0];
  const out = [];
  if (allGames.length === 1) out.push('Rookie');
  if (leader(p => p.net) === name) out.push('Chip leader');
  if (leader(p => p.wins) === name) out.push('Most wins');
  if (leader(p => p.n) === name) out.push('Iron man');
  if (leader(p => p.buys / p.n) === name) out.push('Rebuy king');
  if (run >= 3) out.push('On a heater'); else if (run <= -3) out.push('Running cold');
  const tn = games.filter(r => r.type === 'Tournament').reduce((s, r) => s + r.net, 0);
  const cn = games.filter(r => r.type !== 'Tournament').reduce((s, r) => s + r.net, 0);
  if (tn > 0 && tn > cn) out.push('Tournament threat'); else if (cn > 0 && cn > tn) out.push('Cash game grinder');
  return out.slice(0, 3);
}

/** Everything the ratings card shows for one player in one period ("Q4 2026", "Y2026", or "all" only when asked for). */
export function playerCard(recs, name, period) {
  const p = period || latestQuarter(recs);
  const label = p === 'all' ? 'All time' : p[0] === 'Y' ? p.slice(1) + ' season' : p;
  const scope = recs.filter(r => inP(r, p)), allGames = recs.filter(r => r.player === name), games = allGames.filter(r => inP(r, p));
  const out = { name, period: p, label, nights: new Set(scope.map(r => r.key)).size, played: new Set(games.map(r => r.key)).size, empty: !games.length };
  if (!games.length) return out;
  const R = ratingsFor(scope), mine = R.ratings[name];
  const totals = {}; scope.forEach(r => totals[r.player] = (totals[r.player] || 0) + r.net);
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  let run = 0; games.forEach(r => { run = r.net > 0 ? Math.max(run, 0) + 1 : r.net < 0 ? Math.min(run, 0) - 1 : 0; });
  const split = t => { const g = games.filter(r => t === 'Tournament' ? r.type === 'Tournament' : r.type !== 'Tournament');
    return g.length ? { n: g.length, net: r2(g.reduce((s, r) => s + r.net, 0)) } : null; };
  const best = games.reduce((a, r) => r.net > a.net ? r : a);
  return { ...out,
    ovr: mine ? { value: mine.OVR, rank: R.order.indexOf(name) + 1, of: R.order.length } : null, needs: R.min,
    attrs: mine ? ['PRO', 'CON', 'CLO', 'ATT', 'CSH', 'TRN'].filter(k => mine[k] != null).map(k => ({ k, v: mine[k] })) : [],
    badges: badgesFor(name, games, run, scope, allGames),
    form: games.slice(-8).map(r => ({ net: r.net, date: `${MONTHS[r.m - 1]} ${r.d}` })),
    cash: split('Cash'), tour: split('Tournament'),
    best: best.net > 0 ? { net: best.net, date: `${MONTHS[best.m - 1]} ${best.d}, ${best.y}` } : null,
    h2h: headToHead(name, scope),
    net: r2(games.reduce((s, r) => s + r.net, 0)), wins: games.filter(r => r.win).length,
    rank: ranked.findIndex(([q]) => q === name) + 1, of: ranked.length };
}

/** Head to head between two players in a period: games both played, who finished ahead, totals, latest meetings. */
export function pairStats(recs, a, b, period) {
  const games = {};
  recs.filter(r => inP(r, period) && (r.player === a || r.player === b)).forEach(r => (games[r.key + '|' + r.type] ||= {})[r.player] = r);
  const both = Object.values(games).filter(g => g[a] && g[b]).sort((x, y) => x[a].key < y[a].key ? -1 : 1);
  let aw = 0, bw = 0, an = 0, bn = 0, aUp = 0, bUp = 0, best = null;
  both.forEach(g => { const x = g[a].net, y = g[b].net; if (x > y) aw++; else if (y > x) bw++; an += x; bn += y; aUp += x > 0; bUp += y > 0;
    const gap = Math.abs(x - y); if (!best || gap > best.gap) best = { gap, who: x > y ? a : b, date: `${MONTHS[g[a].m - 1]} ${g[a].d}, ${g[a].y}` }; });
  const label = period === 'all' ? 'All time' : period[0] === 'Y' ? period.slice(1) : period;
  return { a, b, period, label, n: both.length, aw, bw, ties: both.length - aw - bw, an: r2(an), bn: r2(bn), aUp, bUp, best,
    last: both.slice(-5).reverse().map(g => ({ date: `${MONTHS[g[a].m - 1]} ${g[a].d}`, tour: g[a].type === 'Tournament', x: g[a].net, y: g[b].net })),
    // every shared game in order, with running totals (for the race chart) and who finished ahead
    games: (() => { let ca = 0, cb = 0; return both.map(g => { ca += g[a].net; cb += g[b].net;
      return { date: `${MONTHS[g[a].m - 1]} ${g[a].d}`, tour: g[a].type === 'Tournament', x: g[a].net, y: g[b].net, ca: r2(ca), cb: r2(cb), win: g[a].net > g[b].net ? 'a' : g[b].net > g[a].net ? 'b' : '' }; }); })() };
}

// ---------- Quarter wrap (the /wrap card and the auto-post when a new quarter starts) ----------
const prevQuarter = q => { const [k, y] = q.split(' '); const n = +k.slice(1); return n === 1 ? `Q4 ${+y - 1}` : `Q${n - 1} ${y}`; };
/** The quarter /wrap shows by default: the last finished one (the latest quarter with games, unless it's still running). */
export function wrapDefault(recs, now = new Date()) {
  const latest = latestQuarter(recs), cur = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
  if (latest !== cur) return latest;
  const qs = [...new Set(recs.map(r => r.quarter))].sort(qSort);
  return qs[1] || latest;
}
export const quartersWithGames = recs => [...new Set(recs.map(r => r.quarter))].sort(qSort);

/** Everything the wrap card shows for one quarter ("Q3 2026"). */
export function wrapStats(recs, q) {
  const games = recs.filter(r => r.quarter === q);
  if (!games.length) return null;
  const date = r => `${MONTHS[r.m - 1]} ${r.d}`;
  const tot = (list) => { const t = {}; list.forEach(r => t[r.player] = r2((t[r.player] || 0) + r.net)); return t; };
  const ranked = Object.entries(tot(games)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, net]) => ({ name, net }));
  const best = games.reduce((a, r) => r.net > a.net ? r : a), worst = games.reduce((a, r) => r.net < a.net ? r : a);
  const nightsBy = {}; games.forEach(r => (nightsBy[r.player] ||= new Set()).add(r.key));
  const iron = Object.entries(nightsBy).map(([n, s]) => [n, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const winsBy = {}; games.filter(r => r.win).forEach(r => winsBy[r.player] = (winsBy[r.player] || 0) + 1);
  const wins = Object.entries(winsBy).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  const tour = Object.entries(tot(games.filter(r => r.type === 'Tournament'))).sort((a, b) => b[1] - a[1])[0] || null;
  // biggest turnaround: most improved net compared with the quarter before (played both)
  const pq = prevQuarter(q), before = tot(recs.filter(r => r.quarter === pq)), now = tot(games);
  const turn = Object.keys(now).filter(n => n in before).map(n => ({ name: n, from: before[n], to: now[n], gain: r2(now[n] - before[n]) }))
    .sort((a, b) => b.gain - a.gain)[0] || null;
  const allBest = recs.reduce((a, r) => r.net > a.net ? r : a);
  return {
    q, nights: new Set(games.map(r => r.key)).size, players: ranked.length, pot: r2(games.reduce((s, r) => s + (r.cin || 0), 0)),
    cashNights: new Set(games.filter(r => r.type !== 'Tournament').map(r => r.key)).size, tourNights: new Set(games.filter(r => r.type === 'Tournament').map(r => r.key)).size,
    podium: ranked.slice(0, 3),
    best: { name: best.player, net: best.net, date: date(best), record: best === allBest },
    worst: worst.net < 0 ? { name: worst.player, net: worst.net, date: date(worst) } : null,
    iron: { name: iron[0], n: iron[1] },
    wins: wins ? { name: wins[0], n: wins[1] } : null,
    tour: tour && tour[1] > 0 ? { name: tour[0], net: tour[1] } : null,
    turn: turn && turn.gain > 0 ? turn : null,
  };
}
