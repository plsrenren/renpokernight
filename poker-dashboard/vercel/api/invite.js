// /api/invite            who answered the latest /tourney or /cash invite (the entry page's "Load from invite" button)
// /api/invite?link=...   the same for a specific invite (Discord: right-click the invite > Copy Message Link)
// Returns JSON { kind, date, time, buyin, url, postedAt, in: [{ name, known }], maybe: [...], cant: [...] }.
// "known" means the Discord account is in the Members tab, so the name is the sheet name.
// Uses DISCORD_BOT_TOKEN; the bot needs View Channel + Read Message History where the invite was posted.
import { readReacts } from './_tourney.js';
import { MEMBERS_URL, memberIds } from '../recap-core.js';

const API = 'https://discord.com/api/v10';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dc(path) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(API + path, { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } });
    if (r.status === 429) { await sleep(1000 * ((await r.json().catch(() => ({}))).retry_after || 1)); continue; }
    return r.ok ? r.json() : null;
  }
  return null;
}
const isInvite = (m, botId) => m && m.author && m.author.id === botId
  && (m.components || []).some(row => (row.components || []).some(c => String(c.custom_id || '').startsWith('tally:')));

// Looks through the text channels of every server the bot is in for its newest invite
async function latestInvite(botId) {
  const guilds = (await dc('/users/@me/guilds')) || [];
  let best = null;
  for (const g of guilds.slice(0, 5)) {
    const chans = ((await dc(`/guilds/${g.id}/channels`)) || []).filter(c => c.type === 0 || c.type === 5);
    const found = await Promise.all(chans.slice(0, 40).map(c => dc(`/channels/${c.id}/messages?limit=50`).then(ms => (ms || []).find(m => isInvite(m, botId)))));
    for (const m of found) if (m && (!best || m.timestamp > best.timestamp)) best = { ...m, guild_id: g.id };
  }
  return best;
}

export default async function handler(req, res) {
  try {
    if (!process.env.DISCORD_BOT_TOKEN) { res.status(500).json({ error: 'DISCORD_BOT_TOKEN is not set on Vercel' }); return; }
    const q = new URL(req.url, 'http://x').searchParams;
    const me = await dc('/users/@me');
    if (!me) { res.status(502).json({ error: "Couldn't reach Discord. Try again in a moment." }); return; }
    let msg = null;
    const link = (q.get('link') || '').match(/channels\/(\d+|@me)\/(\d+)\/(\d+)/);
    if (link) {
      msg = await dc(`/channels/${link[2]}/messages/${link[3]}`);
      if (msg) msg.guild_id = link[1] === '@me' ? '' : link[1];
      if (!isInvite(msg, me.id)) { res.status(404).json({ error: "That link isn't a /tourney or /cash invite (or the bot can't see that channel)." }); return; }
    } else {
      msg = await latestInvite(me.id);
      if (!msg) { res.status(404).json({ error: 'No /tourney or /cash invite found in the last 50 messages of any channel the bot can see.' }); return; }
    }
    const members = await fetch(MEMBERS_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
    const names = Object.fromEntries(Object.entries(memberIds(members)).map(([n, id]) => [id, n]));
    const got = await readReacts(msg.channel_id, msg.id, names);
    if (got.error) { res.status(502).json({ error: `Couldn't read the reactions (Discord said ${got.status}).` }); return; }
    const e = (msg.embeds && msg.embeds[0]) || {}, d = e.description || '', grab = re => (d.match(re) || [])[1] || '';
    const pick = l => l.map(u => ({ name: u.name, known: u.known }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      kind: /cash/i.test(e.title || '') ? 'Cash' : 'Tournament', date: grab(/📅 \*\*(.+?)\*\*/), time: grab(/📅 \*\*.+?\*\* · (.+)/), buyin: grab(/💵 \*\*(.+?)\*\*/),
      url: msg.guild_id ? `https://discord.com/channels/${msg.guild_id}/${msg.channel_id}/${msg.id}` : '', postedAt: msg.timestamp,
      in: pick(got.lists[0]), maybe: pick(got.lists[1]), cant: pick(got.lists[2]) });
  } catch (err) {
    res.status(500).json({ error: 'Could not read the invite: ' + err.message });
  }
}
