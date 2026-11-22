// Blackjack with chips: /daily, /blackjack, /chips, and the Hit / Stand / Double / Split buttons.
//   /daily          +$100 for your first claim each week (weeks start Monday 16:00 UTC), +$50 for the other days (resets at 16:00 UTC)
//   /blackjack bet  one hand against the dealer, $1 to $500 (default $20). Blackjack pays 3:2, dealer stands on all 17s,
//                   double on any first two cards, split any two cards of the same value up to 6 hands (split aces get one card each, no re-split)
//   /freebet bet push22   Free Bet Blackjack, same chips and buttons: free double on a hard 9/10/11, free split on any pair except
//                   10-value cards (up to 6 hands), dealer hits soft 17, a dealer 22 pushes every hand still standing (blackjack still 3:2),
//                   optional Push 22 side bet ($0 to $25) pays 11:1. A free bet pays even money if its hand wins and costs nothing if it loses.
//   /chips          leaderboard of everyone's chips
// Balances live in Upstash Redis (Vercel: Storage > Upstash > connect to this project). It sets KV_REST_API_URL and
// KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN); either pair works. Keys: bj:bal, bj:last, bj:name (hashes
// keyed by Discord user ID) and bj:g:<id> (a hand in progress, expires after an hour).
import { randomInt, randomBytes } from 'node:crypto';

const SITE = 'https://renpokernight.vercel.app';
export const MAX_BET = 500;
/** Most hands one deal can be split into (both games). */
export const MAX_HANDS = 6;
/** Biggest Push 22 side bet on /freebet. */
export const MAX_PUSH22 = 25;
const DEFAULT_BET = 20, DAY = 24 * 3600e3;
/** The first claim of each week (Monday 16:00 UTC on) pays WEEKLY_CLAIM instead of DAILY. A brand-new player's first claim is just that weekly one. */
export const WEEKLY_CLAIM = 100, DAILY = 50;
/** The daily claim resets once a day at this hour (UTC), instead of 24 hours after your last claim. */
export const DAILY_RESET_UTC = 16;
/** The most recent reset time (ms) at or before now. */
export const lastReset = (now = Date.now()) => { const d = new Date(now), r = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAILY_RESET_UTC); return r > now ? r - DAY : r; };
/** ms until the next claim (0 = can claim now). */
const dailyWait = (last, now = Date.now()) => !last || +last < lastReset(now) ? 0 : lastReset(now) + DAY - now;

