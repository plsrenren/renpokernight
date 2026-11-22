// Study Cards (the shop) and /tip. Same chips as the casino (bj:bal). Items, odds and refunds are in ../loot.js.
//   /pack              buy a $100 pack in the channel: tap to tear it open, then flip the three cards one at a time,
//                      then equip one, open another, see your loadout or the odds
//   /loadout           (only you see it) what you have equipped per slot, change it with the menus
//   /tip user amount   give some of your chips to another player, with an optional note
// The site's /shop page uses the same code through /api/shop (rewritten to api/discord.js?web=shop, see shopWeb).
// Casino accolades (a:<key> items, earned by playing, see _accolades.js) sit in the same slots; ac:own:<user id> holds them.
// Keys: sh:own:<user id> (hash item id → how many), sh:eq (hash user id → JSON {slot: item id}), sh:packs (hash user id → packs
// bought), sh:pk:<pack id> (an opened pack and which cards are flipped, PACK_TTL), sh:open:<user id> (set of their packs that
// still have face-down cards), sh:lock:<user id> (stops double taps).
// Cards go into sh:own when the pack is bought (so refunds and the chips are settled in one go), but a card stays out of the
// loadout, the menus and equip until it's flipped (hiddenCards). A pack left half-open can be finished later (Discord buttons,
// or the site picks it back up); once its sh:pk key runs out, whatever was still face down simply shows up.
// Chips come off with one storage script (DEBIT) so two taps can never spend chips you don't have.
import { randomBytes, randomInt } from 'node:crypto';
import { kv, kvUrl, kvToken, money, json, quiet, whoIs, noStorage, feedCmds, DEBIT } from './_blackjack.js';
import { ITEMS, BY_ID, PRICE, REFUND, ODDS, TIERS, SLOT_NAMES, PACKS, rollPack, itemFor, tierRank, championsFrom, RETIRED } from '../loot.js';
import { earnedIds } from './_accolades.js';

const SITE = 'https://renpokernight.vercel.app';
const MAX_TIP = 100000;
export const SHOP_COMMANDS = [
  { name: 'pack', description: `Buy a pack of Study Cards ($${PRICE}): 3 cosmetics for your player card`, type: 1 },
  { name: 'loadout', description: 'Your Study Cards: change your title, pfp border, overall bar and sticker', type: 1 },
  { name: 'tip', description: 'Give some of your chips to another player', type: 1, options: [
    { type: 6, name: 'user', description: 'Who gets the chips', required: true },
    { type: 4, name: 'amount', description: 'How many chips', min_value: 1, max_value: MAX_TIP, required: true },
    { type: 3, name: 'note', description: 'Optional note, like "for the pizza"', max_length: 120, required: false }] },
];

// ---------- storage ----------
const rand = () => randomInt(0, 2 ** 32) / 2 ** 32;
// moves ARGV[3] chips from ARGV[1] to ARGV[2] if ARGV[1] has that many; returns {from balance, to balance} or {'-1', balance}
const MOVE = "local b=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0') if b<tonumber(ARGV[3]) then return {'-1',tostring(b)} end local a=redis.call('HINCRBYFLOAT',KEYS[1],ARGV[1],-tonumber(ARGV[3])) local c=redis.call('HINCRBYFLOAT',KEYS[1],ARGV[2],tonumber(ARGV[3])) return {a,c}";
const lock = async uid => { const [got] = await kv(['SET', 'sh:lock:' + uid, '1', 'NX', 'PX', 3000]); return !!got; };
const unlock = uid => kv(['DEL', 'sh:lock:' + uid]).catch(() => {});
const parseEq = raw => { try { const e = JSON.parse(raw || '{}'); return e && typeof e === 'object' ? e : {}; } catch (e) { return {}; } };
const hashObj = arr => { const o = {}; for (let k = 0; k < (arr || []).length; k += 2) o[arr[k]] = +arr[k + 1]; return o; };
const PACK_TTL = 7 * 86400;
const savePack = p => ['SET', 'sh:pk:' + p.id, JSON.stringify(p), 'EX', PACK_TTL];

