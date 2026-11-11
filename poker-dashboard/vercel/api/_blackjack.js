// Blackjack with chips: /daily, /blackjack, /chips, and the Hit / Stand / Double / Split buttons.
//   /daily          +$100 the first time, then +$50 every 24 hours
//   /blackjack bet  one hand against the dealer, $1 to $500 (default $20). Blackjack pays 3:2, dealer stands on all 17s,
//                   double on any first two cards, one split (any two cards of the same value; split aces get one card each)
//   /chips          leaderboard of everyone's chips
// Balances live in Upstash Redis (Vercel: Storage > Upstash > connect to this project). It sets KV_REST_API_URL and
// KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN); either pair works. Keys: bj:bal, bj:last, bj:name (hashes
// keyed by Discord user ID) and bj:g:<id> (a hand in progress, expires after an hour).
import { randomInt, randomBytes } from 'node:crypto';

const SITE = 'https://renpokernight.vercel.app';
export const MAX_BET = 500;
const DEFAULT_BET = 20, FIRST_CLAIM = 100, DAILY = 50, DAY = 24 * 3600e3;

export const BLACKJACK_COMMANDS = [
  { name: 'daily', description: 'Claim free blackjack chips: $100 the first time, then $50 a day', type: 1 },
  { name: 'blackjack', description: 'Play a hand of blackjack', type: 1,
    options: [{ type: 4, name: 'bet', description: `How much to bet ($1 to $${MAX_BET}, default $${DEFAULT_BET})`, min_value: 1, max_value: MAX_BET, required: false }] },
  { name: 'chips', description: 'Blackjack chip leaderboard', type: 1 },
];

// ---------- storage (Upstash REST: one HTTP call per batch of commands) ----------
export const kvUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
export const kvToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export async function kv(...cmds) {
  const r = await fetch(kvUrl().replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('storage said ' + r.status);
  const out = await r.json();
  return out.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

// ---------- cards ----------
const RANKS = 'A23456789TJQK', SUITS = 'SHDC';
export const freshDeck = () => { const d = []; for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  for (let k = d.length - 1; k > 0; k--) { const j = randomInt(k + 1); [d[k], d[j]] = [d[j], d[k]]; } return d; };
const cardVal = c => c[0] === 'A' ? 1 : 'TJQK'.includes(c[0]) ? 10 : +c[0];
export function total(cards) {
  let t = 0, aces = 0; for (const c of cards) { t += cardVal(c); if (c[0] === 'A') aces++; }
  const soft = aces > 0 && t + 10 <= 21; return { t: soft ? t + 10 : t, soft };
}
const natural = h => h.cards.length === 2 && !h.split && total(h.cards).t === 21;

export const money = n => (n < 0 ? '−' : '') + '$' + (Math.abs(n) % 1 ? Math.abs(n).toFixed(2) : Math.abs(n));
export const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
export const quiet = content => json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

export function whoIs(i, s) {
  const u = (i.member && i.member.user) || i.user || {};
  const sheetName = s && s.ids ? Object.keys(s.ids).find(n => s.ids[n] === u.id) : null;
  return { id: u.id, name: sheetName || (i.member && i.member.nick) || u.global_name || u.username || 'Someone' };
}
export const noStorage = () => quiet("Blackjack isn't set up yet: the site needs its chip storage (Upstash) connected in Vercel.");

// ---------- /daily ----------
async function daily(i, s) {
  const me = whoIs(i, s), now = Date.now();
  const [last] = await kv(['HGET', 'bj:last', me.id]);
  if (last && now - +last < DAY) {
    const left = Math.ceil((DAY - (now - +last)) / 60e3), hrs = Math.floor(left / 60), mins = left % 60;
    return quiet(`⏳ Already claimed. Next **+${money(DAILY)}** in ${hrs}h ${mins}m.`);
  }
  const amt = last ? DAILY : FIRST_CLAIM;
  const [bal] = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, amt], ['HSET', 'bj:last', me.id, now], ['HSET', 'bj:name', me.id, me.name]);
  return json({ type: 4, data: { allowed_mentions: { parse: [] }, embeds: [{ color: 0x8ee0b0,
    title: last ? `🎁 ${me.name} claimed ${money(amt)}` : '🎁 Welcome bonus!',
    description: `${last ? '' : 'First claim gets double. '}**+${money(amt)}** in chips\n\nBalance **${money(+bal)}**`,
    footer: { text: `Come back in 24 hours for +${money(DAILY)}` } }] } });
}

