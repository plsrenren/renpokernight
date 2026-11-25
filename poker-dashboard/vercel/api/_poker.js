// The poker room on the site (/poker): one host-run no-limit Hold'em table for casino chips (bj:bal), live through Ably.
// Routed through api/discord.js (vercel.json rewrites /api/poker there with ?web=poker), so it needs no function of its own.
//
//   GET  /api/poker            → the table (public), plus for a signed-in person: your seat, your two cards, your chips, host or not
//   GET  /api/poker?token=1    → Ably token request; guests (not signed in) get listen-only, so watching needs no sign-in
//   GET  /api/poker?hands=1    → your hand history (signed in): your sessions of the last 90 days + the hands of one (&from=&to= ms, default the latest)
//   POST /api/poker {a: …}     → token (Ably sign-in for live updates) | sit {seat, amt, gift (take the host's free seat)} | top {amt} | leave | sitout {on}
//                                | act {do: fold|check|call|raise, to} | tick | host: open {cfg} | close | pause | resume | blinds {sb, bb} | seatout {seat, on} | bomb {x} | straddle {on} | nit {x} | gift {x} (free seat $, 0 = off) | bot {on: ''} (clears bots left over from before practice tables)
//                                | practice (counts one bot game toward the Beta Tester title; see the case below)
//   Practice tables against bots never come here while playing: they run entirely in the browser (poker.html LOCAL + /pokergame.js), so only real
//   games use Redis. The one exception is the bot-game counter: one 'practice' post per practice table opening (after 10 hands, signed-in members).
//
// Storage: the whole table is one JSON value (pk:t) with a version number (pk:v). Each change reads it, applies the rules
// (_pokergame.js) and writes it back only if nobody else wrote in between (one Lua compare-and-set), else tries again.
// That's 2 Redis commands per move. Chips: buy-ins/top-ups are taken first (takeChips, atomic) and refunded if the seat
// can't be taken; cash-outs are paid only after the table saved. Hidden cards never leave the server except to their owner.
// Live updates: after each change the public table is published to the Ably channel "poker:table" (env ABLY_API_KEY, kept
// server-side; browsers get short-lived tokens that can only listen there and chat on "poker:chat"). Without Ably the page polls.
// Hosts = Renato, server admins and the pitboss role (same people as /house).
// Free seats (host's gift): only people in the Discord server (checked with the bot, a yes is kept a day in pk:mem:<id>). The house's cost
// goes in the house books as 'free seat' (hs:all / hs:wk) and the casino feed gets a "free seat" line.
// Hand histories: every finished hand (_pokergame.js T.rec) is saved once as pk:h:<hand id> (90 days), and each real player dealt in gets it
// in their own list pk:hp:<id> (sorted set, score = time). Reading gives you back only your own cards plus the ones shown to the table.
import { createHmac, randomBytes } from 'node:crypto';
import { kv, takeChips, FEED_KEEP, weekKey } from './_blackjack.js';
import { postChannel } from './_rewards.js';
import * as E from './_pokergame.js';

const CHAN = 'poker:table', CHAT = 'poker:chat';
const ROOM = { key: 'pk:t', ver: 'pk:v' };
const RENATO = '147939795400654848', API = 'https://discord.com/api/v10';
const CAS = "local v=redis.call('GET',KEYS[1]) or '0' if v~=ARGV[1] then return 0 end redis.call('SET',KEYS[2],ARGV[3]) redis.call('SET',KEYS[1],ARGV[2]) return 1";
const $ = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // cents on every amount (Renato, Nov 25 2026)
const int = v => { const n = Math.floor(+v); return Number.isFinite(n) ? n : NaN; };

async function load(ref = ROOM) {
  const [raw] = await kv(['GET', ref.key]);
  if (!raw) return E.fresh();
  try { return { ...E.fresh(), ...JSON.parse(raw) }; } catch (e) { return E.fresh(); }
}
/** Applies fn(T) and saves, retrying if someone else saved first. fn returns an error string to refuse (nothing saved),
 *  or false for "nothing changed". Returns { T, err } after paying any cash-outs and publishing the new table. */
