// Sign-in badge (Nov 25 2026, Renato's pick B "seat plate"): top right of every page. Signed out = one small Discord SIGN IN tag;
// signed in = you as you sit at the poker table (pfp in your border, dark plate with your overall bar washing in, name + chips,
// sticker on the plate corner, title as a slanted tab underneath). Hover it (tap on a phone) for a card: chips + stack rank,
// this quarter on the sheet, cosmetics owned, links. Phones show just face + chips; name and title move into the card.
// Load: <script type="module" src="/badge.js"></script>. The badge lives in the SITE BAR this script also draws (Nov 25 2026,
// Renato's pick B + "1 Menus"): one slim bar across the top of every page = logo + THE STUDY (home), three menus Stats / Casino /
// Cards (click the name for the group's main page; hover, or tap the caret, for the rest), badge on the right. Phones: the menus fold into a caret next to THE STUDY (no bottom
// tab bar on any page, Renato's call Nov 25 2026). Pages keep only their own big title.
// Cost: signed out = no call at all (the readable cas_in cookie says nobody signed in; a browser without it asks /api/me once a
// week, for sessions made before the marker existed). Signed in = GET /api/me, kept 2 minutes in localStorage so clicking
// around the site doesn't ask again. Pages that know a fresher balance call window.SB.bal(n).
const KEY = 'sb:me', TTL = 120e3, CHECK = 7 * 864e5;
const PAGES = { '/': 'home', '/index': 'home', '/recap': 'recap', '/hall': 'hall', '/h2h': 'h2h', '/shop': 'shop', '/poker': 'poker', '/live': 'live', '/collection': 'collection', '/casino': 'casino' };
const DC = '<svg viewBox="0 0 71 55" aria-hidden="true"><path fill="currentColor" d="M60 4.9A58.5 58.5 0 0 0 45.6.4a40 40 0 0 0-1.9 3.8 54 54 0 0 0-16.2 0A40 40 0 0 0 25.6.4 58.4 58.4 0 0 0 11.1 4.9C1.9 18.7-.6 32.2.6 45.5a58.8 58.8 0 0 0 18 9.1 43 43 0 0 0 3.8-6.2 38 38 0 0 1-6-2.9l1.5-1.1a42 42 0 0 0 36 0l1.5 1.1a38 38 0 0 1-6 2.9 43 43 0 0 0 3.8 6.2 58.6 58.6 0 0 0 18-9.1c1.5-15.4-2.5-28.8-10.5-40.6zM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2 6.5 3.3 6.4 7.2c0 4-2.8 7.2-6.4 7.2zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2 6.5 3.3 6.4 7.2c0 4-2.8 7.2-6.4 7.2z"/></svg>';
const ERR = { stranger: "Only club members can sign in. Ask in Discord to get added.", cancelled: 'Sign-in cancelled.', expired: 'That sign-in took too long. Try again.', discord: "Discord didn't answer. Try again.", setup: "Sign-in isn't set up yet." };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n < 0 ? '−$' : '$') + Math.abs(+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const hasMarker = () => /(?:^|;\s*)cas_in=1/.test(document.cookie);
const page = () => PAGES[location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/'] || 'home';
const css = href => { if (!document.querySelector(`link[href$="${href}"]`)) document.head.insertAdjacentHTML('beforeend', `<link rel="stylesheet" href="${href}">`); };

css('/badge.css');
let host = null, ME = null, mods = null;
// the site's pages, in the three menus. here() = the one you're on
export const MENU = [
  ['Stats', [['/', 'Dashboard'], ['/recap', 'Recap'], ['/hall', 'Hall of Fame'], ['/h2h', 'Head to head']]],
  ['Casino', [['/casino', 'Lobby'], ['/poker', 'Poker room'], ['/live', 'Live tables']]],
  ['Cards', [['/shop', 'Shop & loadout'], ['/collection', 'Collection']]],
];
const here = () => location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1') || '/';
const CARET = '<svg class="sbn-c" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const list = pages => pages.map(([href, name]) => `<a href="${href}"${href === here() ? ' class="on" aria-current="page"' : ''}>${esc(name)}</a>`).join('');
const groupOn = pages => pages.some(([href]) => href === here());
function mount() {
  document.querySelectorAll('#sb').forEach(el => el.remove()); // old badge spots from before the bar
  const bar = document.createElement('header');
  bar.className = 'sbar'; bar.setAttribute('role', 'banner');
  bar.innerHTML = `<a class="sbar-mk" href="/" aria-label="Poker Club @ The Study, dashboard"><i aria-hidden="true"></i><b>THE STUDY</b></a>
    <button type="button" class="sbar-all" aria-label="Pages" aria-expanded="false">${CARET}</button>
    <nav class="sbar-nav" aria-label="Pages">${MENU.map(([g, pages]) => `<div class="sbn${groupOn(pages) ? ' cur' : ''}"><span class="sbn-h"><a href="${pages[0][0]}">${g}</a><button type="button" aria-label="${g} pages" aria-expanded="false">${CARET}</button></span><div class="sbn-m">${list(pages)}</div></div>`).join('')}</nav>
    <div class="sb" id="sb"></div>
    <div class="sbar-sheet" hidden>${MENU.map(([g, pages]) => `<div class="sbs-g"><a class="sbs-h" href="${pages[0][0]}">${g}</a>${list(pages)}</div>`).join('')}</div>`;
  document.body.prepend(bar);
  const sp = document.createElement('div'); sp.className = 'sbar-sp'; bar.after(sp); // keeps the page clear of the bar
  document.documentElement.classList.add('has-sbar');
  host = bar.querySelector('#sb');
  // menus: the name is a link to the group's main page (Stats = dashboard, Casino = lobby, Cards = shop & loadout; Renato, Nov 26
  // 2026). Hover opens the list on a mouse (CSS); the caret next to the name toggles it on a tap/click, one at a time
  bar.querySelectorAll('.sbn-h > button').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); const g = b.closest('.sbn'), o = !g.classList.contains('open');
    closeMenus(); g.classList.toggle('open', o); b.setAttribute('aria-expanded', o); }));
  const all = bar.querySelector('.sbar-all'), sheet = bar.querySelector('.sbar-sheet');
  all.addEventListener('click', e => { e.stopPropagation(); const o = sheet.hidden; closeMenus(); sheet.hidden = !o; all.setAttribute('aria-expanded', o); });
}
function closeMenus() {
  document.querySelectorAll('.sbn.open').forEach(g => { g.classList.remove('open'); const b = g.querySelector('.sbn-h > button'); b && b.setAttribute('aria-expanded', 'false'); });
  const sh = document.querySelector('.sbar-sheet'); if (sh) sh.hidden = true;
  const all = document.querySelector('.sbar-all'); if (all) all.setAttribute('aria-expanded', 'false');
}

