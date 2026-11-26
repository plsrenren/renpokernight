// /roulette: a shared table with the blackjack chips (bj:bal). One table per channel.
//   /roulette opens it for 30 seconds. Anyone taps bets (Red, Black, Odd, Even, 1-18, 19-36, dozens, Number...);
//   each tap places one chip of their chosen size ($5 to $100, set with the dropdown). Chips come off when placed.
//   When time is up the bot spins (European wheel, single 0), pays everyone and edits the table into the result.
//   Payouts: number 35:1, dozens 2:1, everything else 1:1. Even-money bets lose on 0.
// The bot only runs when Discord calls it, so the command (or New round button) that opened the table stays awake
// for the 30 seconds and then spins. If that ever dies, the next tap on the table (bets or New round), the next
// /roulette in that channel, or a site visitor watching it, spins it instead (for up to a day), so chips are never stuck.
//
// Site roulette (Nov 26 2026, Renato: "put roulette on site", one shared table): /casino#roulette plays the SAME #casino table.
//   - GET /api/casino?ro=1[&ch=<channel>] (rouletteWeb) = the table people are betting on, or the last spin. One Redis GET
//     (ro:cur:<channel> holds a copy of the newest table), plus your balance when signed in.
//   - POST {a:'ro-open'} opens a table from the site: the bot posts the table message in #casino (anyone there can tap in)
//     and the site's request stays awake 30s to spin it. POST {a:'ro-bet', id, type, num, amt} = one bet of any size up to
//     MAX_PER_SPIN, after which the Discord message is edited to show it, tagged (site).
//   - Each table remembers its Discord message (t.msg: the opening interaction's webhook token, or the bot message's channel + id)
//     so either side can redraw it.
// Keys: ro:t:<id> (table, 1 day), ro:open:<channel> (open table id, 1 day), ro:cur:<channel> (copy of the newest table, 1 day),
//       ro:lock:<id>, ro:chip (hash user → chip size), ro:hist:<channel> (last spins).
import { attachPicture, discordBody } from './_attach.js';
import { randomBytes, randomInt } from 'node:crypto';
import { waitUntil as vercelWaitUntil } from '@vercel/functions';
import { kv, kvUrl, kvToken, money, json, quiet, whoIs, noStorage, feedCmds, takeChips, nameCmd } from './_blackjack.js';
import { afterJackpot } from './_jackpot.js';
import { channelId } from './_rewards.js';

const SITE = 'https://www.thepoker.study', API = 'https://discord.com/api/v10';
const OPEN_MS = 30e3, CHIPS = [5, 10, 25, 50, 100], DEFAULT_CHIP = 10, MAX_PER_SPIN = 1000;
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const BETS = {
  red: { label: 'Red', emoji: '🔴', wins: n => REDS.has(n), pays: 1 },
  black: { label: 'Black', emoji: '⚫', wins: n => n > 0 && !REDS.has(n), pays: 1 },
  odd: { label: 'Odd', wins: n => n > 0 && n % 2 === 1, pays: 1 },
  even: { label: 'Even', wins: n => n > 0 && n % 2 === 0, pays: 1 },
  low: { label: '1–18', wins: n => n >= 1 && n <= 18, pays: 1 },
  high: { label: '19–36', wins: n => n >= 19, pays: 1 },
  d1: { label: '1st 12', wins: n => n >= 1 && n <= 12, pays: 2 },
  d2: { label: '2nd 12', wins: n => n >= 13 && n <= 24, pays: 2 },
  d3: { label: '3rd 12', wins: n => n >= 25, pays: 2 },
};
const betName = b => (b.type === 'num' ? `#${b.num}` : `${BETS[b.type].emoji ? BETS[b.type].emoji + ' ' : ''}${BETS[b.type].label}`);
const wins = (b, n) => (b.type === 'num' ? b.num === n : BETS[b.type].wins(n));
/** 1 when every chip uid put on this spin sits on one single number and that number hit (True Believer accolade). */
export const loneHit = (bets, uid, n) => { const mine = bets.filter(b => b.uid === uid); return mine.length && mine.every(b => b.type === 'num' && b.num === n) ? 1 : 0; };
const pays = b => (b.type === 'num' ? 35 : BETS[b.type].pays);
export const colorOf = n => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

