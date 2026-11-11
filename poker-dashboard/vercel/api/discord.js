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
//   /daily /blackjack /chips  blackjack with chips (see _blackjack.js; needs Upstash storage)
//   /duel                   player vs player for chips: rock paper scissors or high card (see _duel.js)
//   /uth                    Ultimate Texas Hold'em against the dealer for chips (see _uth.js)
//   /roulette               shared roulette table, 30 seconds to bet, then it spins (see _roulette.js)
//   /baccarat               bet Player, Banker or Tie (see _baccarat.js)
//   /seats                  random seat order for everyone in on the latest invite (see _seats.js)
// One-time setup: open /api/discord?setup=1 in a browser. It registers the command and shows the "add to server" link.
// Needs Vercel env vars DISCORD_BOT_TOKEN (already there) and DISCORD_PUBLIC_KEY (from the Developer Portal).
import { createPublicKey, verify } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { TOURNEY_COMMAND, CASH_COMMAND, startTourney, tally } from './_tourney.js';
import { syncRoles } from './_roles.js';
import { BLACKJACK_COMMANDS, blackjackCommand, blackjackButton } from './_blackjack.js';
import { DUEL_COMMAND, duelCommand, duelButton } from './_duel.js';
import { SEATS_COMMAND, startSeats, reshuffle } from './_seats.js';
import { UTH_COMMAND, uthCommand, uthButton } from './_uth.js';
import { ROULETTE_COMMAND, rouletteCommand, rouletteInteraction } from './_roulette.js';
import { BACCARAT_COMMAND, baccaratCommand, baccaratButton } from './_baccarat.js';
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

export async function POST(req) {
  const body = await req.text();
  if (!signed(req, body)) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return json({ type: 1 }); // Discord's ping when you save the endpoint URL

  const opts = Object.fromEntries((i.data && i.data.options || []).map(o => [o.name, o]));
  if (i.type === 4) return suggest(i, opts); // suggestions while typing
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('tally:')) { // the invite's Update headcount button
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
  if (i.type === 3 && i.data && String(i.data.custom_id).startsWith('seats:')) return json(reshuffle(i)); // /seats Reshuffle
  if (i.type !== 2 || !i.data) return say('Unknown command.');
  if (i.data.name === 'roulette') return rouletteCommand(i, waitUntil); // no sheet needed; stays awake 30s to spin
  if (i.data.name === 'fish' || i.data.name === 'donkey') { // fun pings, no sheet needed
    const id = (opts.who && opts.who.value) || FISH_DEFAULT;
    if (!id) return say('Pick who with the "who" option.');
    const lines = i.data.name === 'fish' ? FISH_LINES : DONKEY_LINES;
    return json({ type: 4, data: { content: lines[Math.floor(Math.random() * lines.length)].replace('ID', id), allowed_mentions: { users: [id] } } });
  }
  const s = await sheet();
  const bj = await blackjackCommand(i, opts, s);
  if (bj) return bj;
  if (i.data.name === 'duel') return duelCommand(i, opts, s);
  if (i.data.name === 'uth') return uthCommand(i, opts, s);
  if (i.data.name === 'baccarat') return baccaratCommand(i, opts, s);
  if (i.data.name === 'seats') return json(startSeats(i, opts, s, waitUntil));
  if (i.data.name === 'tourney' || i.data.name === 'cash') return json(startTourney(i, opts, s || { ids: {} }, waitUntil));
  if (!s) return say("Couldn't reach the poker sheet just now. Try again in a minute.");
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
  const run = { player, standings, recap, h2h, hall, wrap }[i.data.name];
  return run ? run(i, opts, s) : say('Unknown command.');
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

function hall(i, opts, s) {
  // the Hall of Fame card is drawn by /api/hall; Discord fetches the picture itself
  return embed({ url: `${SITE}/hall`, title: '🏆 Hall of Fame', image: { url: `${SITE}/api/hall?v=${stampNow()}` } });
}

// one-time setup in a browser: registers the commands and shows the link that adds them to your server
export async function GET(req) {
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