/** cards someone bought but hasn't flipped yet: { hid: {item id: n}, open: newest unfinished pack or null }.
 *  openIds = SMEMBERS sh:open:<uid> when the caller already has it. Tidies finished and expired packs out of the set. */
export async function hiddenCards(uid, openIds) {
  if (!openIds) [openIds] = await kv(['SMEMBERS', 'sh:open:' + uid]);
  const hid = {}; let open = null;
  if (!openIds || !openIds.length) return { hid, open };
  const [raws] = await kv(['MGET', ...openIds.map(id => 'sh:pk:' + id)]);
  const done = [];
  openIds.forEach((pid, k) => {
    let p = null; try { p = raws[k] ? JSON.parse(raws[k]) : null; } catch (e) {}
    if (!p || p.uid !== uid || p.f.every(Boolean)) { done.push(pid); return; }
    p.cards.forEach(([id], j) => { if (!p.f[j]) hid[id] = (hid[id] || 0) + 1; });
    if (!open || p.at > open.at) open = p;
  });
  if (done.length) kv(['SREM', 'sh:open:' + uid, ...done]).catch(() => {});
  return { hid, open };
}
/** owned minus the face-down cards */
const shown = (owned, hid) => { const o = { ...owned }; for (const [id, n] of Object.entries(hid)) { o[id] = (o[id] || 0) - n; if (!(o[id] > 0)) delete o[id]; } return o; };

/** everything one person has: { owned: {id: n}, eq: {slot: id}, bal, packs, earned: [accolade ids they can wear] } */
// pays back a retired item once: removes it from sh:own and adds its refund per copy to bj:bal, in one step
const RETIRE = "local n=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0') if n<=0 then return 0 end redis.call('HDEL',KEYS[1],ARGV[1]) redis.call('HINCRBYFLOAT',KEYS[2],ARGV[3],n*tonumber(ARGV[2])) return n";
export async function loadout(uid) {
  // same pipeline, refunds first, so the balance read below already includes them
  const res = await kv(...RETIRED.map(id => ['EVAL', RETIRE, 2, 'sh:own:' + uid, 'bj:bal', id, REFUND[BY_ID[id].tier], uid]),
    ['HGETALL', 'sh:own:' + uid], ['HGET', 'sh:eq', uid], ['HGET', 'bj:bal', uid], ['HGET', 'sh:packs', uid], ['HGETALL', 'ac:own:' + uid], ['HGETALL', 'bj:bal'], ['SMEMBERS', 'sh:open:' + uid]);
  const [own, eq, bal, packs, acc, all, openIds] = res.slice(RETIRED.length);
  const earned = earnedIds(uid, acc, all), { hid, open } = await hiddenCards(uid, openIds);
  return { owned: shown(hashObj(own), hid), eq: wearable(parseEq(eq), earned), bal: bal === null ? null : +bal, packs: +packs || 0, earned, open };
}
/** an equipped set without retired items or accolades they haven't earned. earned = earnedIds */
export const wearable = (eq, earned) => Object.fromEntries(Object.entries(eq || {}).filter(([, id]) => !RETIRED.includes(id) && (!String(id).startsWith('a:') || earned.includes(id))));
/** equipped items for many people at once: { userId: {slot: item} } (for the player cards) */
export async function equippedAll() {
  const [all] = await kv(['HGETALL', 'sh:eq']);
  const o = {}; for (let k = 0; k < (all || []).length; k += 2) { const e = parseEq(all[k + 1]), v = {}; for (const s of SLOT_NAMES) if (itemFor(e[s])) v[s] = e[s]; o[all[k]] = v; }
  return o;
}

