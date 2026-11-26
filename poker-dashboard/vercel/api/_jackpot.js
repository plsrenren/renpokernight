// Casino jackpot (Nov 2026): one "mystery drop" pot shared by the house games (blackjack, free bet, UTH, baccarat, roulette).
// - Every hand (spin) the house wins puts JP.cut of what it won into the pot. A hand the house loses takes nothing out.
// - After each win the server picks a secret drop point at random between JP.seed and JP.cap. The losing hand that pushes the
//   pot past it wins the whole pot (it needs a bet of JP.minBet or more), then the pot restarts at JP.seed with a new secret point.
//   So it always pays by JP.cap. The drop point never leaves Redis.
// - The seed is new chips; the slices come out of the house's winnings. Both show on /house as their own lines
//   ('jackpot' = slices, 'jackpot seed' = seeds), next to rakeback. A jackpot win isn't a house-game result, so it doesn't
//   touch rakeback (rb:wk / rb:vol) or the accolade counts.
// Redis: jp (hash: pot, drop, since, wins, last*), jp:news (wins waiting to be announced in #casino, see announceJackpots).
// Game of the Week (_featured.js): the featured game's losing hands put in 4% instead of 2%.
// Run inside every house hand's own pipeline: houseCmds() in _blackjack.js appends jackpotCmds().
import { randomInt } from 'node:crypto';
import { kv, money, FEED_KEEP, weekKey } from './_blackjack.js';
import { postCasino } from './_rewards.js';
import { featuredGame, GOTW, GAME_INFO } from './_featured.js';

export const JP = { cut: 0.02, seed: 500, cap: 2000, minBet: 5 };
const SITE = 'https://www.thepoker.study';

// KEYS: jp, bj:bal, cas:feed, hs:wk:<week>, hs:all, jp:news, ac:n:<id>, ac:dirty (jackpot wins count toward the Mystery Machine / Struck Twice titles)
// ARGV: 1 id, 2 slice, 3 qualifies (1/0), 4 seed, 5 cap, 6 random 0-1 (next drop point), 7 name, 8 game, 9 src, 10 now ms, 11 feed keep, 12 featured game (1/0, Comped title)
const JACKPOT = `
local seed, cap, now = tonumber(ARGV[4]), tonumber(ARGV[5]), ARGV[10]
local nextDrop = seed + tonumber(ARGV[6]) * (cap - seed)
local function books(f, n) redis.call('HINCRBYFLOAT', KEYS[4], f, -n) redis.call('HINCRBYFLOAT', KEYS[5], f, -n) end
local pot = tonumber(redis.call('HGET', KEYS[1], 'pot') or '-1')
if pot < 0 then pot = seed redis.call('HSET', KEYS[1], 'pot', seed, 'drop', nextDrop, 'since', now) books('jackpot seed', seed) return '0' end
local add = tonumber(ARGV[2])
if add > 0 then pot = tonumber(redis.call('HINCRBYFLOAT', KEYS[1], 'pot', add)) books('jackpot', add) end
if ARGV[3] ~= '1' or pot < tonumber(redis.call('HGET', KEYS[1], 'drop') or '0') then return '0' end
local win = math.floor(pot * 100 + 0.5) / 100
redis.call('HINCRBYFLOAT', KEYS[2], ARGV[1], win)
redis.call('HSET', KEYS[1], 'pot', seed, 'drop', nextDrop, 'since', now, 'lastId', ARGV[1], 'lastName', ARGV[7], 'lastWin', win, 'lastAt', now, 'lastGame', ARGV[8])
redis.call('HINCRBY', KEYS[1], 'wins', 1)
redis.call('HINCRBY', KEYS[7], 'jackpots', 1) redis.call('SADD', KEYS[8], ARGV[1])
if ARGV[12] == '1' then redis.call('HINCRBY', KEYS[7], 'gwjack', 1) end
books('jackpot seed', seed)
local e = cjson.encode({ id = ARGV[1], name = ARGV[7], game = 'jackpot', why = 'mystery drop · ' .. ARGV[8], net = win, src = ARGV[9], at = tonumber(now) })
redis.call('LPUSH', KEYS[3], e) redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[11]) - 1)
redis.call('LPUSH', KEYS[6], e) redis.call('LTRIM', KEYS[6], 0, 19)
return tostring(win)`;

