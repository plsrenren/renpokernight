// /uth: Ultimate Texas Hold'em style hand against the dealer, with the blackjack play chips (bj:bal).
//   /uth ante:10 trips:5   ante + an equal blind go up (plus the optional Trips side bet)
//   Pre-flop: bet 4x or 3x the ante, or check.  Flop: bet 2x, or check.  River: bet 1x, or fold (lose ante + blind).
//   One bet per hand; after it the rest of the cards come out and it's showdown.
//   Dealer needs a pair to qualify; if not, the ante pushes. Play pays 1:1. Blind pays only when you win with a
//   straight or better (royal 500:1, straight flush 50:1, quads 10:1, full house 3:1, flush 3:2, straight 1:1),
//   otherwise it pushes on a win. Trips pays on your own hand whatever the dealer has, even after a fold
//   (royal 50, straight flush 40, quads 30, full house 8, flush 7, straight 4, three of a kind 3).
// Keys: uth:g:<id> (the hand, 1 hour), uth:lock:<id> (stops double taps).
import { randomBytes } from 'node:crypto';
import { kv, kvUrl, kvToken, money, json, quiet, whoIs, noStorage, freshDeck } from './_blackjack.js';

const SITE = 'https://renpokernight.vercel.app';
const MAX_ANTE = 100, MAX_TRIPS = 100, DEFAULT_ANTE = 10;

export const UTH_COMMAND = { name: 'uth', description: "Ultimate Texas Hold'em against the dealer with play chips (not real money)", type: 1,
  options: [
    { type: 4, name: 'ante', description: `Ante, matched by an equal blind ($1 to $${MAX_ANTE}, default $${DEFAULT_ANTE})`, min_value: 1, max_value: MAX_ANTE, required: false },
    { type: 4, name: 'trips', description: `Optional Trips side bet, pays on three of a kind or better ($0 to $${MAX_TRIPS})`, min_value: 0, max_value: MAX_TRIPS, required: false }] };

// ---------- hand ranking (best 5 of up to 7 cards) ----------
const VAL = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
const val = c => VAL[c[0]] || +c[0];
const NAME = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };
const PLURAL = v => (v === 6 ? 'sixes' : NAME[v] + 's');
export const CAT = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Royal flush'];

function straightHigh(vals) {
  const u = [...new Set(vals)].sort((a, b) => b - a);
  if (u.includes(14)) u.push(1);
  for (let k = 0; k + 4 < u.length; k++) if (u[k] - u[k + 4] === 4) return u[k];
  return 0;
}

