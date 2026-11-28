// Live tables on the site (/live): one shared blackjack / Free Bet / UTH table, opened by any member of the Discord server.
// Routed through api/discord.js (vercel.json rewrites /api/live there with ?web=live), so it needs no function of its own.
//
//   GET  /api/live            → the table (public), plus for a signed-in person: your seat, your UTH cards, your chips, can you host
//   GET  /api/live?token=1    → Ably token request; guests (not signed in) get listen-only, so watching needs no sign-in
//   POST /api/live {a: …}     → token | sit {seat} | leave | bet {bet, side} | move {do: hit|stand|double|split | b4|b2|b1|chk|fold} | tick
//                               | host: open {cfg: game} | close | pause {on} | game {game}   (bets $5-$500, both clocks 15s, side bets always on: all fixed)
//
// Same storage as the poker room: the whole table is one JSON value (lt:t) with a version (lt:v), saved with a Lua
// compare-and-set (2 Redis commands per move). The rules are in _livegame.js.
// Chips: a bet / paid double / paid split / UTH play bet is taken first (takeChips, atomic) and handed back if the table refuses it;
// winnings are paid only after the table saved, and every finished hand goes through feedCmds like a solo hand (casino feed,
// house books, rakeback, jackpot, accolade counts), so a live table counts exactly like playing the same hands alone.
// Hosts (by request, Nov 24 2026): anyone in the Discord server can open a table. The host controls belong to whoever opened it,
// plus Renato / admins / pitbosses; once the opener leaves the table, any server member can pick them up.
// Live updates: after each change the public table is published to Ably "live:table" (same ABLY_API_KEY as the poker room).
import { createHmac, randomBytes } from 'node:crypto';
import { kv, jpSink, takeChips, feedCmds, nameCmd } from './_blackjack.js';
import { postChannel } from './_rewards.js';
import { isHost, isMember } from './_poker.js';
import * as E from './_livegame.js';

const CHAN = 'live:table', REF = { key: 'lt:t', ver: 'lt:v' };
const CAS = "local v=redis.call('GET',KEYS[1]) or '0' if v~=ARGV[1] then return 0 end redis.call('SET',KEYS[2],ARGV[3]) redis.call('SET',KEYS[1],ARGV[2]) return 1";
const int = v => { const n = Math.floor(+v); return Number.isFinite(n) ? n : NaN; };

async function load() {
  const [raw] = await kv(['GET', REF.key]);
  if (!raw) return E.fresh();
  try { return { ...E.fresh(), ...JSON.parse(raw) }; } catch (e) { return E.fresh(); }
}
/** Applies fn(T) and saves, retrying if someone else saved first (string = refused, false = nothing changed). Pays out after the save. */
async function change(fn, t = Date.now()) {
  for (let k = 0; k < 8; k++) {
    const T = await load(), was = T.v;
    const r = fn(T, t);
    if (typeof r === 'string') return { T, err: r };
    if (r === false) return { T, same: true };
    T.at = t; T.v = was + 1;
    const pays = T._pay || []; delete T._pay;
    const [ok] = await kv(['EVAL', CAS, 2, REF.ver, REF.key, String(was), String(T.v), JSON.stringify(T)]);
    if (+ok === 1) {
      const jp = pays.length ? await payOut(pays).catch(e => { console.error('live payout', e, JSON.stringify(pays)); return []; }) : [];
      await publish(T, t, jp);
      return { T, jp };
    }
    await new Promise(res => setTimeout(res, 30 + Math.random() * 90));
  }
  return { err: 'The table is busy. Try again.' };
}
async function payOut(list) {
  const cmds = [];
  for (const p of list) {
    if (p.amt > 0) cmds.push(['HINCRBYFLOAT', 'bj:bal', p.id, p.amt]);
    if (p.feed) cmds.push(...feedCmds({ id: p.id, name: p.name, src: 'site' }, p.feed.game, p.feed.net, p.feed.wager, p.feed.stats));
  }
  // jackpot wins from these hands (see jpSink in _blackjack.js): sent with this update so the whole table sees them
  const jp = [];
  if (cmds.length) await jpSink.run(jp, () => kv(...cmds));
  return jp.map(w => ({ id: w.id, name: w.name, win: w.win }));
}

// ---------- /live on Discord (Nov 25 2026, by request: info only, playing stays on the site) ----------
export const LIVE_COMMAND = { name: 'live', description: 'Is a live table open? Game, who is seated, open seats, and a link to sit down', type: 1 };
/** read-only: never saves, so it costs one Redis GET. A table that is due to auto-close shows as closed. */
/** For the casino lobby's "open now" card: what /live shows, from the raw lt:t the lobby already read (a table due to auto-close counts as closed). */
export function liveSummary(raw, now = Date.now()) {
  let c; try { c = { ...E.fresh(), ...JSON.parse(raw || 'null') }; } catch (e) { return null; }
  if (!raw) return null;
  E.tick(c, now);
  if (!c.open) return null;
  const seated = c.seats.filter(Boolean);
  return { game: E.GAMES[c.game], seats: seated.map(s => ({ id: s.id, name: s.name })), of: E.SEATS, min: c.cfg.min, max: E.betMax(c), host: c.host ? c.host.name : null };
}

