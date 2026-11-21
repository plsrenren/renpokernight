// The poker room's game rules (no storage, no network): one no-limit Texas Hold'em table, 8 seats, play chips.
// Everything works on one plain table object T that _poker.js loads from Redis, changes here, and saves back.
// Time never "runs" on the server: a turn has a deadline and the next hand has a start time, and whichever client
// notices first asks the server to tick (see tick()). All functions take `now` (ms) so they are easy to test.
//
// Seat fields: id, name, stack, pend (top-up waiting for the next hand), buyins (all chips brought this sitting),
//   hand state: cards, bet (this street), total (this hand), folded, allIn, acted, last (label), show
//   flags: out (sitting out), timeouts (in a row), left (left mid-hand: already cashed out, removed after the hand)
import { randomInt } from 'node:crypto';

export const SEATS = 8;
export const STAKES = [[1, 2], [2, 5], [5, 10]];
export const MIN_BUYS = [20, 40, 100];
export const MAX_BUYS = [100, 200, 500, 1000];
export const TURNS = [15, 20, 30];
export const DEFAULT_CFG = { sb: 1, bb: 2, min: 40, max: 200, turn: 20 };
const LOG_KEEP = 40, SIT_OUT_AFTER = 2; // timeouts in a row before you're sat out

export const fresh = () => ({ v: 0, open: false, cfg: { ...DEFAULT_CFG }, seats: Array(SEATS).fill(null), hand: 0, hid: '', button: -1,
  board: [], deck: [], pot: 0, curBet: 0, minRaise: 2, toAct: -1, street: '', phase: 'idle', deadline: 0, nextAt: 0,
  pauseReq: false, closeReq: false, res: null, log: [], at: 0, emptyAt: 0 });

// ---------- cards ----------
const RANKS = '23456789TJQKA';
const rv = c => RANKS.indexOf(c[0]) + 2;
export const newDeck = () => { const d = []; for (const r of RANKS) for (const s of 'shdc') d.push(r + s);
  for (let k = d.length - 1; k > 0; k--) { const j = randomInt(k + 1); [d[k], d[j]] = [d[j], d[k]]; } return d; };