async function change(fn, t = Date.now(), ref = ROOM) {
  for (let k = 0; k < 8; k++) {
    const T = await load(ref), was = T.v;
    const r = fn(T, t);
    if (typeof r === 'string') return { T, err: r };
    if (r === false) return { T, same: true };
    T.at = t; T.v = was + 1;
    const out = T._out || []; delete T._out;
    const hands = T._hands || []; delete T._hands;
    const [ok] = await kv(['EVAL', CAS, 2, ref.ver, ref.key, String(was), String(T.v), JSON.stringify(T)]);
    if (+ok === 1) {
      if (out.length) await payOut(out).catch(e => console.error('poker payout', e, JSON.stringify(out)));
      if (hands.length) await saveHands(hands).catch(e => console.error('poker hands', e));
      await publish(T, t);
      return { T, out };
    }
    await new Promise(res => setTimeout(res, 30 + Math.random() * 90));
  }
  return { err: 'The table is busy. Try again.' };
}
/** pays cash-outs into chip balances and notes them in the casino feed (as one "poker room" line per sitting) */
async function payOut(list) {
  const cmds = [];
  for (const o of list) {
    if (o.amt > 0) cmds.push(['HINCRBYFLOAT', 'bj:bal', o.id, o.amt]);
    if (o.test) continue; // a test-table sitting: chips back, nothing to show in the feed
    cmds.push(['LPUSH', 'cas:feed', JSON.stringify({ id: o.id, name: o.name, game: 'poker room', net: o.net, src: 'site', at: Date.now() })]);
  }
  cmds.push(['LTRIM', 'cas:feed', 0, FEED_KEEP - 1]);
  await kv(...cmds);
}

// ---------- hand histories ----------
const HAND_DAYS = 90, HAND_MS = HAND_DAYS * 86400e3, SESSION_GAP = 2 * 3600e3, SESSION_MAX = 800;
export async function saveHands(list) {
  const cmds = [], ex = HAND_DAYS * 86400;
  for (const h of list) {
    const people = h.seats.filter(s => !s.bot);
    if (!people.length) continue; // bots only: nobody to give it to
    cmds.push(['SET', 'pk:h:' + h.hid, JSON.stringify(h), 'EX', ex]);
    for (const s of people) cmds.push(['ZADD', 'pk:hp:' + s.id, h.at, h.hid], ['EXPIRE', 'pk:hp:' + s.id, ex]);
    if (!h.test && !h.practice) for (const [id, got] of Object.entries(roomStats(h))) {
      for (const [k, n] of Object.entries(got)) cmds.push(['HINCRBY', 'ac:n:' + id, k, n]);
      cmds.push(['SADD', 'ac:dirty', id]); // the next request checks their titles (_accolades.js)
    }
  }
  if (cmds.length) await kv(...cmds);
}
/** the poker room titles (Bomb Squad, Straddle Daddy, Nit Tax, Run It Back, Rabbit Season, AFK, Showboat; ACC in loot.js) from one
 *  finished hand: { player id: { ac:n field: +n } }. Only the rare moments count, so most hands add no Redis commands at all. */
