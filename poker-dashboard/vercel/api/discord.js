// /api/discord — the Discord bot's "Interactions Endpoint URL" (slash commands land here).
//   /player                 your own card (matched by your Discord ID in the Members tab)
//   /player name:Renato     someone's card, with name suggestions as you type
//   /player user:@Renato    someone's card by their Discord account
//   season:This year        the season card instead of this quarter's (season:All time only when picked)
//   /standings              this quarter's leaderboard (season:This year for the year)
//   /recap                  the latest night's recap card (night: picks an older one)
//   /h2h player1 player2    head to head in games they both played (this year by default)
//   /hall                   Hall of Fame: record holders, champions, trophy counts
//   /wrap                   the last finished quarter's "wrapped" card (quarter: picks another)
//   /roles                  refreshes the results roles (Quarter Leader, Heater, ...; see _roles.js)
//   /tourney date:...       tournament invite people answer with reactions (see _tourney.js)
//   /cash date:...          same for a cash game
//   /daily /blackjack /freebet /chips  blackjack (and Free Bet Blackjack) with chips (see _blackjack.js; needs Upstash storage)
//   /duel                   player vs player for chips: coin flip (default), rock paper scissors or high card (see _duel.js)
//   /uth                    Ultimate Texas Hold'em against the dealer for chips (see _uth.js)
//   /roulette               shared roulette table, 30 seconds to bet, then it spins (see _roulette.js)
//   /baccarat               bet Player, Banker or Tie (see _baccarat.js)
//   /lottery odds           this quarter's lottery: jackpot, your tickets and everyone's odds (see _lottery.js)
//   /lottery draw           the host draws last quarter's winner live in the channel (host only)
//   /seats                  random seat order for everyone in on the latest invite (see _seats.js)
//   /pack /loadout /tip     Study Cards (cosmetics for your player card) and giving chips to someone (see _shop.js)
// Casino commands only run in #casino and poker commands only in #the-table; elsewhere they point there (_channels.js).
// Also serves the site's casino and shop: /api/login, /api/casino and /api/shop are rewritten here with ?web= (see _casino.js).
// One-time setup: open /api/discord?setup=1 in a browser. It registers the command and shows the "add to server" link.
// Needs Vercel env vars DISCORD_BOT_TOKEN (already there) and DISCORD_PUBLIC_KEY (from the Developer Portal).
import { createPublicKey, verify } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { TOURNEY_COMMAND, CASH_COMMAND, startTourney, tally, inviteBlocked, refreshInvite } from './_tourney.js';
import { syncRoles } from './_roles.js';
import { BLACKJACK_COMMANDS, blackjackCommand, blackjackButton } from './_blackjack.js';
import { DUEL_COMMAND, duelCommand, duelButton, sweepDuels } from './_duel.js';
import { SEATS_COMMAND, startSeats, reshuffle } from './_seats.js';
import { UTH_COMMAND, uthCommand, uthButton } from './_uth.js';
import { ROULETTE_COMMAND, rouletteCommand, rouletteInteraction } from './_roulette.js';
import { BACCARAT_COMMAND, baccaratCommand, baccaratButton } from './_baccarat.js';
import { casinoWeb } from './_casino.js';
import { checkAccolades } from './_accolades.js';
import { houseEmbed } from './_rakeback.js';
import { REWARD_LIST } from './_rewards.js';
import { WEEKLY_CLAIM, DAILY, DAILY_RESET_UTC, RAKE, kvUrl, kvToken } from './_blackjack.js';
import { SHOP_COMMANDS, shopCommand, shopInteraction } from './_shop.js';
import { wrongChannel } from './_channels.js';
import { withPicture, warmPictures } from './_attach.js';
import { board as lotteryBoard, quarterOf, shownQuarter, drawable, drawQuarter, TICKET, LUCKY_ROLE, nextQuarter } from './_lottery.js';
import { nightRows } from './_rewards.js';
import { SHEET_URL, MEMBERS_URL, gameRecords, findPlayer, latestQuarter, memberIds, toNights, hallOfFame, usd, wrapDefault, quartersWithGames } from '../recap-core.js';

