// The poker room on the site (/poker): one host-run no-limit Hold'em table for casino chips (bj:bal), live through Ably.
// Routed through api/discord.js (vercel.json rewrites /api/poker there with ?web=poker), so it needs no function of its own.
//
//   GET  /api/poker            → the table (public), plus for a signed-in person: your seat, your two cards, your chips, host or not
//   GET  /api/poker?token=1    → Ably token request; guests (not signed in) get listen-only, so watching needs no sign-in
//   POST /api/poker {a: …}     → token (Ably sign-in for live updates) | sit {seat, amt} | top {amt} | leave | sitout {on}
//                                | act {do: fold|check|call|raise, to} | tick | host: open {cfg} | close | pause | resume | blinds {sb, bb} | seatout {seat, on} | bomb {x} | straddle {on} | nit {x} | bot {on} (add one test player / remove them all)
//
// Storage: the whole table is one JSON value (pk:t) with a version number (pk:v). Each change reads it, applies the rules
// (_pokergame.js) and writes it back only if nobody else wrote in between (one Lua compare-and-set), else tries again.
// That's 2 Redis commands per move. Chips: buy-ins/top-ups are taken first (takeChips, atomic) and refunded if the seat
// can't be taken; cash-outs are paid only after the table saved. Hidden cards never leave the server except to their owner.
// Live updates: after each change the public table is published to the Ably channel "poker:table" (env ABLY_API_KEY, kept
// server-side; browsers get short-lived tokens that can only listen there and chat on "poker:chat"). Without Ably the page polls.
// Hosts = Renato, server admins and the pitboss role (same people as /house).
import { createHmac, randomBytes } from 'node:crypto';
import { kv, takeChips, FEED_KEEP } from './_blackjack.js';
import { postChannel } from './_rewards.js';
import * as E from './_pokergame.js';

const KEY = 'pk:t', VER = 'pk:v', CHAN = 'poker:table', CHAT = 'poker:chat';
const RENATO = '147939795400654848', API = 'https://discord.com/api/v10';
const CAS = "local v=redis.call('GET',KEYS[1]) or '0' if v~=ARGV[1] then return 0 end redis.call('SET',KEYS[2],ARGV[3]) redis.call('SET',KEYS[1],ARGV[2]) return 1";
const $ = n => '$' + Math.round(n).toLocaleString('en-US');
const int = v => { const n = Math.floor(+v); return Number.isFinite(n) ? n : NaN; };

async function load() {
  const [raw] = await kv(['GET', KEY]);
  if (!raw) return E.fresh();
  try { return { ...E.fresh(), ...JSON.parse(raw) }; } catch (e) { return E.fresh(); }
}
/** Applies fn(T) and saves, retrying if someone else saved first. fn returns an error string to refuse (nothing saved),
 *  or false for "nothing changed". Returns { T, err } after paying any cash-outs and publishing the new table. */
