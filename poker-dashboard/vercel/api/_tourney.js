// /tourney and /cash: a game invite people answer with reactions. Any reaction counts as "in".
// The bot can't watch reactions live (it only wakes up on commands and button presses), so the card has a
// "🔄 Update headcount" button that reads the reactions and rewrites the names and count on the card.
// Needs the bot to be in the server (Add Reactions, Read Message History, View Channel, Mention Everyone).
import { kv, kvUrl } from './_blackjack.js';
const API = 'https://discord.com/api/v10';
// Auto-refresh: the newest invite's spot is kept in Redis (tv:last, 3 days) so refreshInvite() can rewrite its card
// without searching the channels. tv:seen = the list last drawn, tv:lock = at most one check a minute.
const LAST = 'tv:last', SEEN = 'tv:seen', LOCK = 'tv:lock', KEEP = 3 * 86400;

const inviteOptions = buyinHint => [
  { type: 3, name: 'date', description: 'e.g. Fri Nov 21', required: true, max_length: 40 },
  { type: 3, name: 'time', description: 'e.g. 7:30 PM', required: false, max_length: 20 },
  { type: 3, name: 'buyin', description: buyinHint, required: false, max_length: 30 },
  { type: 4, name: 'min', description: 'Players needed (shows "We have enough!" when reached)', required: false, min_value: 2, max_value: 30 },
  { type: 11, name: 'meme', description: 'A picture to go with it', required: false },
  { type: 3, name: 'note', description: 'Anything else to say', required: false, max_length: 200 },
];
export const TOURNEY_COMMAND = { name: 'tourney', description: 'Post a tournament invite people answer with reactions', type: 1, options: inviteOptions('e.g. $25') };
export const CASH_COMMAND = { name: 'cash', description: 'Post a cash game invite people answer with reactions', type: 1, options: inviteOptions('e.g. $20 buy-in or 25c/50c') };
const KIND = { t: { title: '🏆 Tournament @ The Study', ask: 'Tournament night?' }, c: { title: '💵 Cash game @ The Study', ask: 'Cash game?' } };