export async function liveCommand(origin = 'https://www.thepoker.study') {
  const T = await load(), now = Date.now(), c = JSON.parse(JSON.stringify(T));
  E.tick(c, now);
  const url = origin + '/live', btn = label => [{ type: 1, components: [{ type: 2, style: 5, label, url }] }];
  if (!c.open) return { allowed_mentions: { parse: [] }, components: btn('Open a table'),
    embeds: [{ color: 0x8f78f0, title: '🎰 No live table open', url, description: `Anyone can [open one here](${url}): blackjack, Free Bet or UTH, up to ${E.SEATS} players.` }] };
  const seated = c.seats.filter(Boolean), open = E.SEATS - seated.length;
  const state = c.closing ? 'Closing after this round' : c.phase === 'paused' ? 'Paused by the host' : c.phase === 'act' ? `Round ${c.round} is being played` : seated.length ? 'Taking bets' : 'Waiting for players';
  const min = Math.max(1, Math.round((now - (c.openedAt || now)) / 60e3));
  return { allowed_mentions: { parse: [] }, components: btn(open ? 'Take a seat' : 'Watch the table'),
    embeds: [{ color: 0x2e9e5b, title: `🎰 Live ${E.GAMES[c.game]} table`, url,
      description: `${state}. Bets $${c.cfg.min} to $${E.betMax(c)}${c.game === 'uth' ? ' on the ante' : ''}.`,
      fields: [
        { name: `Seated (${seated.length}/${E.SEATS})`, value: seated.length ? seated.map(s => s.name).join(', ').slice(0, 1000) : 'Nobody yet', inline: false },
        { name: 'Open seats', value: open ? String(open) : 'Full, you can watch', inline: true },
        { name: 'Host', value: c.host ? c.host.name : 'Nobody', inline: true }],
      footer: { text: `Open for ${min < 60 ? min + ' min' : Math.floor(min / 60) + 'h ' + (min % 60) + 'm'}` } }] };
}