/** { cat (0-9), kick: [...], name } for the best hand in cards (works for 2 to 7 cards). */
export function best(cards) {
  const vals = cards.map(val).sort((a, b) => b - a);
  const bySuit = {};
  for (const c of cards) (bySuit[c[1]] ||= []).push(val(c));
  const fl = Object.values(bySuit).find(v => v.length >= 5);
  if (fl) {
    const sf = straightHigh(fl);
    if (sf) return sf === 14 ? { cat: 9, kick: [14], name: 'Royal flush' } : { cat: 8, kick: [sf], name: `Straight flush, ${NAME[sf]} high` };
  }
  const count = {};
  for (const v of vals) count[v] = (count[v] || 0) + 1;
  const groups = Object.entries(count).map(([v, n]) => [+v, n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const rest = (...skip) => vals.filter(v => !skip.includes(v));
  const [g1, g2] = groups;
  if (g1[1] === 4) return { cat: 7, kick: [g1[0], ...rest(g1[0]).slice(0, 1)], name: `Four ${PLURAL(g1[0])}` };
  if (g1[1] === 3 && g2 && g2[1] >= 2) return { cat: 6, kick: [g1[0], g2[0]], name: `Full house, ${PLURAL(g1[0])} full of ${PLURAL(g2[0])}` };
  if (fl) { const top = fl.sort((a, b) => b - a).slice(0, 5); return { cat: 5, kick: top, name: `Flush, ${NAME[top[0]]} high` }; }
  const st = straightHigh(vals);
  if (st) return { cat: 4, kick: [st], name: `Straight, ${NAME[st]} high` };
  if (g1[1] === 3) return { cat: 3, kick: [g1[0], ...rest(g1[0]).slice(0, 2)], name: `Three ${PLURAL(g1[0])}` };
  if (g1[1] === 2 && g2 && g2[1] === 2) return { cat: 2, kick: [g1[0], g2[0], ...rest(g1[0], g2[0]).slice(0, 1)], name: `Two pair, ${PLURAL(g1[0])} and ${PLURAL(g2[0])}` };
  if (g1[1] === 2) return { cat: 1, kick: [g1[0], ...rest(g1[0]).slice(0, 3)], name: `Pair of ${PLURAL(g1[0])}` };
  return { cat: 0, kick: vals.slice(0, 5), name: `${NAME[vals[0]][0].toUpperCase() + NAME[vals[0]].slice(1)} high` };
}
export function compare(a, b) {
  const x = [a.cat, ...a.kick], y = [b.cat, ...b.kick];
  for (let k = 0; k < Math.max(x.length, y.length); k++) if ((x[k] || 0) !== (y[k] || 0)) return (x[k] || 0) > (y[k] || 0) ? 1 : -1;
  return 0;
}
const BLIND_PAY = { 9: 500, 8: 50, 7: 10, 6: 3, 5: 1.5, 4: 1 };
const TRIPS_PAY = { 9: 50, 8: 40, 7: 30, 6: 8, 5: 7, 4: 4, 3: 3 };
const ratio = m => (m === 1.5 ? '3:2' : `${m}:1`);

// ---------- settling ----------
/** Works out every bet. Sets g.lines (for the message), g.payout (chips handed back) and g.net. */
export function settle(g) {
  g.stage = 'done';
  const me = best([...g.me, ...g.board]), dl = best([...g.dealer, ...g.board]);
  g.myHand = me.name; g.dlHand = dl.name;
  const qualifies = dl.cat >= 1, cmp = g.folded ? -1 : compare(me, dl);
  g.qualifies = qualifies;
  const lines = [];
  let back = 0;
  const line = (bet, why, amt) => { lines.push([bet, why, amt]); };
  if (g.folded) {
    line('Ante', 'folded', -g.ante); line('Blind', 'folded', -g.ante);
    g.res = 'fold';
  } else if (cmp > 0) {
    g.res = 'win';
    back += g.play * 2; line('Play', 'beat the dealer, 1:1', g.play);
    if (qualifies) { back += g.ante * 2; line('Ante', 'dealer qualified, 1:1', g.ante); } else { back += g.ante; line('Ante', "dealer didn't qualify, push", 0); }
    const bm = BLIND_PAY[me.cat];
    if (bm) { back += g.ante + g.ante * bm; line('Blind', `${CAT[me.cat].toLowerCase()} pays ${ratio(bm)}`, g.ante * bm); }
    else { back += g.ante; line('Blind', 'pushes under a straight', 0); }
  } else if (cmp === 0) {
    g.res = 'push';
    back += g.play + g.ante * 2;
    line('Play', 'tie, push', 0); line('Ante', 'tie, push', 0); line('Blind', 'tie, push', 0);
  } else {
    g.res = 'lose';
    line('Play', 'dealer wins', -g.play);
    if (qualifies) line('Ante', 'dealer wins', -g.ante); else { back += g.ante; line('Ante', "dealer didn't qualify, push", 0); }
    line('Blind', 'dealer wins', -g.ante);
  }
  if (g.trips) {
    const tm = TRIPS_PAY[me.cat];
    if (tm) { back += g.trips + g.trips * tm; line('Trips', `${CAT[me.cat].toLowerCase()} pays ${tm}:1`, g.trips * tm); }
    else line('Trips', 'needs three of a kind or better', -g.trips);
  }
  g.lines = lines; g.payout = back; g.net = back - (g.ante * 2 + g.trips + g.play);
}

// ---------- the message ----------
const onTable = g => g.ante * 2 + g.trips + g.play;
const shown = g => g.stage === 'pre' ? 0 : g.stage === 'flop' ? 3 : 5;
const holeName = cs => { const [a, b] = cs.map(val).sort((x, y) => y - x); return a === b ? `Pocket ${PLURAL(a)}` : `${NAME[a][0].toUpperCase() + NAME[a].slice(1)} high`; };

function view(g, bal) {
  const done = g.stage === 'done', n = shown(g);
  const board = [...g.board.slice(0, n), ...Array(5 - n).fill('__')];
  const mine = done ? g.myHand : n ? best([...g.me, ...g.board.slice(0, n)]).name : holeName(g.me);
  const q = new URLSearchParams({ m: 'uth', d: done ? g.dealer.join('.') : 'XX.XX', b: board.join('.'), p: g.me.join('.'), n: g.name, ph: mine,
    dh: done ? `${g.dlHand}${g.qualifies ? ' · qualifies' : " · doesn't qualify"}` : '', r: done ? g.res : '', v: g.id + g.step });
  const bets = [`Ante **${money(g.ante)}**`, `Blind **${money(g.ante)}**`, ...(g.play ? [`Play **${money(g.play)}**`] : []), ...(g.trips ? [`Trips **${money(g.trips)}**`] : [])].join(' · ');
  let title, description = bets, color, footer;
  const btn = (label, emoji, act, style, disabled = false) => ({ type: 2, style, label, ...(emoji ? { emoji: { name: emoji } } : {}), custom_id: `uth:${act}:${g.id}`, disabled });
  let row;
  if (!done) {
    title = `♠️ Ultimate Hold'em · ${g.name}`; color = 0x6e52c8;
    const can = m => bal >= g.ante * m;
    if (g.stage === 'pre') { footer = 'Pre-flop: bet 4x or 3x your ante now, or check and decide later';
      row = [btn(`Bet 4x (${money(g.ante * 4)})`, '💰', 'b4', 3, !can(4)), btn(`Bet 3x (${money(g.ante * 3)})`, null, 'b3', 3, !can(3)), btn('Check', '✋', 'chk', 2)]; }
    else if (g.stage === 'flop') { footer = 'Flop: bet 2x your ante, or check';
      row = [btn(`Bet 2x (${money(g.ante * 2)})`, '💰', 'b2', 3, !can(2)), btn('Check', '✋', 'chk', 2)]; }
    else { footer = 'River: bet 1x your ante, or fold and lose the ante and blind';
      row = [btn(`Bet 1x (${money(g.ante)})`, '💰', 'b1', 3, !can(1)), btn('Fold', null, 'fold', 4)]; }
    footer += ` · balance ${money(bal)} (+${money(onTable(g))} on the table) · only ${g.name} can press these · play money`;
  } else {
    title = g.res === 'fold' ? `♠️ ${g.name} folds${g.net ? `, ${g.net > 0 ? 'up' : 'down'} ${money(Math.abs(g.net))}` : ''}`
      : g.net > 0 ? `♠️ ${g.name} wins ${money(g.net)}!` : g.net < 0 ? `♠️ ${g.name} loses ${money(-g.net)}` : `♠️ ${g.name} breaks even`;
    color = g.net > 0 ? 0x8ee0b0 : g.net < 0 ? 0xf59bb0 : 0x9a94c4;
    const fmt = a => (a > 0 ? `+${money(a)}` : a < 0 ? `−${money(-a)}` : '$0');
    description = `${bets}\n\n${g.lines.map(([b, why, a]) => `**${b}** · ${why} · \`${fmt(a)}\``).join('\n')}\n\nBalance **${money(bal)}**`;
    footer = 'Dealer needs a pair to qualify · Blind pays on a straight or better · play money only';
    row = [btn(`Play again (${money(g.ante)}${g.trips ? ` + ${money(g.trips)} trips` : ''})`, '🔁', 'again', 1, bal < g.ante * 2 + g.trips), btn('Payouts', '📜', 'pay', 2)];
  }
  return { allowed_mentions: { parse: [] }, embeds: [{ color, title, description, image: { url: `${SITE}/api/bjcards?${q}` }, footer: { text: footer } }],
    components: [{ type: 1, components: row }] };
}

const PAYTABLE = [
  "**Ultimate Hold'em payouts**",
  '**Play** pays 1:1 when you beat the dealer. **Ante** pays 1:1 if the dealer qualifies (a pair or better), otherwise it pushes.',
  '**Blind** (only when you win): royal flush 500:1 · straight flush 50:1 · four of a kind 10:1 · full house 3:1 · flush 3:2 · straight 1:1 · anything less pushes.',
  '**Trips** (your hand, win or lose, even after a fold): royal flush 50:1 · straight flush 40:1 · four of a kind 30:1 · full house 8:1 · flush 7:1 · straight 4:1 · three of a kind 3:1.',
  'Ties push everything except Trips. Folding on the river loses the ante and blind.'].join('\n');

// ---------- a hand ----------
async function newHand(me, ante, trips) {
  const [balRaw] = await kv(['HGET', 'bj:bal', me.id]);
  const need = ante * 2 + trips;
  if (balRaw === null) return { err: "You don't have any chips yet. Use **/daily** to get some free." };
  if (+balRaw < need) return { err: `This hand needs ${money(need)} up front (ante + blind${trips ? ' + trips' : ''}), and you have ${money(+balRaw)}.` };
  const deck = freshDeck(), g = { id: randomBytes(5).toString('hex'), uid: me.id, name: me.name, ante, trips, play: 0, step: 0, stage: 'pre' };
  g.me = [deck.pop(), deck.pop()]; g.dealer = [deck.pop(), deck.pop()]; g.board = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  const res = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, -need], ['HSET', 'bj:name', me.id, me.name], ['SET', 'uth:g:' + g.id, JSON.stringify(g), 'EX', 3600]);
  return { g, bal: +res[0] };
}

/** The /uth slash command. */
export async function uthCommand(i, opts, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const ante = Math.min(MAX_ANTE, Math.max(1, Math.floor((opts.ante && opts.ante.value) || DEFAULT_ANTE)));
  const trips = Math.min(MAX_TRIPS, Math.max(0, Math.floor((opts.trips && opts.trips.value) || 0)));
  try {
    const out = await newHand(whoIs(i, s), ante, trips);
    if (out.err) return quiet(out.err);
    return json({ type: 4, data: view(out.g, out.bal) });
  } catch (e) { console.error('uth', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}

/** The buttons (custom_id uth:<action>:<hand id>). */
export async function uthButton(i, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const [, act, gid] = String(i.data.custom_id).split(':');
  if (act === 'pay') return quiet(PAYTABLE);
  const me = whoIs(i, s);
  const [raw, lock] = await kv(['GET', 'uth:g:' + gid], ['SET', 'uth:lock:' + gid, '1', 'NX', 'EX', 5]);
  const unlock = () => kv(['DEL', 'uth:lock:' + gid]).catch(() => {});
  if (!raw) { if (lock) await unlock(); return quiet('This hand has expired. Start a new one with **/uth**.'); }
  const g = JSON.parse(raw);
  if (g.uid !== me.id) { if (lock) await unlock(); return quiet(`That's ${g.name}'s hand. Start your own with **/uth**.`); }
  if (!lock) return json({ type: 6 }); // a second tap while the first is still being handled
  try {
    if (act === 'again') {
      if (g.stage !== 'done') return json({ type: 6 });
      const out = await newHand(me, g.ante, g.trips);
      if (out.err) return quiet(out.err);
      return json({ type: 4, data: view(out.g, out.bal) });
    }
    if (g.stage === 'done') return json({ type: 6 });
    const [balRaw] = await kv(['HGET', 'bj:bal', me.id]);
    let bal = +balRaw || 0;
    const ok = { pre: ['b4', 'b3', 'chk'], flop: ['b2', 'chk'], river: ['b1', 'fold'] }[g.stage];
    if (!ok.includes(act)) return json({ type: 6 });
    let spend = 0;
    if (act[0] === 'b') {
      spend = g.ante * +act[1];
      if (bal < spend) return quiet(`You need ${money(spend)} for that bet and have ${money(bal)}.`);
      g.play = spend; settle(g);
    } else if (act === 'fold') { g.folded = true; settle(g); }
    else g.stage = g.stage === 'pre' ? 'flop' : 'river';
    g.step++;
    const delta = (g.stage === 'done' ? g.payout : 0) - spend;
    const res = await kv(...(delta ? [['HINCRBYFLOAT', 'bj:bal', me.id, delta]] : [['HGET', 'bj:bal', me.id]]), ['SET', 'uth:g:' + g.id, JSON.stringify(g), 'EX', 3600]);
    bal = +res[0];
    return json({ type: 7, data: view(g, bal) });
  } finally { await unlock(); }
}