async function change(fn, t = Date.now()) {
  for (let k = 0; k < 8; k++) {
    const T = await load(), was = T.v;
    const r = fn(T, t);
    if (typeof r === 'string') return { T, err: r };
    if (r === false) return { T, same: true };
    T.at = t; T.v = was + 1;
    const out = T._out || []; delete T._out;
    const [ok] = await kv(['EVAL', CAS, 2, VER, KEY, String(was), String(T.v), JSON.stringify(T)]);
    if (+ok === 1) {
      if (out.length) await payOut(out).catch(e => console.error('poker payout', e, JSON.stringify(out)));
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
/** ids = () => Promise of the Members-tab Discord IDs; only waited on when the answer isn't known yet (it can mean a trip to Google) */
async function isHost(id, ids) {
  if (id === RENATO) return true;
  const c = hostCache.get(id); if (c && Date.now() - c.at < 600e3) return c.ok;
  if (id === (await ids()).Renato) return true;
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

// ---------- the page's data ----------
async function view(T, me, ids, t, extra = {}) {
  const body = { table: E.publicView(T, t), ably: !!ablyKey(), ...extra };
  if (!me) return body;
  const i = E.seatOf(T, me.id), s = i >= 0 ? T.seats[i] : null;
  const [bal] = extra.bal !== undefined ? [extra.bal] : await kv(['HGET', 'bj:bal', me.id]);
  body.me = { id: me.id, name: me.name, seat: i, cards: s && s.cards.length ? s.cards : [], bal: bal === null ? 0 : Math.floor(+bal * 100) / 100, host: await isHost(me.id, ids) };
  delete body.bal;
  return body;
}

export async function pokerWeb(req, me, sheet, out) {
  const t = Date.now();
  // the sheet is loaded only if a host check needs it: every move (bots' ticks too) used to wait on it, up to ~2s on a cold start
  let idsP = null; const ids = () => idsP ||= sheet().then(s => (s && s.ids) || {}).catch(() => ({}));
  if (req.method === 'GET') {
    // signing in is optional: anyone can watch, and a guest gets a listen-only live token here
    if (new URL(req.url).searchParams.get('token')) return ablyKey() ? out({ token: tokenRequest(me ? me.id : 'guest-' + randomBytes(6).toString('hex'), !me) }) : out({ err: 'Live updates are not set up.' });
    let T = await load();
    // nobody ticks a room that everyone walked away from; the next visit does (closes it, pays everyone)
    if (T.open && ((T.at && t - T.at > 3 * 3600e3) || (!T.seats.some(s => s && !s.left) && T.emptyAt && t - T.emptyAt > 30 * 60e3))) {
      const r = await change((X, now) => E.tick(X, now) ? true : false, t); if (r.T) T = r.T;
    }
    return out(await view(T, me, ids, t));
  }
  let b; try { b = await req.json(); } catch (e) { return out({ err: 'Bad request.' }, 400); }
  const who = { id: me.id, name: me.name };
  const host = ['open', 'close', 'pause', 'resume', 'blinds', 'seatout', 'bomb', 'straddle', 'nit', 'bot'].includes(b.a);
  if (host && !(await isHost(me.id, ids))) return out({ err: 'Only hosts can do that.' }, 403);
  const done = async (r, extra = {}) => r.err ? out({ err: r.err, ...(r.T ? await view(r.T, me, ids, t) : {}) }) : out(await view(r.T, me, ids, t, extra));

  switch (b.a) {
    case 'token': return ablyKey() ? out({ token: tokenRequest(me.id) }) : out({ err: 'Live updates are not set up.' });
    case 'sit': case 'top': {
      const amt = int(b.amt);
      if (!(amt >= 1)) return out({ err: 'Pick an amount.' });
      const pre = await load(); // quick checks before taking chips (the real ones run again inside the change)
      if (b.a === 'sit' && (!pre.open || amt < pre.cfg.min || amt > pre.cfg.max)) return done({ T: pre, err: pre.open ? `Buy in for ${$(pre.cfg.min)} to ${$(pre.cfg.max)}.` : 'The room is closed.' });
      const paid = await takeChips(me.id, amt);
      if (paid.short) return done({ T: pre, err: `You only have ${$(paid.had || 0)} in chips.` });
      const r = await change((T, now) => b.a === 'sit' ? E.sit(T, who, int(b.seat), amt, now) : E.topUp(T, who, amt, now), t);
      if (r.err) { const [back] = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, amt]); return done(r, { bal: +back }); }
      await kv(['HSET', 'bj:name', me.id, me.name]).catch(() => {});
      return done(r, { bal: paid.bal });
    }
    case 'leave': return done(await change((T, now) => E.leave(T, who, now), t));
    case 'sitout': return done(await change((T, now) => { const i = E.seatOf(T, me.id); return i < 0 ? "You're not at the table." : E.sitOut(T, i, !!b.on, now); }, t));
    case 'act': return done(await change((T, now) => { const i = E.seatOf(T, me.id); return i < 0 ? "You're not at the table." : E.act(T, i, String(b.do), int(b.to), now); }, t));
    case 'tick': return done(await change((T, now) => E.tick(T, now) ? true : false, t));
    case 'open': {
      const r = await change((T, now) => E.openRoom(T, b.cfg || {}, now), t);
      if (!r.err && b.post !== false) {
        const c = r.T.cfg, origin = `https://${req.headers.get('x-forwarded-host') || new URL(req.url).host}`;
        const x = [c.straddle && 'Straddle on.', r.T.nitNext && `Nit game: last to win a pot pays everyone ${$(r.T.nitNext.amt)}.`, r.T.bomb && `First hand is a ${$(r.T.bomb * c.bb)} bomb pot.`].filter(Boolean).join(' ');
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
    case 'bot': return done(await change((T, now) => b.on ? E.addBot(T, now) : E.removeBots(T, now), t));
  }
  return out({ err: 'Unknown action.' }, 400);
}

/** For the Monday cron: closes a room nobody touched for 3 hours so nobody's chips sit on a dead table. */
export async function pokerSweep() {
  const T = await load();
  if (!T.open || !T.at || Date.now() - T.at < 3 * 3600e3) return 'nothing to do';
  const r = await change((X, now) => E.tick(X, now) ? true : false);
  return r.err || 'closed';
}
