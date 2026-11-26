// Shared table kit: one set of sounds, cards, chips and deal motion for every table on the site
// (poker room, casino tables, live tables). Pages import what they need; the look lives in table-kit.css.
//
//   <script src="/table-kit.js"></script> before the page's own script, then const K = window.TK;
//   K.card('AH', 'lg')            -> card HTML (four-color deck), K.card(null) = face down
//   K.chips(135)                  -> chip stack HTML ($1 white, $5 red, $25 green, $100 black, $500 purple)
//   K.deal(el, fromEl, {delay, flip}) -> slide a card in from the shoe / dealer spot, turning it over if flip
//   K.SND.card() / flip() / chips(n) / check() / fold() / turn() / win() / lose() / push() / jackpot() / jpOther() / tick()
//   K.sndButton() + K.toggleSound() -> the one speaker button; the setting is shared by every table (localStorage tk:snd)
//
// Sounds are made with Web Audio on the fly (no files). Browsers only allow sound after the first tap on the page.

(() => {
// ---------- cards ----------
const SUIT = { H: '♥', D: '♦', C: '♣', S: '♠' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** code like 'AH', 'TD' (T = ten); null = face down. size: '' (44px) | 'sm' | 'md' | 'lg' (74px) */
function card(code, size = '', extra = '') {
  const cls = `tk-cd ${size} ${extra}`.trim();
  if (!code) return `<div class="${cls} back"><i>♠</i></div>`;
  const r = code[0] === 'T' ? '10' : code[0], s = code[1].toUpperCase();
  return `<div class="${cls} face su-${s.toLowerCase()}" data-c="${esc(code)}">${r}<i>${SUIT[s]}</i></div>`;
}
/** turns a face-down card element into the given card (used when the dealer's hole card turns over) */
function reveal(el, code) {
  const r = code[0] === 'T' ? '10' : code[0], s = code[1].toUpperCase();
  el.classList.remove('back'); el.classList.add('face', 'su-' + s.toLowerCase()); el.innerHTML = `${r}<i>${SUIT[s]}</i>`; el.dataset.c = code;
}

// ---------- chips ----------
const DEN = [[500, 'k500'], [100, 'k100'], [25, 'k25'], [5, 'k5'], [1, 'k1']];
const COLOR = { k500: '#8f78f0', k100: '#22202f', k25: '#2e9e5b', k5: '#d93a4a', k1: '#f2f2f2' };
/** the color of a chip worth v (the biggest chip that fits: $20 is red like $5, $50 green like $25); 0 = an empty grey chip */
function chipColor(v) { const d = DEN.find(([x]) => v >= x); return d ? COLOR[d[1]] : '#3a3560'; }
/** an amount as tight casino-color stacks, biggest chips on the left (max 5 stacks, 8 chips high) */
function chips(amount) {
  let left = Math.floor(amount); const stacks = [];
  for (const [v, k] of DEN) { const n = Math.floor(left / v); if (n) { stacks.push([k, Math.min(n, 8)]); left -= n * v; } }
  return `<span class="tk-stks">${stacks.slice(0, 5).map(([k, n]) => `<span class="tk-stk" style="height:${8 + (n - 1) * 3}px">${Array.from({ length: n }, (_, i) => `<i class="${k}" style="bottom:${i * 3}px"></i>`).join('')}</span>`).join('')}</span>`;
}

// ---------- deal motion: every table deals the same way ----------
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** slides a card element in from fromEl (the shoe or dealer spot). flip: it travels face down and turns over when it lands */
function deal(el, fromEl, { delay = 0, flip = true, dur = 380 } = {}) {
  if (REDUCED || !el.animate) return Promise.resolve();
  const a = el.getBoundingClientRect(), b = fromEl ? fromEl.getBoundingClientRect() : { left: a.left, top: a.top - 120, width: a.width, height: a.height };
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const face = flip && el.classList.contains('face');
  el.style.opacity = '0';
  return new Promise(res => setTimeout(() => {
    el.style.opacity = '';
    if (face) el.classList.add('tk-flipping');
    const slide = el.animate([{ transform: `translate(${dx}px,${dy}px) rotate(-14deg) scale(.8)` }, { transform: 'none' }], { duration: dur, easing: 'cubic-bezier(.2,.8,.3,1)' });
    if (!face) { slide.onfinish = res; return; }
    // the face is hidden by a back overlay until the card lands, then it turns over
    const back = document.createElement('b'); back.className = 'tk-backcover'; el.appendChild(back);
    slide.onfinish = () => {
      const turn = el.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)', offset: .5 }, { transform: 'scaleX(1)' }], { duration: 260, easing: 'ease-in-out' });
      setTimeout(() => back.remove(), 130);
      turn.onfinish = () => { el.classList.remove('tk-flipping'); res(); };
      SND.flip();
    };
  }, delay));
}
/** turns a card over where it sits (the dealer's hole card) */
function flipTo(el, code) {
  if (REDUCED || !el.animate) { reveal(el, code); return Promise.resolve(); }
  return new Promise(res => {
    const turn = el.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)', offset: .5 }, { transform: 'scaleX(1)' }], { duration: 300, easing: 'ease-in-out' });
    setTimeout(() => reveal(el, code), 150); SND.flip(); turn.onfinish = res;
  });
}
if (typeof document !== 'undefined' && !document.getElementById('tk-css2')) {
  const st = document.createElement('style'); st.id = 'tk-css2';
  st.textContent = '.tk-backcover{position:absolute;inset:-1px;background:var(--tk-back);border:calc(var(--cw)*.07) solid var(--tk-cardbg);pointer-events:none}';
  document.head.appendChild(st);
}

// ---------- sounds ----------
// one setting for every table; the poker room's old pk:snd and the casino's cas.snd are read once so nobody's choice is lost
let sndOn = true;
try { const v = localStorage.getItem('tk:snd'); sndOn = v !== null ? v !== 'off' : localStorage.getItem('pk:snd') !== 'off'; } catch (e) {}
const soundOn = () => sndOn;
function toggleSound() { sndOn = !sndOn; try { localStorage.setItem('tk:snd', sndOn ? 'on' : 'off'); } catch (e) {} if (sndOn) audio(); return sndOn; }
const sndButton = () => `<button class="tk-snd${sndOn ? ' on' : ''}" data-tksnd title="${sndOn ? 'Sound on: tap to mute' : 'Sound off: tap to turn on'}" aria-label="${sndOn ? 'Mute sounds' : 'Turn sounds on'}">${sndOn ? '&#128266;' : '&#128263;'}</button>`;

let actx = null;
function audio() { if (!actx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; actx = new A(); } if (actx.state === 'suspended') actx.resume().catch(() => {}); return actx; }
if (typeof addEventListener === 'function') ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => { if (sndOn) audio(); }, { passive: true }));
// the audio context is only made on a tap (browsers block it before one), so sounds before the first tap are just skipped
const ready = () => { if (!sndOn || !actx) return false; if (actx.state === 'suspended') actx.resume().catch(() => {}); return actx.state === 'running'; };
function tone(f, at, dur, { type = 'sine', vol = .18, to = 0 } = {}) {
  const c = actx, o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + .008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + .02);
}
function noise(at, dur, { vol = .2, hp = 1500, lp = 9000, bp = 0, q = 1, curve = 3 } = {}) {
  const c = actx, n = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / n, curve);
  const src = c.createBufferSource(), g = c.createGain(), t0 = c.currentTime + at; src.buffer = buf; g.gain.value = vol;
  let node = src;
  if (bp) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = bp; b.Q.value = q; node.connect(b); node = b; }
  else { const h = c.createBiquadFilter(), l = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; l.type = 'lowpass'; l.frequency.value = lp; node.connect(h); h.connect(l); node = l; }
  node.connect(g).connect(c.destination); src.start(t0);
}
const jit = (x, j) => x + (Math.random() - .5) * j;
const RAW = {
  card: (at = 0) => noise(at, .07, { vol: .32, hp: 2200 }),
  flip: (at = 0) => { noise(at, .05, { vol: .28, hp: 1800 }); tone(900, at + .01, .05, { type: 'triangle', vol: .05 }); },
  // "clay clack" (Renato's pick, Nov 23): n chips knocking together, slightly out of time
  chips: (at = 0, n = 2) => { for (let k = 0; k < n; k++) { const d = at + k * jit(.055, .03); noise(d, .025, { vol: .55, bp: jit(3300, 500), q: 6, curve: 4 }); noise(d, .05, { vol: .18, bp: jit(5200, 600), q: 14, curve: 2 }); tone(jit(2400, 300), d, .045, { vol: .04 }); } },
  check: (at = 0) => { tone(180, at, .09, { type: 'sine', vol: .3, to: 90 }); tone(180, at + .12, .08, { type: 'sine', vol: .22, to: 90 }); },  // knock (poker check, blackjack stand)
  fold: (at = 0) => noise(at, .22, { vol: .16, hp: 600, lp: 3000 }),
  turn: (at = 0) => { tone(660, at, .16, { vol: .14 }); tone(990, at + .14, .26, { vol: .14 }); },                                       // your turn
  win: (at = 0) => { [523, 659, 784, 1047].forEach((f, k) => tone(f, at + k * .09, .3, { type: 'triangle', vol: .12 })); RAW.chips(at + .4, 8); },
  pot: (at = 0) => RAW.chips(at, 10),                                                                                                   // someone else wins
  lose: (at = 0) => { tone(392, at, .18, { type: 'triangle', vol: .09 }); tone(294, at + .15, .3, { type: 'triangle', vol: .09 }); },      // bust / dealer wins
  push: (at = 0) => { tone(587, at, .22, { type: 'triangle', vol: .08 }); tone(587, at + .2, .22, { type: 'triangle', vol: .06 }); },     // tie: bet comes back
  // casino jackpot (Nov 26 2026): your win = a bell run up, a held chord, then a long chip pour; someone else's = a short bell + a pot of chips
  jackpot: (at = 0) => {
    [784, 988, 1175, 1568, 1976, 2349].forEach((f, k) => tone(f, at + k * .07, .5, { type: 'triangle', vol: .1 }));
    [523, 659, 784, 1047].forEach(f => tone(f, at + .48, 1.5, { type: 'sine', vol: .055 }));
    for (let k = 0; k < 6; k++) RAW.chips(at + .55 + k * .2, 5);
  },
  jpOther: (at = 0) => { [1175, 1568, 1976].forEach((f, k) => tone(f, at + k * .08, .35, { type: 'triangle', vol: .07 })); RAW.chips(at + .3, 8); },
  tick: (at = 0) => tone(2000 + (Math.random() - .5) * 300, at, .03, { type: 'square', vol: .018 }),                                   // a number counting up
};
/** every sound checks the shared mute first, so pages just call K.SND.x() */
const SND = Object.fromEntries(Object.entries(RAW).map(([k, f]) => [k, (...a) => { if (ready()) f(...a); }]));