export function roomStats(h) {
  const out = {}, ev = h.ev || [], seat = i => h.seats.find(s => s.i === i), byName = n => h.seats.find(s => s.name === n);
  const add = (s, k) => { if (s && !s.bot) (out[s.id] ||= {})[k] = ((out[s.id] || {})[k] || 0) + 1; };
  const wins = ev.filter(e => e[0] === 'win'), won = new Set(wins.map(e => e[1]));
  if (ev.some(e => e[0] === 'post' && e[3] === 'bomb')) won.forEach(i => add(seat(i), 'bomb'));
  ev.filter(e => e[0] === 'post' && e[3] === 'straddle' && won.has(e[1])).forEach(e => add(seat(e[1]), 'straddle'));
  const r1 = new Set(wins.filter(e => e[3] === 'run1').map(e => e[1]));
  [...new Set(wins.filter(e => e[3] === 'run2' && r1.has(e[1])).map(e => e[1]))].forEach(i => add(seat(i), 'rit2'));
  ev.filter(e => e[0] === 'rabbit').forEach(e => add(byName(e[2]), 'rabbit'));
  ev.filter(e => e[0] === 'note' && / is the last nit and pays everyone /.test(e[1])).forEach(e => add(byName(e[1].split(' is the last nit')[0]), 'nit'));
  (h.afk || []).forEach(i => add(seat(i), 'afk'));
  // shown after everyone folded: a 'show' with no hand name (showdown shows carry one)
  ev.filter(e => e[0] === 'show' && !e[3]).forEach(e => add(seat(e[1]), 'showboat'));
  return out;
}
/** one hand as one player may see it: their own cards, nobody else's (shown cards are in the 'show' events), no ids but theirs */
export function handFor(h, id) {
  const me = h.seats.find(s => s.id === id);
  return { ...h, me: me ? me.i : -1, cards: me && h.cards[me.i] ? { [me.i]: h.cards[me.i] } : {}, seats: h.seats.map(({ id: _, ...s }) => s) };
}
/** your sessions (runs of hands with under 2 hours between them, newest first) and the hands of the one asked for */
export async function myHands(id, from, to, t) {
  const key = 'pk:hp:' + id;
  const [, list] = await kv(['ZREMRANGEBYSCORE', key, 0, t - HAND_MS], ['ZRANGE', key, 0, -1, 'WITHSCORES']);
  const rows = []; for (let k = 0; k + 1 < (list || []).length; k += 2) rows.push([list[k], +list[k + 1]]);
  const sessions = [];
  rows.forEach(([hid, at]) => { const s = sessions[sessions.length - 1]; if (s && at - s.to < SESSION_GAP) { s.to = at; s.n++; } else sessions.push({ from: at, to: at, n: 1 }); });
  sessions.reverse();
  const pick = from ? sessions.find(s => s.from <= from && from <= s.to) || sessions.find(s => s.from >= from && s.from <= (to || from)) : sessions[0];
  if (!pick) return { sessions, hands: [] };
  const ids = rows.filter(([, at]) => at >= pick.from && at <= pick.to).map(([hid]) => hid).slice(-SESSION_MAX);
  const raw = ids.length ? (await kv(['MGET', ...ids.map(h => 'pk:h:' + h)]))[0] : [];
  const hands = (raw || []).map(r => { try { return r && handFor(JSON.parse(r), id); } catch (e) { return null; } }).filter(Boolean);
  return { sessions, session: pick, hands };
}

// ---------- Ably ----------
const ablyKey = () => process.env.ABLY_API_KEY || '';
async function publish(T, t) {
  const key = ablyKey(); if (!key) return;
  const c = new AbortController(), timer = setTimeout(() => c.abort(), 1500);
  try {
    await fetch(`https://rest.ably.io/channels/${encodeURIComponent(CHAN)}/messages`, { method: 'POST', signal: c.signal,
      headers: { Authorization: 'Basic ' + Buffer.from(key).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 't', data: JSON.stringify(E.publicView(T, t)) }) });
  } catch (e) { console.error('ably publish', e.name); } finally { clearTimeout(timer); }
}
/** A signed Ably token request (the browser swaps it for a token itself): listen on the table, talk on the chat, nothing else. */
function tokenRequest(clientId, guest) {
  const [keyName, secret] = ablyKey().split(':');
  // Ably signs the capability in its sorted form (channels A-Z, operations A-Z), so it's written that way here.
  // Guests (not signed in) can only watch: listen on the table and the chat, never talk.
  const capability = JSON.stringify({ [CHAT]: guest ? ['subscribe'] : ['publish', 'subscribe'], [CHAN]: ['subscribe'] });
  const ttl = 4 * 3600e3, timestamp = Date.now(), nonce = randomBytes(12).toString('hex');
  const mac = createHmac('sha256', secret).update([keyName, ttl, capability, clientId, timestamp, nonce, ''].join('\n')).digest('base64');
  return { keyName, ttl, capability, clientId, timestamp, nonce, mac };
}