// ---------- Ably ----------
const ablyKey = () => process.env.ABLY_API_KEY || '';
async function publish(T, t, jp = []) {
  const key = ablyKey(); if (!key) return;
  const c = new AbortController(), timer = setTimeout(() => c.abort(), 1500);
  try {
    // X-Ably-ClientId: the Ably app only lets identified clients publish; without it every publish was refused (40161), so
    // nobody got live tables and every page fell back to polling Redis (found Nov 25 2026)
    const r = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(CHAN)}/messages`, { method: 'POST', signal: c.signal,
      headers: { Authorization: 'Basic ' + Buffer.from(key).toString('base64'), 'X-Ably-ClientId': Buffer.from('server').toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 't', data: JSON.stringify(jp.length ? { ...E.publicView(T, t), jp } : E.publicView(T, t)) }) });
    if (!r.ok) console.error('ably publish', r.status, (await r.text().catch(() => '')).slice(0, 200));
  } catch (e) { console.error('ably publish', e.name); } finally { clearTimeout(timer); }
}
/** a signed Ably token request that can only listen on the table (the browser swaps it for a token itself) */
function tokenRequest(clientId) {
  const [keyName, secret] = ablyKey().split(':');
  const capability = JSON.stringify({ [CHAN]: ['subscribe'] });
  const ttl = 4 * 3600e3, timestamp = Date.now(), nonce = randomBytes(12).toString('hex');
  const mac = createHmac('sha256', secret).update([keyName, ttl, capability, clientId, timestamp, nonce, ''].join('\n')).digest('base64');
  return { keyName, ttl, capability, clientId, timestamp, nonce, mac };
}

// ---------- the page's data ----------
const canHost = async (T, id) => T.open && T.host && T.host.id === id ? true : (await isHost(id)) || (E.hostFree(T) && (await isMember(id)));
async function view(T, me, t, extra = {}) {
  const body = { table: extra.jp && extra.jp.length ? { ...E.publicView(T, t), jp: extra.jp } : E.publicView(T, t), ably: !!ablyKey() };
  if (!me) return body;
  const i = E.seatOf(T, me.id);
  const [bal] = extra.bal !== undefined ? [extra.bal] : await kv(['HGET', 'bj:bal', me.id]);
  body.me = { id: me.id, name: me.name, seat: i, mine: i >= 0 ? E.mine(T, i) : null, bal: bal === null ? 0 : Math.floor(+bal * 100) / 100, host: await canHost(T, me.id) };
  return body;
}

export async function liveWeb(req, me, out) {
  const t = Date.now();
  if (req.method === 'GET') {
    if (new URL(req.url).searchParams.get('token')) return ablyKey() ? out({ token: tokenRequest(me ? me.id : 'guest-' + randomBytes(6).toString('hex')) }) : out({ err: 'Live updates are not set up.' });
    let T = await load();
    if (T.open && E.tick({ ...structuredClone(T) }, t)) { const r = await change((X, now) => E.tick(X, now) ? true : false, t); if (r.T) T = r.T; }
    return out(await view(T, me, t));
  }
  let b; try { b = await req.json(); } catch (e) { return out({ err: 'Bad request.' }, 400); }
  const who = { id: me.id, name: me.name };
  const done = async (r, extra = {}) => r.err ? out({ err: r.err, ...(r.T ? await view(r.T, me, t) : {}) }) : out(await view(r.T, me, t, { ...extra, jp: r.jp }));
  const HOST = ['close', 'pause', 'game'];
  if (b.a === 'open' && !(await isMember(me.id))) return out({ err: 'Tables are for people in the Poker Club Discord. Join the server, then try again.' }, 403);
  if (HOST.includes(b.a) && !(await canHost(await load(), me.id))) return out({ err: 'Only the host can do that.' }, 403);

  switch (b.a) {
    case 'token': return ablyKey() ? out({ token: tokenRequest(me.id) }) : out({ err: 'Live updates are not set up.' });
    case 'sit': { const r = await change((T, now) => E.sit(T, who, int(b.seat), now), t); if (!r.err) await kv(nameCmd(me)).catch(() => {}); return done(r); }
    case 'leave': return done(await change((T, now) => E.leave(T, who, now), t));
    case 'bet': {
      const pre = await load(), i = E.seatOf(pre, me.id), bet = int(b.bet), side = Math.max(0, int(b.side) || 0);
      const why = E.betBlock(pre, i, bet, side); if (why) return done({ T: pre, err: why });
      const need = E.needFor(pre, bet, side), game = pre.game, paid = await takeChips(me.id, need);
      if (paid.short) return done({ T: pre, err: `That needs $${need}${game === 'uth' ? ' (ante + blind + 1x ante held for the river bet' + (side ? ' + trips' : '') + ')' : ''} and you have $${paid.had || 0}.` });
      // the game or limits could change between the read and the save: the bet only stands on the table it was priced for
      const r = await change((T, now) => T.game !== game || E.needFor(T, bet, side) !== need ? 'The table changed. Try again.' : E.placeBet(T, E.seatOf(T, me.id), bet, side, now), t);
      if (r.err) { const [back] = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, need]); return done(r, { bal: +back }); }
      return done(r);
    }
    case 'move': {
      const act = String(b.do || ''), pre = await load(), i = E.seatOf(pre, me.id);
      const cost = i < 0 ? null : E.costOf(pre, i, act);
      if (cost === null) return done({ T: pre, err: i < 0 ? "You're not at the table." : "That move isn't open right now." });
      if (cost > 0) { const paid = await takeChips(me.id, cost); if (paid.short) return done({ T: pre, err: `That needs $${cost} more and you have $${paid.had || 0}.` }); }
      const r = await change((T, now) => { const k = E.seatOf(T, me.id); return k < 0 ? "You're not at the table." : E.move(T, k, act, now, cost); }, t);
      if (r.err && cost > 0) { const [back] = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, cost]); return done(r, { bal: +back }); }
      return done(r);
    }
    case 'tick': return done(await change((T, now) => E.tick(T, now) ? true : false, t));
    case 'open': {
      const r = await change((T, now) => E.openTable(T, who, b.cfg || {}, now), t);
      if (!r.err && b.post !== false) {
        const c = r.T.cfg, origin = `https://${req.headers.get('x-forwarded-host') || new URL(req.url).host}`;
        await postChannel({ content: `🎰 **${me.name} opened a live ${E.GAMES[r.T.game]} table.** Bets $${c.min} to $${E.betMax(r.T)}, ${E.SEATS} seats, everyone plays at once against the same dealer.\n${origin}/live`, allowed_mentions: { parse: [] } }, 'casino').catch(e => console.error('live open post', e));
      }
      return done(r);
    }
    case 'close': return done(await change((T, now) => E.requestClose(T, now), t));
    case 'pause': return done(await change((T, now) => E.pause(T, !!b.on, now), t));
    case 'game': return done(await change((T, now) => E.setGame(T, String(b.game), now), t));
  }
  return out({ err: 'Unknown action.' }, 400);
}