const SITE = 'https://renpokernight.vercel.app';
const SEASON = { type: 3, name: 'season', description: 'This quarter or the whole year', required: false,
  choices: [{ name: 'This quarter', value: 'quarter' }, { name: 'This year', value: 'year' }] };
const PLAYER = (name, description, required = false) => ({ type: 3, name, description, autocomplete: true, required });
const COMMANDS = [
  { name: 'player', description: "Show a player's card from The Study", type: 1,
    options: [PLAYER('name', 'Player name (leave empty for your own card)'), { type: 6, name: 'user', description: 'Or pick them by Discord account', required: false },
      { ...SEASON, description: 'This quarter (default), the whole year, or all time', choices: [...SEASON.choices, { name: 'All time', value: 'all' }] }] },
  { name: 'standings', description: "The Study's leaderboard", type: 1, options: [{ ...SEASON, description: 'This quarter (default) or the whole year' }] },
  { name: 'recap', description: 'Show the recap card for the latest night', type: 1,
    options: [{ type: 3, name: 'night', description: 'Pick an older night', autocomplete: true, required: false }] },
  { name: 'h2h', description: 'Head to head between two players', type: 1,
    options: [PLAYER('player1', 'First player', true), PLAYER('player2', 'Second player', true), { ...SEASON, description: 'This year (default), this quarter, or all time', choices: [...SEASON.choices, { name: 'All time', value: 'all' }] }] },
  { name: 'hall', description: 'Hall of Fame: record holders, champions and trophies', type: 1 },
  { name: 'roles', description: 'Refresh the results roles (Quarter Leader, Heater, Cash King, ...)', type: 1 },
  { name: 'wrap', description: "A quarter's wrap-up card: champion, best night, awards", type: 1,
    options: [{ type: 3, name: 'quarter', description: 'Pick another quarter (default: the last finished one)', autocomplete: true, required: false }] },
  TOURNEY_COMMAND,
  CASH_COMMAND,
  { name: 'fish', description: 'Call out the fish at the table', type: 1, options: [{ type: 6, name: 'who', description: 'Who is the fish (leave empty for the usual suspect)', required: false }] },
  { name: 'donkey', description: 'Call someone a donkey', type: 1, options: [{ type: 6, name: 'who', description: 'Who played like a donkey (leave empty for the usual suspect)', required: false }] },
  ...BLACKJACK_COMMANDS,
  DUEL_COMMAND,
  UTH_COMMAND,
  ROULETTE_COMMAND,
  BACCARAT_COMMAND,
  SEATS_COMMAND,
  ...SHOP_COMMANDS,
  { name: 'lottery', description: 'The quarter lottery', type: 1, options: [
    { type: 1, name: 'odds', description: "The jackpot, your tickets and everyone's odds" },
    { type: 1, name: 'draw', description: "Draw last quarter's winner, live (host only)" }] },
  { name: 'earn', description: 'Every way to earn chips: daily, poker night rewards, rakeback, the lottery', type: 1 },
  { name: 'house', description: 'The casino books: what the house has won, by game (pitbosses only)', type: 1 },
];
// /fish and /donkey ping this person when nobody is picked (their Discord user ID, in quotes). Empty = they ask who.
const FISH_DEFAULT = '170443455590301696';
const FISH_LINES = ['🐟 <@ID> is the fish at this table', '🎣 Reeling in <@ID>. Easy catch.', '🐟 Someone feed <@ID>, they\'re donating again'];
const DONKEY_LINES = ['🫏 <@ID> played like a donkey tonight', '🫏 Hee-haw, <@ID>. Hee-haw.', '🫏 <@ID> called with what?!'];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const say = (content, ephemeral = true) => json({ type: 4, data: { content, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } } });

function signed(req, body) {
  const key = process.env.DISCORD_PUBLIC_KEY, sig = req.headers.get('x-signature-ed25519'), ts = req.headers.get('x-signature-timestamp');
  if (!key || !sig || !ts || !/^[0-9a-f]{64}$/i.test(key.trim()) || !/^[0-9a-f]{128}$/i.test(sig)) return false;
  try {
    const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key.trim(), 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(ts + body), pub, Buffer.from(sig, 'hex'));
  } catch (e) { return false; }
}

