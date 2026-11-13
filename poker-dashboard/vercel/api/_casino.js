// The site's casino (/casino page): Discord sign-in plus the same games and chips as the Discord bot.
// Routed through api/discord.js (vercel.json rewrites /api/login and /api/casino there) so it needs no function slot of its own.
//
//   GET  /api/login              → sends you to Discord to sign in (scope "identify": name, pfp, ID only)
//   GET  /api/login?code=…       ← Discord sends you back here; sets the session cookie, then goes to /casino
//   GET  /api/casino             → who you are, your chips, daily, leaderboard, "just now" feed, any unfinished hand
//   POST /api/casino {a: …}      → daily | bj | bj-act | uth | uth-act | bac | logout
//
// Chips are the Discord bot's (bj:bal keyed by Discord user ID), so the site and Discord stay in sync both ways.
// The game rules are the bot's own code (_blackjack.js, _uth.js, _baccarat.js); nothing is duplicated here.
// Needs Vercel env var DISCORD_CLIENT_SECRET (Developer Portal > OAuth2) and the redirect
// https://renpokernight.vercel.app/api/login added there. The app's client ID is looked up with DISCORD_BOT_TOKEN.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { kv, kvUrl, kvToken, MAX_BET, claimDaily, dailyStatus, chipBoard, newHand as bjStart, handAction, publicHand } from './_blackjack.js';
import { newHand as uthStart, uthAction, publicUth, MAX_ANTE, MAX_TRIPS, UTH_PAYTABLE } from './_uth.js';
import { playHand } from './_baccarat.js';

const DAYS30 = 30 * 24 * 3600;
const out = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const go = (url, cookies = []) => { const h = new Headers({ Location: url, 'Cache-Control': 'no-store' }); cookies.forEach(c => h.append('Set-Cookie', c)); return new Response(null, { status: 302, headers: h }); };
// messages from the shared game code are written for Discord; tidy them for the page
const plain = m => String(m).replace(/\*\*/g, '').replace(/Use \/daily/g, 'Claim your daily chips').replace(/with \/(blackjack|uth)/g, 'from the lobby');

// ---------- session cookie: base64url(JSON).hmac ----------
const secret = () => process.env.SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_BOT_TOKEN || '';
const keyOf = () => createHash('sha256').update('casino-session|' + secret()).digest();
const sign = data => createHmac('sha256', keyOf()).update(data).digest('base64url');
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function readCookie(req, name) {
  const m = (req.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
export function makeSession(user) {
  const data = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + DAYS30 * 1000 })).toString('base64url');
  return data + '.' + sign(data);
}
export function readSession(req) {
  const [data, sig] = readCookie(req, 'cas').split('.');
  if (!data || !sig || !secret()) return null;
  const want = Buffer.from(sign(data)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try { const s = JSON.parse(Buffer.from(data, 'base64url').toString()); return s.exp > Date.now() && /^\d{17,20}$/.test(s.id) ? s : null; } catch (e) { return null; }
}

// ---------- Discord sign-in ----------
let APP_ID = process.env.DISCORD_CLIENT_ID || '';
async function appId() {
  if (APP_ID) return APP_ID;
  const app = await fetch('https://discord.com/api/v10/oauth2/applications/@me', { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
  return (APP_ID = app ? app.id : '');
}
const originOf = req => { const u = new URL(req.url); return `https://${req.headers.get('x-forwarded-host') || u.host}`; };

async function login(req, sheet) {
  const u = new URL(req.url), origin = originOf(req), redirect = origin + '/api/login';
  const fail = why => go(`/casino?err=${encodeURIComponent(why)}`, [cookie('cas_state', '', 0)]);
  if (u.searchParams.get('error')) return fail('cancelled');
  const code = u.searchParams.get('code');
  if (!code) { // step 1: off to Discord
    const id = await appId();
    if (!id || !process.env.DISCORD_CLIENT_SECRET) return fail('setup');
    const state = randomBytes(12).toString('hex');
    const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: redirect, scope: 'identify', state, prompt: 'none' });
    return go('https://discord.com/oauth2/authorize?' + q, [cookie('cas_state', state, 600)]);
  }
  // step 2: Discord sent us back
  if (!u.searchParams.get('state') || u.searchParams.get('state') !== readCookie(req, 'cas_state')) return fail('expired');
  const tok = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: await appId(), client_secret: process.env.DISCORD_CLIENT_SECRET || '', grant_type: 'authorization_code', code, redirect_uri: redirect }) })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  if (!tok || !tok.access_token) return fail('discord');
  const user = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!user || !user.id) return fail('discord');
  // only people the club knows: anyone the bot has seen play (bj:name), or anyone with their Discord ID on the Members tab
  const [known] = await kv(['HGET', 'bj:name', user.id]);
  const s = await sheet().catch(() => null), ids = (s && s.ids) || {};
  const sheetName = Object.keys(ids).find(n => ids[n] === user.id);
  if (!known && !sheetName) return fail('stranger');
  const name = sheetName || known || user.global_name || user.username;
  return go('/casino', [cookie('cas', makeSession({ id: user.id, name }), DAYS30), cookie('cas_state', '', 0)]);
}

