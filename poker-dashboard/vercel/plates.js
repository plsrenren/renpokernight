// "Nameplates" (Nov 2026): players' equipped Study Cards on the site's lists, not just the player card.
// A list row is painted in the player's overall bar, their pfp wears their border, the title sits under the name and the
// sticker rides on the plate. Used by the dashboard (standings + top 3 podium), /h2h (the two slots) and /casino (chip leaders).
// Looks are in plates.css (+ cosmetics.css for the borders, bars and stickers). Players with nothing equipped stay plain.
let P = null;
/** loot.js + everyone's equipped items, fetched once per page: { L, byName, byId } (empty when /api/shop can't be reached) */
export function loadouts() {
  return P ||= Promise.all([
    import('/loot.js'),
    fetch('/api/shop', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([L, j]) => ({ L, byName: (j && j.byName) || {}, byId: (j && j.byId) || {} })).catch(() => ({ L: null, byName: {}, byId: {} }));
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