// sheet reads are cached for a minute so name suggestions stay quick while someone types
let cache = { at: 0, recs: null, ids: null, csv: '' };
async function sheet() {
  if (cache.recs && Date.now() - cache.at < 60e3) return cache;
  const get = (u, ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(u, { cache: 'no-store', signal: c.signal }).then(r => r.ok ? r.text() : '').catch(() => '').finally(() => clearTimeout(t)); };
  const [csv, members] = await Promise.all([get(SHEET_URL, 2200), get(MEMBERS_URL, 2200)]);
  if (!csv) return cache.recs ? cache : null;
  cache = { at: Date.now(), recs: gameRecords(csv), ids: memberIds(members), csv };
  return cache;
}

// names for the invite list come from the sheet copy in memory (no wait on Google); Discord names when there's none yet
const refreshNewestInvite = () => refreshInvite(async () => Object.fromEntries(Object.entries(cache.ids || {}).map(([n, id]) => [id, n])))
  .catch(e => console.error('invite refresh', e));
const webRoute = req => { const w = new URL(req.url).searchParams.get('web'); return w === 'login' || w === 'casino' || w === 'shop' ? w : null; };

// casino replies carry their table picture as an upload (see _attach.js), so it shows with the message instead of loading after it
const PIC_BUTTONS = /^(bj|du|uth|ro|ba|sh):/, PIC_COMMANDS = ['blackjack', 'freebet', 'duel', 'uth', 'baccarat', 'roulette', 'pack'];
// after an answer is sent: checks the players whose casino numbers just changed for new accolades (see _accolades.js)
const accoladesLater = () => { if (kvUrl() && kvToken()) waitUntil(checkAccolades({ ids: cache.ids }).catch(e => console.error('accolades', e))); };
export async function POST(req) {
  if (webRoute(req)) { waitUntil(refreshNewestInvite()); const out = await casinoWeb(req, webRoute(req), sheet); accoladesLater(); return out; }
  const startedAt = Date.now();
  const body = await req.text();
  if (!signed(req, body)) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return json({ type: 1 }); // Discord's ping when you save the endpoint URL
  const pic = (i.type === 3 && i.data && PIC_BUTTONS.test(String(i.data.custom_id))) || (i.type === 2 && i.data && PIC_COMMANDS.includes(i.data.name));
  if (!pic) { const out = await answer(i); accoladesLater(); return out; }
  warmPictures().catch(e => console.error('picture code', e)); // loads while the game talks to chip storage
  const out = withPicture(await answer(i), startedAt);
  accoladesLater();
  return out;
}