export const BLACKJACK_COMMANDS = [
  { name: 'daily', description: 'Claim free chips: $100 your first claim each week, $50 the other days (resets 16:00 UTC)', type: 1 },
  { name: 'blackjack', description: 'Play a hand of blackjack', type: 1,
    options: [{ type: 4, name: 'bet', description: `How much to bet ($1 to $${MAX_BET}, default $${DEFAULT_BET})`, min_value: 1, max_value: MAX_BET, required: false }] },
  { name: 'freebet', description: 'Free Bet Blackjack: free doubles on 9-11, free splits, dealer 22 pushes', type: 1,
    options: [{ type: 4, name: 'bet', description: `How much to bet ($1 to $${MAX_BET}, default $${DEFAULT_BET})`, min_value: 1, max_value: MAX_BET, required: false },
      { type: 4, name: 'push22', description: `Push 22 side bet, pays 11:1 if the dealer ends on 22 ($0 to $${MAX_PUSH22})`, min_value: 0, max_value: MAX_PUSH22, required: false }] },
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

// Takes chips in one step (check + take inside Redis), so two games started at once can't both spend the same chips.
// ARGV[1] = user, ARGV[2] = amount. Returns the new balance, or '-1' if they don't have that many.
export const DEBIT = "local b=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0') if b<tonumber(ARGV[2]) then return '-1' end return redis.call('HINCRBYFLOAT',KEYS[1],ARGV[1],-tonumber(ARGV[2]))";
/** Takes amt chips from id: { bal } (new balance) or { short: true, had } (had = their balance, null if they have none). */
export async function takeChips(id, amt) {
  const [left] = await kv(['EVAL', DEBIT, 1, 'bj:bal', id, amt]);
  if (String(left) !== '-1') return { bal: +left };
  const [b] = await kv(['HGET', 'bj:bal', id]);
  return { short: true, had: b === null ? null : +b };
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

// "Just now" feed on the site's /casino page: the last 300 finished hands, spins, duels and daily claims from Discord and the site.
// me.src is 'site' for the website; Discord players have no src.
// stats = extra counts for the casino accolades, e.g. { naturals: 1 } (see statCmds).
export const feedCmds = (me, game, net, wager = 0, stats = {}) => [
  ['LPUSH', 'cas:feed', JSON.stringify({ id: me.id, name: me.name, game, net: Math.round(net * 100) / 100, src: me.src || 'discord', at: Date.now() })],
  ['LTRIM', 'cas:feed', 0, FEED_KEEP - 1], ...houseCmds(me.id, game, net, wager), ...statCmds(me.id, game, net, stats)];

// ---------- counts for the casino accolades (see _accolades.js and ACC in loot.js) ----------
// Nobody sees these numbers; they only unlock titles and borders. One hash per player, ac:n:<id>:
//   blackjack / free bet / UTH / baccarat / roulette   hands (spins) finished at that game
//   daily      /daily claims          tips   chips received from tips minus chips tipped away (chip titles ignore these)
//   naturals   dealt blackjacks       royal  UTH royal flushes      believer  roulette spins won with every chip on one number
//   bjrun/bjbest, rlrun/rlbest, durun/dubest   current / best run of wins at blackjack + free bet, roulette, duels
//   heavy      house-game hands or spins won by $1,000+      sweep  blackjack splits of 3+ hands where every hand won
// Every change also drops the player in ac:dirty, so the next bot or site request checks them for new accolades.
// A win adds 1 to the run (ARGV[1]) and keeps the best run (ARGV[2]); a loss resets the run. One step, so the best can't be missed.
const STREAK = "if ARGV[3]=='1' then local r=redis.call('HINCRBY',KEYS[1],ARGV[1],1) if r>tonumber(redis.call('HGET',KEYS[1],ARGV[2]) or '0') then redis.call('HSET',KEYS[1],ARGV[2],r) end return r end redis.call('HSET',KEYS[1],ARGV[1],0) return 0";
function statCmds(id, game, net, stats) {
  if (!id) return [];
  const k = 'ac:n:' + id, out = [];
  if (HOUSE_GAMES.has(game)) out.push(['HINCRBY', k, game, 1]);
  else if (game === 'daily') out.push(['HINCRBY', k, 'daily', 1]);
  else if (/^tip (to|from) /.test(game)) out.push(['HINCRBYFLOAT', k, 'tips', Math.round(net * 100) / 100]);
  for (const [f, n] of Object.entries(stats || {})) if (+n) out.push(['HINCRBY', k, f, Math.round(+n)]);
  // earned bars: runs of wins (a loss resets, a push / break-even skips) and $1,000+ wins
  const run = game === 'blackjack' || game === 'free bet' ? 'bj' : game === 'roulette' ? 'rl' : /^duel vs /.test(game) ? 'du' : null;
  if (run && Math.abs(net) > 0.004) out.push(['EVAL', STREAK, 1, k, run + 'run', run + 'best', net > 0 ? 1 : 0]);
  if (HOUSE_GAMES.has(game) && net >= 1000) out.push(['HINCRBY', k, 'heavy', 1]);
  out.push(['SADD', 'ac:dirty', id]);
  return out;
}

// ---------- the house's books + weekly rakeback ----------
// Every finished hand at a house game goes through feedCmds, so it is counted here too:
//   hs:all            game -> what the house won all-time (from when this was added), plus 'rakeback' (paid back, negative)
//   hs:wk:<week>      the same for one week
//   rb:wk:<week>      Discord ID -> that player's net at the house games that week   } what rakeback pays from,
//   rb:vol:<week>     Discord ID -> everything they bet at the house games that week } see _rakeback.js
// Duels, tips, packs and dailies aren't house games, so they don't count.
// A week starts Monday at the daily reset (16:00 UTC); <week> is that Monday's date, e.g. 2026-11-16.
export const HOUSE_GAMES = new Set(['blackjack', 'free bet', 'UTH', 'baccarat', 'roulette']);
export const weekStart = (now = Date.now()) => { const r = lastReset(now); return r - ((new Date(r).getUTCDay() + 6) % 7) * DAY; };
export const weekKey = (now = Date.now()) => new Date(weekStart(now)).toISOString().slice(0, 10);
const KEEP_WEEKS = 120 * 86400;   // seconds the weekly hashes are kept
function houseCmds(id, game, net, wager) {
  net = Math.round(net * 100) / 100; wager = Math.round((+wager || 0) * 100) / 100;
  if (!HOUSE_GAMES.has(game) || !id || (!net && !wager)) return [];
  const wk = weekKey();
  return [['HINCRBYFLOAT', 'rb:wk:' + wk, id, net], ['EXPIRE', 'rb:wk:' + wk, KEEP_WEEKS],
    ...(wager ? [['HINCRBYFLOAT', 'rb:vol:' + wk, id, wager], ['EXPIRE', 'rb:vol:' + wk, KEEP_WEEKS]] : []),
    ['HINCRBYFLOAT', 'hs:wk:' + wk, game, -net], ['EXPIRE', 'hs:wk:' + wk, KEEP_WEEKS], ['HINCRBYFLOAT', 'hs:all', game, -net]];
}
// Rakeback = a share of the week's net loss + a sliver of everything bet (kept under the house edge), capped per week.
export const RAKE = { loss: 0.10, volume: 0.0025, cap: 250 };
/** What a week pays back on Monday, from the player's net and total bet at the house games. */
export const rakeFor = (net, vol = 0) => Math.min(RAKE.cap, Math.round((Math.max(0, -(+net || 0)) * RAKE.loss + (+vol || 0) * RAKE.volume) * 100) / 100);
/** The /chips line: only the rakeback so far, never the loss. '' when they haven't played this week. */
export const weekLine = (net, vol) => { const r = rakeFor(net, vol); return r >= 0.01 ? `**${money(r)}** rakeback so far, paid Monday` : ''; };
/** Total bet in a blackjack hand (all hands incl. paid doubles/splits, plus the side bet). */
/** 1 when a blackjack hand was split into 3+ hands and every one of them won (Clean Sweep) */
const sweep = g => g.hands.length >= 3 && g.hands.every(h => h.res === 'win' || h.res === 'bj') ? 1 : 0;
const staked = g => g.hands.reduce((a, h) => a + h.bet, 0) + (g.side || 0);
/** How many raw feed entries are kept; the lobby rolls them into session lines (see groupFeed in _casino.js). */
export const FEED_KEEP = 300;

// ---------- /daily ----------
/** Shared by /daily and the site: { wait } (ms until the next claim) or { amt, bal, first }. */
export async function claimDaily(me) {
  const now = Date.now();
  // a short lock so two taps (or Discord and the site at once) can't both claim
  const [last, got] = await kv(['HGET', 'bj:last', me.id], ['SET', 'bj:dlock:' + me.id, '1', 'NX', 'PX', 3000]);
  const wait = dailyWait(last, now);
  if (wait) return { wait, amt: claimAmt(last, now + wait) };
  if (!got) return { wait: 0, busy: true, amt: claimAmt(last, now) };
  const amt = claimAmt(last, now);
  const [bal] = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, amt], ['HSET', 'bj:last', me.id, now], ['HSET', 'bj:name', me.id, me.name], ...feedCmds(me, 'daily', amt));
  return { amt, bal: +bal, weekly: amt === WEEKLY_CLAIM, next: claimAmt(now, lastReset(now) + DAY) };
}
/** What a claim at `at` pays: WEEKLY_CLAIM if it's the first since this week started (or ever), else DAILY. */
export const claimAmt = (last, at = Date.now()) => !last || +last < weekStart(at) ? WEEKLY_CLAIM : DAILY;
/** When the next daily is ready (ms from now, 0 = ready) and how much it gives. */
export const dailyFrom = (last, now = Date.now()) => { const wait = dailyWait(last, now); return { wait, amt: claimAmt(last, now + wait) }; };
export async function dailyStatus(id) {
  const [last] = await kv(['HGET', 'bj:last', id]);
  return dailyFrom(last);
}

