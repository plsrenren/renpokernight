// Shared table kit: one set of sounds, cards, chips and deal motion for every table on the site
// (poker room, casino tables, live tables). Pages import what they need; the look lives in table-kit.css.
//
//   <script src="/table-kit.js"></script> before the page's own script, then const K = window.TK;
//   K.card('AH', 'lg')            -> card HTML (four-color deck), K.card(null) = face down
//   K.chips(135)                  -> chip stack HTML ($1 white, $5 red, $25 green, $100 black, $500 purple)
//   K.deal(el, fromEl, {delay, flip}) -> slide a card in from the shoe / dealer spot, turning it over if flip
//   K.SND.card() / flip() / chips(n) / check() / fold() / turn() / win() / lose() / push()
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
};
/** every sound checks the shared mute first, so pages just call K.SND.x() */
const SND = Object.fromEntries(Object.entries(RAW).map(([k, f]) => [k, (...a) => { if (ready()) f(...a); }]));

window.TK = { chipColor, card, reveal, chips, deal, flipTo, soundOn, toggleSound, sndButton, SND };
})();