/** The pot command for one finished house hand (net = the player's result, wager = what they bet). [] if the house didn't win it. */
export function jackpotCmds(me, game, net, wager) {
  if (!me || !me.id || !(net < 0)) return [];
  // Game of the Week hands put in GOTW.cut (4%) instead of JP.cut (see _featured.js)
  const feat = game === featuredGame(), slice = Math.round(-net * (feat ? GOTW.cut : JP.cut) * 100) / 100, wk = weekKey();
  return [['EVAL', JACKPOT, 8, 'jp', 'bj:bal', 'cas:feed', 'hs:wk:' + wk, 'hs:all', 'jp:news', 'ac:n:' + me.id, 'ac:dirty',
    me.id, slice, (+wager || 0) >= JP.minBet ? 1 : 0, JP.seed, JP.cap, randomInt(1e6) / 1e6, me.name || 'Someone', game, me.src || 'discord', Date.now(), FEED_KEEP, feat ? 1 : 0]];
}

const pairs = a => { const o = {}; for (let k = 0; k < (a || []).length; k += 2) o[a[k]] = a[k + 1]; return o; };
/** What anyone may see: pot, cap, last win. Never the drop point. */
export function jackpotView(raw) {
  const h = pairs(raw);
  const fg = featuredGame();
  return { pot: h.pot === undefined ? JP.seed : Math.round(+h.pot * 100) / 100, seed: JP.seed, cap: JP.cap, wins: +h.wins || 0, cut: JP.cut,
    featured: { game: fg, short: GAME_INFO[fg].short, cut: GOTW.cut },
    last: h.lastId ? { id: h.lastId, name: h.lastName, win: +h.lastWin, at: +h.lastAt, game: h.lastGame } : null };
}
export async function readJackpot() { const [raw] = await kv(['HGETALL', 'jp']); return jackpotView(raw); }

const usd = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ago = ms => { const m = Math.round((Date.now() - ms) / 60e3); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 * 2 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
/** /jackpot */
export function jackpotEmbed(v) {
  return { color: 0xf1c75b, title: `🎰 Casino jackpot: ${usd(v.pot)}`, url: `${SITE}/casino`,
    description: `Drops at a secret amount before **${usd(v.cap)}**. The losing hand that pushes it over takes the whole pot.`,
    fields: [
      { name: 'How it grows', value: `${Math.round(JP.cut * 100)}% of every hand the house wins goes in, **${Math.round(GOTW.cut * 100)}% on ${GAME_INFO[featuredGame()].short}** this week (Game of the Week). Blackjack, free bet, UTH, baccarat and roulette all count.` },
      { name: 'To win', value: `Bet ${money(JP.minBet)} or more. Pot resets to ${money(JP.seed)} after a hit. ${GAME_INFO[featuredGame()].short} hands are twice as likely this week.` },
      ...(v.last ? [{ name: 'Last hit', value: `<@${v.last.id}> won **${usd(v.last.win)}** · ${ago(v.last.at)}` }] : []),
    ] };
}

const winEmbed = w => ({ color: 0xf1c75b, title: `💥 JACKPOT! ${w.name} wins ${usd(w.net)}`, url: `${SITE}/casino`,
  description: `<@${w.id}> lost a ${String(w.why).replace('mystery drop · ', '')} hand and hit the mystery drop. **${usd(w.net)}** is already in their balance.`,
  thumbnail: { url: `${SITE}/api/avatar?id=${w.id}` },
  footer: { text: `Next pot starts at ${money(JP.seed)} · must drop by ${money(JP.cap)} · /jackpot` } });

/** Posts any new jackpot wins in #casino.
 *  Called after every bot/site answer (waitUntil) and after a roulette spin. */
export async function afterJackpot() {
  const [news] = await kv(['EVAL', "local a=redis.call('LRANGE',KEYS[1],0,-1) if #a>0 then redis.call('DEL',KEYS[1]) end return a", 1, 'jp:news']);
  const wins = (news || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean).reverse();
  for (const w of wins) {
    try { await postCasino({ content: `<@${w.id}>`, embeds: [winEmbed(w)], allowed_mentions: { users: [w.id] } }); } catch (e) { console.error('jackpot post', e); }
  }
  return wins.length;
}