async function daily(i, s) {
  const me = whoIs(i, s);
  const r = await claimDaily(me);
  if (r.busy) return quiet('One moment, that claim is already going through.');
  if (r.wait !== undefined) {
    const left = Math.ceil(r.wait / 60e3), hrs = Math.floor(left / 60), mins = left % 60;
    return quiet(`⏳ Already claimed. Next **+${money(r.amt)}** in ${hrs}h ${mins}m.`);
  }
  const { amt, bal } = r;
  return json({ type: 4, data: { allowed_mentions: { parse: [] }, embeds: [{ color: 0x8ee0b0,
    title: r.weekly ? `🎁 ${me.name} claimed the weekly ${money(amt)}` : `🎁 ${me.name} claimed ${money(amt)}`,
    description: `${r.weekly ? 'First claim of the week gets double. ' : ''}**+${money(amt)}** in chips\n\nBalance **${money(+bal)}**`,
    footer: { text: `Next +${money(r.next)} after ${DAILY_RESET_UTC}:00 UTC` } }] } });
}

// ---------- /chips ----------
/** Everyone's chips, most first: [{ id, name, bal }]. Shared by /chips and the site. */
export async function chipBoard() {
  const [bal, names] = await kv(['HGETALL', 'bj:bal'], ['HGETALL', 'bj:name']);
  return boardFrom(bal, names);
}
/** The leaderboard from raw HGETALL bj:bal and bj:name replies. */
export function boardFrom(bal, names) {
  const pairs = a => { const o = {}; for (let k = 0; k < (a || []).length; k += 2) o[a[k]] = a[k + 1]; return o; };
  const b = pairs(bal), n = pairs(names);
  return Object.entries(b).map(([id, v]) => ({ id, name: n[id] || 'Someone', bal: +v })).sort((x, y) => y.bal - x.bal);
}
async function chips(i) {
  const me = whoIs(i), wk = weekKey();
  const [bal, names, net, vol] = await kv(['HGETALL', 'bj:bal'], ['HGETALL', 'bj:name'], ['HGET', 'rb:wk:' + wk, me.id || '-'], ['HGET', 'rb:vol:' + wk, me.id || '-']);
  const rows = boardFrom(bal, names).slice(0, 15).map(r => [r.name, r.bal]);
  const week = weekLine(net, vol);
  const medal = ['🥇', '🥈', '🥉'];
  const lines = rows.map(([nm, v], k) => `${medal[k] || `\`${k + 1}.\``} **${nm}** · ${money(v)}${v < 1 ? ' · broke 💀' : ''}`);
  return json({ type: 4, data: { allowed_mentions: { parse: [] }, embeds: [{ color: 0xf1c75b, title: '🪙 Blackjack chip leaders',
    description: (lines.join('\n') || 'Nobody has chips yet. Use /daily to get started.') + (week ? `\n\n**${me.name}**, this week: ${week}` : ''), footer: { text: '/daily for free chips' } }] } });
}

// ---------- a hand ----------
const draw = g => g.deck.pop();
const active = g => g.hands[g.active];
const isFree = g => g.mode === 'free';
const GAME = g => isFree(g) ? 'free bet' : 'blackjack';       // name in the "just now" feed
const TITLE = g => isFree(g) ? 'Free Bet Blackjack' : 'Blackjack';
const CMD = g => isFree(g) ? 'freebet' : 'blackjack';
/** What the hand being played may do. A paid double or split costs g.bet (the original bet); a free one costs nothing.
 *  Free Bet: free double on a hard 9, 10 or 11 (two cards), free split on any pair except 10-value cards. */
export function moves(g, bal) {
  if (g.over) return { dbl: false, spl: false, dblFree: false, splFree: false };
  const h = active(g), two = h.cards.length === 2, t = total(h.cards);
  const dblFree = isFree(g) && two && !h.aces && !t.soft && t.t >= 9 && t.t <= 11;
  const dbl = two && !h.aces && (dblFree || bal >= g.bet);
  const pair = two && !h.aces && cardVal(h.cards[0]) === cardVal(h.cards[1]) && g.hands.length < MAX_HANDS;
  const splFree = isFree(g) && pair && cardVal(h.cards[0]) !== 10;
  const spl = pair && (splFree || bal >= g.bet);
  return { dbl, spl, dblFree, splFree };
}

function advance(g) {
  while (g.active < g.hands.length && g.hands[g.active].done) g.active++;
  if (g.active >= g.hands.length) settle(g);
}
// a hand that reaches 21 or busts is finished on its own
const autoDone = h => { if (total(h.cards).t >= 21) h.done = true; };

// Classic: dealer stands on all 17s. Free Bet: dealer hits soft 17.
const dealerHits = g => { const t = total(g.dealer); return t.t < 17 || (isFree(g) && t.t === 17 && t.soft); };
export function settle(g) {
  g.over = true; g.active = Math.max(0, g.hands.length - 1);
  const dealerNat = g.dealer.length === 2 && total(g.dealer).t === 21;
  const live = g.hands.some(h => total(h.cards).t <= 21 && !natural(h));
  // a Push 22 side bet needs the dealer's hand played out even when every hand is done
  if ((live || g.side) && !dealerNat) while (dealerHits(g)) g.dealer.push(draw(g));
  const d = total(g.dealer).t;
  g.d22 = isFree(g) && d === 22;
  g.payout = 0;
  for (const h of g.hands) {
    const p = total(h.cards).t, free = h.free || 0;
    let back = 0;
    if (p > 21) h.res = 'bust';
    else if (natural(h) && !dealerNat) { h.res = 'bj'; back = h.bet * 2.5; }
    else if (dealerNat && natural(h)) { h.res = 'push'; back = h.bet; }
    else if (dealerNat) h.res = 'lose';
    else if (g.d22) { h.res = 'push'; back = h.bet; }               // Free Bet: dealer 22 pushes
    else if (d > 21 || p > d) { h.res = 'win'; back = h.bet * 2 + free; } // a free bet is paid even money, never returned
    else if (p === d) { h.res = 'push'; back = h.bet; }
    else h.res = 'lose';
    h.won = back - h.bet; g.payout += back;
  }
  g.sideWin = g.side && d === 22 && !dealerNat ? g.side * 12 : 0;   // 11:1 plus the side bet back
  g.payout += g.sideWin;
  g.net = g.payout - g.hands.reduce((a, h) => a + h.bet, 0) - (g.side || 0);
}

function view(g, bal) {
  const code = cs => cs.join('.');
  const hide = !g.over;
  const q = new URLSearchParams({ d: hide ? g.dealer[0] + '.XX' : code(g.dealer), p: g.hands.map(h => code(h.cards)).join('-'),
    a: g.over ? '' : String(g.active), r: g.over ? g.hands.map(h => h.res).join('.') : '', b: g.hands.map(h => h.bet).join('.'), n: g.name, v: g.id + g.step });
  if (isFree(g)) { q.set('f', g.hands.map(h => h.free || 0).join('.')); if (g.side) q.set('s', g.side); if (g.over) q.set('x', [g.d22 ? 'd22' : '', g.side ? (g.sideWin ? 'sw' : 'sl') : ''].filter(Boolean).join('.')); }
  const onTable = g.hands.reduce((a, h) => a + h.bet, 0) + (g.side || 0), freeOn = g.hands.reduce((a, h) => a + (h.free || 0), 0);
  const RES = { win: 'won', bj: 'hit blackjack 🔥', push: 'pushed', lose: 'lost', bust: 'busted' };
  let title, description = '', color;
  if (!g.over) { title = `🃏 ${TITLE(g)} · ${g.name} bets ${money(g.bet)}${g.side ? ` + ${money(g.side)} Push 22` : ''}`; color = 0x6e52c8;
    if (g.hands.length > 1) description = `Playing hand ${g.active + 1} of ${g.hands.length}`; }
  else {
    title = g.net > 0 ? `🃏 ${g.name} wins ${money(g.net)}!` : g.net < 0 ? `🃏 ${g.name} loses ${money(-g.net)}` : `🃏 ${g.name} breaks even`;
    color = g.net > 0 ? 0x8ee0b0 : g.net < 0 ? 0xf59bb0 : 0x9a94c4;
    const d = total(g.dealer).t;
    const lines = g.hands.map((h, k) => `${g.hands.length > 1 ? `Hand ${k + 1}: ` : ''}${total(h.cards).t}${h.freeDbl ? ' (free double)' : h.doubled ? ' (doubled)' : ''}${!h.bet && h.free ? ' (free hand)' : ''}, ${RES[h.res]}${isFree(g) && h.won > 0 ? ' ' + money(h.won) : ''}`);
    if (g.side) lines.push(g.sideWin ? `Push 22: ${money(g.side)} pays ${money(g.side * 11)} 🎯` : `Push 22: lost ${money(g.side)}`);
    description = `${g.d22 ? 'Dealer hit 22, so standing hands push' : d > 21 ? 'Dealer busted with ' + d : 'Dealer has ' + d}\n${lines.join('\n')}\n\nBalance **${money(bal)}**`;
  }
  const footer = g.over ? (isFree(g) ? 'Free doubles on 9-11 · free splits (not 10s) · dealer 22 pushes · dealer hits soft 17' : 'Blackjack pays 3:2 · dealer stands on 17 · split up to 6 hands')
    : `Balance ${money(bal)} (+${money(onTable)} on the table${freeOn ? `, ${money(freeOn)} free` : ''}) · only ${g.name} can press these`;
  const btn = (label, emoji, id, style, disabled = false) => ({ type: 2, style, label, emoji: { name: emoji }, custom_id: `bj:${id}:${g.id}:${g.step}`, disabled }); // the step makes a stale or repeated press harmless
  const m = moves(g, bal), again = g.bet + (g.side || 0);
  const row = g.over ? [btn(`Play again (${money(g.bet)}${g.side ? ` + ${money(g.side)}` : ''})`, '🔁', 'again', 1, bal < again)]
    : [btn('Hit', '👊', 'hit', 1), btn('Stand', '✋', 'stand', 2),
       ...(m.dbl ? [m.dblFree ? btn('Free Double', '🎟️', 'double', 3) : btn('Double', '💰', 'double', 3)] : []),
       ...(m.spl ? [m.splFree ? btn('Free Split', '🎟️', 'split', 3) : btn('Split', '✂️', 'split', 3)] : [])];
  return { allowed_mentions: { parse: [] }, embeds: [{ color, title, description: description || undefined, image: { url: `${SITE}/api/bjcards?${q}` }, footer: { text: footer } }],
    components: [{ type: 1, components: row }] };
}

/** Deals a new hand and takes the bet (plus any Push 22 side bet) in one step. Shared by /blackjack, /freebet and the site.
 *  mode 'free' = Free Bet Blackjack. Returns { g, bal } or { err }. */
export async function newHand(me, bet, mode = '', side = 0) {
  const free = mode === 'free';
  side = free ? Math.min(MAX_PUSH22, Math.max(0, Math.floor(+side || 0))) : 0;
  const took = await takeChips(me.id, bet + side);
  if (took.short) { const b = took.had;
    if (b === null) return { err: `You don't have any chips yet. Use **/daily** to get ${money(WEEKLY_CLAIM)} free.` };
    return { err: b < 1 ? `You're out of chips 💀 Use **/daily** for more.` : `You only have ${money(b)}. Bet that or less${side ? ' (the side bet counts too)' : ''}.` }; }
  const g = { id: randomBytes(5).toString('hex'), uid: me.id, name: me.name, bet, step: 0, deck: freshDeck(), dealer: [], hands: [{ cards: [], bet, free: 0 }], active: 0, over: false,
    ...(free ? { mode: 'free', side } : {}) };
  g.hands[0].cards.push(draw(g)); g.dealer.push(draw(g)); g.hands[0].cards.push(draw(g)); g.dealer.push(draw(g));
  g.nat = natural(g.hands[0]) ? 1 : 0; // a dealt blackjack, for the Natural accolade
  if (natural(g.hands[0]) || total(g.dealer).t === 21) settle(g);
  // the bet is already off (takeChips); this pays a hand that settled on the deal and saves it
  const res = await kv(g.over && g.payout ? ['HINCRBYFLOAT', 'bj:bal', me.id, g.payout] : ['HGET', 'bj:bal', me.id], ['HSET', 'bj:name', me.id, me.name], ['SET', 'bj:g:' + g.id, JSON.stringify(g), 'EX', 3600],
    ...(g.over ? feedCmds(me, GAME(g), g.net, staked(g), { naturals: g.nat, sweep: sweep(g) }) : []));
  return { g, bal: +res[0] };
}