// ---------- hosts ----------
const hostCache = new Map();
export async function isHost(id) {
  if (id === RENATO) return true;
  const c = hostCache.get(id); if (c && Date.now() - c.at < 600e3) return c.ok;
  let ok = false;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (token) try {
    const get = p => fetch(API + p, { headers: { Authorization: `Bot ${token}` } }).then(r => r.ok ? r.json() : null);
    for (const g of ((await get('/users/@me/guilds')) || []).slice(0, 3)) {
      const m = await get(`/guilds/${g.id}/members/${id}`); if (!m) continue;
      const roles = (await get(`/guilds/${g.id}/roles`)) || [];
      const mine = roles.filter(r => (m.roles || []).includes(r.id));
      if (mine.some(r => /^pit ?boss(es)?$/i.test(String(r.name || '').replace(/[^a-z ]/gi, '').trim()) || (BigInt(r.permissions || 0) & 8n))) { ok = true; break; }
      const info = await get(`/guilds/${g.id}`); if (info && info.owner_id === id) { ok = true; break; }
    }
  } catch (e) { console.error('poker host check', e); }
  hostCache.set(id, { at: Date.now(), ok });
  return ok;
}

/** Is this person in the Discord server? (site sign-in alone doesn't say) A yes is kept a day; a no is re-checked next time. */
const memberCache = new Map();
export async function isMember(id) {
  if (id === RENATO) return true;
  const c = memberCache.get(id); if (c && Date.now() - c < 3600e3) return true;
  const [seen] = await kv(['GET', 'pk:mem:' + id]).catch(() => [null]);
  if (seen) { memberCache.set(id, Date.now()); return true; }
  const token = process.env.DISCORD_BOT_TOKEN; if (!token) return false;
  try {
    const get = p => fetch(API + p, { headers: { Authorization: `Bot ${token}` } }).then(r => r.ok ? r.json() : null);
    for (const g of ((await get('/users/@me/guilds')) || []).slice(0, 3)) {
      if (await get(`/guilds/${g.id}/members/${id}`)) { memberCache.set(id, Date.now()); await kv(['SET', 'pk:mem:' + id, '1', 'EX', 86400]).catch(() => {}); return true; }
    }
  } catch (e) { console.error('poker member check', e); }
  return false;
}

// ---------- the page's data ----------
async function view(T, me, t, extra = {}) {
  const body = { table: E.publicView(T, t), ably: !!ablyKey(), ...extra };
  if (!me) return body;
  const i = E.seatOf(T, me.id), s = i >= 0 ? T.seats[i] : null;
  const [bal] = extra.bal !== undefined ? [extra.bal] : await kv(['HGET', 'bj:bal', me.id]);
  body.me = { id: me.id, name: me.name, seat: i, cards: s && s.cards.length ? s.cards : [], bal: bal === null ? 0 : Math.floor(+bal * 100) / 100, host: await isHost(me.id) };
  delete body.bal;
  return body;
}