// ---------- casino jackpot (Nov 26 2026, Renato's picks: "Gold Card" for the winner + a banner for everyone else) ----------
// Mockup: https://claude.ai/artifact/B4DAA1nAaMCZ3ER4aoJvof. Used by /casino and /live; the look is in table-kit.css (.tk-jp*).
const usd = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CROWN = c => `<svg viewBox="0 0 48 36" aria-hidden="true"><path d="M4 30 L2 8 L14 18 L24 2 L34 18 L46 8 L44 30 Z" fill="${c}"/><rect x="4" y="31" width="40" height="4" fill="${c}"/></svg>`;
const play = (k, alt) => (SND[k] || SND[alt] || (() => {}))();
let jpLayer = null;
/** takes the gold card off the table (next deal, leaving the table, a tap on the card) */
function jpClear() { if (jpLayer) { jpLayer.remove(); jpLayer = null; } }
if (typeof addEventListener === 'function') { addEventListener('hashchange', jpClear); addEventListener('resize', jpClear); }
function countUp(el, to, ms) {
  return new Promise(res => {
    if (REDUCED) { el.textContent = usd(to); return res(); }
    const t0 = performance.now(); let lt = 0;
    const f = t => { const p = Math.min(1, (t - t0) / ms); el.textContent = usd(to * (1 - Math.pow(1 - p, 3))); if (t - lt > 75 && p < 1) { SND.tick && SND.tick(); lt = t; } p < 1 ? requestAnimationFrame(f) : res(); };
    requestAnimationFrame(f);
  });
}
// chips popping out of a spot (x, y inside host), drawn on a canvas so dozens cost nothing
const POP = ['#f1c75b', '#ffe7a1', '#d93a4a', '#2e9e5b', '#22202f', '#8f78f0', '#f2f2f2'];
function chipBurst(host, x, y, n = 60, ms = 2000) {
  if (REDUCED) return;
  const cv = document.createElement('canvas'); cv.className = 'tk-jpburst'; host.appendChild(cv);
  const W = host.clientWidth, H = host.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const P = Array.from({ length: n }, () => ({ x, y, vx: (Math.random() - .5) * 10, vy: -Math.random() * 9 - 3, r: 5 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - .5) * .4, c: POP[Math.random() * POP.length | 0] }));
  const t0 = performance.now();
  const f = t => {
    const el = t - t0; g.clearRect(0, 0, W, H); g.globalAlpha = el > ms - 500 ? Math.max(0, (ms - el) / 500) : 1;
    for (const p of P) {
      p.vy += .28; p.x += p.vx; p.y += p.vy; p.a += p.va;
      g.save(); g.translate(p.x, p.y); g.scale(1, Math.max(.15, Math.abs(Math.cos(p.a))));
      g.beginPath(); g.arc(0, 0, p.r, 0, 6.283); g.fillStyle = p.c; g.fill();
      g.setLineDash([2.5, 2.5]); g.lineWidth = 1.6; g.strokeStyle = p.c === '#f2f2f2' ? '#3b6fd6' : 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(0, 0, p.r * .66, 0, 6.283); g.stroke();
      g.restore();
    }
    el < ms ? requestAnimationFrame(f) : cv.remove();
  };
  requestAnimationFrame(f);
}
/** chips flying from one element to another (your balance), fixed to the window so a redraw underneath can't stop them */
function flyChips(fromEl, toEl, n = 14) {
  if (REDUCED || !fromEl || !toEl || !document.body.animate) return Promise.resolve();
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!b.width && !b.height) return Promise.resolve();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2, bx = b.left + b.width / 2, by = b.top + b.height / 2, cls = ['kg', 'k100', 'k500', 'k25', 'k5', 'kg'];
  return Promise.all(Array.from({ length: n }, (_, i) => {
    const c = document.createElement('i'); c.className = 'tk-jpchip ' + cls[i % cls.length];
    c.style.left = (ax - 11) + 'px'; c.style.top = (ay - 11) + 'px'; document.body.appendChild(c);
    const jx = (Math.random() - .5) * 140, jy = -40 - Math.random() * 70;
    return c.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { transform: `translate(${jx}px,${jy}px) scale(1.1)`, opacity: 1, offset: .35 }, { transform: `translate(${bx - ax}px,${by - ay}px) scale(.5)`, opacity: .9 }],
      { duration: 650 + Math.random() * 250, delay: i * 50, easing: 'cubic-bezier(.5,0,.35,1)', fill: 'forwards' }).finished.then(() => { c.remove(); if (i % 3 === 0) SND.chips(0, 1); }, () => c.remove());
  }));
}
/** The winner's moment. felt = the table element. A gold card drops onto it, turns over and counts up to the pot, the rail glows,
 *  then the chips fly to toEl (your balance) and onPaid() runs (put the new balance on screen there). Stays until the next deal or a tap. */