export const ROULETTE_COMMAND = { name: 'roulette', description: 'Open a roulette table: everyone has 30 seconds to bet chips, then it spins', type: 1 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const later = p => { try { vercelWaitUntil(p); } catch (e) { /* not on Vercel: the promise just runs */ } };
const KEEP = 86400; // a table (and the channel's pointer to it) lives a day, so a table that never spun is still found and spun
// the table + the copy the site reads (ro:cur:<channel>): two commands, always sent together
const save = t => [['SET', 'ro:t:' + t.id, JSON.stringify(t), 'EX', KEEP], ['SET', 'ro:cur:' + t.channel, JSON.stringify(t), 'EX', KEEP]];
// clears the channel's open table only if it is still this one (a newer table may have opened meanwhile)
const CLEAR_OPEN = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0";
async function lock(id, tries = 20) {
  for (let k = 0; k < tries; k++) { const [got] = await kv(['SET', 'ro:lock:' + id, '1', 'NX', 'EX', 8]); if (got) return true; await sleep(150); }
  return false;
}
const unlock = id => kv(['DEL', 'ro:lock:' + id]).catch(() => {});

// ---------- the message ----------
function byPlayer(t) {
  const m = new Map();
  for (const b of t.bets) { if (!m.has(b.uid)) m.set(b.uid, { name: b.name, site: false, bets: [] }); const p = m.get(b.uid); p.bets.push(b); if (b.src === 'site') p.site = true; }
  return [...m.entries()];
}
const groupBets = bets => { // "Odd ×3 · #17" style, amounts summed per bet
  const g = new Map();
  for (const b of bets) { const k = betName(b); const x = g.get(k) || { n: 0, amt: 0 }; x.n++; x.amt += b.amt; g.set(k, x); }
  return [...g.entries()].map(([k, x]) => `${k}${x.n > 1 ? ` ×${x.n}` : ''} ${money(x.amt)}`).join(' · ');
};
const tagged = p => `**${p.name}**${p.site ? ' (site)' : ''}`;

export function tableView(t) {
  const btn = (label, emoji, id, style) => ({ type: 2, style, label, ...(emoji ? { emoji: { name: emoji } } : {}), custom_id: `ro:${id}:${t.id}` });
  if (!t.spun) {
    const players = byPlayer(t), total = t.bets.reduce((a, b) => a + b.amt, 0);
    const list = players.map(([, p]) => `${tagged(p)} · ${groupBets(p.bets)}`).join('\n') || '_No bets yet. Be the first._';
    return { allowed_mentions: { parse: [] }, embeds: [{ color: 0x2f7d5b, title: '🎡 Roulette · place your bets', url: `${SITE}/casino#roulette`,
      description: `Spins <t:${Math.ceil(t.ends / 1000)}:R>${t.by ? ` · opened on the site by **${t.by}**` : ''}\nTap a bet to place one chip, tap again to stack. Pick your chip size below. Or bet on the site.\nNumber pays 35:1 · dozens 2:1 · everything else 1:1\n\n${list}`,
      footer: { text: `${players.length} player${players.length === 1 ? '' : 's'} · ${money(total)} on the table` } }],
    components: [
      { type: 1, components: [btn('Red', '🔴', 'red', 4), btn('Black', '⚫', 'black', 2), btn('Odd', null, 'odd', 2), btn('Even', null, 'even', 2), btn('Number…', '🎯', 'num', 1)] },
      { type: 1, components: [btn('1–18', null, 'low', 2), btn('19–36', null, 'high', 2), btn('1st 12', null, 'd1', 2), btn('2nd 12', null, 'd2', 2), btn('3rd 12', null, 'd3', 2)] },
      { type: 1, components: [{ type: 3, custom_id: `ro:chip:${t.id}`, placeholder: '🪙 Chip size (default $10)',
        options: CHIPS.map(c => ({ label: `Chip size: ${money(c)}`, value: String(c) })) }] }] };
  }
  const n = t.result, col = colorOf(n);
  const tags = n === 0 ? 'zero' : [n % 2 ? 'odd' : 'even', n <= 18 ? '1–18' : '19–36', n <= 12 ? '1st 12' : n <= 24 ? '2nd 12' : '3rd 12'].join(' · ');
  const rows = byPlayer(t).map(([uid, p]) => {
    const net = t.nets[uid] || 0;
    const marks = [...new Set(p.bets.map(b => `${betName(b)} ${wins(b, n) ? '✓' : '✗'}`))].join(' · ');
    return [net, `${tagged(p)} · ${marks} · \`${net > 0 ? '+' : net < 0 ? '−' : ''}${money(Math.abs(net))}\``];
  }).sort((a, b) => b[0] - a[0]).map(r => r[1]);
  const dot = x => (colorOf(x) === 'red' ? '🔴' : colorOf(x) === 'black' ? '⚫' : '🟢');
  return { allowed_mentions: { parse: [] }, embeds: [{ color: col === 'red' ? 0xc2283e : col === 'black' ? 0x1e1f22 : 0x248046,
    title: `🎡 ${n} ${col.toUpperCase()} · ${tags}`,
    description: rows.join('\n') || 'Nobody bet this spin.',
    image: { url: `${SITE}/api/roulette?n=${n}&v=${t.id}` },
    footer: { text: `Last spins: ${(t.hist || [n]).map(x => `${x} ${dot(x)}`).join(' · ')}` } }],
  components: [{ type: 1, components: [btn('New round (30s)', '🔁', 'new', 1)] }] };
}

/** Redraws the table's Discord message (the opening interaction's, or the bot's own post for site-opened tables).
 *  pic = upload the wheel picture with it (the spin). A betting redraw re-reads the table first so it never
 *  paints over a spin that landed meanwhile. */
async function pushView(t, pic = false) {
  if (!t.msg) return;
  if (!pic) { const [raw] = await kv(['GET', 'ro:t:' + t.id]); if (!raw) return; t = JSON.parse(raw); if (t.spun) return; }
  const view = pic ? ((await attachPicture(tableView(t), 5000)) || { data: tableView(t), png: null }) : { data: tableView(t), png: null };
  const body = discordBody(view.data, view.png);
  const url = t.msg.token ? `${API}/webhooks/${t.msg.app}/${t.msg.token}/messages/@original` : `${API}/channels/${t.msg.ch}/messages/${t.msg.id}`;
  const headers = t.msg.token ? body.headers : { ...body.headers, Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
  const r = await fetch(url, { method: 'PATCH', headers, body: body.body });
  if (!r.ok) console.error('roulette edit failed', r.status, await r.text());
}

// ---------- spinning ----------
/** Spins table t (already locked by the caller), pays out, saves. Returns the table. */
async function spin(t) {
  if (t.spun) return t;
  const n = randomInt(37);
  t.result = n; t.spun = true; t.nets = {};
  const back = {};
  for (const b of t.bets) {
    t.nets[b.uid] = (t.nets[b.uid] || 0) - b.amt;
    if (wins(b, n)) { const r = b.amt * (pays(b) + 1); back[b.uid] = (back[b.uid] || 0) + r; t.nets[b.uid] += r; }
  }
  const pay = Object.entries(back).map(([uid, amt]) => ['HINCRBYFLOAT', 'bj:bal', uid, amt]);
  // one "Just now" line per player at the table (after the reads below, so the result indexes stay put)
  const names = {}, src = {}, staked = {}; t.bets.forEach(b => { names[b.uid] = b.name; if (b.src === 'site') src[b.uid] = 'site'; staked[b.uid] = (staked[b.uid] || 0) + b.amt; });
  const feed = Object.entries(t.nets).flatMap(([uid, net]) => feedCmds({ id: uid, name: names[uid], src: src[uid] }, 'roulette', net, staked[uid], { believer: loneHit(t.bets, uid, n) }));
  const res = await kv(...pay, ['LPUSH', 'ro:hist:' + t.channel, n], ['LTRIM', 'ro:hist:' + t.channel, 0, 4], ['LRANGE', 'ro:hist:' + t.channel, 0, 4], ...save(t), ['EVAL', CLEAR_OPEN, 1, 'ro:open:' + t.channel, t.id], ...feed);
  t.hist = (res[pay.length + 2] || []).map(Number);
  await kv(...save(t));
  await afterJackpot().catch(e => console.error('jackpot', e)); // a spin can hit the mystery drop: post it now
  return t;
}

/** Waits until the table's time is up, spins it and redraws its Discord message. */
async function spinLater(id) {
  const [raw] = await kv(['GET', 'ro:t:' + id]);
  if (!raw) return;
  await sleep(Math.max(0, JSON.parse(raw).ends - Date.now()) + 300);
  if (!(await lock(id))) return;
  try {
    const [r2] = await kv(['GET', 'ro:t:' + id]);
    const t = JSON.parse(r2);
    if (t.spun) return;
    await spin(t);
    await pushView(t, true); // wheel uploaded with the edit (see _attach.js)
  } finally { await unlock(id); }
}

/** A table whose time ran out but never spun (its opener died): spin it and pay it. */
async function rescue(t) {
  if (!t || t.spun || Date.now() < t.ends) return t;
  if (!(await lock(t.id))) return t;
  try { const [r2] = await kv(['GET', 'ro:t:' + t.id]); const t2 = r2 && JSON.parse(r2); if (t2 && !t2.spun) { await spin(t2); await pushView(t2, true).catch(() => {}); return t2; } return t2 || t; }
  finally { await unlock(t.id); }
}

/** The channel's open table if it's still taking bets, else null (an old one that never spun gets spun on the way). */
async function openNow(channel) {
  const [openId] = await kv(['GET', 'ro:open:' + channel]);
  if (!openId) return null;
  const [raw] = await kv(['GET', 'ro:t:' + openId]);
  const t = raw && JSON.parse(raw);
  if (t && !t.spun && Date.now() < t.ends) return t;
  if (t && !t.spun) await rescue(t);
  return null;
}

/** Opens a table in the channel (or says one is already open). waitUntil keeps the spin alive. */
async function openTable(i, waitUntil) {
  const channel = i.channel_id || (i.channel && i.channel.id) || 'dm';
  const live = await openNow(channel);
  if (live) return quiet(`A table is already open here. It spins <t:${Math.ceil(live.ends / 1000)}:R>, so jump in on that one.`);
  const t = { id: randomBytes(5).toString('hex'), channel, ends: Date.now() + OPEN_MS, bets: [], spun: false, msg: { app: i.application_id, token: i.token } };
  await kv(...save(t), ['SET', 'ro:open:' + channel, t.id, 'EX', KEEP]);
  waitUntil(spinLater(t.id).catch(e => console.error('roulette spin', e)));
  return json({ type: 4, data: tableView(t) });
}

export async function rouletteCommand(i, waitUntil) {
  if (!kvUrl() || !kvToken()) return noStorage();
  try { return await openTable(i, waitUntil); } catch (e) { console.error('roulette', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}

// ---------- placing bets (Discord taps and the site share this) ----------
/** One bet on table id. me = { id, name, src?, guess? }. amtWanted 0 = their chip size.
 *  Returns { t, amt, mine, left } or { err } / { gone } / { done } / { late: t (just spun) } / { busy }. */
async function betCore(me, id, type, num, amtWanted) {
  if (!(await lock(id))) return { busy: true };
  try {
    const [raw, chip, balRaw] = await kv(['GET', 'ro:t:' + id], ['HGET', 'ro:chip', me.id], ['HGET', 'bj:bal', me.id]);
    if (!raw) return { gone: true };
    const t = JSON.parse(raw);
    if (t.spun) return { done: true, t };
    if (Date.now() >= t.ends) { await spin(t); return { late: t }; } // late tap: spin it now
    const amt = amtWanted || +chip || DEFAULT_CHIP, mine = t.bets.filter(b => b.uid === me.id).reduce((a, b) => a + b.amt, 0);
    if (balRaw === null) return { err: "You don't have any chips yet. Use **/daily** to get some free." };
    if (mine + amt > MAX_PER_SPIN) return { err: `That's the ${money(MAX_PER_SPIN)} limit per spin. Wait for the next round.` };
    const took = await takeChips(me.id, amt); // check + take in one step, so other games can't spend the same chips
    if (took.short) return { err: `You only have ${money(took.had || 0)} left. Pick a smaller chip size.` };
    t.bets.push({ uid: me.id, name: me.name, type, ...(type === 'num' ? { num } : {}), amt, ...(me.src === 'site' ? { src: 'site' } : {}) });
    await kv(nameCmd(me), ...save(t));
    return { t, amt, mine: mine + amt, left: +took.bal };
  } finally { await unlock(id); }
}

async function placeBet(i, s, id, type, num, amtWanted, waitUntil) {
  const r = await betCore(whoIs(i, s), id, type, num, amtWanted);
  if (r.busy) return json({ type: 6 });
  if (r.gone) return quiet('This table has closed. Start a new one with **/roulette**.');
  if (r.done) return quiet('This spin is done. Tap **New round** to play again.');
  if (r.late) return json({ type: 7, data: tableView(r.late) });
  if (r.err) return quiet(r.err);
  if (waitUntil) waitUntil(fetch(`${API}/webhooks/${i.application_id}/${i.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flags: 64, content: `${money(r.amt)} on ${betName(r.t.bets.at(-1))}. You have ${money(r.mine)} on this spin and ${money(r.left)} left.` }) }).catch(() => {}));
  // the tapped message updates itself (type 7); a site-opened table's message is the same message, so nothing else to redraw
  return json({ type: 7, data: tableView(r.t) });
}

/** Buttons, the chip dropdown and the Number box (custom_id ro:<action>:<table id>). */
export async function rouletteInteraction(i, s, waitUntil) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const [, act, id] = String(i.data.custom_id).split(':');
  if (act === 'chip') {
    const v = +((i.data.values || [])[0]);
    if (!CHIPS.includes(v)) return json({ type: 6 });
    await kv(['HSET', 'ro:chip', whoIs(i, s).id, v]);
    return quiet(`Chip size set to ${money(v)}. Every bet you tap is now ${money(v)}.`);
  }
  if (act === 'num') { // open the box
    return json({ type: 9, data: { custom_id: `ro:numbox:${id}`, title: 'Bet on a number', components: [
      { type: 1, components: [{ type: 4, custom_id: 'n', label: 'Number (0 to 36)', style: 1, min_length: 1, max_length: 2, required: true, placeholder: '17' }] },
      { type: 1, components: [{ type: 4, custom_id: 'a', label: 'Chips (leave empty for your chip size)', style: 1, max_length: 4, required: false, placeholder: '10' }] }] } });
  }
  if (act === 'numbox') { // the box was sent
    const field = k => { for (const row of i.data.components || []) for (const c of row.components || []) if (c.custom_id === k) return String(c.value || '').trim(); return ''; };
    const n = field('n'), a = field('a').replace(/[$,\s]/g, '');
    if (!/^\d{1,2}$/.test(n) || +n > 36) return quiet('Pick a number from 0 to 36.');
    if (a && (!/^\d+$/.test(a) || +a < 1 || +a > MAX_PER_SPIN)) return quiet(`Chips must be a whole number from $1 to ${money(MAX_PER_SPIN)}.`);
    return placeBet(i, s, id, 'num', +n, a ? +a : 0, waitUntil);
  }
  if (act === 'new') {
    const [raw] = await kv(['GET', 'ro:t:' + id]);
    const t = raw && JSON.parse(raw);
    if (t && !t.spun && Date.now() < t.ends) return json({ type: 6 }); // still taking bets
    return openTable(i, waitUntil); // a table that never spun is spun and paid first (openNow)
  }
  if (BETS[act]) return placeBet(i, s, id, act, null, 0, waitUntil);
  return json({ type: 6 });
}

// ---------- the site (/casino#roulette) ----------
const plainMsg = m => String(m).replace(/\*\*/g, '').replace(/Use \/daily to get some free/, 'Collect your day job pay in the lobby first').replace(/ Pick a smaller chip size\./, ' Pick a smaller chip.');
/** What the page sees: no Discord tokens, just the table. */
function siteView(t) {
  if (!t) return null;
  return { id: t.id, ends: t.ends, spun: !!t.spun, result: t.spun ? t.result : null, color: t.spun ? colorOf(t.result) : null, hist: t.hist || [], by: t.by || null,
    bets: t.bets.map(b => ({ uid: b.uid, name: b.name, type: b.type, num: b.num, amt: b.amt, label: betName(b).replace(/^\S+ (?=Red|Black)/, ''), site: b.src === 'site' })),
    nets: t.spun ? t.nets : null };
}
const cleanCh = c => (/^\d{5,25}$/.test(String(c || '')) ? String(c) : '');
/** The site's table channel: #casino (so Discord and the site share one table), or 'site' when the bot can't find it. */
const siteChannel = async () => (await channelId('casino').catch(() => '')) || 'site';

/** GET /api/casino?ro=1[&ch=…] and POST {a:'ro-open'|'ro-bet'} from _casino.js. out = its JSON responder. */
export async function rouletteWeb(req, me, out, body = null) {
  if (!body) { // watching: one GET (plus your balance)
    const u = new URL(req.url), ch = cleanCh(u.searchParams.get('ch')) || (u.searchParams.get('ch') === 'site' ? 'site' : await siteChannel());
    const [raw, bal] = await kv(['GET', 'ro:cur:' + ch], ...(me ? [['HGET', 'bj:bal', me.id]] : []));
    let t = raw ? JSON.parse(raw) : null;
    if (t && !t.spun && Date.now() > t.ends + 4000) t = await rescue(t); // its opener died: whoever's watching spins it
    return out({ ch, now: Date.now(), t: siteView(t), bal: me && bal !== null && bal !== undefined ? Math.round(+bal * 100) / 100 : null, max: MAX_PER_SPIN, openMs: OPEN_MS });
  }
  const who = { id: me.id, name: me.name, src: 'site', ...(me.guess ? { guess: true } : {}) };
  if (body.a === 'ro-open') {
    const channel = await siteChannel(), live = await openNow(channel);
    if (live) return out({ ch: channel, now: Date.now(), t: siteView(live) });
    const t = { id: randomBytes(5).toString('hex'), channel, ends: Date.now() + OPEN_MS, bets: [], spun: false, by: me.name };
    if (channel !== 'site' && process.env.DISCORD_BOT_TOKEN) { // the bot posts the table in #casino so Discord can tap in
      const r = await fetch(`${API}/channels/${channel}/messages`, { method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tableView(t)) }).catch(() => null);
      const m = r && r.ok ? await r.json().catch(() => null) : null;
      if (m && m.id) t.msg = { ch: channel, id: m.id }; else if (r) console.error('roulette post failed', r.status);
    }
    // NX on the pointer: if Discord opened one in the same moment, theirs wins and we show it
    const [, got] = await kv(...save(t), ['SET', 'ro:open:' + channel, t.id, 'EX', KEEP, 'NX']);
    if (!got) { const other = await openNow(channel); return out({ ch: channel, now: Date.now(), t: siteView(other || t) }); }
    later(spinLater(t.id).catch(e => console.error('roulette spin', e)));
    return out({ ch: channel, now: Date.now(), t: siteView(t) });
  }
  if (body.a === 'ro-bet') {
    const id = String(body.id || '').replace(/[^0-9a-f]/g, ''), type = String(body.type || '');
    const num = Math.floor(+body.num), amt = Math.floor(+body.amt);
    if (!id || !(BETS[type] || type === 'num')) return out({ err: 'Pick a bet on the table.' });
    if (type === 'num' && !(num >= 0 && num <= 36)) return out({ err: 'Pick a number from 0 to 36.' });
    if (!(amt >= 1 && amt <= MAX_PER_SPIN)) return out({ err: `Bets are $1 to ${money(MAX_PER_SPIN)}.` });
    const r = await betCore(who, id, type, type === 'num' ? num : null, amt);
    if (r.busy) return out({ busy: true });
    if (r.gone) return out({ err: 'That table closed. Open a new one.' });
    if (r.done || r.late) { const t = r.t || r.late; if (r.late) later(pushView(t, true).catch(() => {})); return out({ err: 'Too late, the wheel is spinning.', t: siteView(t), now: Date.now() }); }
    if (r.err) return out({ err: plainMsg(r.err) });
    later(pushView(r.t).catch(e => console.error('roulette redraw', e))); // show the site bet on the Discord message
    return out({ t: siteView(r.t), bal: r.left, now: Date.now() });
  }
  return out({ err: 'Unknown action.' }, 400);
}