function signedOut(msg) {
  ME = null;
  host.classList.remove('sb-me');
  host.innerHTML = `<a class="sb-out" href="/api/login?to=${page()}" title="Sign in with Discord">${DC}<span>SIGN IN</span></a>${msg ? `<div class="sb-msg" role="status">${esc(msg)}</div>` : ''}`;
}

function plate(m, L, bits) {
  const b = bits(L, m.eq || {}), t = L.itemFor((m.eq || {})['Title']);
  const pfp = s => `<img class="sb-pf" src="/api/avatar?id=${esc(m.id)}" alt="" width="${s}" height="${s}" onerror="this.onerror=null;this.src='/icon-192.png'">`;
  const tt = t ? { name: t.name, col: L.TCOL[t.tier] } : null, q = m.q;
  const wash = cls => b.bar ? ` pl-wash${cls ? ' ' + cls : ''}"><span class="pl-bg ${b.bar}" aria-hidden="true"></span` : `${cls ? ' ' + cls : ''}"`;
  const qLine = !q ? '' : q.nights ? `<div><span>${esc(q.label.toUpperCase())}</span><strong class="${q.net >= 0 ? 'u' : 'd'}">${q.net > 0 ? '+' : ''}${money(q.net)}</strong><em>${q.nights} night${q.nights > 1 ? 's' : ''} · ${ord(q.place)} of ${q.players}</em></div>`
    : `<div><span>${esc(q.label.toUpperCase())}</span><strong class="n">—</strong><em>no nights yet</em></div>`;
  return `<button type="button" class="sb-in" aria-haspopup="true" aria-expanded="false" title="${esc(m.name)}">
      ${b.face(pfp(38), 38)}
      <span class="sb-np"><span class="sb-name${wash('')}><b>${esc(m.name)}</b><span class="sb-bal">${money(m.bal)}</span></span>${b.sticker ? `<span class="sb-stk">${b.sticker}</span>` : ''}${tt ? `<span class="sb-ttl" style="--tc:${tt.col}">${esc(tt.name)}</span>` : ''}</span>
    </button>
    <div class="sb-card" role="menu">
      <div class="sbc-hd${wash('')}>${b.face(pfp(56), 56, true)}<div class="sbc-nm"><b>${esc(m.name)}</b>${tt ? `<span class="sbc-tt" style="--tc:${tt.col}">${esc(tt.name)}</span>` : '<span class="sbc-tt no">No title on</span>'}</div></div>
      <div class="sbc-st">
        <div><span>CHIPS</span><strong class="g sb-bal2">${money(m.bal)}</strong><em>${m.rank ? `#${m.rank} of ${m.of} stacks` : 'casino chips'}</em></div>
        ${qLine || `<div><span>PACKS</span><strong>${m.packs || 0}</strong><em>opened</em></div>`}
        <div class="w"><span>COSMETICS</span><strong>${m.own} <small>/ ${m.all}</small></strong><em>${m.champs ? `+ ${m.champs} champion border${m.champs > 1 ? 's' : ''} · ` : ''}${m.packs || 0} pack${m.packs === 1 ? '' : 's'} opened</em></div>
      </div>
      <div class="sbc-ln"><a class="pri" href="/shop#lo">My loadout</a><a href="/collection">Collection</a>${m.player ? `<a href="/#player-${encodeURIComponent(m.player)}">My card</a>` : ''}<button type="button" class="out">Sign out</button></div>
    </div>`;
}

async function draw(m) {
  ME = m;
  window.dispatchEvent(new CustomEvent('sb:me', { detail: m })); // the casino lobby shows your cosmetics count from this, no extra call
  css('/cosmetics.css'); css('/plates.css');
  mods ||= Promise.all([import('/loot.js'), import('/plates.js')]);
  let L, P; try { [L, P] = await mods; } catch (e) { return; }
  if (ME !== m) return;
  host.classList.add('sb-me');
  host.innerHTML = plate(m, L, P.bits);
  const btn = host.querySelector('.sb-in');
  btn.addEventListener('click', e => {
    e.stopPropagation(); closeMenus(); const o = host.classList.toggle('open'); btn.setAttribute('aria-expanded', o);
    // phones: the card spans the screen just under the badge, wherever the page put it
    const card = host.querySelector('.sb-card');
    card.style.top = o && matchMedia('(max-width: 640px)').matches ? Math.round(btn.getBoundingClientRect().bottom + 8) + 'px' : '';
  });
  host.querySelector('.out').addEventListener('click', async () => {
    ls.del(KEY); document.cookie = 'cas_in=; Path=/; Max-Age=0; Secure; SameSite=Lax';
    await fetch('/api/casino', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'logout' }), credentials: 'same-origin' }).catch(() => {});
    location.reload();
  });
}
document.addEventListener('click', e => { if (host && !host.contains(e.target)) host.classList.remove('open'); if (!e.target.closest('.sbn-m, .sbar-sheet')) closeMenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { host && host.classList.remove('open'); closeMenus(); } });

async function ask() {
  ls.set('sb:chk', Date.now());
  const j = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!j) return undefined; // couldn't reach it: keep whatever is showing
  if (j.me) ls.set(KEY, { t: Date.now(), m: j.me }); else ls.del(KEY);
  return j.me;
}

/** pages that know a newer balance (casino, shop, poker, live) pass it here */
window.SB = { bal(n) {
  if (n == null || !ME || +n === +ME.bal) return;
  ME = { ...ME, bal: +n }; ls.set(KEY, { t: Date.now(), m: ME });
  host && host.querySelectorAll('.sb-bal, .sb-bal2').forEach(el => el.textContent = money(ME.bal));
} };

async function start() {
  mount();
  const err = new URLSearchParams(location.search).get('err');
  const msg = err && page() !== 'casino' && page() !== 'shop' ? ERR[err] || '' : ''; // casino and shop show their own
  if (!hasMarker()) {
    ls.del(KEY);
    const last = ls.get('sb:chk');
    if (last && Date.now() - last < CHECK) return signedOut(msg);
    signedOut(msg);
    const m = await ask();
    if (m) draw(m);
    return;
  }
  const c = ls.get(KEY);
  if (c && c.m) draw(c.m); else host.innerHTML = '<span class="sb-wait" aria-hidden="true"></span>';
  if (!c || Date.now() - c.t > TTL) { const m = await ask(); if (m) draw(m); else if (m === null) signedOut(msg); else if (!c) signedOut(msg); }
}
document.body ? start() : document.addEventListener('DOMContentLoaded', start);