async function answer(i) {
  waitUntil(refreshNewestInvite()); // any use of the bot also refreshes the newest invite's headcount (at most once a minute)

  const opts = Object.fromEntries((i.data && i.data.options || []).map(o => [o.name, o]));
  if (i.type === 4) return suggest(i, opts); // suggestions while typing
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('tally:')) { // old invites' Update headcount button (new ones have none)
    const s = await sheet();
    return json(await tally(i, s || { ids: {} }));
  }
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('bj:')) { // blackjack buttons
    try { return await blackjackButton(i, null); } catch (e) { console.error('blackjack button', e); return say("Couldn't reach the chip storage just now. Try again in a moment."); }
  }
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('du:')) { // duel buttons
    try { return await duelButton(i, cache.recs ? cache : null, waitUntil); } catch (e) { console.error('duel button', e); return say("Couldn't reach the chip storage just now. Try again in a moment."); }
  }
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('uth:')) { // /uth buttons
    try { return await uthButton(i, cache.recs ? cache : null); } catch (e) { console.error('uth button', e); return say("Couldn't reach the chip storage just now. Try again in a moment."); }
  }
  if ((i.type === 3 || i.type === 5) && i.data && String(i.data.custom_id).startsWith('ro:')) { // roulette bets, chip size, Number box
    try { return await rouletteInteraction(i, cache.recs ? cache : null, waitUntil); } catch (e) { console.error('roulette', e); return say("Couldn't reach the chip storage just now. Try again in a moment."); }
  }
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('ba:')) { // baccarat play-again buttons
    try { return await baccaratButton(i, cache.recs ? cache : null); } catch (e) { console.error('baccarat', e); return say("Couldn't reach the chip storage just now. Try again in a moment."); }
  }
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('sh:')) return shopInteraction(i, cache.recs ? cache : null); // Study Cards buttons and menus
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('seats:')) return json(reshuffle(i)); // /seats Reshuffle
  if (i.type !== 2 || !i.data) return say('Unknown command.');
  const hint = await wrongChannel(i); // casino games only in #casino, poker commands only in #the-table (see _channels.js)
  if (hint) return say(hint);
  if (i.data.name === 'roulette') return rouletteCommand(i, waitUntil); // no sheet needed; stays awake 30s to spin
  if (i.data.name === 'fish' || i.data.name === 'donkey') { // fun pings, no sheet needed
    const id = (opts.who && opts.who.value) || FISH_DEFAULT;
    if (!id) return say('Pick who with the "who" option.');
    const lines = i.data.name === 'fish' ? FISH_LINES : DONKEY_LINES;
    return json({ type: 4, data: { content: lines[Math.floor(Math.random() * lines.length)].replace('ID', id), allowed_mentions: { users: [id] } } });
  }
  // chip commands answer from the sheet copy already in memory (names only) instead of waiting on Google: a slow sheet read
  // could push the reply past Discord's 3 seconds after the bet was already taken. The copy refreshes in the background.
  const CHIP = ['daily', 'blackjack', 'freebet', 'chips', 'pack', 'loadout', 'tip', 'duel', 'uth', 'baccarat', 'house', 'earn'];
  const chipCmd = CHIP.includes(i.data.name);
  if (chipCmd && (i.data.name === 'daily' || i.data.name === 'duel')) waitUntil(sweepDuels().catch(e => console.error('duel sweep', e))); // refunds stuck duels
  const s = chipCmd ? (cache.recs ? cache : null) : await sheet();
  if (chipCmd && (!cache.recs || Date.now() - cache.at >= 60e3)) waitUntil(sheet().catch(() => {}));
  const bj = await blackjackCommand(i, opts, s);
  if (bj) return bj;
  const shop = await shopCommand(i, opts, s); // /pack /loadout /tip
  if (shop) return shop;
  if (i.data.name === 'duel') return duelCommand(i, opts, s);
  if (i.data.name === 'uth') return uthCommand(i, opts, s);
  if (i.data.name === 'baccarat') return baccaratCommand(i, opts, s);
  if (i.data.name === 'seats') return json(startSeats(i, opts, s, waitUntil));
  if (i.data.name === 'tourney' || i.data.name === 'cash') { // pitboss role only (plus Renato and admins), see inviteBlocked
    const no = await inviteBlocked(i, s || { ids: {} }, HOST_ID);
    return json(no || startTourney(i, opts, s || { ids: {} }, waitUntil));
  }
  if (i.data.name === 'earn') return json({ type: 4, data: { allowed_mentions: { parse: [] }, embeds: [earnEmbed()] } });
  if (i.data.name === 'house') { // pitbosses only (plus Renato and admins), and only they see the answer
    const no = await inviteBlocked(i, s || { ids: {} }, HOST_ID, true);
    if (no) return json(no);
    try { return json({ type: 4, data: { flags: 64, allowed_mentions: { parse: [] }, embeds: [await houseEmbed()] } }); }
    catch (e) { console.error('house', e); return json({ type: 4, data: { flags: 64, content: "Couldn't reach the chip storage just now." } }); }
  }
  if (!s) return say("Couldn't reach the poker sheet just now. Try again in a minute.");
  if (i.data.name === 'lottery' && (i.data.options || [])[0] && i.data.options[0].name === 'draw') return lotteryDraw(i, s, waitUntil);
  if (i.data.name === 'roles') { // can take a few seconds, so answer "thinking…" and finish in the background
    waitUntil((async () => {
      let r; try { r = await syncRoles(s.recs, s.ids); } catch (e) { r = { changes: [], errors: ['Something went wrong: ' + e.message], holders: {} }; }
      const who = Object.entries(r.holders).map(([role, n]) => `**${role}:** ${n.length ? n.join(', ') : '–'}`).join('\n');
      const content = (r.errors.length ? '⚠️ ' + r.errors.join(' ') + '\n\n' : '') + (r.changes.length ? `Updated ${r.changes.length} role${r.changes.length === 1 ? '' : 's'}.\n` : 'Roles were already up to date.\n') + who;
      await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }) });
    })());
    return json({ type: 5, data: { flags: 64 } });
  }
  const run = { player, standings, recap, h2h, hall, wrap, lottery }[i.data.name];
  return run ? run(i, opts, s) : say('Unknown command.');
}