// the poker room never reads the Google sheet (chips live in Redis); `_sheet` is only there because _casino.js passes it to every page
export async function pokerWeb(req, me, _sheet, out) {
  const t = Date.now();
  if (req.method === 'GET') {
    // signing in is optional: anyone can watch, and a guest gets a listen-only live token here
    const q = new URL(req.url).searchParams;
    if (q.get('hands')) return me ? out(await myHands(me.id, +q.get('from') || 0, +q.get('to') || 0, t)) : out({ err: 'Sign in to see your hands.' }, 401);
    if (q.get('ablycheck')) { // TEMP diagnostic (preview only use): what Ably says to our token request + a publish. No secrets returned.
      const k = ablyKey(), tr = tokenRequest('diag-check', true);
      const a1 = await fetch(`https://rest.ably.io/keys/${encodeURIComponent(tr.keyName)}/requestToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tr) }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 400).replace(/"token":"[^"]+"/, '"token":"…"') })).catch(e => ({ err: String(e) }));
      const a2 = await fetch(`https://rest.ably.io/channels/diag-check/messages`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(k).toString('base64'), 'Content-Type': 'application/json' }, body: '{"name":"x","data":"1"}' }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 300) })).catch(e => ({ err: String(e) }));
      const a3 = await fetch(`https://rest.ably.io/channels/diag-check/messages`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(k).toString('base64'), 'Content-Type': 'application/json' }, body: '{"name":"x","data":"1","clientId":"server"}' }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 300) })).catch(e => ({ err: String(e) }));
      let a4 = null;
      try {
        const tok = JSON.parse((await fetch(`https://rest.ably.io/keys/${encodeURIComponent(tr.keyName)}/requestToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tokenRequest('diag-ws', true)) }).then(r => r.text()))).token;
        a4 = await new Promise(res => { const ws = new WebSocket(`wss://realtime.ably.io/?access_token=${encodeURIComponent(tok)}&v=3&format=json`); const to = setTimeout(() => { res({ timeout: true }); try { ws.close(); } catch (e) {} }, 5000);
          ws.onmessage = ev => { clearTimeout(to); res({ first: String(ev.data).slice(0, 300).replace(/"connectionKey":"[^"]+"/, '') }); try { ws.close(); } catch (e) {} }; ws.onerror = e => { clearTimeout(to); res({ wsError: String(e && e.message || e.type) }); }; });
      } catch (e) { a4 = { err: String(e) }; }
      return out({ withClientId: a3, realtime: a4, keyLen: k.length, colons: k.split(':').length - 1, space: /\s/.test(k), quote: /["']/.test(k), token: a1, publish: a2 });
    }
    if (new URL(req.url).searchParams.get('token')) return ablyKey() ? out({ token: tokenRequest(me ? me.id : 'guest-' + randomBytes(6).toString('hex'), !me) }) : out({ err: 'Live updates are not set up.' });
    let T = await load();
    // nobody ticks a room that everyone walked away from; the next visit does (closes it, pays everyone)
    if (T.open && ((T.at && t - T.at > 3 * 3600e3) || (!T.seats.some(s => s && !s.left) && T.emptyAt && t - T.emptyAt > 30 * 60e3))) {
      const r = await change((X, now) => E.tick(X, now) ? true : false, t); if (r.T) T = r.T;
    }
    return out(await view(T, me, t));
  }
  let b; try { b = await req.json(); } catch (e) { return out({ err: 'Bad request.' }, 400); }
  const who = { id: me.id, name: me.name };
  const host = ['open', 'close', 'pause', 'resume', 'blinds', 'seatout', 'bomb', 'straddle', 'nit', 'gift', 'bot'].includes(b.a);
  if (host && !(await isHost(me.id))) return out({ err: 'Only hosts can do that.' }, 403);
  const done = async (r, extra = {}) => r.err ? out({ err: r.err, ...(r.T ? await view(r.T, me, t) : {}) }) : out(await view(r.T, me, t, extra));

  // Keyboard Warrior: the first time someone sits at the hosted table (stamped by checkAccolades from ac:n joined)
  const joined = async r => { if (!r.err && b.a === 'sit' && r.T && !E.testTable(r.T)) await kv(['HSETNX', 'ac:n:' + me.id, 'joined', String(t)], ['SADD', 'ac:dirty', me.id]).catch(e => console.error('poker joined', e)); };
  switch (b.a) {
    // a practice game against the bots (played in the browser) counts toward the Beta Tester title (5 games): the page sends this once per practice
    // table opening, after 10 hands. Server members only; at most one count every 15 minutes, so reloading or spamming can't run it up.
    case 'practice': {
      if (!(await isMember(me.id))) return out({ ok: false, why: 'not in the server' });
      const [fresh] = await kv(['SET', 'pk:pc:' + me.id, '1', 'NX', 'EX', 900]);
      if (!fresh) return out({ ok: false, why: 'too soon' });
      const [n] = await kv(['HINCRBY', 'ac:n:' + me.id, 'practice', 1], ['SADD', 'ac:dirty', me.id]); // ac:dirty: the next request checks the titles
      return out({ ok: true, n: +n || 0 });
    }
    case 'token': return ablyKey() ? out({ token: tokenRequest(me.id) }) : out({ err: 'Live updates are not set up.' });
    case 'sit': if (b.gift) {
      // the host's free seat: no chips taken, no strings (leaving pays the whole stack like any seat)
      const pre = await load(), why = E.giftBlock(pre, me.id);
      if (why) return done({ T: pre, err: why });
      if (!(await isMember(me.id))) return done({ T: pre, err: 'Free seats are for people in the Poker Club Discord. Join the server, then try again.' });
      const r = await change((T, now) => E.sit(T, who, int(b.seat), 0, now, false, true), t);
      if (r.err) return done(r);
      await joined(r);
      const amt = r.T.seats[E.seatOf(r.T, me.id)].gift, wk = weekKey(t);
      await kv(['HSET', 'bj:name', me.id, me.name], ['HINCRBYFLOAT', 'hs:wk:' + wk, 'free seat', -amt], ['EXPIRE', 'hs:wk:' + wk, 120 * 86400], ['HINCRBYFLOAT', 'hs:all', 'free seat', -amt],
        ['LPUSH', 'cas:feed', JSON.stringify({ id: me.id, name: me.name, game: 'free seat', why: 'poker room, on the house', net: amt, src: 'site', at: Date.now() })], ['LTRIM', 'cas:feed', 0, FEED_KEEP - 1]).catch(e => console.error('poker gift books', e));
      return done(r);
    } // fall through: a normal buy-in
    case 'top': {
      const amt = int(b.amt);
      if (!(amt >= 1)) return out({ err: 'Pick an amount.' });
      const pre = await load(); // quick checks before taking chips (the real ones run again inside the change)
      if (b.a === 'sit' && (!pre.open || amt < pre.cfg.min || amt > pre.cfg.max)) return done({ T: pre, err: pre.open ? `Buy in for ${$(pre.cfg.min)} to ${$(pre.cfg.max)}.` : 'The room is closed.' });
      // free while bots sit (a test table): sitting costs nothing, leaving pays nothing; a free seat also tops up free
      const mine = pre.seats.find(s => s && !s.left && s.id === me.id);
      const free = b.a === 'sit' ? pre.seats.some(s => s && s.bot && !s.left) : !!(mine && mine.free);
      if (free) {
        const r = await change((T, now) => { if (b.a === 'sit') return E.sit(T, who, int(b.seat), amt, now, true); const i = E.seatOf(T, me.id); return i >= 0 && T.seats[i].free ? E.topUp(T, who, amt, now) : 'Try again.'; }, t);
        return done(r);
      }
      const paid = await takeChips(me.id, amt);
      if (paid.short) return done({ T: pre, err: `You only have ${$(paid.had || 0)} in chips.` });
      const r = await change((T, now) => { if (b.a === 'sit') return E.sit(T, who, int(b.seat), amt, now); const i = E.seatOf(T, me.id); return i >= 0 && T.seats[i].free ? 'Try again.' : E.topUp(T, who, amt, now); }, t);
      if (r.err) { const [back] = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, amt]); return done(r, { bal: +back }); }
      await kv(['HSET', 'bj:name', me.id, me.name]).catch(() => {});
      await joined(r);
      return done(r, { bal: paid.bal });
    }
    case 'leave': return done(await change((T, now) => E.leave(T, who, now), t));
    case 'sitout': return done(await change((T, now) => { const i = E.seatOf(T, me.id); return i < 0 ? "You're not at the table." : E.sitOut(T, i, !!b.on, now); }, t));
    case 'act': return done(await change((T, now) => { const i = E.seatOf(T, me.id); return i < 0 ? "You're not at the table." : E.act(T, i, String(b.do), int(b.to), now); }, t));
    case 'show': return done(await change((T, now) => { const i = E.seatOf(T, me.id); return i < 0 ? "You're not at the table." : E.showCards(T, i, now); }, t));
    case 'rit': return done(await change((T, now) => { const i = E.seatOf(T, me.id); return i < 0 ? "You're not at the table." : E.ritVote(T, i, !!b.yes, now); }, t));
    case 'rabbit': return done(await change((T, now) => { const i = E.seatOf(T, me.id); return i < 0 ? "You're not at the table." : E.rabbitHunt(T, i, now); }, t));
    case 'tick': return done(await change((T, now) => E.tick(T, now) ? true : false, t));
    case 'open': {
      const r = await change((T, now) => E.openRoom(T, b.cfg || {}, now), t);
      if (!r.err && b.post !== false) {
        const c = r.T.cfg, origin = `https://${req.headers.get('x-forwarded-host') || new URL(req.url).host}`;
        const x = [c.gift && `\n🎟️ **Free seat tonight:** your first ${$(c.gift)} buy-in is on the house, yours to keep.`, c.straddle && 'Straddle on.', r.T.nitNext && `Nit game: last to win a pot pays everyone ${$(r.T.nitNext.amt)}.`, r.T.bomb && `First hand is a ${$(r.T.bomb * c.bb)} bomb pot.`].filter(Boolean).join(' ');
        await postChannel({ content: `🃏 **The poker room is open.** No-limit Hold'em, blinds ${$(c.sb)}/${$(c.bb)}, buy in ${$(c.min)} to ${$(c.max)} with your casino chips.${x ? ' ' + x : ''}\n${origin}/poker`, allowed_mentions: { parse: [] } }, 'table').catch(e => console.error('poker open post', e));
      }
      return done(r);
    }
    case 'close': return done(await change((T, now) => E.requestClose(T, now), t));
    case 'pause': return done(await change((T, now) => E.pause(T, now), t));
    case 'resume': return done(await change((T, now) => E.resume(T, now), t));
    case 'blinds': return done(await change(T => E.setBlinds(T, int(b.sb), int(b.bb)), t));
    case 'seatout': return done(await change((T, now) => E.sitOut(T, int(b.seat), !!b.on, now, 'host'), t));
    case 'bomb': return done(await change(T => E.setBomb(T, int(b.x)), t));
    case 'straddle': return done(await change(T => E.setStraddle(T, !!b.on), t));
    case 'nit': return done(await change(T => E.setNit(T, int(b.x)), t));
    case 'gift': return done(await change(T => E.setGift(T, int(b.x)), t));
    case 'bot': return b.on ? out({ err: 'Bots play at practice tables now: anyone can start one from the poker page.' }) : done(await change((T, now) => E.removeBots(T, now), t));
  }
  return out({ err: 'Unknown action.' }, 400);
}


/** For the Monday cron: closes a room nobody touched for 3 hours so nobody's chips sit on a dead table. */
export async function pokerSweep() {
  const T = await load(ROOM);
  if (!T.open || !T.at || Date.now() - T.at < 3 * 3600e3) return 'nothing to do';
  const r = await change((X, now) => E.tick(X, now) ? true : false);
  return r.err || 'closed';
}