const PL = { 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' };
const RN = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rn = r => RN[r] || String(r);
const SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const cardText = c => rn(rv(c)) + SYM[c[1]];

function score5(cs) {
  const rs = cs.map(rv).sort((a, b) => b - a), fl = cs.every(c => c[1] === cs[0][1]);
  const cnt = {}; rs.forEach(r => cnt[r] = (cnt[r] || 0) + 1);
  const g = Object.entries(cnt).map(([r, n]) => [+r, n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const u = [...new Set(rs)]; let st = 0;
  if (u.length === 5) { if (u[0] - u[4] === 4) st = u[0]; else if (u.join() === '14,5,4,3,2') st = 5; }
  let cat, ks;
  if (st && fl) { cat = 8; ks = [st]; }
  else if (g[0][1] === 4) { cat = 7; ks = [g[0][0], g[1][0]]; }
  else if (g[0][1] === 3 && g[1][1] === 2) { cat = 6; ks = [g[0][0], g[1][0]]; }
  else if (fl) { cat = 5; ks = rs; }
  else if (st) { cat = 4; ks = [st]; }
  else if (g[0][1] === 3) { cat = 3; ks = g.map(x => x[0]); }
  else if (g[0][1] === 2 && g[1][1] === 2) { cat = 2; ks = g.map(x => x[0]); }
  else if (g[0][1] === 2) { cat = 1; ks = g.map(x => x[0]); }
  else { cat = 0; ks = rs; }
  let v = cat; for (let i = 0; i < 5; i++) v = v * 15 + (ks[i] || 0);
  return { v, cat, ks, cards: cs };
}
/** best 5 of 5 to 7 cards: { v (bigger wins), cat, ks, cards } */
export function best(cs) {
  let b = null; const n = cs.length;
  for (let a = 0; a < n; a++) for (let b1 = a + 1; b1 < n; b1++) for (let c = b1 + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
    const s = score5([cs[a], cs[b1], cs[c], cs[d], cs[e]]); if (!b || s.v > b.v) b = s;
  }
  return b;
}
export function describe(h) {
  const k = h.ks;
  return [`${rn(k[0])} high`, `Pair of ${PL[k[0]]}`, `Two pair, ${PL[k[0]]} and ${PL[k[1]]}`, `Three ${PL[k[0]]}`, `Straight, ${rn(k[0])} high`,
    `Flush, ${rn(k[0])} high`, `Full house, ${PL[k[0]]} full of ${PL[k[1]]}`, `Four ${PL[k[0]]}`, k[0] === 14 ? 'Royal flush' : `Straight flush, ${rn(k[0])} high`][h.cat];
}

// ---------- helpers ----------
const $ = n => '$' + Math.round(n).toLocaleString('en-US');
const inHand = s => s && s.cards.length > 0;
const canAct = s => inHand(s) && !s.folded && !s.allIn;
const alive = T => T.seats.filter(s => inHand(s) && !s.folded);
export const potTotal = T => T.pot + T.seats.reduce((a, s) => a + (s ? s.bet : 0), 0);
export const seatOf = (T, id) => T.seats.findIndex(s => s && !s.left && s.id === id);
function nextSeat(T, from, pred) { for (let k = 1; k <= SEATS; k++) { const j = (from + k + SEATS) % SEATS; if (pred(T.seats[j], j)) return j; } return -1; }
function log(T, text) { T.log.push(text); if (T.log.length > LOG_KEEP) T.log.splice(0, T.log.length - LOG_KEEP); }
function move(s, a) { a = Math.max(0, Math.min(a, s.stack)); s.stack -= a; s.bet += a; s.total += a; if (s.stack === 0) s.allIn = true; return a; }
const blank = () => ({ cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, last: '', show: false });
/** chips owed back to players after a change: [{ id, name, amt, net }] is pushed onto T._out (paid by _poker.js after saving) */
function cashOut(T, s, why) {
  const amt = Math.round((s.stack + (s.pend || 0)) * 100) / 100;
  (T._out ||= []).push({ id: s.id, name: s.name, amt, net: Math.round((amt - s.buyins) * 100) / 100 });
  log(T, `${s.name} ${why} with ${$(amt)}`);
  s.stack = 0; s.pend = 0;
  return amt;
}

// ---------- hands ----------
/** Starts the next hand if it can (or pauses / closes the room if the host asked). */
export function startHand(T, now) {
  T.seats = T.seats.map(s => s && s.left ? null : s);
  if (T.closeReq) return closeRoom(T, now);
  if (T.pauseReq) { T.pauseReq = false; T.phase = 'paused'; T.toAct = -1; T.res = null; T.board = []; T.seats.forEach(s => s && Object.assign(s, blank())); log(T, 'The host paused the game'); return; }
  T.seats.forEach(s => {
    if (!s) return;
    if (s.pend) { s.stack += s.pend; log(T, `${s.name} topped up ${$(s.pend)}`); s.pend = 0; }
    Object.assign(s, blank());
  });
  const ok = (s) => s && !s.out && s.stack > 0;
  const live = T.seats.filter(ok);
  T.res = null; T.board = []; T.pot = 0;
  if (live.length < 2) { T.phase = 'idle'; T.toAct = -1; T.nextAt = 0; return; }
  T.hand++; T.hid = Math.random().toString(36).slice(2, 10);
  T.deck = newDeck(); T.street = 'pre'; T.phase = 'hand';
  T.button = nextSeat(T, T.button, ok);
  const heads = live.length === 2;
  const sb = heads ? T.button : nextSeat(T, T.button, ok), bb = nextSeat(T, sb, ok);
  log(T, `Hand #${T.hand}`);
  for (let r = 0; r < 2; r++) for (let k = 0; k < SEATS; k++) { const s = T.seats[(sb + k) % SEATS]; if (ok(s)) s.cards.push(T.deck.pop()); }
  move(T.seats[sb], T.cfg.sb); T.seats[sb].last = 'SB';
  move(T.seats[bb], T.cfg.bb); T.seats[bb].last = 'BB';
  T.minRaise = T.cfg.bb;
  T.curBet = Math.max(T.cfg.bb, T.seats[sb].bet, T.seats[bb].bet);
  return nextTurn(T, bb, now);
}
/** finds who acts after seat i; ends the street if nobody needs to */
function nextTurn(T, i, now) {
  if (alive(T).length === 1) return winUncontested(T, now);
  const n = nextSeat(T, i, s => canAct(s) && (!s.acted || s.bet < T.curBet));
  if (n < 0 || (T.seats.filter(canAct).length === 1 && T.seats[n].bet >= T.curBet)) return endStreet(T, now);
  T.toAct = n; T.deadline = now + T.cfg.turn * 1000;
  if (T.seats[n].out) return act(T, n, T.seats[n].bet < T.curBet ? 'fold' : 'check', 0, now, true);
}
/** A player's move. kind = fold | check | call | raise (to = their total bet this street). Returns an error string or undefined. */
export function act(T, i, kind, to, now, auto = false) {
  if (T.phase !== 'hand' || T.toAct !== i) return "It's not your turn.";
  const s = T.seats[i], toCall = T.curBet - s.bet;
  if (kind === 'check' && toCall > 0) { if (!auto) return 'You need to call or fold.'; kind = 'fold'; }
  if (kind === 'raise') {
    to = Math.floor(+to);
    const maxTo = s.bet + s.stack, minTo = Math.min(maxTo, T.curBet === 0 ? T.cfg.bb : T.curBet + T.minRaise);
    if (!Number.isFinite(to)) return 'Pick an amount.';
    if (maxTo <= T.curBet) kind = 'call';
    else if (!T.seats.some((q, j) => j !== i && canAct(q))) kind = toCall > 0 ? 'call' : 'check';
    else if (to < minTo) return `The smallest raise is to ${$(minTo)}.`;
    else to = Math.min(to, maxTo);
  }
  if (kind === 'call' && toCall <= 0) kind = 'check';
  if (!['fold', 'check', 'call', 'raise'].includes(kind)) return 'Unknown move.';
  if (!auto) s.timeouts = 0;
  const tag = auto && !s.out ? ' (timed out)' : '';
  if (kind === 'fold') { s.folded = true; s.last = 'Fold'; log(T, `${s.name} folds${tag}`); }
  else if (kind === 'check') { s.last = 'Check'; log(T, `${s.name} checks${tag}`); }
  else if (kind === 'call') { const a = move(s, toCall); s.last = s.allIn ? 'All in' : `Call ${$(a)}`; log(T, `${s.name} calls ${$(a)}${s.allIn ? ' and is all in' : ''}`); }
  else {
    const by = to - T.curBet, wasBet = T.curBet === 0;
    move(s, to - s.bet);
    if (by >= T.minRaise) { T.minRaise = by; T.seats.forEach((q, j) => { if (j !== i && canAct(q)) q.acted = false; }); }
    else T.seats.forEach((q, j) => { if (j !== i && canAct(q) && q.bet < to) q.acted = false; }); // short all-in: only re-opens for people who still owe chips
    T.curBet = Math.max(T.curBet, to);
    s.last = s.allIn ? `All in ${$(to)}` : wasBet ? `Bet ${$(to)}` : `Raise ${$(to)}`;
    log(T, `${s.name} ${s.allIn ? 'is all in for' : wasBet ? 'bets' : 'raises to'} ${$(to)}`);
  }
  s.acted = true;
  if (auto && !s.out) { s.timeouts = (s.timeouts || 0) + 1; if (s.timeouts >= SIT_OUT_AFTER) { s.out = true; log(T, `${s.name} is sat out after ${SIT_OUT_AFTER} timeouts`); } }
  nextTurn(T, i, now);
}
function collect(T) { T.seats.forEach(s => { if (!s) return; T.pot += s.bet; s.bet = 0; s.acted = false; if (inHand(s) && !s.folded) s.last = s.allIn ? 'All in' : ''; }); T.curBet = 0; T.minRaise = T.cfg.bb; }
function deal(T) {
  T.deck.pop();
  if (T.street === 'pre') { T.board.push(T.deck.pop(), T.deck.pop(), T.deck.pop()); T.street = 'flop'; log(T, `Flop: ${T.board.map(cardText).join(' ')}`); }
  else { T.board.push(T.deck.pop()); T.street = T.street === 'flop' ? 'turn' : 'river'; log(T, `${T.street === 'turn' ? 'Turn' : 'River'}: ${cardText(T.board[T.board.length - 1])}`); }
}
function endStreet(T, now) {
  T.toAct = -1;
  collect(T);
  if (T.street === 'river') return showdown(T, now);
  deal(T);
  if (T.seats.filter(canAct).length <= 1) { // nobody left to bet: turn everyone's cards up and run the board out
    alive(T).forEach(s => s.show = true);
    while (T.street !== 'river') deal(T);
    T.runout = true;
    return showdown(T, now);
  }
  T.runout = false;
  return nextTurn(T, T.button, now);
}
function finish(T, now, ms) {
  T.phase = 'done'; T.toAct = -1; T.deck = [];
  T.nextAt = now + ms;
  T.seats.forEach(s => { if (s && !s.left && s.stack <= 0 && !s.pend) { s.out = true; } });
}
function winUncontested(T, now) {
  const w = alive(T)[0], amt = potTotal(T);
  T.seats.forEach(s => { if (s) s.bet = 0; }); T.pot = 0;
  w.stack += amt; w.last = 'Wins';
  T.res = { banner: `${w.name} takes ${$(amt)}`, sub: 'Everyone else folded', hl: [], win: [T.seats.indexOf(w)] };
  log(T, `${w.name} takes ${$(amt)}`);
  finish(T, now, 3500);
}
function showdown(T, now) {
  const live = alive(T);
  live.forEach(s => { s.show = true; s.best = best([...s.cards, ...T.board]); });
  const levels = [...new Set(live.map(s => s.total))].sort((a, b) => a - b);
  let prev = 0; const pots = [];
  const dist = s => (T.seats.indexOf(s) - T.button + SEATS) % SEATS;
  levels.forEach((L, li) => {
    let amt = 0; T.seats.forEach(s => { if (s) amt += Math.max(0, Math.min(s.total, L) - prev); });
    if (li === levels.length - 1) T.seats.forEach(s => { if (s && s.total > L) amt += s.total - L; });
    const elig = live.filter(s => s.total >= L), top = Math.max(...elig.map(s => s.best.v));
    const w = elig.filter(s => s.best.v === top).sort((a, b) => (dist(a) || SEATS) - (dist(b) || SEATS)); // odd chip: first left of the button
    const share = Math.floor(amt / w.length);
    w.forEach(s => s.stack += share); w[0].stack += amt - share * w.length;
    if (amt > 0) pots.push({ amt, w, refund: elig.length === 1 && levels.length > 1 && li === levels.length - 1 });
    prev = L;
  });
  T.pot = 0;
  const real = pots.filter(p => !p.refund), main = real[0] || pots[0];
  const winners = [...new Set(real.flatMap(p => p.w))];
  winners.forEach(s => s.last = 'Wins');
  const names = main.w.map(s => s.name).join(' & ');
  T.res = { banner: `${names} ${main.w.length > 1 ? 'split' : 'wins'} ${$(main.amt)}`, sub: describe(main.w[0].best), hl: main.w[0].best.cards, win: winners.map(s => T.seats.indexOf(s)) };
  live.forEach(s => log(T, `${s.name} shows ${s.cards.map(cardText).join(' ')} (${describe(s.best)})`));
  pots.forEach((p, k) => log(T, p.refund ? `${p.w[0].name} gets ${$(p.amt)} back (uncalled)`
    : `${p.w.map(s => s.name).join(' & ')} ${p.w.length > 1 ? 'split' : 'wins'} ${real.length > 1 ? (k === 0 ? 'the main pot' : 'a side pot') + ' of ' : ''}${$(p.amt)}`));
  live.forEach(s => delete s.best);
  finish(T, now, T.runout ? 8000 : 6000);
}

// ---------- the room ----------
/** Moves time forward: overdue turns time out, the next hand starts when it's due, an empty room closes after 30 min,
 *  a room nobody touched for 3 hours closes (everyone cashed out). Returns true if anything changed. */
export function tick(T, now) {
  if (!T.open) return false;
  const seated = T.seats.filter(s => s && !s.left).length;
  if (seated === 0 && T.phase !== 'hand') { if (!T.emptyAt) { T.emptyAt = now; return true; } if (now - T.emptyAt > 30 * 60e3) { closeRoom(T, now); return true; } }
  if (T.at && now - T.at > 3 * 3600e3) { closeRoom(T, now); return true; }
  if (T.phase === 'hand' && T.toAct >= 0 && now >= T.deadline) { const s = T.seats[T.toAct]; act(T, T.toAct, T.curBet > s.bet ? 'fold' : 'check', 0, now, true); return true; }
  if ((T.phase === 'done' || T.phase === 'idle') && (T.closeReq || T.pauseReq || T.phase === 'done' ? now >= T.nextAt : canStart(T))) { startHand(T, now); return true; }
  return false;
}
const canStart = T => T.seats.filter(s => s && !s.left && !s.out && s.stack > 0).length >= 2;
/** Someone sits down with `amt` chips (already taken from their balance by the caller). Returns an error or undefined. */
export function sit(T, me, idx, amt, now) {
  if (!T.open) return 'The room is closed.';
  if (seatOf(T, me.id) >= 0) return "You're already sitting down.";
  if (!(idx >= 0 && idx < SEATS) || T.seats[idx]) return 'That seat is taken.';
  if (amt < T.cfg.min || amt > T.cfg.max) return `Buy in for ${$(T.cfg.min)} to ${$(T.cfg.max)}.`;
  T.seats[idx] = { id: me.id, name: me.name, stack: amt, pend: 0, buyins: amt, out: false, timeouts: 0, ...blank() };
  T.emptyAt = 0;
  log(T, `${me.name} sits down with ${$(amt)}`);
  if (T.phase === 'idle' && canStart(T)) T.nextAt = now + 3000, T.phase = 'done';
}
/** Adds chips (already taken). Mid-hand they wait for the next hand. */
export function topUp(T, me, amt, t) {
  const i = seatOf(T, me.id); if (i < 0) return "You're not at the table.";
  const s = T.seats[i];
  if (amt < 1 || s.stack + (s.pend || 0) + amt > T.cfg.max) return `You can top up to ${$(T.cfg.max)} in front of you.`;
  s.buyins += amt;
  if (inHand(s) && !s.folded && T.phase === 'hand') { s.pend = (s.pend || 0) + amt; log(T, `${s.name} adds ${$(amt)} for next hand`); }
  else { s.stack += amt; if (s.out && s.timeouts < SIT_OUT_AFTER) s.out = false; log(T, `${s.name} tops up ${$(amt)}`); }
  if (T.phase === 'idle' && canStart(T)) T.nextAt = t + 3000, T.phase = 'done';
}
/** Leaves: folds if in a hand, cashes out the rest. */
export function leave(T, me, t) {
  const i = seatOf(T, me.id); if (i < 0) return "You're not at the table.";
  const s = T.seats[i];
  if (T.phase === 'hand' && inHand(s) && !s.folded) {
    if (T.toAct === i) act(T, i, 'fold', 0, t); else { s.folded = true; s.last = 'Fold'; log(T, `${s.name} folds`); if (alive(T).length === 1) winUncontested(T, t); }
  }
  cashOut(T, s, 'leaves the table');
  if (T.phase === 'hand' && inHand(s)) s.left = true; else T.seats[i] = null;
  if (!T.seats.some(x => x && !x.left)) T.emptyAt = t;
}
export function sitOut(T, i, on, t, byHost = '') {
  const s = T.seats[i]; if (!s || s.left) return 'Nobody is in that seat.';
  s.out = !!on; s.timeouts = 0;
  log(T, byHost ? `The host ${on ? 'sat out' : 'dealt in'} ${s.name}` : `${s.name} ${on ? 'sits out' : 'is back'}`);
  if (on && T.phase === 'hand' && T.toAct === i) act(T, i, s.bet < T.curBet ? 'fold' : 'check', 0, t, true);
  if (!on && T.phase === 'idle' && canStart(T)) { T.nextAt = t + 2000; T.phase = 'done'; }
}
// host
export function openRoom(T, cfg, t) {
  if (T.open) return 'The room is already open.';
  const st = STAKES.find(([a, b]) => a === +cfg.sb && b === +cfg.bb) || STAKES[0];
  const min = MIN_BUYS.includes(+cfg.min) ? +cfg.min : DEFAULT_CFG.min, max = Math.max(min, MAX_BUYS.includes(+cfg.max) ? +cfg.max : DEFAULT_CFG.max);
  const keep = T.log;
  Object.assign(T, fresh(), { v: T.v, open: true, cfg: { sb: st[0], bb: st[1], min, max, turn: TURNS.includes(+cfg.turn) ? +cfg.turn : DEFAULT_CFG.turn }, log: keep, at: t, emptyAt: t });
  log(T, `The host opened the room: ${$(st[0])}/${$(st[1])}, buy-in ${$(min)} to ${$(max)}`);
}
export function setBlinds(T, sb, bb) {
  const st = STAKES.find(([a, b]) => a === +sb && b === +bb); if (!st) return 'Pick blinds from the list.';
  T.cfg.sb = st[0]; T.cfg.bb = st[1]; if (T.phase !== 'hand') T.minRaise = st[1];
  log(T, `The host set the blinds to ${$(st[0])}/${$(st[1])} from the next hand`);
}
export function pause(T, t) {
  if (T.phase === 'paused') return;
  if (T.phase === 'hand') { T.pauseReq = true; log(T, 'The host will pause after this hand'); return; }
  T.pauseReq = true; startHand(T, t);
}
export function resume(T, t) { if (T.phase !== 'paused' && !T.pauseReq) return; T.pauseReq = false; if (T.phase === 'paused') { T.phase = 'done'; T.nextAt = t + 2000; } log(T, 'The host resumed the game'); }
export function requestClose(T, t) {
  if (!T.open) return 'The room is already closed.';
  if (T.phase === 'hand') { T.closeReq = true; log(T, 'The host will close the room after this hand'); return; }
  closeRoom(T, t);
}
export function closeRoom(T, t) {
  T.seats.forEach(s => { if (s && !s.left) cashOut(T, s, 'cashes out'); });
  const keep = T.log, out = T._out;
  Object.assign(T, fresh(), { v: T.v, log: keep, at: t });
  T._out = out;
  log(T, 'The room is closed');
}

/** What everyone may see (no deck, no hidden cards). */
export function publicView(T, t = Date.now()) {
  return {
    v: T.v, now: t, open: T.open, cfg: T.cfg, hand: T.hand, hid: T.hid, button: T.button, board: T.board, pot: T.pot, curBet: T.curBet, minRaise: T.minRaise,
    toAct: T.toAct, street: T.street, phase: T.phase, deadline: T.deadline, nextAt: T.nextAt, pauseReq: T.pauseReq, closeReq: T.closeReq, res: T.res, log: T.log.slice(-30),
    seats: T.seats.map(s => s && { id: s.id, name: s.name, stack: s.stack, pend: s.pend || 0, bet: s.bet, last: s.last, folded: s.folded, allIn: s.allIn, out: s.out, left: !!s.left,
      dealt: inHand(s), cards: s.show ? s.cards : undefined }),
  };
}