// /earn (posted for everyone in the channel): every way to get chips. Poker night amounts come from REWARD_LIST, so they never go stale.
function earnEmbed() {
  const nights = REWARD_LIST.map(g => `__${g.group}__\n` + g.items.map(x => `${x.what} **${x.amt}**`).join(' · ')).join('\n');
  return { color: 0xf1c75b, title: '💰 How to earn chips', url: `${SITE}/casino`,
    fields: [
      { name: '🎁 /daily', value: `$${WEEKLY_CLAIM} your first claim each week, $${DAILY} the other days (resets ${DAILY_RESET_UTC}:00 UTC, weeks start Monday)` },
      { name: '🃏 Poker night', value: 'Paid automatically after every saved night:\n' + nights },
      { name: '💸 Weekly rakeback', value: `Every Monday you get a cut back on everything you played at the tables, up to $${RAKE.cap}. Paid straight into your balance; /chips shows yours so far.` },
      { name: '🎟️ Quarter lottery', value: `Every $${TICKET} you buy in at poker night is a free ticket. One winner takes the whole quarter's buy-ins in chips. See /lottery odds.` },
      { name: '🤝 /tip', value: 'Any player can send you chips.' },
    ],
    footer: { text: 'Spend them at /blackjack, /freebet, /uth, /baccarat, /roulette, /duel, /pack or the site casino' } };
}

const stampNow = () => Math.floor(Date.now() / 600e3); // Discord re-fetches pictures at most every 10 minutes
const slugOf = n => n.replace(/[^A-Za-z0-9]/g, '_');
const periodName = p => p === 'all' ? 'all time' : p[0] === 'Y' ? p.slice(1) : p;
const inPeriod = (r, p) => p === 'all' || (p[0] === 'Y' ? r.y === +p.slice(1) : r.quarter === p);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = r => `${MON[r.m - 1]} ${r.d}`;
const embed = (e, extra = {}) => json({ type: 4, data: { allowed_mentions: { parse: [] }, ...extra, embeds: [{ color: 0xf1c75b, ...e }] } });
const avatarOf = (s, n) => s.ids[n] ? { url: `${SITE}/api/avatar?id=${s.ids[n]}` } : undefined;

async function suggest(i, opts) {
  const s = await sheet();
  if (!s) return json({ type: 8, data: { choices: [] } });
  const focused = Object.values(opts).find(o => o.focused) || {}, typed = String(focused.value || '').toLowerCase();
  if (focused.name === 'quarter') {
    const qs = quartersWithGames(s.recs).filter(q => !typed || q.toLowerCase().includes(typed));
    return json({ type: 8, data: { choices: qs.slice(0, 25).map(q => ({ name: q, value: q })) } });
  }
  if (focused.name === 'night') {
    const nights = toNights(s.csv).filter(n => !typed || `${MON[n.m - 1]} ${n.d}, ${n.y} ${n.type}`.toLowerCase().includes(typed));
    return json({ type: 8, data: { choices: nights.slice(0, 25).map(n => ({ name: `${MON[n.m - 1]} ${n.d}, ${n.y} · ${n.type}`, value: `${n.key}|${n.type}` })) } });
  }
  const q = latestQuarter(s.recs), recent = new Set(s.recs.filter(r => r.quarter === q).map(r => r.player));
  const names = [...new Set(s.recs.map(r => r.player))].filter(n => n.toLowerCase().includes(typed))
    .sort((a, b) => (recent.has(b) - recent.has(a)) || (b.toLowerCase().startsWith(typed) - a.toLowerCase().startsWith(typed)) || a.localeCompare(b));
  return json({ type: 8, data: { choices: names.slice(0, 25).map(n => ({ name: n, value: n })) } });
}
const notFound = (query, found) => say(`No player called "${String(query).slice(0, 40)}".` + (found.suggestions.length ? ` Did you mean ${found.suggestions.join(', ')}?` : ''));