/** buys one pack: { pack, bal, owned } or { err } / { busy }. me = { id, name, src? } */
export async function buyPack(me) {
  if (!(await lock(me.id))) return { busy: true };
  try {
    const [left] = await kv(['EVAL', DEBIT, 1, 'bj:bal', me.id, PRICE]);
    if (String(left) === '-1') {
      const [b] = await kv(['HGET', 'bj:bal', me.id]);
      return { err: b === null ? 'You don\'t have any chips yet. Use **/daily** to get some free.' : `A pack is ${money(PRICE)} and you have ${money(+b)}.`, bal: b === null ? 0 : +b };
    }
    const items = rollPack(rand);
    const have = await kv(...items.map(it => ['HGET', 'sh:own:' + me.id, it.id]));
    const seen = new Set();
    const cards = items.map((it, k) => { const dup = +have[k] > 0 || seen.has(it.id); seen.add(it.id); return [it.id, dup ? 1 : 0]; });
    const back = cards.reduce((s, [id, dup]) => s + (dup ? REFUND[BY_ID[id].tier] : 0), 0);
    const pack = { id: randomBytes(6).toString('hex'), uid: me.id, name: me.name, d: PACKS[randomInt(PACKS.length)].id, cards, f: [0, 0, 0], torn: false, back, at: Date.now() };
    const res = await kv(...cards.map(([id]) => ['HINCRBY', 'sh:own:' + me.id, id, 1]),
      ['HINCRBYFLOAT', 'bj:bal', me.id, back], ['HINCRBY', 'sh:packs', me.id, 1], ['HSET', 'bj:name', me.id, me.name], ['HLEN', 'sh:own:' + me.id],
      ...feedCmds(me, 'study cards', back - PRICE));
    pack.bal = +res[3]; pack.owned = +res[6];
    await kv(savePack(pack), ['SADD', 'sh:open:' + me.id, pack.id]);
    return { pack, bal: pack.bal, owned: pack.owned };
  } finally { await unlock(me.id); }
}

/** champion borders someone has earned (ids), from the sheet copy s = { ids, recs }; null when the sheet isn't loaded */
export function champsFor(uid, s) {
  if (!s || !s.ids || !s.recs) return null;
  const name = Object.keys(s.ids).find(n => s.ids[n] === uid);
  return name ? championsFrom(s.recs)[name] || [] : [];
}

/** equip an owned item (id) in its slot, or clear a slot (id = null, slot given). champs = earned champion ids
 *  (champsFor), needed to wear a champion border. Returns { eq } or { err } */
export async function equip(uid, slot, id, champs = null) {
  if (id) {
    const it = itemFor(id);
    if (!it) return { err: "That item doesn't exist." };
    if (it.tier === 'Champion') {
      if (!champs) return { err: "Couldn't check the Hall of Fame just now. Try again in a moment." };
      if (!champs.includes(id)) return { err: `${it.name} goes to whoever won it.` };
    } else if (it.tier === 'Earned') {
      const [acc, bal] = await kv(['HGETALL', 'ac:own:' + uid], ['HGETALL', 'bj:bal']);
      if (!earnedIds(uid, acc, bal).includes(id)) return { err: `You haven't earned ${it.name} yet.` };
    } else {
      const [[n], { hid }] = await Promise.all([kv(['HGET', 'sh:own:' + uid, id]), hiddenCards(uid)]);
      if (!(+n - (hid[id] || 0) > 0)) return { err: +n > 0 ? `Flip the card first to see what you got.` : `You don't have ${it.name} yet.` };
    }
    slot = it.slot;
  } else if (!SLOT_NAMES.includes(slot)) return { err: 'Unknown slot.' };
  const [raw] = await kv(['HGET', 'sh:eq', uid]);
  const eq = parseEq(raw);
  if (id) eq[slot] = id; else delete eq[slot];
  await kv(['HSET', 'sh:eq', uid, JSON.stringify(eq)]);
  return { eq };
}

/** move chips between two people. Returns { from, to } balances or { err } */
export async function tip(from, to, amount) {
  if (!(await lock(from.id))) return { busy: true };
  try {
    const [r] = await kv(['EVAL', MOVE, 1, 'bj:bal', from.id, to.id, amount]);
    if (String(r[0]) === '-1') return { err: +r[1] > 0 ? `You only have ${money(+r[1])}.` : "You don't have any chips yet. Use **/daily** to get some free." };
    await kv(['HSET', 'bj:name', from.id, from.name], ['HSETNX', 'bj:name', to.id, to.name], ...feedCmds(from, 'tip to ' + to.name, -amount), ...feedCmds({ ...to, src: from.src }, 'tip from ' + from.name, amount));
    return { from: +r[0], to: +r[1] };
  } finally { await unlock(from.id); }
}

