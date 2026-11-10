// /seats: random seat order for everyone who reacted to the newest /tourney or /cash invite.
//   add:    walk-ins, comma separated (matched to sheet names when they're close)
//   remove: no-shows, comma separated names or @mentions
// Everyone sits at one table. One player gets the dealer button at random. Posts the table picture (/api/seats)
// with a numbered list, plus a Reshuffle button only the person who ran it can press. No storage: the players
// ride along in the picture's URL, so Reshuffle reads them back from the message.
import { randomInt } from 'node:crypto';
import { readReacts, latestInvite } from './_tourney.js';

const SITE = 'https://renpokernight.vercel.app';
const MAX = 16;

export const SEATS_COMMAND = { name: 'seats', description: 'Random seat order for everyone in on the latest /tourney or /cash invite', type: 1,
  options: [
    { type: 3, name: 'add', description: 'Walk-ins to add, comma separated (e.g. Mike, Tommy)', required: false, max_length: 200 },
    { type: 3, name: 'remove', description: 'No-shows to take out, comma separated names or @mentions', required: false, max_length: 300 }] };

const shuffle = a => { a = a.slice(); for (let k = a.length - 1; k > 0; k--) { const j = randomInt(k + 1); [a[k], a[j]] = [a[j], a[k]]; } return a; };
const clean = n => String(n).replace(/[|~]/g, '').trim().slice(0, 24);
const pack = ps => ps.map(p => `${p.id || ''}~${clean(p.name)}`).join('|');
const unpack = str => String(str || '').split('|').filter(Boolean).map(x => { const [id, ...n] = x.split('~'); return { id, name: n.join('~') }; });