async function blackjack(i, opts, s, mode = '') {
  const bet = Math.min(MAX_BET, Math.max(1, Math.floor((opts.bet && opts.bet.value) || DEFAULT_BET)));
  const out = await newHand(whoIs(i, s), bet, mode, opts.push22 ? opts.push22.value : 0);
  if (out.err) return quiet(out.err);
  return json({ type: 4, data: view(out.g, out.bal) });
}
const freebet = (i, opts, s) => blackjack(i, opts, s, 'free');

/** Hit / Stand / Double / Split on a hand in progress. Shared by the Discord buttons and the site.
 *  Returns { g, bal }, { err } (a message for the player), { gone } (hand expired), { notYours }, or { busy } (a tap is already being handled). */
/** step = the hand step the button was drawn for (Discord): a press from an older step changes nothing and returns { stale, g, bal }. */
export async function handAction(me, gid, action, step) {
  // one trip to read the hand, take the lock and read the balance; one trip to write and unlock
  const [raw, lock, balRaw] = await kv(['GET', 'bj:g:' + gid], ['SET', 'bj:lock:' + gid, '1', 'NX', 'EX', 5], ['HGET', 'bj:bal', me.id]);
  let wrote = false;
  const unlock = () => kv(['DEL', 'bj:lock:' + gid]).catch(() => {});
  if (!raw) { if (lock) await unlock(); return { gone: true }; }
  const g = JSON.parse(raw);
  if (g.uid !== me.id) { if (lock) await unlock(); return { notYours: g.name }; }
  if (!lock) return { busy: true };
  try {
    let bal = +balRaw || 0, spend = 0;
    if (step !== undefined && (+step !== g.step || g.over)) return { stale: true, g, bal };
    if (g.over) return { busy: true };
    const h = active(g), m = moves(g, bal);
    if (action === 'hit') { h.cards.push(draw(g)); autoDone(h); }
    else if (action === 'stand') h.done = true;
    else if (action === 'double') {
      if (!m.dbl) return { err: "You can't double here (two cards only, and you need the chips to match your bet)." };
      if (m.dblFree) { h.free = (h.free || 0) + g.bet; h.freeDbl = true; } else { spend = g.bet; h.bet += g.bet; }
      h.doubled = true; h.cards.push(draw(g)); h.done = true;
    } else if (action === 'split') {
      if (!m.spl) return { err: `You can only split two cards of the same value, up to ${MAX_HANDS} hands, with chips to match your bet.` };
      const [c1, c2] = h.cards, aces = c1[0] === 'A';
      const nh = { cards: [c2, draw(g)], bet: 0, free: 0, split: true, aces };
      if (m.splFree) nh.free = g.bet; else { spend = g.bet; nh.bet = g.bet; }
      h.cards = [c1, draw(g)]; h.split = true; h.aces = aces;
      g.hands.splice(g.active + 1, 0, nh);
      for (const x of [h, nh]) { if (aces) x.done = true; autoDone(x); }
    } else return { busy: true };
    if (spend) { // doubles and splits: take the extra bet in one step (another game may have spent the chips since we read them)
      const took = await takeChips(me.id, spend);
      if (took.short) return { err: `You need ${money(spend)} more on the table and have ${money(took.had || 0)}.` };
    }
    advance(g); g.step++;
    const delta = g.over ? g.payout : 0;
    const res = await kv(...(delta ? [['HINCRBYFLOAT', 'bj:bal', me.id, delta]] : [['HGET', 'bj:bal', me.id]]), ['SET', 'bj:g:' + g.id, JSON.stringify(g), 'EX', 3600], ['DEL', 'bj:lock:' + gid],
      ...(g.over ? feedCmds(me, GAME(g), g.net, staked(g), { naturals: g.nat, sweep: sweep(g) }) : []));
    wrote = true; bal = +res[0];
    return { g, bal };
  } finally { if (!wrote) await unlock(); }
}