// ---------- Discord: /pack ----------
const SQ = { Common: '⬜', Uncommon: '🟩', Rare: '🟥', Epic: '🟨' };
const COLOR = { Common: 0xa9a3c9, Uncommon: 0x8fe0b0, Rare: 0xe0507f, Epic: 0xf0c75e };
const packName = d => (PACKS.find(p => p.id === d) || PACKS[0]).name;
const an = w => /^[aeiou]/i.test(w) ? 'an' : 'a';
const slotWord = s => s === 'Title' ? 'title' : s.toLowerCase();
const cardLine = ([id, dup]) => { const it = BY_ID[id]; return `${SQ[it.tier]} **${it.name}** · ${it.tier} ${slotWord(it.slot)} · ${dup ? `duplicate, **+${money(REFUND[it.tier])}** back` : 'New!'}`; };
const cardsUrl = (p) => `${SITE}/api/bjcards?${new URLSearchParams({ m: 'cards', c: p.cards.map(([id, dup]) => `${id}.${dup}`).join(','), f: p.f.join('') })}`;
const btn = (label, id, style = 2, emoji) => ({ type: 2, style, label, custom_id: id, ...(emoji ? { emoji: { name: emoji } } : {}) });
const row = (...c) => ({ type: 1, components: c });
const after = p => row(btn(`Open another · ${money(PRICE)}`, 'sh:a:' + p.id, 1, '🃏'), btn('My loadout', 'sh:l'), btn('Odds', 'sh:o'));

function packView(p) {
  const name = packName(p.d);
  if (!p.torn) return { allowed_mentions: { parse: [] }, embeds: [{ color: 0xe0507f, title: `${p.name} bought ${an(name)} ${name} pack`, description: '3 cards. The third is always Uncommon or better.',
    image: { url: `${SITE}/api/bjcards?m=pack&d=${p.d}` }, footer: { text: `−${money(PRICE)} · balance ${money(p.bal - p.back)}` } }], components: [row(btn('Tear it open', 'sh:t:' + p.id, 3))] };
  const done = p.f.every(Boolean), shown = p.cards.filter((_, k) => p.f[k]);
  const best = shown.reduce((b, [id]) => Math.max(b, TIERS.indexOf(BY_ID[id].tier)), 0);
  const epic = done && p.cards.some(([id]) => BY_ID[id].tier === 'Epic');
  const lines = p.cards.map((c, k) => p.f[k] ? cardLine(c) : `❔ Card ${k + 1}`);
  const embed = { color: COLOR[TIERS[best]], title: epic ? `${p.name} pulled an Epic from ${an(name)} ${name} pack!` : `${p.name} tore open ${an(name)} ${name} pack`,
    description: lines.join('\n'), image: { url: cardsUrl(p) } };
  if (!done) return { allowed_mentions: { parse: [] }, embeds: [embed], components: [row(...p.cards.map((_, k) => p.f[k] ? null : btn(`Flip card ${k + 1}`, `sh:f:${p.id}:${k}`, 1)).filter(Boolean))] };
  embed.footer = { text: `−${money(PRICE)}${p.back ? ` +${money(p.back)}` : ''} · balance ${money(p.bal)} · ${p.owned} of ${ITEMS.length} collected` };
  const opts = p.cards.filter((c, k, a) => a.findIndex(x => x[0] === c[0]) === k).map(([id]) => { const it = BY_ID[id]; return { label: `Equip ${it.name}`.slice(0, 100), value: id, description: `${it.tier} ${slotWord(it.slot)}` }; });
  return { allowed_mentions: { parse: [] }, embeds: [embed], components: [row({ type: 3, custom_id: 'sh:e:' + p.id, placeholder: 'Equip one of these…', options: opts }), after(p)] };
}