function player(i, opts, s) {
  const byId = Object.fromEntries(Object.entries(s.ids).map(([n, id]) => [id, n]));
  let query = opts.name && String(opts.name.value).trim();
  if (!query) {
    const id = opts.user ? opts.user.value : (i.member && i.member.user || i.user || {}).id;
    query = byId[id];
    if (!query) return say(opts.user ? "That Discord account isn't linked to a player yet (Members tab, Discord ID column)." : "Your Discord account isn't linked to a player yet. Ask Renato to add your Discord ID to the Members tab, or use `/player name:`.");
  }
  const found = findPlayer(s.recs, query);
  if (!found.name) return notFound(query, found);
  const q = latestQuarter(s.recs), year = 'Y' + q.split(' ')[1];
  const played = p => s.recs.some(r => r.player === found.name && inPeriod(r, p));
  // this quarter by default; someone who hasn't played yet this quarter gets their season card instead
  const pick = opts.season && opts.season.value;
  const period = pick === 'all' ? 'all' : pick === 'year' ? year : played(q) || pick ? q : year;
  if (!played(period)) return say(`${found.name} hasn't played in ${periodName(period)} yet.`);
  const img = `${SITE}/api/card?name=${encodeURIComponent(found.name)}&period=${encodeURIComponent(period)}&v=${stampNow()}`;
  return embed({ url: `${SITE}/#player-${slugOf(found.name)}`, title: `${found.name} · ${period === 'all' ? 'All time' : period[0] === 'Y' ? period.slice(1) + ' season' : period}`, image: { url: img } });
}

function standings(i, opts, s) {
  const q = latestQuarter(s.recs), period = opts.season && opts.season.value === 'year' ? 'Y' + q.split(' ')[1] : q;
  const scope = s.recs.filter(r => inPeriod(r, period)), per = {};
  scope.forEach(r => { const p = per[r.player] ||= { net: 0, days: new Set(), wins: 0 }; p.net += r.net; p.days.add(r.key); p.wins += r.win ? 1 : 0; });
  const rows = Object.entries(per).sort((a, b) => b[1].net - a[1].net || a[0].localeCompare(b[0]));
  const nights = new Set(scope.map(r => r.key)).size;
  const MEDAL = ['🥇', '🥈', '🥉'];
  const lines = rows.map(([n, p], k) => `${MEDAL[k] || `\`${String(k + 1).padStart(2, ' ')}\``}  **${n}**  ${usd(Math.round(p.net * 100) / 100)}  ·  ${p.days.size} night${p.days.size === 1 ? '' : 's'}${p.wins ? `, ${p.wins} win${p.wins === 1 ? '' : 's'}` : ''}`);
  return embed({ url: SITE, title: `${periodName(period)} standings`, description: lines.join('\n').slice(0, 4000) || 'No games yet.',
    footer: { text: `after ${nights} night${nights === 1 ? '' : 's'} · Poker Club @ The Study` }, thumbnail: rows[0] ? avatarOf(s, rows[0][0]) : undefined });
}

function recap(i, opts, s) {
  const nights = toNights(s.csv);
  let n = nights[0];
  if (opts.night && opts.night.value) {
    const [key, type] = String(opts.night.value).split('|');
    n = nights.find(x => x.key === key && (!type || x.type === type)) || nights.find(x => x.key === key);
    if (!n) return say("Couldn't find that night. Pick one from the list as you type.");
  }
  if (!n) return say('No nights recorded yet.');
  const img = `${SITE}/api/recap?night=${n.key}&type=${encodeURIComponent(n.type)}&v=${stampNow()}`;
  return embed({ url: `${SITE}/recap`, title: `${MON[n.m - 1]} ${n.d}, ${n.y} · ${n.type === 'Tournament' ? 'Tournament' : 'Cash game'}`, image: { url: img } });
}

function h2h(i, opts, s) {
  const a = findPlayer(s.recs, opts.player1 && opts.player1.value || ''), b = findPlayer(s.recs, opts.player2 && opts.player2.value || '');
  if (!a.name) return notFound(opts.player1 && opts.player1.value, a);
  if (!b.name) return notFound(opts.player2 && opts.player2.value, b);
  if (a.name === b.name) return say('Pick two different players.');
  const q = latestQuarter(s.recs), pick = opts.season && opts.season.value;
  const period = pick === 'quarter' ? q : pick === 'all' ? 'all' : 'Y' + q.split(' ')[1];
  const games = {};
  s.recs.filter(r => inPeriod(r, period) && (r.player === a.name || r.player === b.name)).forEach(r => (games[r.key + '|' + r.type] ||= {})[r.player] = r);
  const both = Object.values(games).filter(g => g[a.name] && g[b.name]).sort((x, y) => x[a.name].key < y[a.name].key ? -1 : 1);
  if (!both.length) return say(`${a.name} and ${b.name} haven't played the same game in ${periodName(period)}.`);
  // the card is drawn by /api/h2h; Discord fetches the picture itself
  const img = `${SITE}/api/h2h?a=${encodeURIComponent(a.name)}&b=${encodeURIComponent(b.name)}&period=${encodeURIComponent(period)}&v=${stampNow()}`;
  const page = `${SITE}/h2h?a=${encodeURIComponent(a.name)}&b=${encodeURIComponent(b.name)}&period=${encodeURIComponent(period)}`;
  return embed({ url: page, title: `${a.name} vs ${b.name} · ${periodName(period)}`, image: { url: img } });
}