/** What the site may see of a hand: no deck, and the dealer's second card stays face down until it's over. */
export function publicHand(g, bal) {
  const m = moves(g, bal);
  return { id: g.id, bet: g.bet, over: g.over, active: g.active, net: g.net, payout: g.payout, mode: g.mode || 'classic', side: g.side || 0, sideWin: g.sideWin || 0, d22: !!g.d22,
    dealer: g.over ? g.dealer : [g.dealer[0], 'XX'], dealerTotal: total(g.over ? g.dealer : [g.dealer[0]]).t,
    hands: g.hands.map(h => ({ cards: h.cards, bet: h.bet, free: h.free || 0, doubled: !!h.doubled, freeDbl: !!h.freeDbl, res: h.res || null, total: total(h.cards).t, soft: total(h.cards).soft })),
    canDouble: m.dbl, canSplit: m.spl, freeDouble: m.dblFree, freeSplit: m.splFree };
}

/** The buttons under a hand (custom_id bj:<action>:<hand id>). */
export async function blackjackButton(i, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const [, action, gid, step] = String(i.data.custom_id).split(':'); // step is missing on buttons drawn before it existed
  const me = whoIs(i, s);
  if (action === 'again') {
    const [raw, lock] = await kv(['GET', 'bj:g:' + gid], ['SET', 'bj:lock:' + gid, '1', 'NX', 'EX', 5]);
    const unlock = () => kv(['DEL', 'bj:lock:' + gid]).catch(() => {});
    if (!raw) { if (lock) await unlock(); return quiet('This hand has expired. Start a new one with **/blackjack** or **/freebet**.'); }
    const g = JSON.parse(raw);
    if (g.uid !== me.id) { if (lock) await unlock(); return quiet(`That's ${g.name}'s hand. Start your own with **/${CMD(g)}**.`); }
    if (!lock) return json({ type: 6 });
    try {
      if (!g.over) return json({ type: 6 });
      // a second Play again on the same message while the hand it dealt is still going (say, the first answer was too slow
      // and never showed) shows that hand again instead of dealing and charging another one
      if (g.next) {
        const [nRaw, nBal] = await kv(['GET', 'bj:g:' + g.next], ['HGET', 'bj:bal', me.id]);
        const n = nRaw && JSON.parse(nRaw);
        if (n && n.uid === me.id && !n.over) return json({ type: 4, data: view(n, +nBal || 0) });
      }
      const out = await newHand(me, g.bet, g.mode, g.side);
      if (out.err) return quiet(out.err);
      g.next = out.g.id; await kv(['SET', 'bj:g:' + g.id, JSON.stringify(g), 'KEEPTTL']);
      return json({ type: 4, data: view(out.g, out.bal) });
    } finally { await unlock(); }
  }
  const r = await handAction(me, gid, action, step);
  if (r.gone) return quiet('This hand has expired. Start a new one with **/blackjack** or **/freebet**.');
  if (r.notYours) return quiet(`That's ${r.notYours}'s hand. Start your own with **/blackjack** or **/freebet**.`);
  if (r.stale) return json({ type: 7, data: view(r.g, r.bal) }); // the message was behind: show where the hand really is, play nothing
  if (r.busy) return quiet('Your last move is still going through. If the table looks behind, press any button to refresh it.');
  if (r.err) return quiet(r.err);
  return json({ type: 7, data: view(r.g, r.bal) });
}

/** Slash commands: returns a Response, or null when the command isn't a blackjack one. */
export async function blackjackCommand(i, opts, s) {
  const run = { daily, blackjack, freebet, chips }[i.data.name];
  if (!run) return null;
  if (!kvUrl() || !kvToken()) return noStorage();
  try { return await run(i, opts, s); }
  catch (e) { console.error('blackjack', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}
