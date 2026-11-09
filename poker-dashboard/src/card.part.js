
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
