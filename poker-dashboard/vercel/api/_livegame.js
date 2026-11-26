// Live tables (/live): the rules of one shared casino table where several people play against the same dealer at once.
// Games: blackjack, Free Bet blackjack, Ultimate Texas Hold'em, with exactly the solo games' rules: the hands are settled by the
// same settle() code as /blackjack, /freebet and /uth (_blackjack.js, _uth.js), so pays and edges can't drift apart.
// Pure rules, no storage: api/_live.js loads the table, calls these, saves it and moves the chips.
//
// Pacing (Renato picked "everyone at once", Nov 24 2026):
//   bet    bets are open. The clock (cfg.betClock) starts with the first bet; the deal comes when it runs out, or as soon as
//          everyone seated has bet. Nobody bets = the table just waits.
//   act    everyone plays their own hand AT THE SAME TIME against the same dealer card, each with their own clock (cfg.clock).
//          A clock that runs out stands (blackjack) / checks, or folds on the river (UTH). UTH goes street by street: when
//          everyone still deciding has decided, the board turns and the next street starts.
//   done   the dealer has played and everyone is paid; the next round's betting opens at nextAt.
//   paused the host paused after a round; closed = no table.
// Chips never sit on the table: bets are taken from bj:bal when they're placed and paid straight back at the end of the round.
// The engine says what to pay in T._pay ([{ id, name, amt, feed }]); feed = { game, net, wager, stats } for the house books
// (feedCmds: casino feed, house, rakeback, jackpot, accolades), null for a plain refund.
// Timers: deadlines in the table (s.dl, T.deadline, T.nextAt); browsers send "tick" when one has passed (same as the poker room).
import { freshDeck, total, settle as bjSettle, moves, MAX_PUSH22 } from './_blackjack.js';
import { settle as uthSettle, best, CAT, MAX_ANTE, MAX_TRIPS } from './_uth.js';

export const SEATS = 5;
export const MIN_BET = 5, MAX_BET = 500;  // every table: $5 to $500, UTH ante capped at $100 like /uth (MAX_ANTE), no host setting (by request)
export const CLOCK = 15; // seconds for both clocks, deciding and betting (fixed by request: no host setting); side bets always on
export const GAMES = { bj: 'Blackjack', fb: 'Free Bet', uth: "Ultimate Texas Hold'em" };
export const FEED = { bj: 'blackjack', fb: 'free bet', uth: 'UTH' }; // names in the casino feed + house books (HOUSE_GAMES)
const DONE_MS = 3800, CARD_MS = 650, STREET_MS = 1100, IDLE_ROUNDS = 5, LOG_KEEP = 14;
const draw = T => T.deck.pop();
const natural = h => h.cards.length === 2 && !h.split && total(h.cards).t === 21;
const r2 = n => Math.round(n * 100) / 100;

export const fresh = () => ({ v: 0, open: false, game: 'bj', cfg: { min: MIN_BET, max: MAX_BET, clock: CLOCK, betClock: CLOCK, side: true },
  seats: Array(SEATS).fill(null), phase: 'closed', round: 0, deadline: 0, nextAt: 0, dealer: [], board: [], street: '', log: [] });

const log = (T, line) => { T.log.unshift(line); T.log.length = Math.min(T.log.length, LOG_KEEP); };
const pay = (T, s, amt, feed = null) => { (T._pay ||= []).push({ id: s.id, name: s.name, amt: r2(amt), feed }); };
export const seatOf = (T, id) => T.seats.findIndex(s => s && s.id === id);
const seated = T => T.seats.filter(Boolean);
const inRound = T => T.seats.filter(s => s && s.g);
export const sideMax = T => T.game === 'fb' ? MAX_PUSH22 : T.game === 'uth' ? MAX_TRIPS : 0;
export const betMax = T => T.game === 'uth' ? Math.min(T.cfg.max, MAX_ANTE) : T.cfg.max;
/** chips a bet takes: blackjack = bet (+ Push 22); UTH = ante + blind + 1x ante held for the river bet (+ Trips), like /uth */
export const needFor = (T, bet, side) => T.game === 'uth' ? bet * 3 + side : bet + side;

