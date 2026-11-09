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