function inviteEmbed({ date, time, buyin, host, note, min, kind = 't' }, lists, image) {
  const n = lists ? lists[0].length : 0;
  const lines = [`📅 **${date}**${time ? ` · ${time}` : ''}`, `${buyin ? `💵 **${buyin}**${/buy|\//i.test(buyin) ? '' : ' buy-in'} · ` : ''}hosted by ${host}`];
  if (note) lines.push('', note);
  lines.push('');
  if (!lists) { if (min) lines.push(`👥 Need **${min}** players`); lines.push('React with anything to say you\'re in, then press **Update headcount** to see the list.'); }
  else if (min) lines.push(`${'🟩'.repeat(Math.min(n, min))}${'⬛'.repeat(Math.max(0, min - n))} **${n} in** of ${min} needed${n >= min ? ' · **We have enough!**' : ''}`);
  else lines.push(`**${n} in**`);
  const fields = lists ? [{ name: `In (${n})`, value: lists[0].join('\n').slice(0, 1000) || '–', inline: true }] : [];
  return { color: kind === 'c' ? 0x8ee0b0 : 0xf1c75b, title: KIND[kind].title, description: lines.join('\n'), fields,
    ...(image ? { image: { url: image } } : {}),
    footer: { text: `${lists ? 'Updated' : 'Posted'} · react to answer, change it anytime · Poker Club @ The Study` } };
}
// what the card needs to redraw itself later, packed into the button's id (max 100 characters)
const pack = o => 'tally:' + JSON.stringify([o.min || 0, o.file || '', o.kind || 't']).slice(0, 90);
const unpack = id => { try { const [min, file, kind] = JSON.parse(id.slice(6)); return { min, file, kind: kind === 'c' ? 'c' : 't' }; } catch (e) { return { kind: 't' }; } };
const buttons = state => [{ type: 1, components: [{ type: 2, style: 2, custom_id: pack(state), label: 'Update headcount', emoji: { name: '🔄' } }] }];

// Who may post an invite: Renato (hostId / his Members ID), server admins, and anyone with the server's "pitboss" role
// (found by name, any case, "pit boss" works too). If the role is missing or Discord can't be reached, nobody is blocked.
let roleCache = { at: 0, guild: '', id: null };
async function pitbossRole(guild) {
  if (roleCache.guild === guild && Date.now() - roleCache.at < 600e3) return roleCache.id;
  const c = new AbortController(), t = setTimeout(() => c.abort(), 1200);
  try {
    const r = await fetch(`${API}/guilds/${guild}/roles`, { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }, signal: c.signal });
    if (!r.ok) return undefined;
    const role = (await r.json()).find(x => /^pit ?boss(es)?$/i.test(String(x.name || '').replace(/[^a-z ]/gi, '').trim()));
    roleCache = { at: Date.now(), guild, id: role ? role.id : null };
    return roleCache.id;
  } catch (e) { return undefined; } finally { clearTimeout(t); }
}
/** null when this person may run /tourney or /cash, otherwise the (ephemeral) answer to send back. */
export async function inviteBlocked(i, s, hostId) {
  const m = i.member, uid = ((m && m.user) || i.user || {}).id;
  if (!m || !i.guild_id || uid === hostId || (uid && uid === s.ids.Renato)) return null;
  if (m.permissions && (BigInt(m.permissions) & 8n)) return null; // server admins
  const rid = await pitbossRole(i.guild_id);
  if (!rid || (m.roles || []).includes(rid)) return null; // no such role (or couldn't check): don't get in the way
  return { type: 4, data: { flags: 64, allowed_mentions: { parse: [] },
    content: `Only <@&${rid}> can post game invites. Ask one of them to run /${i.data.name}.` } };
}

/** The /tourney command: answers "thinking…" right away, then finishes the post in the background. */
export function startTourney(i, opts, s, waitUntil) {
  const v = k => opts[k] && opts[k].value;
  const who = (i.member && i.member.user) || i.user || {};
  const byId = Object.fromEntries(Object.entries(s.ids).map(([n, id]) => [id, n]));
  const host = byId[who.id] || (i.member && i.member.nick) || who.global_name || who.username || 'someone';
  const att = v('meme') && i.data.resolved && i.data.resolved.attachments && i.data.resolved.attachments[v('meme')];
  const info = { date: v('date'), time: v('time'), buyin: v('buyin'), note: v('note'), min: v('min'), host, kind: i.data.name === 'cash' ? 'c' : 't' };
  waitUntil(finishTourney(i, info, att));
  return { type: 5 }; // "The Study is thinking…"
}

async function finishTourney(i, info, att) {
  const hook = `${API}/webhooks/${i.application_id}/${i.token}/messages/@original`;
  const isImg = att && /^image\//.test(att.content_type || '') && att.size < 10e6;
  const file = isImg ? 'meme.' + ((att.filename || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'png') : '';
  const payload = { content: `@everyone ${KIND[info.kind].ask} React below 👇`, allowed_mentions: { parse: ['everyone'] },
    embeds: [inviteEmbed(info, null, file ? `attachment://${file}` : null)], components: buttons({ min: info.min, file, kind: info.kind }) };
  let body, headers = { 'Content-Type': 'application/json' };
  const pic = isImg ? await fetch(att.url).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null) : null;
  if (pic) {
    body = new FormData();
    body.append('payload_json', JSON.stringify({ ...payload, attachments: [{ id: 0, filename: file }] }));
    body.append('files[0]', new Blob([pic], { type: att.content_type }), file);
    headers = {};
  } else {
    payload.embeds = [inviteEmbed(info, null, null)]; payload.components = buttons({ min: info.min, kind: info.kind });
    body = JSON.stringify(payload);
  }
  const r = await fetch(hook, { method: 'PATCH', headers, body });
  if (!r.ok) { console.error('tourney post failed', r.status, await r.text()); return; }
  const msg = await r.json().catch(() => null);
  if (msg && msg.id && kvUrl()) await kv(['SET', LAST, JSON.stringify({ c: msg.channel_id, m: msg.id, min: info.min || 0, file: pic ? file : '', kind: info.kind }), 'EX', KEEP],
    ['SET', SEEN, '', 'EX', KEEP]).catch(e => console.error('invite remember', e));
}

// ---------- finding the newest invite (used by /api/invite and /seats) ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** GET from Discord's API with the bot token (waits out rate limits). null on failure. */
export async function dc(path) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(API + path, { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } });
    if (r.status === 429) { await sleep(1000 * ((await r.json().catch(() => ({}))).retry_after || 1)); continue; }
    return r.ok ? r.json() : null;
  }
  return null;
}
export const isInvite = (m, botId) => m && m.author && m.author.id === botId
  && (m.components || []).some(row => (row.components || []).some(c => String(c.custom_id || '').startsWith('tally:')));

/** The bot's newest /tourney or /cash invite. Looks in channelId first (when given), then the text channels of the
 *  server guildId (or of every server the bot is in). Returns the message with guild_id added, or null. */
