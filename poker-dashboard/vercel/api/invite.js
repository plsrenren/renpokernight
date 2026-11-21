// /api/invite            who answered the latest /game invite (the entry page's "Load from invite" button)
// /api/invite?link=...   the same for a specific invite (Discord: right-click the invite > Copy Message Link)
// /api/invite?refresh=1 rewrites the newest invite's headcount card (called every 5 minutes by a scheduler, e.g. Upstash QStash;
//   cheap: does nothing for invites older than 3 days, more than once a minute, or when the list hasn't changed).
// Returns JSON { kind, date, time, buyin, url, postedAt, in: [{ name, known }], maybe: [], cant: [] } (any reaction counts as in).
// "known" means the Discord account is in the Members tab, so the name is the sheet name.
// Uses DISCORD_BOT_TOKEN; the bot needs View Channel + Read Message History where the invite was posted.
import { readReacts, dc, isInvite, latestInvite, refreshInvite } from './_tourney.js';
import { MEMBERS_URL, memberIds } from '../recap-core.js';

export default async function handler(req, res) {
  try {
    if (!process.env.DISCORD_BOT_TOKEN) { res.status(500).json({ error: 'DISCORD_BOT_TOKEN is not set on Vercel' }); return; }
    const q = new URL(req.url, 'http://x').searchParams;
    if (q.has('refresh')) {
      const done = await refreshInvite(async () => {
        const members = await fetch(MEMBERS_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
        return Object.fromEntries(Object.entries(memberIds(members)).map(([n, id]) => [id, n]));
      });
      res.setHeader('Cache-Control', 'no-store'); res.status(200).json({ refresh: done }); return;
    }
    const me = await dc('/users/@me');
    if (!me) { res.status(502).json({ error: "Couldn't reach Discord. Try again in a moment." }); return; }
    let msg = null;
    const link = (q.get('link') || '').match(/channels\/(\d+|@me)\/(\d+)\/(\d+)/);
    if (link) {
      msg = await dc(`/channels/${link[2]}/messages/${link[3]}`);
      if (msg) msg.guild_id = link[1] === '@me' ? '' : link[1];
      if (!isInvite(msg, me.id)) { res.status(404).json({ error: "That link isn't a /game invite (or the bot can't see that channel)." }); return; }
    } else {
      msg = await latestInvite(me.id);
      if (!msg) { res.status(404).json({ error: 'No /game invite found in the last 50 messages of any channel the bot can see.' }); return; }
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
      in: pick(got.lists[0]), maybe: [], cant: [] }); // any reaction counts as in, so maybe/cant stay empty
  } catch (err) {
    res.status(500).json({ error: 'Could not read the invite: ' + err.message });
  }
}
