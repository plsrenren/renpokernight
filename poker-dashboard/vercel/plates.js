// "Nameplates" (Nov 2026): players' equipped Study Cards on the site's lists, not just the player card.
// A list row gets the player's overall bar as a soft wash, their pfp wears their border, the title sits under the name and the
// sticker rides on the plate. Used by the dashboard (standings + top 3 podium), /h2h (the two slots) and /casino (chip leaders).
// Looks are in plates.css (+ cosmetics.css for the borders, bars and stickers). Players with nothing equipped stay plain.
// Smooth sticker outlines: a white die-cut edge drawn by an SVG filter (grow the shape, soften the edge) instead of stacked
// CSS drop-shadows, which leave a lumpy, octagon-ish outline. The filter goes on a <g> INSIDE each sticker's own svg (Safari
// ignores CSS filter:url() on page elements), sized per sticker so the edge stays ~1.6px whatever size the sticker shows at.
// cosmetics.css drops the old drop-shadow outline when html has .stk-smooth.
if (typeof document !== 'undefined' && !document.getElementById('stkdefs')) {
  const NS = 'http://www.w3.org/2000/svg', made = new Set();
  let defs;
  const filt = k => { // k = svg user units per css px, rounded
    const id = 'stkline' + String(k).replace('.', '_');
    if (!made.has(id)) { made.add(id);
      defs.insertAdjacentHTML('beforeend', `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="${(1.6 * k).toFixed(2)}" result="d"/><feGaussianBlur in="d" stdDeviation="${(.35 * k).toFixed(2)}" result="b"/><feComponentTransfer in="b" result="m"><feFuncA type="linear" slope="3"/></feComponentTransfer><feFlood flood-color="#fff"/><feComposite in2="m" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`); }
    return id;
  };
  const ro = new ResizeObserver(es => { for (const e of es) {
    const s = e.target, w = e.contentRect.width, vb = s.viewBox && s.viewBox.baseVal;
    if (!w || !s.__g) continue;
    const k = Math.max(.1, Math.round(((vb && vb.width) || w) / w * 10) / 10);
    s.__g.setAttribute('filter', `url(#${filt(k)})`);
  } });
  const wrap = root => root.querySelectorAll && root.querySelectorAll('.cos-stk svg').forEach(s => {
    if (s.__g) return;
    const g = document.createElementNS(NS, 'g');
    while (s.firstChild) g.appendChild(s.firstChild);
    s.appendChild(g); s.__g = g; ro.observe(s);
  });
  const add = () => {
    document.body.insertAdjacentHTML('afterbegin', '<svg id="stkdefs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs></defs></svg>');
    defs = document.querySelector('#stkdefs defs');
    document.documentElement.classList.add('stk-smooth');
    wrap(document);
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) n.matches && n.matches('.cos-stk svg') ? wrap(n.parentNode) : wrap(n); })
      .observe(document.body, { childList: true, subtree: true });
  };
  document.body ? add() : document.addEventListener('DOMContentLoaded', add);
}
let P = null;
/** loot.js + everyone's equipped items, fetched once per page: { L, byName, byId } (empty when /api/shop can't be reached) */
export function loadouts() {
  return P ||= Promise.all([
    import('/loot.js'),
    fetch('/api/shop', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([L, j]) => demo(L, { L, byName: (j && j.byName) || {}, byId: (j && j.byId) || {} })).catch(() => ({ L: null, byName: {}, byId: {} }));
}
// PREVIEW ONLY: on a Vercel preview link (or with ?demo=1) every empty slot (title, border, bar, sticker) gets a random pack
// item, the same one every time for the same player, to see how full lists look. Real loadouts are kept.
// Never on renpokernight.vercel.app. Remove before merging.
function demo(L, lo) {
  const on = /-git-/.test(location.hostname) || new URLSearchParams(location.search).has('demo');
  if (!on || !L || location.hostname === 'renpokernight.vercel.app') return lo;
  const pool = s => L.ITEMS.filter(i => i.slot === s);
  const SL = ['Title', 'Pfp border', 'Overall bar', 'Sticker'].map(s => [s, pool(s)]);
  const h = k => [...String(k)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const fill = m => new Proxy(m, { get: (t, k) => { if (typeof k !== 'string') return t[k];
    const e = { ...(t[k] || {}) }; for (const [s, items] of SL) if (!e[s]) e[s] = items[h(k + s) % items.length].id; return e; } });
  return { ...lo, byName: fill(lo.byName), byId: fill(lo.byId) };
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** the pieces of one player's loadout for the page to place. eq = { 'Title': id, 'Pfp border': id, ... } */
export function bits(L, eq) {
  const none = { bar: '', title: '', sticker: '', any: false, face: (pfp, size) => `<span class="plf" style="--s:${size}px">${pfp}</span>` };
  if (!L || !eq) return none;
  const it = s => L.itemFor(eq[s]);
  const b = it('Pfp border'), o = it('Overall bar'), t = it('Title'), sk = it('Sticker'), svg = sk && L.STICKERS[sk.name];
  return {
    any: !!(b || o || t || svg),
    bar: o ? 'cbar-' + o.key : '',
    title: t ? `<span class="pl-ttl" style="--tc:${L.TCOL[t.tier]}">${esc(t.name)}</span>` : '',
    sticker: svg ? `<span class="pl-stk" aria-hidden="true"><span class="cos-stk">${svg}</span></span>` : '',
    // the pfp in its border; the border art is drawn around a 64px pfp, so it's zoomed down to `size`.
    // corner: also slap the sticker on the pfp's bottom right corner (podium, h2h) instead of on the plate
    face: (pfp, size, corner) => `<span class="plf" style="--s:${size}px">${b
      ? `<span class="cbw cb-${b.key}${b.year ? ' cb-champ-y' : ''}" style="zoom:${(size / 64).toFixed(3)}">${pfp}${L.decoFor(b)}</span>`
      : pfp}${corner && svg ? `<span class="pl-cstk" aria-hidden="true"><span class="cos-stk">${svg}</span></span>` : ''}</span>`,
  };
}