export async function latestInvite(botId, { channelId, guildId } = {}) {
  if (channelId) {
    const m = ((await dc(`/channels/${channelId}/messages?limit=50`)) || []).find(x => isInvite(x, botId));
    if (m) return { ...m, guild_id: guildId || '' };
  }
  const guilds = guildId ? [{ id: guildId }] : ((await dc('/users/@me/guilds')) || []).slice(0, 5);
  let best = null;
  for (const g of guilds) {
    const chans = ((await dc(`/guilds/${g.id}/channels`)) || []).filter(c => (c.type === 0 || c.type === 5) && c.id !== channelId);
    const found = await Promise.all(chans.slice(0, 40).map(c => dc(`/channels/${c.id}/messages?limit=50`).then(ms => (ms || []).find(m => isInvite(m, botId)))));
    for (const m of found) if (m && (!best || m.timestamp > best.timestamp)) best = { ...m, guild_id: g.id };
  }
  return best;
}

/** Who reacted on an invite (any emoji counts as in): { lists: [[{ id, name, known }]] } or { error, status }. names maps Discord ID → sheet name. */
export async function readReacts(channelId, messageId, names = {}) {
  const token = process.env.DISCORD_BOT_TOKEN, auth = { headers: { Authorization: `Bot ${token}` } }, seen = new Set(), list = [];
  const m = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, auth);
  if (!m.ok) return { error: true, status: m.status };
  const emojis = ((await m.json()).reactions || []).map(r => r.emoji).slice(0, 20);
  for (const e of emojis) {
    const code = encodeURIComponent(e.id ? `${e.name}:${e.id}` : e.name);
    const r = await fetch(`${API}/channels/${channelId}/messages/${messageId}/reactions/${code}?limit=100`, auth);
    if (!r.ok) return { error: true, status: r.status };
    // one entry per person, however many emojis they used
    for (const u of await r.json()) if (!u.bot && !seen.has(u.id)) { seen.add(u.id); list.push({ id: u.id, name: names[u.id] || u.global_name || u.username, known: !!names[u.id] }); }
  }
  return { lists: [list] };
}

/** Date/time/buy-in/host/note read back off an invite card (the card is the only place they're kept). */
function infoFrom(m, state) {
  const d = ((m.embeds && m.embeds[0]) || {}).description || '';
  const grab = re => (d.match(re) || [])[1];
  const p = d.split('\n\n')[1];
  return { date: grab(/📅 \*\*(.+?)\*\*/), time: grab(/📅 \*\*.+?\*\* · (.+)/), buyin: grab(/💵 \*\*(.+?)\*\*/), host: grab(/hosted by (.+)/),
    note: (p && !/^(React|👥|🟩|⬛|\*\*\d)/.test(p) ? p : ''), min: state.min, kind: state.kind };
}

/** The Update headcount button: reads the reactions and rewrites the card (no new message, no ping). */
export async function tally(i, s) {
  const m = i.message, state = unpack(i.data.custom_id);
  const names = Object.fromEntries(Object.entries(s.ids).map(([n, id]) => [id, n]));
  const got = await readReacts(m.channel_id, m.id, names);
  if (got.error) return { type: 4, data: { flags: 64, content: got.status === 403 ? "I can't read reactions here. The bot needs to be in the server with Read Message History in this channel." : `Couldn't read the reactions (Discord said ${got.status}). Try again in a moment.` } };
  const lists = got.lists.map(l => l.map(u => u.name));
  return { type: 7, data: { embeds: [inviteEmbed(infoFrom(m, state), lists, state.file ? `attachment://${state.file}` : null)], components: m.components, allowed_mentions: { parse: [] } } };
}

/** Rewrites the newest invite's card with the current reactions, like pressing Update headcount. Cheap to call often:
 *  does nothing when there's no invite from the last 3 days, when someone checked in the last minute, or when the list
 *  hasn't changed. getNames: async () => { discordId: sheetName }. Returns a short word on what happened. */
export async function refreshInvite(getNames = async () => ({})) {
  if (!kvUrl() || !process.env.DISCORD_BOT_TOKEN) return 'not set up';
  const [raw, lock] = await kv(['GET', LAST], ['SET', LOCK, '1', 'NX', 'EX', 55]);
  if (!raw) return 'no recent invite';
  if (lock !== 'OK') return 'checked in the last minute';
  const last = JSON.parse(raw);
  const got = await readReacts(last.c, last.m, await getNames());
  if (got.error) { if (got.status === 404) await kv(['DEL', LAST]); return 'discord said ' + got.status; }
  const list = got.lists[0].map(u => u.name), key = list.join('|');
  const [seen] = await kv(['GET', SEEN]);
  if (seen === key) return 'no change';
  const m = await dc(`/channels/${last.c}/messages/${last.m}`);
  if (!m) return 'invite not found';
  const r = await fetch(`${API}/channels/${last.c}/messages/${last.m}`, { method: 'PATCH',
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [inviteEmbed(infoFrom(m, last), [list], last.file ? `attachment://${last.file}` : null)], allowed_mentions: { parse: [] } }) });
  if (!r.ok) return 'edit failed ' + r.status;
  await kv(['SET', SEEN, key, 'EX', KEEP]);
  return 'updated';
}