async function jpCard(felt, { win, toEl, onPaid = () => {} }) {
  jpClear();
  if (!felt || !document.body.contains(felt)) { onPaid(); return; }
  const r = felt.getBoundingClientRect(), L = document.createElement('div');
  L.className = 'tk-jp'; L.style.cssText = `left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;border-radius:${getComputedStyle(felt).borderRadius}`;
  const face = `<div class="tk-jpf fc"><span class="ix t">J</span><span class="ix b">J</span>${CROWN('#d6a32f')}<span class="w">JACKPOT</span><span class="a">${usd(REDUCED ? win : 0)}</span><span class="g">mystery drop</span></div>`;
  L.innerHTML = `<div class="tk-jpc" role="img" aria-label="Jackpot ${usd(win)}" title="Tap to put it away">${REDUCED ? face : `<div class="tk-jpf bk">${CROWN('rgba(110,70,0,.75)')}</div>`}</div><span class="tk-jptag" hidden>Jackpot +${usd(win)}</span>`;
  document.body.appendChild(L); jpLayer = L;
  const c = L.firstElementChild, tag = L.querySelector('.tk-jptag'), mine = L;
  c.addEventListener('click', () => { if (jpLayer === mine) jpClear(); });
  if (REDUCED) { L.classList.add('on'); tag.hidden = false; play('jackpot', 'win'); onPaid(); return; }
  requestAnimationFrame(() => L.classList.add('on'));
  SND.flip();
  await c.animate([{ transform: 'translateY(-260px) rotate(-18deg) scale(1.3)', opacity: 0 }, { transform: 'translateY(8px) rotate(2deg) scale(1)', opacity: 1, offset: .7 }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.3,.8,.3,1)' }).finished.catch(() => {});
  await new Promise(res => setTimeout(res, 250));
  if (jpLayer !== mine) return onPaid();
  const turn = c.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0) scale(1.08)', offset: .5 }, { transform: 'scaleX(1) scale(1)' }], { duration: 420, easing: 'ease-in-out' });
  setTimeout(() => { c.innerHTML = face; }, 210); SND.flip();
  await turn.finished.catch(() => {});
  if (jpLayer !== mine) return onPaid();
  play('jackpot', 'win');
  const cr = c.getBoundingClientRect(), lr = L.getBoundingClientRect();
  chipBurst(L, cr.left - lr.left + cr.width / 2, cr.top - lr.top + cr.height / 3, 70, 2200);
  await countUp(c.querySelector('.a'), win, 1500);
  tag.hidden = false;
  await new Promise(res => setTimeout(res, 300));
  const fly = flyChips(c, toEl, 14);
  setTimeout(onPaid, 550);
  await fly;
}
/** "X hit the jackpot": a gold strip at the top of the window for 6 seconds. you = it was you (roulette, where the card can't show). */
function jpBanner({ name, win, game, you }) {
  const b = document.createElement('div'); b.className = 'tk-jpban'; b.setAttribute('role', 'status');
  const on = game ? ` on ${esc(game)}` : '';
  b.innerHTML = `${CROWN('#6d4c07')}<span>${you ? `You hit the jackpot · <b>${usd(win)}</b>${on}. It's in your chips.` : `${esc(name || 'Someone')} hit the jackpot · <b>${usd(win)}</b>${on}`}</span>`;
  document.body.appendChild(b);
  requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('show')));
  play('jpOther', 'pot');
  const bye = () => { b.classList.remove('show'); setTimeout(() => b.remove(), 500); };
  b.addEventListener('click', bye); setTimeout(bye, 6000);
}

window.TK = { chipColor, card, reveal, chips, deal, flipTo, soundOn, toggleSound, sndButton, SND, jpCard, jpClear, jpBanner, chipBurst, flyChips };
})();