function wrap(i, opts, s) {
  const want = opts.quarter && String(opts.quarter.value).trim(), qs = quartersWithGames(s.recs);
  const q = want ? qs.find(x => x.toLowerCase() === want.toLowerCase()) : wrapDefault(s.recs);
  if (!q) return say(`No games in "${String(want).slice(0, 20)}". Try one of: ${qs.slice(0, 6).join(', ')}.`);
  // the card is drawn by /api/wrap; Discord fetches the picture itself
  return embed({ url: `${SITE}/hall`, title: `🏁 ${q} wrapped`, image: { url: `${SITE}/api/wrap?q=${encodeURIComponent(q)}&v=${stampNow()}` } });
}

async function lottery(i, opts, s) {
  const rows = nightRows(s.csv), q = await shownQuarter(rows).catch(() => quarterOf()), b = lotteryBoard(rows, q, s.ids), pending = q !== quarterOf();
  const byId = Object.fromEntries(Object.entries(s.ids).map(([n, id]) => [id, n]));
  const me = byId[(i.member && i.member.user || i.user || {}).id], mine = me && b.holders.find(x => x.name === me);
  const pct = t => { const p = 100 * t / (b.total || 1); return (p < 10 ? p.toFixed(1) : Math.round(p)) + '%'; };
  const you = mine ? `You have **${mine.t} ticket${mine.t === 1 ? '' : 's'}** (${pct(mine.t)} to win).` : me ? 'You have no tickets yet this quarter.'
    : "Your Discord isn't linked to a player yet, so you're not in the draw. Ask Renato to add your Discord ID to the Members tab.";
  return embed({ url: `${SITE}/casino`, title: `🎟️ ${q} lottery · ${'$' + b.jackpot.toLocaleString('en-US')} jackpot`,
    description: `1 free ticket for every $${TICKET} you buy in at poker night. ${pending ? 'The quarter is over: the winner gets drawn live here soon.' : 'One winner is drawn live after the quarter ends and gets everything bought in, in chips.'}${you ? '\n\n' + you : ''}`,
    image: { url: `${SITE}/api/wrap?lottery=${encodeURIComponent(q)}&v=${stampNow()}` } });
}