// ---------- the host ----------
export function openTable(T, host, c, now) {
  if (T.open) return 'A table is already open.';
  Object.assign(T, fresh(), { v: T.v, open: true, game: GAMES[c.game] ? c.game : 'bj', host: { id: host.id, name: host.name }, openedAt: now, phase: 'bet',
    cfg: { min: MIN_BET, max: MAX_BET, clock: CLOCK, betClock: CLOCK, side: true } });
  log(T, `${host.name} opened a ${GAMES[T.game]} table`);
  return true;
}
const between = T => T.phase === 'done' || T.phase === 'paused' || (T.phase === 'bet' && !seated(T).some(s => s.locked));
/** settings that change the game: only between rounds (bets already down keep their game) */
export function setGame(T, game, now) {
  if (!GAMES[game]) return 'Pick a game.';
  if (!between(T)) return 'Change the game between rounds.';
  if (T.game === game) return false;
  T.game = game; log(T, `Now playing ${GAMES[game]}`); seated(T).forEach(s => { s.res = null; s.last = ''; });
  // clear the last round's cards so the felt doesn't show old blackjack hands under a UTH sign (the round is already paid)
  if (T.phase === 'done') { T.dealer = []; T.board = []; T.dealerHand = ''; seated(T).forEach(s => Object.assign(s, { g: null, bet: 0, side: 0, locked: false })); } // unlocked too, so a close/leave can't refund a paid bet
  return true;
}
export function pause(T, on, now) {
  T.pause = !!on;
  if (on && T.phase === 'bet' && !seated(T).some(s => s.locked)) T.phase = 'paused';
  if (!on && T.phase === 'paused') { T.phase = 'bet'; T.deadline = 0; }
  log(T, on ? 'Paused after this round' : 'Back on');
  return true;
}
/** closes now if no hand is out (bets placed but not dealt are handed back), else at the end of the round */
export function requestClose(T, now) {
  if (!T.open) return 'The table is already closed.';
  if (T.phase === 'act') { T.closing = true; log(T, 'Closing after this round'); return true; }
  return close(T, now);
}
function close(T, now) {
  for (const s of seated(T)) if (s.locked && !s.g) pay(T, s, needFor(T, s.bet, s.side));
  const v = T.v, pays = T._pay; Object.assign(T, fresh(), { v, closedAt: now }); if (pays) T._pay = pays;
  return true;
}
/** host or not: the person who opened it, or anyone when they've left the table (any Discord member can host, by request) */
export const hostFree = T => !T.host || seatOf(T, T.host.id) < 0;

// ---------- seats ----------
export function sit(T, who, i, now) {
  if (!T.open) return 'No table is open.';
  if (seatOf(T, who.id) >= 0) return "You're already at the table.";
  if (!(i >= 0 && i < SEATS) || T.seats[i]) return 'That seat is taken.';
  T.seats[i] = { id: who.id, name: who.name, bet: 0, side: 0, locked: false, g: null, dl: 0, idle: 0, last: '', res: null, at: now };
  T.emptyAt = 0;
  return true;
}
export function leave(T, who, now) {
  const i = seatOf(T, who.id); if (i < 0) return "You're not at the table.";
  const s = T.seats[i];
  if (s.g && T.phase === 'act') { s.left = true; s.dl = now; tick(T, now); return true; } // their hand plays out on the clock rules, then the seat empties
  if (s.locked && !s.g) pay(T, s, needFor(T, s.bet, s.side));
  T.seats[i] = null;
  if (!seated(T).length) T.emptyAt = now;
  if (T.phase === 'bet') maybeDeal(T, now);
  return true;
}

// ---------- betting ----------
/** checks a bet before any chips are taken; returns an error or null */
export function betBlock(T, i, bet, side) {
  if (!T.open || i < 0) return 'Sit down first.';
  if (T.phase !== 'bet') return T.phase === 'paused' ? 'The table is paused.' : 'Bets for the next round open in a moment.';
  if (T.seats[i].locked) return "You're already in this round.";
  if (!(bet >= T.cfg.min && bet <= betMax(T))) return `Bet $${T.cfg.min} to $${betMax(T)}${T.game === 'uth' ? ' on the ante' : ''}.`;
  if (side && (!T.cfg.side || !sideMax(T) || side < 0 || side > sideMax(T))) return 'That side bet is off.';
  return null;
}
/** places a bet whose chips (needFor) were already taken */
export function placeBet(T, i, bet, side, now) {
  const why = betBlock(T, i, bet, side); if (why) return why;
  const s = T.seats[i]; Object.assign(s, { bet, side: side || 0, locked: true, last: 'In', res: null });
  if (!T.deadline) T.deadline = now + T.cfg.betClock * 1000;
  maybeDeal(T, now);
  return true;
}
function maybeDeal(T, now) {
  const people = seated(T), locked = people.filter(s => s.locked);
  if (!locked.length) { T.deadline = 0; return false; }
  if (locked.length === people.length || now >= T.deadline) { deal(T, now); return true; }
  return false;
}