// ---------- the page's data ----------
async function state(me) {
  const [board, feedRaw] = await Promise.all([chipBoard(), kv(['LRANGE', 'cas:feed', 0, 9]).then(r => r[0] || [])]);
  const feed = feedRaw.map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
  const body = { me: null, board: board.slice(0, 15), players: board.length, feed, maxBet: MAX_BET, maxAnte: MAX_ANTE, maxTrips: MAX_TRIPS, uthPaytable: plain(UTH_PAYTABLE) };
  if (!me) return body;
  const mine = board.find(r => r.id === me.id);
  const [daily, cur] = await Promise.all([dailyStatus(me.id), kv(['HGETALL', 'cas:cur:' + me.id]).then(r => r[0] || [])]);
  body.me = { id: me.id, name: me.name, bal: mine ? mine.bal : null, rank: mine ? board.indexOf(mine) + 1 : null, daily };
  // an unfinished hand started on the site comes back after a reload
  const c = {}; for (let k = 0; k < cur.length; k += 2) c[cur[k]] = cur[k + 1];
  const [bjRaw, uthRaw] = await kv(['GET', 'bj:g:' + (c.bj || 'none')], ['GET', 'uth:g:' + (c.uth || 'none')]);
  const bal = body.me.bal || 0;
  if (bjRaw) { const g = JSON.parse(bjRaw); if (!g.over && g.uid === me.id) body.bj = publicHand(g, bal); }
  if (uthRaw) { const g = JSON.parse(uthRaw); if (g.stage !== 'done' && g.uid === me.id) body.uth = publicUth(g, bal); }
  return body;
}

const int = (v, lo, hi, dflt) => { const n = Math.floor(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const remember = (me, game, gid) => kv(['HSET', 'cas:cur:' + me.id, game, gid], ['EXPIRE', 'cas:cur:' + me.id, 3600]).catch(() => {});
const actResult = (r, view) => r.gone ? out({ err: 'That hand expired. Deal a new one.' }) : r.notYours ? out({ err: "That's not your hand." })
  : r.busy ? out({ busy: true }) : r.err ? out({ err: plain(r.err) }) : out({ bal: r.bal, hand: view(r.g, r.bal) });

async function act(req, me) {
  let b; try { b = await req.json(); } catch (e) { return out({ err: 'Bad request.' }, 400); }
  const who = { id: me.id, name: me.name, src: 'site' };
  switch (b.a) {
    case 'logout': return out({ ok: true }, 200, { 'Set-Cookie': cookie('cas', '', 0) });
    case 'daily': {
      const r = await claimDaily(who);
      if (r.busy) return out({ busy: true });
      if (r.wait !== undefined) return out({ err: 'Already claimed today.', daily: { wait: r.wait, amt: r.amt } });
      return out({ bal: r.bal, got: r.amt, first: r.first, daily: await dailyStatus(me.id) });
    }
    case 'bj': {
      const r = await bjStart(who, int(b.bet, 1, MAX_BET, 20));
      if (r.err) return out({ err: plain(r.err) });
      if (!r.g.over) await remember(me, 'bj', r.g.id);
      return out({ bal: r.bal, hand: publicHand(r.g, r.bal) });
    }
    case 'bj-act': return actResult(await handAction(who, String(b.id || '').replace(/[^0-9a-f]/g, ''), String(b.do)), publicHand);
    case 'uth': {
      const r = await uthStart(who, int(b.ante, 1, MAX_ANTE, 10), int(b.trips, 0, MAX_TRIPS, 0));
      if (r.err) return out({ err: plain(r.err) });
      await remember(me, 'uth', r.g.id);
      return out({ bal: r.bal, hand: publicUth(r.g, r.bal) });
    }
    case 'uth-act': return actResult(await uthAction(who, String(b.id || '').replace(/[^0-9a-f]/g, ''), String(b.do)), publicUth);
    case 'bac': {
      const side = ['player', 'banker', 'tie'].includes(b.side) ? b.side : 'banker';
      // a short lock per person so a double tap doesn't deal two hands
      const [got] = await kv(['SET', 'ba:lock:' + me.id, '1', 'NX', 'PX', 1500]);
      if (!got) return out({ busy: true });
      const r = await playHand(who, side, int(b.bet, 1, MAX_BET, 20));
      if (r.err) return out({ err: plain(r.err) });
      return out({ bal: r.bal, net: r.net, side, coup: { p: r.c.p, b: r.c.b, ps: r.c.ps, bs: r.c.bs, natural: r.c.natural, winner: r.c.winner } });
    }
  }
  return out({ err: 'Unknown action.' }, 400);
}

/** Entry point from api/discord.js. what = 'login' | 'casino'. sheet() = the cached sheet loader (for Members tab IDs). */
export async function casinoWeb(req, what, sheet) {
  if (!kvUrl() || !kvToken()) return out({ err: "The chip storage isn't connected." }, 503);
  try {
    if (what === 'login') return await login(req, sheet);
    const me = readSession(req);
    if (req.method === 'GET') return out(await state(me));
    if (req.method !== 'POST') return out({ err: 'Method not allowed.' }, 405);
    // same-site only: the cookie is SameSite=Lax already; this also refuses posts from other sites
    const o = req.headers.get('origin');
    if (o && new URL(o).host !== (req.headers.get('x-forwarded-host') || new URL(req.url).host)) return out({ err: 'Wrong site.' }, 403);
    if (!me) return out({ err: 'Sign in first.', signedOut: true }, 401);
    return await act(req, me);
  } catch (e) {
    console.error('casino', e);
    return out({ err: "Couldn't reach the chip storage just now. Try again in a moment." }, 500);
  }
}