// ---------- /chips ----------
async function chips() {
  const [bal, names] = await kv(['HGETALL', 'bj:bal'], ['HGETALL', 'bj:name']);
  const pairs = a => { const o = {}; for (let k = 0; k < (a || []).length; k += 2) o[a[k]] = a[k + 1]; return o; };
  const b = pairs(bal), n = pairs(names);
  const rows = Object.entries(b).map(([id, v]) => [n[id] || 'Someone', +v]).sort((x, y) => y[1] - x[1]).slice(0, 15);
  const medal = ['🥇', '🥈', '🥉'];
  const lines = rows.map(([nm, v], k) => `${medal[k] || `\`${k + 1}.\``} **${nm}** · ${money(v)}${v < 1 ? ' · broke 💀' : ''}`);
  return json({ type: 4, data: { allowed_mentions: { parse: [] }, embeds: [{ color: 0xf1c75b, title: '🪙 Blackjack chip leaders',
    description: lines.join('\n') || 'Nobody has chips yet. Use /daily to get started.', footer: { text: '/daily for free chips' } }] } });
}

// ---------- a hand ----------
const draw = g => g.deck.pop();
const active = g => g.hands[g.active];
const canDouble = (g, bal) => !g.over && active(g).cards.length === 2 && bal >= active(g).bet;
const canSplit = (g, bal) => !g.over && g.hands.length === 1 && active(g).cards.length === 2 && cardVal(active(g).cards[0]) === cardVal(active(g).cards[1]) && bal >= active(g).bet;

function advance(g) {
  while (g.active < g.hands.length && g.hands[g.active].done) g.active++;
  if (g.active >= g.hands.length) settle(g);
}
// a hand that reaches 21 or busts is finished on its own
const autoDone = h => { if (total(h.cards).t >= 21) h.done = true; };

function settle(g) {
  g.over = true; g.active = Math.max(0, g.hands.length - 1);
  const dealerNat = g.dealer.length === 2 && total(g.dealer).t === 21;
  const live = g.hands.some(h => total(h.cards).t <= 21 && !natural(h));
  if (live && !dealerNat) while (total(g.dealer).t < 17) g.dealer.push(draw(g));
  const d = total(g.dealer).t;
  g.payout = 0;
  for (const h of g.hands) {
    const p = total(h.cards).t;
    if (p > 21) h.res = 'bust';
    else if (natural(h) && !dealerNat) { h.res = 'bj'; g.payout += h.bet * 2.5; }
    else if (dealerNat && natural(h)) { h.res = 'push'; g.payout += h.bet; }
    else if (dealerNat) h.res = 'lose';
    else if (d > 21 || p > d) { h.res = 'win'; g.payout += h.bet * 2; }
    else if (p === d) { h.res = 'push'; g.payout += h.bet; }
    else h.res = 'lose';
  }
  g.net = g.payout - g.hands.reduce((a, h) => a + h.bet, 0);
}

function view(g, bal) {
  const code = cs => cs.join('.');
  const hide = !g.over;
  const q = new URLSearchParams({ d: hide ? g.dealer[0] + '.XX' : code(g.dealer), p: g.hands.map(h => code(h.cards)).join('-'),
    a: g.over ? '' : String(g.active), r: g.over ? g.hands.map(h => h.res).join('.') : '', b: g.hands.map(h => h.bet).join('.'), n: g.name, v: g.id + g.step });
  const onTable = g.hands.reduce((a, h) => a + h.bet, 0);
  const RES = { win: 'won', bj: 'hit blackjack 🔥', push: 'pushed', lose: 'lost', bust: 'busted' };
  let title, description = '', color;
  if (!g.over) { title = `🃏 Blackjack · ${g.name} bets ${money(onTable)}`; color = 0x6e52c8;
    if (g.hands.length > 1) description = `Playing hand ${g.active + 1} of ${g.hands.length}`; }
  else {
    title = g.net > 0 ? `🃏 ${g.name} wins ${money(g.net)}!` : g.net < 0 ? `🃏 ${g.name} loses ${money(-g.net)}` : `🃏 ${g.name} breaks even`;
    color = g.net > 0 ? 0x8ee0b0 : g.net < 0 ? 0xf59bb0 : 0x9a94c4;
    const d = total(g.dealer).t;
    const hands = g.hands.map((h, k) => `${g.hands.length > 1 ? `Hand ${k + 1}: ` : ''}${total(h.cards).t}${h.doubled ? ' (doubled)' : ''}, ${RES[h.res]}`).join('\n');
    description = `Dealer ${d > 21 ? 'busted with ' + d : 'has ' + d}\n${hands}\n\nBalance **${money(bal)}**`;
  }
  const footer = g.over ? 'Blackjack pays 3:2 · dealer stands on 17'
    : `Balance ${money(bal)} (+${money(onTable)} on the table) · only ${g.name} can press these`;
  const btn = (label, emoji, id, style, disabled = false) => ({ type: 2, style, label, emoji: { name: emoji }, custom_id: `bj:${id}:${g.id}`, disabled });
  const row = g.over ? [btn(`Play again (${money(g.bet)})`, '🔁', 'again', 1, bal < g.bet)]
    : [btn('Hit', '👊', 'hit', 1), btn('Stand', '✋', 'stand', 2),
       ...(canDouble(g, bal) ? [btn('Double', '💰', 'double', 3)] : []), ...(canSplit(g, bal) ? [btn('Split', '✂️', 'split', 3)] : [])];
  return { allowed_mentions: { parse: [] }, embeds: [{ color, title, description: description || undefined, image: { url: `${SITE}/api/bjcards?${q}` }, footer: { text: footer } }],
    components: [{ type: 1, components: row }] };
}

async function newHand(me, bet) {
  const [balRaw] = await kv(['HGET', 'bj:bal', me.id]);
  if (balRaw === null) return { err: `You don't have any chips yet. Use **/daily** to get ${money(FIRST_CLAIM)} free.` };
  if (+balRaw < bet) return { err: +balRaw < 1 ? `You're out of chips 💀 Use **/daily** for more.` : `You only have ${money(+balRaw)}. Bet that or less.` };
  const g = { id: randomBytes(5).toString('hex'), uid: me.id, name: me.name, bet, step: 0, deck: freshDeck(), dealer: [], hands: [{ cards: [], bet }], active: 0, over: false };
  g.hands[0].cards.push(draw(g)); g.dealer.push(draw(g)); g.hands[0].cards.push(draw(g)); g.dealer.push(draw(g));
  if (natural(g.hands[0]) || total(g.dealer).t === 21) settle(g);
  const res = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, (g.over ? g.payout : 0) - bet], ['HSET', 'bj:name', me.id, me.name], ['SET', 'bj:g:' + g.id, JSON.stringify(g), 'EX', 3600]);
  return { g, bal: +res[0] };
}