function deal(T, now) {
  T.round++; T.deck = freshDeck(); T.phase = 'act'; T.deadline = 0; T.dealer = []; T.board = []; T.street = '';
  for (const [i, s] of T.seats.entries()) {
    if (!s) continue;
    if (!s.locked) { s.res = null; s.last = ''; if (++s.idle >= IDLE_ROUNDS) { T.seats[i] = null; log(T, `${s.name} stood up (sat out ${IDLE_ROUNDS} rounds)`); } continue; }
    s.idle = 0; s.last = '';
  }
  const live = inPlayers(T);
  if (T.game === 'uth') {
    for (const s of live) s.g = { ante: s.bet, trips: s.side, play: 0, held: s.bet, me: [draw(T), draw(T)], folded: false };
    T.dealer = [draw(T), draw(T)]; T.board5 = [draw(T), draw(T), draw(T), draw(T), draw(T)]; T.street = 'pre';
  } else {
    const mode = T.game === 'fb' ? 'free' : undefined;
    for (const s of live) s.g = { mode, bet: s.bet, side: s.side, hands: [{ cards: [draw(T)], bet: s.bet, free: 0 }], active: 0, over: false };
    T.dealer.push(draw(T)); for (const s of live) s.g.hands[0].cards.push(draw(T)); T.dealer.push(draw(T));
    for (const s of live) { const h = s.g.hands[0]; s.g.nat = natural(h) ? 1 : 0; if (s.g.nat) { h.done = true; s.last = 'Blackjack'; } }
    if (total(T.dealer).t === 21) return finish(T, now); // the dealer has blackjack: everyone settles on the deal, like /blackjack
  }
  startClocks(T, now, 0);
}
const inPlayers = T => T.seats.filter(s => s && s.locked);
/** seats that still owe a decision this street / hand */
export function deciding(T) {
  if (T.phase !== 'act') return [];
  if (T.game === 'uth') return inRound(T).filter(s => !s.g.folded && !s.g.play && !s.dec);
  return inRound(T).filter(s => s.g.hands.some(h => !h.done));
}
function startClocks(T, now, delay) {
  const list = deciding(T);
  if (!list.length) return endStreet(T, now);
  for (const s of list) s.dl = s.left ? now : now + delay + T.cfg.clock * 1000;
}