// /lottery draw: host only. Answers "thinking…" in the channel, then edits that message: first the wheel GIF
// (/api/wrap?lottery=q&spin=1, pfps on the slices) spinning to the winning ticket, then the winner ping + card.
// The draw itself is stored (and paid) before anything is shown.
const HOST_ID = '147939795400654848';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function lotteryDraw(i, s, waitUntil) {
  const uid = (i.member && i.member.user || i.user || {}).id;
  if (uid !== HOST_ID && uid !== s.ids.Renato) return say('Only the host can run the lottery draw.');
  const rows = nightRows(s.csv);
  return drawable(rows, s.ids).then(ok => {
    if (ok.err) return say(ok.err);
    const q = ok.q, b = lotteryBoard(rows, q, s.ids), jp = '$' + b.jackpot.toLocaleString('en-US');
    const edit = body => fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }) }).catch(() => {});
    const head = `🎟️ **${q} lottery draw** · ${b.total} tickets in the drum · **${jp}** jackpot`;
    waitUntil((async () => {
      const r = await drawQuarter(s.csv, s.ids, q);
      if (r.err) { await edit({ content: `${head}\n⚠️ ${r.err}` }); return; }
      const d = r.d, num = String(d.ticket).padStart(3, '0'), v = `&v=${d.at}`;
      // the GIF embed gets its own url, so Discord stacks it above the card instead of merging the two into one gallery
      const spin = { color: 0x8f78f0, url: `${SITE}/casino?wheel=1`, image: { url: `${SITE}/api/wrap?lottery=${encodeURIComponent(q)}&spin=1${v}` } };
      await edit({ content: `${head}\n\n🎡 Spinning the wheel…`, embeds: [spin] });
      // Discord fetches + renders the GIF (about 1-2s), then it spins for about 3.5s
      await sleep(7500);
      await edit({ content: `${head}\n\n🎉 Ticket **#${num}** belongs to <@${r.id}>! **${jp}** in chips and the ${LUCKY_ROLE} role are yours. Tickets start over for ${nextQuarter(q)}. Watch it again at ${SITE}/casino`,
        embeds: [spin, { color: 0xf1c75b, url: `${SITE}/casino`, image: { url: `${SITE}/api/wrap?lottery=${encodeURIComponent(q)}${v}` } }], allowed_mentions: { users: [r.id] } });
      try { await syncRoles(s.recs, s.ids); } catch (e) { console.error('lucky role', e); }
    })());
    return json({ type: 5 });
  });
}

function hall(i, opts, s) {
  // the Hall of Fame card is drawn by /api/hall; Discord fetches the picture itself
  return embed({ url: `${SITE}/hall`, title: '🏆 Hall of Fame', image: { url: `${SITE}/api/hall?v=${stampNow()}` } });
}

// one-time setup in a browser: registers the commands and shows the link that adds them to your server
export async function GET(req) {
  if (webRoute(req)) return casinoWeb(req, webRoute(req), sheet);
  const url = new URL(req.url), token = process.env.DISCORD_BOT_TOKEN;
  if (!url.searchParams.has('setup')) return new Response('This is the Discord commands endpoint. Open ?setup=1 once to register the commands.', { status: 200 });
  if (!token) return new Response('DISCORD_BOT_TOKEN is missing in Vercel env vars.', { status: 500 });
  const H = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
  const app = await fetch('https://discord.com/api/v10/oauth2/applications/@me', { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!app) return new Response("Discord didn't accept the bot token. Check DISCORD_BOT_TOKEN.", { status: 500 });
  const r = await fetch(`https://discord.com/api/v10/applications/${app.id}/commands`, { method: 'PUT', headers: H, body: JSON.stringify(COMMANDS) });
  // bot + commands: View Channel, Add Reactions, Read Message History, Mention Everyone (for /tourney), Manage Roles (results roles)
  const invite = `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot%20applications.commands&permissions=${1024 + 64 + 65536 + 131072 + 268435456}`;
  const ok = r.ok, keySet = !!process.env.DISCORD_PUBLIC_KEY;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Discord commands setup</title>
<body style="font:16px system-ui;background:#15132a;color:#ece9fb;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.5">
<h2>${ok ? '✅ Commands registered: ' + COMMANDS.map(c => '/' + c.name).join(', ') : '❌ Registering the commands failed'}</h2>
${ok ? '' : `<pre style="white-space:pre-wrap">${(await r.text()).replace(/[<&]/g, c => ({ '<': '&lt;', '&': '&amp;' }[c]))}</pre>`}
<p>${keySet ? '✅' : '⚠️'} DISCORD_PUBLIC_KEY ${keySet ? 'is set' : 'is missing: add it in Vercel, then redeploy'}.</p>
<p>Next, add the bot to your server (you need Manage Server there). Do this again if you added it before /tourney existed: it now joins as a member so it can add and read reactions.</p>
<p><a style="display:inline-block;background:#5865f2;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700" href="${invite}">Add the bot to my server</a></p>
<p style="color:#9a94c4">New commands can take a minute to show up; type / in any channel.</p></body>`;
  return new Response(html, { status: ok ? 200 : 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