/** The message: picture, numbered list, Reshuffle button. */
function seatsMessage(players, { title, source, owner, ownerName }) {
  const seated = shuffle(players), button = randomInt(seated.length);
  const n = seated.length, sb = n === 2 ? button : (button + 1) % n;
  const blinds = n === 2 ? `🔘 **${seated[button].name}** has the button and posts the small blind.`
    : `🔘 **${seated[button].name}** has the button, so **${seated[sb].name}** posts the small blind.`;
  const list = seated.map((p, k) => `\`${String(k + 1).padStart(2)}\` ${p.name}${k === button ? ' 🔘' : ''}`);
  const half = Math.ceil(list.length / 2);
  const q = new URLSearchParams({ p: pack(seated), d: String(button), v: Date.now().toString(36) });
  return { allowed_mentions: { parse: [] }, embeds: [{ color: 0x2f7d5b, title,
    description: `${source}\n${blinds}`,
    fields: [{ name: '​', value: list.slice(0, half).join('\n'), inline: true }, ...(list.length > half ? [{ name: '​', value: list.slice(half).join('\n'), inline: true }] : [])],
    image: { url: `${SITE}/api/seats?${q}` },
    footer: { text: `Random draw · seat 1 is at the bottom, numbers go clockwise · only ${ownerName} can reshuffle` } }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Reshuffle', emoji: { name: '🔀' }, custom_id: `seats:${owner}` }] }] };
}

const whoName = (i, s) => {
  const u = (i.member && i.member.user) || i.user || {};
  const sheet = s && s.ids ? Object.keys(s.ids).find(n => s.ids[n] === u.id) : null;
  return { id: u.id, name: sheet || (i.member && i.member.nick) || u.global_name || u.username || 'Someone' };
};

/** The /seats command: answers "thinking…" right away (reading the invite takes a few seconds), then posts. */
export function startSeats(i, opts, s, waitUntil) {
  waitUntil(finishSeats(i, opts, s || { ids: {}, recs: [] }).catch(e => console.error('seats', e)));
  return { type: 5 };
}

async function finishSeats(i, opts, s) {
  const hook = `https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`;
  const send = body => fetch(hook, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fail = text => send({ content: text, allowed_mentions: { parse: [] } });
  const me = whoName(i, s);
  const byId = Object.fromEntries(Object.entries(s.ids || {}).map(([n, id]) => [id, n]));
  const known = [...new Set([...(s.recs || []).map(r => r.player), ...Object.keys(s.ids || {})])];

  const inv = await latestInvite(i.application_id, { channelId: i.channel_id, guildId: i.guild_id });
  let players = [], source = '';
  if (inv) {
    const got = await readReacts(inv.channel_id, inv.id, byId);
    if (got.error) return fail(`Couldn't read the reactions on the invite (Discord said ${got.status}). The bot needs Read Message History in that channel.`);
    players = got.lists[0].map(u => ({ id: u.id, name: u.name }));
    const e = (inv.embeds && inv.embeds[0]) || {}, date = ((e.description || '').match(/📅 \*\*(.+?)\*\*/) || [])[1];
    source = `From the ${date ? date + ' ' : ''}${/cash/i.test(e.title || '') ? 'cash game' : 'tourney'} invite (${players.length} in)`;
  }
  const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  const removed = [];
  for (const r of split(opts.remove && opts.remove.value)) {
    const id = (r.match(/^<@!?(\d+)>$/) || [])[1];
    const k = players.findIndex(p => id ? p.id === id : p.name.toLowerCase() === r.replace(/^@/, '').toLowerCase());
    if (k >= 0) removed.push(players.splice(k, 1)[0].name);
  }
  const added = [];
  for (const a of split(opts.add && opts.add.value)) {
    const id = (a.match(/^<@!?(\d+)>$/) || [])[1];
    const name = id ? (byId[id] || ((i.data.resolved || {}).users || {})[id]?.global_name || 'Guest') : (known.find(n => n.toLowerCase() === a.toLowerCase()) || clean(a));
    if (!name || players.some(p => p.name.toLowerCase() === name.toLowerCase())) continue;
    players.push({ id: id || (s.ids || {})[name] || '', name }); added.push(name);
  }
  if (!inv && !players.length) return fail("I couldn't find a /tourney or /cash invite. Post one first, or list everyone with `add:`.");
  if (players.length < 2) return fail(`Only ${players.length} player${players.length === 1 ? '' : 's'} so far. Seats need at least 2 (use \`add:\` for walk-ins).`);
  if (players.length > MAX) return fail(`That's ${players.length} players, more than fit around one table (${MAX} max).`);
  const bits = [added.length ? `${added.join(', ')} added` : '', removed.length ? `${removed.join(', ')} removed` : ''].filter(Boolean);
  source = inv ? source + (bits.length ? ` · ${bits.join(' · ')}` : '') + '.' : `No invite found, so just the players you added.`;
  const kind = inv && /cash/i.test(((inv.embeds || [])[0] || {}).title || '') ? 'Cash game' : 'Tourney';
  const r = await send(seatsMessage(players, { title: `🪑 Seat order · ${inv ? kind + ' · ' : ''}${players.length} players`, source, owner: me.id, ownerName: me.name }));
  if (!r.ok) console.error('seats post failed', r.status, await r.text());
}

/** The Reshuffle button (custom_id seats:<owner id>): new draw, same players. */
export function reshuffle(i) {
  const owner = String(i.data.custom_id).split(':')[1];
  const u = (i.member && i.member.user) || i.user || {};
  const e = ((i.message && i.message.embeds) || [])[0] || {};
  const ownerName = ((e.footer && e.footer.text) || '').match(/only (.+) can reshuffle/)?.[1] || 'whoever ran /seats';
  if (u.id !== owner) return { type: 4, data: { flags: 64, content: `Only ${ownerName} can reshuffle. Nice try 😏` } };
  let players = [];
  try { players = unpack(new URL(e.image.url).searchParams.get('p')); } catch (err) { /* fall through */ }
  if (players.length < 2) return { type: 4, data: { flags: 64, content: "Couldn't read the players off this message. Run **/seats** again." } };
  const source = String(e.description || '').split('\n')[0];
  return { type: 7, data: seatsMessage(players, { title: e.title, source, owner, ownerName }) };
}

export { unpack as unpackSeats };