// ---------- moves ----------
/** chips a move needs on top of what's down (null = not allowed now). Free doubles/splits and UTH bets covered by the hold cost less. */
export function costOf(T, i, act) {
  const s = T.seats[i]; if (!s || !s.g || !deciding(T).includes(s)) return null;
  if (T.game === 'uth') {
    const ok = { pre: ['b4', 'chk'], flop: ['b2', 'chk'], river: ['b1', 'fold'] }[T.street] || [];
    if (!ok.includes(act)) return null;
    return act[0] === 'b' ? Math.max(0, s.g.ante * +act[1] - s.g.held) : 0;
  }
  const g = s.g, m = moves(g, Infinity);
  if (act === 'hit' || act === 'stand') return 0;
  if (act === 'double') return m.dbl ? (m.dblFree ? 0 : g.bet) : null;
  if (act === 'split') return m.spl ? (m.splFree ? 0 : g.bet) : null;
  return null;
}
/** a move whose extra chips (costOf) were already taken: paid must match, or nothing happens and the chips go back */
export function move(T, i, act, now, paid = 0) {
  const c = costOf(T, i, act);
  if (c === null) return T.phase === 'act' ? "That move isn't open right now." : 'Wait for the next round.';
  if (c !== paid) return 'Try again.';
  const s = T.seats[i], g = s.g;
  if (T.game === 'uth') {
    if (act[0] === 'b') { g.play = g.ante * +act[1]; g.held = 0; s.last = `Bet ${act[1]}x`; }
    else if (act === 'fold') { g.folded = true; s.last = 'Fold'; }
    else { s.dec = true; s.last = 'Check'; }
    s.dl = 0;
  } else {
    const h = g.hands[g.active];
    if (act === 'hit') { h.cards.push(draw(T)); s.last = total(h.cards).t > 21 ? 'Bust' : 'Hit'; if (total(h.cards).t >= 21) h.done = true; }
    else if (act === 'stand') { h.done = true; s.last = 'Stand'; }
    else if (act === 'double') {
      if (paid) h.bet += g.bet; else { h.free = (h.free || 0) + g.bet; h.freeDbl = true; }
      h.doubled = true; h.cards.push(draw(T)); h.done = true; s.last = paid ? 'Double' : 'Free double';
    } else if (act === 'split') {
      const [c1, c2] = h.cards, aces = c1[0] === 'A';
      const nh = { cards: [c2, draw(T)], bet: paid ? g.bet : 0, free: paid ? 0 : g.bet, split: true, aces };
      h.cards = [c1, draw(T)]; h.split = true; h.aces = aces;
      g.hands.splice(g.active + 1, 0, nh);
      for (const x of [h, nh]) { if (aces || total(x.cards).t >= 21) x.done = true; }
      s.last = paid ? 'Split' : 'Free split';
    }
    while (g.active < g.hands.length && g.hands[g.active].done) g.active++;
    if (g.active >= g.hands.length) { g.active = g.hands.length - 1; s.dl = 0; }
    else s.dl = now + T.cfg.clock * 1000; // a fresh clock for the next card / hand
  }
  if (!deciding(T).length) endStreet(T, now);
  return true;
}
/** what a clock running out does: stand / check / fold on the river */
const timeoutMove = (T, s) => T.game === 'uth' ? (T.street === 'river' ? 'fold' : 'chk') : 'stand';

function endStreet(T, now) {
  if (T.game === 'uth' && T.street !== 'river') {
    T.street = T.street === 'pre' ? 'flop' : 'river';
    T.board = T.board5.slice(0, T.street === 'flop' ? 3 : 5);
    inRound(T).forEach(s => { s.dec = false; });
    return startClocks(T, now, STREET_MS);
  }
  finish(T, now);
}

// ---------- the dealer + paying ----------
function finish(T, now) {
  let drawn = 0;
  if (T.game === 'uth') {
    T.board = T.board5.slice(); T.street = 'show';
    const dl = best([...T.dealer, ...T.board]); T.dealerHand = CAT[dl.cat] + (dl.cat >= 1 ? '' : ", doesn't qualify");
    for (const s of inRound(T)) {
      const g = s.g; Object.assign(g, { dealer: T.dealer, board: T.board }); uthSettle(g);
      const refund = g.folded ? g.held : 0; g.held = 0;
      s.res = { net: r2(g.net), hand: g.myHand, res: g.res };
      pay(T, s, g.payout + refund, { game: FEED.uth, net: g.net, wager: g.ante * 2 + g.trips + g.play, stats: { royal: g.royal } });
    }
  } else {
    const free = T.game === 'fb', hits = () => { const t = total(T.dealer); return t.t < 17 || (free && t.t === 17 && t.soft); };
    const dealerNat = T.dealer.length === 2 && total(T.dealer).t === 21;
    // same rule as settle(): the dealer plays out when any hand is still standing or a Push 22 bet is waiting
    const needed = inRound(T).some(s => s.g.side || s.g.hands.some(h => total(h.cards).t <= 21 && !natural(h)));
    if (needed && !dealerNat) while (hits()) { T.dealer.push(draw(T)); drawn++; }
    for (const s of inRound(T)) {
      const g = s.g; g.dealer = T.dealer; g.deck = []; bjSettle(g); // the dealer is already played out, so settle() draws nothing
      const sweep = g.hands.length >= 3 && g.hands.every(h => h.res === 'win' || h.res === 'bj') ? 1 : 0;
      s.res = { net: r2(g.net), hands: g.hands.map(h => h.res), d22: !!g.d22, sideWin: g.sideWin || 0 };
      pay(T, s, g.payout, { game: FEED[T.game], net: g.net, wager: g.hands.reduce((a, h) => a + h.bet, 0) + (g.side || 0), stats: { naturals: g.nat, sweep } });
    }
  }
  const cents = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // cents on every amount, site-wide
  const line = inRound(T).map(s => `${s.name} ${s.res.net > 0 ? '+$' + cents(s.res.net) : s.res.net < 0 ? '−$' + cents(-s.res.net) : 'push'}`).join(', ');
  if (line) log(T, `Round ${T.round}: ${line}`);
  T.phase = 'done'; T.nextAt = now + DONE_MS + drawn * CARD_MS + (T.game === 'uth' ? 900 : 0);
  T.seats.forEach(s => { if (s) s.dl = 0; });
}