async function newPack(i, s) {
  const me = whoIs(i, s);
  const r = await buyPack(me);
  if (r.busy) return json({ type: 6 });
  if (r.err) return quiet(r.err);
  return json({ type: 4, data: packView(r.pack) });
}

const ODDS_TEXT = () => `Every pack has the same ${ITEMS.length} items: titles, pfp borders, overall bars and stickers. ${money(PRICE)} for 3 cards.\n\n`
  + TIERS.map(t => `${SQ[t]} **${t}** ${ODDS[t]}% · duplicate pays **+${money(REFUND[t])}**`).join('\n') + '\n\nThe third card is always Uncommon or better.';

// ---------- Discord: /loadout ----------
async function loadoutView(me, s, slot = 'Title', note = '') {
  const L = await loadout(me.id), champs = (champsFor(me.id, s) || []).map(itemFor);
  const fields = SLOT_NAMES.map(sl => { const mine = ITEMS.filter(it => it.slot === sl && L.owned[it.id]), on = itemFor(L.eq[sl]);
    return { name: sl, value: `${on ? on.name : 'None'} · ${mine.length}/${ITEMS.filter(it => it.slot === sl).length}`, inline: true }; });
  const total = ITEMS.filter(it => L.owned[it.id]).length;
  const player = s && s.ids ? Object.keys(s.ids).find(n => s.ids[n] === me.id) : null;
  const v = Object.values(L.eq).join('.').replace(/[^a-zA-Z0-9.:-]/g, '').slice(0, 60) || 'none';
  const earned = L.earned.map(itemFor).filter(Boolean);
  const embed = { color: 0xf0c75e, title: `${me.name}'s loadout`, fields, description: note || (total || earned.length || champs.length ? 'Pick a slot, then pick what to wear. It shows on /player and the site card right away.' : `Nothing yet. Open a pack with **/pack** (${money(PRICE)}).`),
    footer: { text: `${total} of ${ITEMS.length} collected · ${L.packs} pack${L.packs === 1 ? '' : 's'} opened${earned.length ? ` · ${earned.length} earned` : ''}` } };
  if (player) embed.image = { url: `${SITE}/api/card?name=${encodeURIComponent(player)}&eq=${encodeURIComponent(v)}&v=${Math.floor(Date.now() / 60e3)}` };
  // owned items in this slot, rarest first (a menu holds 25, so the shop page has the full list). Champion borders and
  // accolades show how they were earned (it.why) where pack items show their rarity.
  const mine = [...(slot === 'Pfp border' ? champs : []), ...earned.filter(it => it.slot === slot), ...ITEMS.filter(it => it.slot === slot && L.owned[it.id])].sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || a.name.localeCompare(b.name));
  const items = [{ label: 'None (default look)', value: 'none', default: !L.eq[slot] }, ...mine.slice(0, 24).map(it => ({ label: it.name, value: it.id, description: it.why || `${it.tier}${L.owned[it.id] > 1 ? ` · x${L.owned[it.id]}` : ''}`, default: L.eq[slot] === it.id }))];
  const components = [
    row({ type: 3, custom_id: 'sh:ls', placeholder: 'Slot', options: SLOT_NAMES.map(sl => ({ label: `Slot: ${sl}`, value: sl, default: sl === slot })) }),
    row({ type: 3, custom_id: 'sh:li:' + SLOT_NAMES.indexOf(slot), placeholder: `Choose a ${slotWord(slot)}`, options: items }),
    row({ type: 2, style: 5, label: 'Open the shop', url: `${SITE}/shop` })];
  return { flags: 64, allowed_mentions: { parse: [] }, embeds: [embed], components };
}

// ---------- Discord entry points ----------
const nameFor = (i, s, id) => {
  const sheet = s && s.ids ? Object.keys(s.ids).find(n => s.ids[n] === id) : null;
  const r = (i.data && i.data.resolved) || {}, u = (r.users || {})[id] || {}, m = (r.members || {})[id] || {};
  return sheet || m.nick || u.global_name || u.username || 'Someone';
};

