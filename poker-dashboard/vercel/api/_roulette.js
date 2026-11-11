// /roulette: a shared table with the blackjack chips (bj:bal). One table per channel.
//   /roulette opens it for 30 seconds. Anyone taps bets (Red, Black, Odd, Even, 1-18, 19-36, dozens, Number...);
//   each tap places one chip of their chosen size ($5 to $100, set with the dropdown). Chips come off when placed.
//   When time is up the bot spins (European wheel, single 0), pays everyone and edits the table into the result.
//   Payouts: number 35:1, dozens 2:1, everything else 1:1. Even-money bets lose on 0.
// The bot only runs when Discord calls it, so the command (or New round button) that opened the table stays awake
// for the 30 seconds and then spins. If that ever dies, the next tap on the table, or the next /roulette in that
// channel, spins it instead, so chips are never stuck.
// Keys: ro:t:<id> (table, 1 hour), ro:open:<channel> (open table id), ro:lock:<id>, ro:chip (hash user → chip size),
//       ro:hist:<channel> (last spins).
import { randomBytes, randomInt } from 'node:crypto';
import { kv, kvUrl, kvToken, money, json, quiet, whoIs, noStorage } from './_blackjack.js';

const SITE = 'https://renpokernight.vercel.app', API = 'https://discord.com/api/v10';
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
const pays = b => (b.type === 'num' ? 35 : BETS[b.type].pays);
export const colorOf = n => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