function nextRound(T, now) {
  for (const [i, s] of T.seats.entries()) {
    if (!s) continue;
    if (s.left) { T.seats[i] = null; continue; }
    Object.assign(s, { bet: 0, side: 0, locked: false, g: null, dl: 0, dec: false });
  }
  T.dealer = []; T.board = []; T.board5 = null; T.street = ''; T.deck = null; T.dealerHand = '';
  if (T.closing) return close(T, now);
  T.phase = T.pause ? 'paused' : 'bet'; T.deadline = 0;
  if (!seated(T).length) T.emptyAt ||= now; else T.emptyAt = 0;
}

/** moves the table along when a clock has run out. true = something changed (save it). */
export function tick(T, now) {
  if (!T.open) return false;
  let changed = false;
  // nobody touched it for 3 hours, or nobody sat for 30 minutes: close (any bets not dealt yet go back)
  if (T.phase !== 'act' && ((T.at && now - T.at > 3 * 3600e3) || (!seated(T).length && now - (T.emptyAt || T.openedAt || now) > 30 * 60e3))) { close(T, now); return true; }
  for (let k = 0; k < 40; k++) { // a few steps can be due at once (several clocks, then a street, then the dealer)
    if (T.phase === 'bet') { if (T.deadline && now >= T.deadline && maybeDeal(T, now)) { changed = true; continue; } break; }
    if (T.phase === 'act') {
      const s = deciding(T).find(x => x.dl && now >= x.dl);
      if (!s) break;
      const i = T.seats.indexOf(s), a = timeoutMove(T, s);
      move(T, i, a, now, 0); s.last = s.left ? 'Left' : a === 'fold' ? 'Fold (clock)' : 'Clock'; changed = true; continue;
    }
    if (T.phase === 'done') { if (now >= T.nextAt) { nextRound(T, now); changed = true; continue; } break; }
    break;
  }
  return changed;
}

// ---------- what everyone may see ----------
/** no deck, no UTH hole cards (except at showdown), dealer's hole card face down until the dealer plays */
export function publicView(T, now) {
  const show = T.phase === 'done';
  const dealer = T.game === 'uth' ? (show ? T.dealer : T.dealer.map(() => 'XX')) : T.dealer.map((c, k) => k === 1 && !show ? 'XX' : c);
  return { open: T.open, game: T.game, cfg: T.cfg, host: T.host || null, phase: T.phase, round: T.round, deadline: T.deadline, nextAt: T.nextAt,
    pause: !!T.pause, closing: !!T.closing, street: T.street, board: T.board || [], dealer, dealerHand: show ? T.dealerHand || '' : '',
    dealerTotal: T.game !== 'uth' && T.dealer.length ? (show ? total(T.dealer).t : null) : null, log: T.log, now, v: T.v,
    sideMax: sideMax(T), betMax: betMax(T),
    seats: T.seats.map(s => s && { id: s.id, name: s.name, bet: s.bet, side: s.side, locked: s.locked, dl: s.dl, last: s.last, res: s.res, left: !!s.left, deciding: false,
      ...(s.g ? T.game === 'uth' ? { play: s.g.play, folded: s.g.folded, cards: show && !s.g.folded ? s.g.me : ['XX', 'XX'], dec: !!s.dec }
        : { hands: s.g.hands.map(h => ({ cards: h.cards, bet: h.bet, free: h.free || 0, done: !!h.done, doubled: !!h.doubled, res: h.res || null, t: total(h.cards).t, soft: total(h.cards).soft })), active: s.g.active } : {}) })
    .map((s, i) => s && { ...s, deciding: deciding(T).includes(T.seats[i]) }) };
}
/** your own UTH cards (+ what you have so far) */
export function mine(T, i) {
  const s = T.seats[i]; if (!s || !s.g || T.game !== 'uth') return null;
  const cs = [...s.g.me, ...(T.board || [])];
  return { cards: s.g.me, hand: cs.length >= 5 ? CAT[best(cs).cat] : null };
}