/** /pack, /loadout, /tip. Returns null for other commands. */
export async function shopCommand(i, opts, s) {
  const name = i.data.name;
  if (!['pack', 'loadout', 'tip'].includes(name)) return null;
  if (!kvUrl() || !kvToken()) return noStorage();
  try {
    if (name === 'pack') return await newPack(i, s);
    const me = whoIs(i, s);
    if (name === 'loadout') return json({ type: 4, data: await loadoutView(me, s) });
    const id = opts.user && opts.user.value, u = ((i.data.resolved || {}).users || {})[id] || {};
    const amount = Math.floor(+(opts.amount && opts.amount.value));
    if (!id) return quiet('Pick who gets the chips.');
    if (id === me.id) return quiet("You can't tip yourself.");
    if (u.bot) return quiet("Bots don't need chips. Pick a person.");
    if (!(amount >= 1 && amount <= MAX_TIP)) return quiet(`Tips are $1 to $100,000.`);
    const to = { id, name: nameFor(i, s, id) };
    const r = await tip(me, to, amount);
    if (r.busy) return quiet('Hang on, your last move is still going through.');
    if (r.err) return quiet(r.err);
    const note = opts.note && String(opts.note.value).trim().replace(/[\r\n]+/g, ' ').slice(0, 120);
    return json({ type: 4, data: { content: `💸 **${me.name}** tipped <@${id}> **${money(amount)}**${note ? `\n> ${note.replace(/[<@>*_~`|]/g, '')}` : ''}`, allowed_mentions: { users: [id] } } });
  } catch (e) { console.error('shop', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}

/** buttons and menus (custom_id sh:…) */
export async function shopInteraction(i, s) {
  if (!kvUrl() || !kvToken()) return noStorage();
  const [, act, pid, arg] = String(i.data.custom_id).split(':');
  const me = whoIs(i, s);
  try {
    if (act === 'a' && !pid) return await newPack(i, s); // buttons drawn before the pack id was added
    if (act === 'o') return quiet(ODDS_TEXT());
    if (act === 'l') return json({ type: 4, data: await loadoutView(me, s) });
    if (act === 'ls') return json({ type: 7, data: await loadoutView(me, s, SLOT_NAMES.includes(i.data.values[0]) ? i.data.values[0] : 'Title') });
    if (act === 'li') {
      const slot = SLOT_NAMES[+pid] || 'Title', v = i.data.values[0];
      const r = await equip(me.id, slot, v === 'none' ? null : v, champsFor(me.id, s));
      const it = v === 'none' ? null : itemFor(v);
      return json({ type: 7, data: await loadoutView(me, s, slot, r.err ? '⚠️ ' + r.err : !it ? `Back to the default ${slotWord(slot)}.` : `Equipped **${it.name}**.${it.why ? `\n*${it.why}*` : ''}`) });
    }
    // pack buttons: only the person who bought it
    const [raw] = await kv(['GET', 'sh:pk:' + pid]);
    if (!raw && act === 'a') return await newPack(i, s); // the old pack expired: just buy
    if (!raw) return quiet('This pack is too old to open here. Your cards are already in **/loadout**.');
    const p = JSON.parse(raw);
    if (act === 'a') { // Open another: one new pack per pack message. A second tap while that pack still has face-down cards
      // (say, the first answer was too slow to show) shows it again instead of buying another.
      if (p.uid === me.id && p.next) {
        const [nRaw] = await kv(['GET', 'sh:pk:' + p.next]);
        const n = nRaw && JSON.parse(nRaw);
        if (n && !n.f.every(Boolean)) return json({ type: 4, data: packView(n) });
      }
      const r = await buyPack(me);
      if (r.busy) return json({ type: 6 });
      if (r.err) return quiet(r.err);
      if (p.uid === me.id) { p.next = r.pack.id; await kv(savePack(p)); }
      return json({ type: 4, data: packView(r.pack) });
    }
    if (p.uid !== me.id) return quiet(`This is ${p.name}'s pack. Open your own with **/pack**.`);
    if (act === 'e') {
      const id = i.data.values[0];
      const r = await equip(me.id, null, id);
      return quiet(r.err ? r.err : `Equipped **${BY_ID[id].name}** (${slotWord(BY_ID[id].slot)}). It shows on /player and the site card.`);
    }
    if (act === 't') p.torn = true;
    else if (act === 'f') { const k = +arg; if (!(k >= 0 && k < 3)) return json({ type: 6 }); if (!p.torn || p.f[k]) return json({ type: 7, data: packView(p) }); p.f[k] = 1; } // a repeat tap redraws
    else return json({ type: 6 });
    await kv(savePack(p), ...(p.f.every(Boolean) ? [['SREM', 'sh:open:' + me.id, p.id]] : []));
    return json({ type: 7, data: packView(p) });
  } catch (e) { console.error('shop button', e); return quiet("Couldn't reach the chip storage just now. Try again in a moment."); }
}

// ---------- the site: /api/shop ----------
const sitePack = p => ({ id: p.id, d: p.d, torn: !!p.torn, f: p.f, cards: p.cards.map(([id, dup]) => ({ id, dup: !!dup })) });
//   GET  /api/shop            your chips, cards and loadout (signed in), plus everyone's equipped items by player name
//   POST /api/shop {a: 'buy'} / {a: 'equip', id} / {a: 'equip', slot, id: null}
export async function shopWeb(req, me, sheet, out) {
  if (req.method === 'GET') {
    const sh = sheet ? await sheet().catch(() => null) : null, ids = (sh && sh.ids) || {};
    const all = await equippedAll(), byName = {}, byId = {};
    for (const [n, id] of Object.entries(ids)) if (all[id] && Object.keys(all[id]).length) byName[n] = all[id];
    // by Discord id too, for lists keyed by id (the casino chip leaders, which include people not on the sheet)
    for (const [id, eq] of Object.entries(all)) if (eq && Object.keys(eq).length) byId[id] = eq;
    const body = { price: PRICE, byName, byId, me: null };
    if (me) { const L = await loadout(me.id); body.me = { id: me.id, name: me.name, ...L, open: L.open ? sitePack(L.open) : null, champs: champsFor(me.id, sh) || [] }; }
    return out(body);
  }
  if (!me) return out({ err: 'Sign in first.', signedOut: true }, 401);
  let b; try { b = await req.json(); } catch (e) { return out({ err: 'Bad request.' }, 400); }
  const who = { id: me.id, name: me.name, src: 'site' };
  if (b.a === 'buy') {
    const r = await buyPack(who);
    if (r.busy) return out({ busy: true });
    if (r.err) return out({ err: r.err.replace(/\*\*/g, '').replace('Use /daily', 'Claim your daily chips on the casino page'), bal: r.bal });
    return out({ bal: r.bal, owned: r.owned, pack: sitePack(r.pack) });
  }
  // tearing and flipping on the site: {a: 'reveal', pack, k: 't' | 0..2}. The page sends these one at a time.
  if (b.a === 'reveal') {
    const pid = String(b.pack || '').replace(/[^a-f0-9]/g, '');
    const [raw] = pid ? await kv(['GET', 'sh:pk:' + pid]) : [null];
    if (!raw) return out({ ok: true, gone: true }); // ran out: the cards already show
    const p = JSON.parse(raw);
    if (p.uid !== me.id) return out({ err: 'Not your pack.' }, 403);
    if (b.k === 't') p.torn = true;
    else { const k = +b.k; if (!(k >= 0 && k < 3)) return out({ err: 'Bad card.' }, 400); p.torn = true; p.f[k] = 1; }
    await kv(savePack(p), ...(p.f.every(Boolean) ? [['SREM', 'sh:open:' + me.id, p.id]] : []));
    return out({ ok: true });
  }
  if (b.a === 'equip') {
    const id = b.id ? String(b.id) : null, champ = id && id.startsWith('c:');
    const sh = champ && sheet ? await sheet().catch(() => null) : null;
    const r = await equip(me.id, b.slot, id, champ ? champsFor(me.id, sh) : null);
    return r.err ? out({ err: r.err }) : out({ eq: r.eq });
  }
  return out({ err: 'Unknown action.' }, 400);
}
