
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