export const ROULETTE_COMMAND = { name: 'roulette', description: 'Open a roulette table: everyone has 30 seconds to bet chips, then it spins', type: 1 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = t => ['SET', 'ro:t:' + t.id, JSON.stringify(t), 'EX', 3600];
async function lock(id) {
  for (let k = 0; k < 20; k++) { const [got] = await kv(['SET', 'ro:lock:' + id, '1', 'NX', 'EX', 8]); if (got) return true; await sleep(150); }
  return false;
}
const unlock = id => kv(['DEL', 'ro:lock:' + id]).catch(() => {});

// ---------- the message ----------
function byPlayer(t) {
  const m = new Map();
  for (const b of t.bets) { if (!m.has(b.uid)) m.set(b.uid, { name: b.name, bets: [] }); m.get(b.uid).bets.push(b); }
  return [...m.entries()];
}
const groupBets = bets => { // "Odd ×3 · #17" style, amounts summed per bet
  const g = new Map();
  for (const b of bets) { const k = betName(b); const x = g.get(k) || { n: 0, amt: 0 }; x.n++; x.amt += b.amt; g.set(k, x); }
  return [...g.entries()].map(([k, x]) => `${k}${x.n > 1 ? ` ×${x.n}` : ''} ${money(x.amt)}`).join(' · ');
};

export function tableView(t) {
  const btn = (label, emoji, id, style) => ({ type: 2, style, label, ...(emoji ? { emoji: { name: emoji } } : {}), custom_id: `ro:${id}:${t.id}` });
  if (!t.spun) {
    const players = byPlayer(t), total = t.bets.reduce((a, b) => a + b.amt, 0);
    const list = players.map(([, p]) => `**${p.name}** · ${groupBets(p.bets)}`).join('\n') || '_No bets yet. Be the first._';
    return { allowed_mentions: { parse: [] }, embeds: [{ color: 0x2f7d5b, title: '🎡 Roulette · place your bets',
      description: `Spins <t:${Math.ceil(t.ends / 1000)}:R>\nTap a bet to place one chip, tap again to stack. Pick your chip size below.\nNumber pays 35:1 · dozens 2:1 · everything else 1:1\n\n${list}`,
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
    return [net, `**${p.name}** · ${marks} · \`${net > 0 ? '+' : net < 0 ? '−' : ''}${money(Math.abs(net))}\``];
  }).sort((a, b) => b[0] - a[0]).map(r => r[1]);
  const dot = x => (colorOf(x) === 'red' ? '🔴' : colorOf(x) === 'black' ? '⚫' : '🟢');
  return { allowed_mentions: { parse: [] }, embeds: [{ color: col === 'red' ? 0xc2283e : col === 'black' ? 0x1e1f22 : 0x248046,
    title: `🎡 ${n} ${col.toUpperCase()} · ${tags}`,
    description: rows.join('\n') || 'Nobody bet this spin.',
    image: { url: `${SITE}/api/roulette?n=${n}&v=${t.id}` },
    footer: { text: `Last spins: ${(t.hist || [n]).map(x => `${x} ${dot(x)}`).join(' · ')}` } }],
  components: [{ type: 1, components: [btn('New round (30s)', '🔁', 'new', 1)] }] };
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
  const res = await kv(...pay, ['LPUSH', 'ro:hist:' + t.channel, n], ['LTRIM', 'ro:hist:' + t.channel, 0, 4], ['LRANGE', 'ro:hist:' + t.channel, 0, 4], save(t), ['DEL', 'ro:open:' + t.channel]);
  t.hist = (res[pay.length + 2] || []).map(Number);
  await kv(save(t));
  return t;
}

/** Waits until the table's time is up, spins it and edits the message (via the interaction that posted it). */
async function spinLater(appId, token, id) {
  const [raw] = await kv(['GET', 'ro:t:' + id]);
  if (!raw) return;
  await sleep(Math.max(0, JSON.parse(raw).ends - Date.now()) + 300);
  if (!(await lock(id))) return;
  try {
    const [r2] = await kv(['GET', 'ro:t:' + id]);
    const t = JSON.parse(r2);
    if (t.spun) return;
    await spin(t);
    const r = await fetch(`${API}/webhooks/${appId}/${token}/messages/@original`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tableView(t)) });
    if (!r.ok) console.error('roulette edit failed', r.status, await r.text());
  } finally { await unlock(id); }
}

/** Opens a table in the channel (or says one is already open). waitUntil keeps the spin alive. */
async function openTable(i, waitUntil) {
  const channel = i.channel_id || (i.channel && i.channel.id) || 'dm';
  const [openId] = await kv(['GET', 'ro:open:' + channel]);
  if (openId) {
    const [raw] = await kv(['GET', 'ro:t:' + openId]);
    const t = raw && JSON.parse(raw);
    if (t && !t.spun && Date.now() < t.ends) return quiet(`A table is already open here. It spins <t:${Math.ceil(t.ends / 1000)}:R>, so jump in on that one.`);
    if (t && !t.spun && (await lock(t.id))) { try { await spin(t); } finally { await unlock(t.id); } } // an old table that never spun
  }
  const t = { id: randomBytes(5).toString('hex'), channel, ends: Date.now() + OPEN_MS, bets: [], spun: false };
  await kv(save(t), ['SET', 'ro:open:' + channel, t.id, 'EX', 120]);
  waitUntil(spinLater(i.application_id, i.token, t.id).catch(e => console.error('roulette spin', e)));
  return json({ type: 4, data: tableView(t) });
}

export async function rouletteCommand(i, waitUntil) {
  if (!kvUrl() || !kvToken()) return noStorage();
  try { return await openTable(i, waitUntil); } catch (e) { console.error('roulette', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}

// ---------- placing bets ----------
async function placeBet(i, s, id, type, num, amtWanted, waitUntil) {
  const me = whoIs(i, s);
  if (!(await lock(id))) return json({ type: 6 });
  try {
    const [raw, chip, balRaw] = await kv(['GET', 'ro:t:' + id], ['HGET', 'ro:chip', me.id], ['HGET', 'bj:bal', me.id]);
    if (!raw) return quiet('This table has closed. Start a new one with **/roulette**.');
    const t = JSON.parse(raw);
    if (t.spun) return quiet('This spin is done. Tap **New round** to play again.');
    if (Date.now() >= t.ends) { await spin(t); return json({ type: 7, data: tableView(t) }); } // late tap: spin it now
    const amt = amtWanted || +chip || DEFAULT_CHIP, mine = t.bets.filter(b => b.uid === me.id).reduce((a, b) => a + b.amt, 0);
    if (balRaw === null) return quiet("You don't have any chips yet. Use **/daily** to get some free.");
    if (+balRaw < amt) return quiet(`You only have ${money(+balRaw)} left. Pick a smaller chip size.`);
    if (mine + amt > MAX_PER_SPIN) return quiet(`That's the ${money(MAX_PER_SPIN)} limit per spin. Wait for the next round.`);
    t.bets.push({ uid: me.id, name: me.name, type, ...(type === 'num' ? { num } : {}), amt });
    const [left] = await kv(['HINCRBYFLOAT', 'bj:bal', me.id, -amt], ['HSET', 'bj:name', me.id, me.name], save(t));
    if (waitUntil) waitUntil(fetch(`${API}/webhooks/${i.application_id}/${i.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flags: 64, content: `${money(amt)} on ${betName(t.bets.at(-1))}. You have ${money(mine + amt)} on this spin and ${money(+left)} left.` }) }).catch(() => {}));
    return json({ type: 7, data: tableView(t) });
  } finally { await unlock(id); }
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
    if (raw && !JSON.parse(raw).spun) return json({ type: 6 });
    return openTable(i, waitUntil);
  }
  if (BETS[act]) return placeBet(i, s, id, act, null, 0, waitUntil);
  return json({ type: 6 });
}
