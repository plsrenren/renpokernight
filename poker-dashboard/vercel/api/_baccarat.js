// /baccarat: bet Player, Banker or Tie with the blackjack play chips (bj:bal); the cards play themselves.
//   Fresh 6-deck shoe each hand, standard third-card rules. Player pays 1:1, Banker 0.95:1 (5% commission),
//   Tie 8:1. Player and Banker bets push on a tie.
// The buttons under a result deal a new hand for whoever presses them (same bet), so anyone can join in.
import { randomInt } from 'node:crypto';
import { kv, kvUrl, kvToken, money, json, quiet, whoIs, noStorage, MAX_BET } from './_blackjack.js';

const SITE = 'https://renpokernight.vercel.app', DEFAULT_BET = 20;
const SIDES = { player: 'Player', banker: 'Banker', tie: 'Tie' };

export const BACCARAT_COMMAND = { name: 'baccarat', description: 'Bet Player, Banker or Tie in baccarat with play chips (not real money)', type: 1,
  options: [
    { type: 3, name: 'on', description: 'What you bet on', required: true,
      choices: [{ name: 'Player (pays 1:1)', value: 'player' }, { name: 'Banker (pays 0.95:1)', value: 'banker' }, { name: 'Tie (pays 8:1)', value: 'tie' }] },
    { type: 4, name: 'bet', description: `How much ($1 to $${MAX_BET}, default $${DEFAULT_BET})`, min_value: 1, max_value: MAX_BET, required: false }] };

const shoe = () => { const d = []; for (let k = 0; k < 6; k++) for (const r of 'A23456789TJQK') for (const s of 'SHDC') d.push(r + s);
  for (let k = d.length - 1; k > 0; k--) { const j = randomInt(k + 1); [d[k], d[j]] = [d[j], d[k]]; } return d; };
const pts = c => (c[0] === 'A' ? 1 : 'TJQK'.includes(c[0]) ? 0 : +c[0]);
export const score = cs => cs.reduce((a, c) => a + pts(c), 0) % 10;

/** Deals one coup with the standard drawing rules. deck: cards to draw from (pop). */
export function coup(deck = shoe()) {
  const p = [deck.pop()], b = [deck.pop()];
  p.push(deck.pop()); b.push(deck.pop());
  const natural = score(p) >= 8 || score(b) >= 8;
  let p3 = null;
  if (!natural) {
    if (score(p) <= 5) { p3 = deck.pop(); p.push(p3); }
    const bs = score(b), v = p3 === null ? null : pts(p3);
    const draw = v === null ? bs <= 5
      : bs <= 2 || (bs === 3 && v !== 8) || (bs === 4 && v >= 2 && v <= 7) || (bs === 5 && v >= 4 && v <= 7) || (bs === 6 && (v === 6 || v === 7));
    if (draw) b.push(deck.pop());
  }
  const ps = score(p), bs = score(b);
  return { p, b, ps, bs, natural, winner: ps > bs ? 'player' : bs > ps ? 'banker' : 'tie' };
}

/** Chips handed back for a bet of amt on side, given the coup's winner. */
export function payout(side, amt, winner) {
  if (winner === 'tie') return side === 'tie' ? amt * 9 : amt; // Player/Banker push on a tie
  if (side !== winner) return 0;
  return side === 'banker' ? amt + Math.round(amt * 0.95 * 100) / 100 : amt * 2;
}

async function play(me, side, bet) {
  const [balRaw] = await kv(['HGET', 'bj:bal', me.id]);
  if (balRaw === null) return quiet("You don't have any chips yet. Use **/daily** to get some free.");
  if (+balRaw < bet) return quiet(`You only have ${money(+balRaw)}. Bet that or less.`);
  const c = coup(), back = payout(side, bet, c.winner), net = Math.round((back - bet) * 100) / 100;
  const [bal] = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, back - bet], ['HSET', 'bj:name', me.id, me.name]);
  const how = c.natural ? 'a natural' : c.p.length + c.b.length > 4 ? 'third cards' : 'two cards each';
  const won = c.winner === 'tie' ? `It's a tie, ${c.ps}–${c.bs}` : `${SIDES[c.winner]} wins ${Math.max(c.ps, c.bs)}–${Math.min(c.ps, c.bs)}`;
  const title = net > 0 ? `🎴 ${me.name} wins ${money(net)}!` : net < 0 ? `🎴 ${me.name} loses ${money(-net)}` : `🎴 ${me.name} pushes`;
  const q = new URLSearchParams({ m: 'bac', p: c.p.join('.'), b: c.b.join('.'), w: c.winner, n: me.name, s: side, v: Date.now().toString(36) });
  const btn = s => ({ type: 2, style: s === side ? 1 : 2, label: `${SIDES[s]} (${money(bet)})`, custom_id: `ba:${s}:${bet}` });
  return json({ type: 4, data: { allowed_mentions: { parse: [] }, embeds: [{ color: net > 0 ? 0x8ee0b0 : net < 0 ? 0xf59bb0 : 0x9a94c4, title,
    description: `${won} (${how}). ${me.name} bet **${money(bet)}** on **${SIDES[side]}**.\n\nBalance **${money(+bal)}**`,
    image: { url: `${SITE}/api/bjcards?${q}` },
    footer: { text: 'Player 1:1 · Banker 0.95:1 · Tie 8:1 (Player/Banker push on a tie) · anyone can tap below to play · play money only' } }],
  components: [{ type: 1, components: ['player', 'banker', 'tie'].map(btn) }] } });
}

export async function baccaratCommand(i, opts, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const side = SIDES[opts.on && opts.on.value] ? opts.on.value : 'banker';
  const bet = Math.min(MAX_BET, Math.max(1, Math.floor((opts.bet && opts.bet.value) || DEFAULT_BET)));
  try { return await play(whoIs(i, s), side, bet); } catch (e) { console.error('baccarat', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}

/** The buttons under a result (custom_id ba:<side>:<bet>): a new hand for whoever pressed. */
export async function baccaratButton(i, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const [, side, b] = String(i.data.custom_id).split(':');
  if (!SIDES[side]) return json({ type: 6 });
  const bet = Math.min(MAX_BET, Math.max(1, Math.floor(+b || DEFAULT_BET)));
  // a short lock per person so a double tap doesn't deal two hands
  const me = whoIs(i, s), [got] = await kv(['SET', 'ba:lock:' + me.id, '1', 'NX', 'PX', 1500]);
  if (!got) return json({ type: 6 });
  return play(me, side, bet);
}
