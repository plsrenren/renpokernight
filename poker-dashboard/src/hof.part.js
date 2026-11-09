
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
