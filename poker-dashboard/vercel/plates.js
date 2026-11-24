// "Nameplates" (Nov 2026): players' equipped Study Cards on the site's lists, not just the player card.
// A list row gets the player's overall bar as a soft wash, their pfp wears their border, the title sits under the name and the
// sticker rides on the plate. Used by the dashboard (standings + top 3 podium), /h2h (the two slots) and /casino (chip leaders).
// Looks are in plates.css (+ cosmetics.css for the borders, bars and stickers). Players with nothing equipped stay plain.
// Smooth sticker outlines: a white die-cut edge drawn by an SVG filter (grow the shape, soften the edge) instead of stacked
// CSS drop-shadows, which leave a lumpy, octagon-ish outline. The filter goes on a <g> INSIDE each sticker's own svg (Safari
// ignores CSS filter:url() on page elements), sized per sticker so the edge stays 1.1-1.6px whatever size the sticker shows at.
// cosmetics.css drops the old drop-shadow outline when html has .stk-smooth.
if (typeof document !== 'undefined' && !document.getElementById('stkdefs')) {
  const NS = 'http://www.w3.org/2000/svg';
  // the shared <defs> holder (put back if a page ever rebuilds its whole body)
  const defs = () => document.querySelector('#stkdefs defs') || (document.body.insertAdjacentHTML('afterbegin', '<svg id="stkdefs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs></defs></svg>'), document.querySelector('#stkdefs defs'));
  const filt = (k, r) => { // k = svg user units per css px, r = outline width in css px (both rounded)
    const id = ('stkline' + k + 'w' + r).replace(/\./g, '_');
    if (!document.getElementById(id)) {
      defs().insertAdjacentHTML('beforeend', `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="${(r * k).toFixed(2)}" result="d"/><feGaussianBlur in="d" stdDeviation="${(.35 * k).toFixed(2)}" result="b"/><feComponentTransfer in="b" result="m"><feFuncA type="linear" slope="3"/></feComponentTransfer><feFlood flood-color="#fff"/><feComposite in2="m" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`); }
    return id;
  };
  const ro = new ResizeObserver(es => { for (const e of es) {
    const s = e.target, w = e.contentRect.width, vb = s.viewBox && s.viewBox.baseVal;
    if (!w || !s.__g) continue;
    const k = Math.max(.1, Math.round(((vb && vb.width) || w) / w * 10) / 10);
    // thinner edge on small stickers (1.1px at ~30px, 1.6px from ~45px up) so it doesn't swallow small details
    const r = Math.round(Math.min(1.6, Math.max(1.1, w / 28)) * 10) / 10;
    s.__g.setAttribute('filter', `url(#${filt(k, r)})`);
  } });
  // give each copy of a sticker its own gradient/pattern ids: the same sticker often sits twice on a page (plate + pfp corner,
  // one of them hidden), and url(#id) points at the first copy, so a hidden first copy left the visible one unpainted
  let seq = 0;
  const uniq = s => {
    const ids = [...s.querySelectorAll('[id]')].map(e => e.id);
    if (!ids.length) return;
    const n = '-k' + (++seq), re = new RegExp('#(' + ids.map(i => i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\w-])', 'g');
    for (const e of s.querySelectorAll('*')) {
      if (e.id) e.id += n;
      for (const a of [...e.attributes]) if (a.name !== 'id' && a.value.includes('#')) e.setAttribute(a.name, a.value.replace(re, '#$1' + n));
      if (e.tagName.toLowerCase() === 'style') e.textContent = e.textContent.replace(re, '#$1' + n);
    }
  };
  const wrap = root => root.querySelectorAll && root.querySelectorAll('.cos-stk svg').forEach(s => {
    if (s.__g) return;
    uniq(s);
    // outer <g> = outline, inner <g> = the sticker's tilt (drawn as vectors, so the outline isn't rotated as a picture and stays crisp)
    const g = document.createElementNS(NS, 'g'), t = document.createElementNS(NS, 'g'), vb = s.viewBox && s.viewBox.baseVal;
    if (vb && vb.width) t.setAttribute('transform', `rotate(-10 ${vb.x + vb.width / 2} ${vb.y + vb.height / 2})`);
    while (s.firstChild) t.appendChild(s.firstChild);
    g.appendChild(t); s.appendChild(g); s.__g = g; ro.observe(s);
  });
  const add = () => {
    defs();
    document.documentElement.classList.add('stk-smooth');
    wrap(document);
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) n.matches && n.matches('.cos-stk svg') ? wrap(n.parentNode) : wrap(n); })
      .observe(document.body, { childList: true, subtree: true });
  };
  document.body ? add() : document.addEventListener('DOMContentLoaded', add);
}
let P = null;
/** loot.js + everyone's equipped items, fetched once per page: { L, byName, byId, me } (empty when /api/shop can't be reached; me = the signed-in person or null) */
export function loadouts() {
  return P ||= Promise.all([
    import('/loot.js'),
    fetch('/api/shop', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([L, j]) => ({ L, byName: (j && j.byName) || {}, byId: (j && j.byId) || {}, me: (j && j.me && j.me.id) ? { id: j.me.id, name: j.me.name } : null })).catch(() => ({ L: null, byName: {}, byId: {}, me: null }));
}
const jitter = eq => { const h = [...Object.values(eq).join('|')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `--rx:${h % 15}px;--ry:${(h >> 4) % 7 - 3}px;--rt:${(h >> 8) % 17 - 8}deg`; };
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
    // sticker next to the name, slapped on: each loadout gets its own small nudge and tilt (same every visit)
    sticker: svg ? `<span class="pl-stk" style="${jitter(eq)}" aria-hidden="true"><span class="cos-stk">${svg}</span></span>` : '',
    // the pfp in its border; the border art is drawn around a 64px pfp, so it's zoomed down to `size`.
    // corner: also slap the sticker on the pfp's bottom right corner (podium, h2h) instead of on the plate
    face: (pfp, size, corner) => `<span class="plf" style="--s:${size}px">${b
      ? `<span class="cbw cb-${b.key}${b.year ? ' cb-champ-y' : ''}" style="zoom:${(size / 64).toFixed(3)}">${pfp}${L.decoFor(b)}</span>`
      : pfp}${corner && svg ? `<span class="pl-cstk" aria-hidden="true"><span class="cos-stk">${svg}</span></span>` : ''}</span>`,
  };
}