async function blackjack(i, opts, s) {
  const bet = Math.min(MAX_BET, Math.max(1, Math.floor((opts.bet && opts.bet.value) || DEFAULT_BET)));
  const out = await newHand(whoIs(i, s), bet);
  if (out.err) return quiet(out.err);
  return json({ type: 4, data: view(out.g, out.bal) });
}

/** The buttons under a hand (custom_id bj:<action>:<hand id>). */
export async function blackjackButton(i, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const [, action, gid] = String(i.data.custom_id).split(':');
  const me = whoIs(i, s);
  const [raw, lock] = await kv(['GET', 'bj:g:' + gid], ['SET', 'bj:lock:' + gid, '1', 'NX', 'EX', 5]);
  const unlock = () => kv(['DEL', 'bj:lock:' + gid]).catch(() => {});
  if (!raw) { await unlock(); return quiet('This hand has expired. Start a new one with **/blackjack**.'); }
  const g = JSON.parse(raw);
  if (g.uid !== me.id) { if (lock) await unlock(); return quiet(`That's ${g.name}'s hand. Start your own with **/blackjack**.`); }
  if (!lock) return json({ type: 6 }); // a second tap while the first is still being handled
  try {
    if (action === 'again') {
      if (!g.over) return json({ type: 6 });
      const out = await newHand(me, g.bet);
      if (out.err) return quiet(out.err);
      return json({ type: 4, data: view(out.g, out.bal) });
    }
    if (g.over) return json({ type: 6 });
    const [balRaw] = await kv(['HGET', 'bj:bal', me.id]);
    let bal = +balRaw || 0, spend = 0;
    const h = active(g);
    if (action === 'hit') { h.cards.push(draw(g)); autoDone(h); }
    else if (action === 'stand') h.done = true;
    else if (action === 'double') {
      if (!canDouble(g, bal)) return quiet("You can't double here (two cards only, and you need the chips to match your bet).");
      spend = h.bet; h.bet *= 2; h.doubled = true; h.cards.push(draw(g)); h.done = true;
    } else if (action === 'split') {
      if (!canSplit(g, bal)) return quiet("You can only split two cards of the same value once, with chips to match your bet.");
      spend = h.bet;
      const [c1, c2] = h.cards, aces = c1[0] === 'A';
      g.hands = [{ cards: [c1, draw(g)], bet: h.bet, split: true }, { cards: [c2, draw(g)], bet: h.bet, split: true }];
      for (const x of g.hands) { if (aces) x.done = true; autoDone(x); }
    } else return json({ type: 6 });
    advance(g); g.step++;
    const delta = (g.over ? g.payout : 0) - spend;
    const res = await kv(...(delta ? [['HINCRBYFLOAT', 'bj:bal', me.id, delta]] : [['HGET', 'bj:bal', me.id]]), ['SET', 'bj:g:' + g.id, JSON.stringify(g), 'EX', 3600]);
    bal = +res[0];
    return json({ type: 7, data: view(g, bal) });
  } finally { await unlock(); }
}

/** Slash commands: returns a Response, or null when the command isn't a blackjack one. */
export async function blackjackCommand(i, opts, s) {
  const run = { daily, blackjack, chips }[i.data.name];
  if (!run) return null;
  if (!kvUrl() || !kvToken()) return noStorage();
  try { return await run(i, opts, s); }
  catch (e) { console.error('blackjack', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}
