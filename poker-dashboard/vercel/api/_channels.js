// Which channel each slash command belongs in: casino games in #casino, poker stats and invites in #the-table.
// Used in the wrong channel, a command answers with a short hint (only the user sees it) pointing to the right one.
// Channels are matched by name ("casino" / "table" anywhere in it, so "🎰-casino" works too); threads count as their
// parent channel. If the server has no such channel, or Discord can't be reached, the command just works anywhere.
// Commands not listed here (/fish, /donkey) work in every channel.
const API = 'https://discord.com/api/v10';
export const HOME = {
  casino: { label: 'casino', test: n => /casino/i.test(n),
    commands: ['daily', 'blackjack', 'chips', 'duel', 'uth', 'roulette', 'baccarat', 'lottery'] },
  table: { label: 'the-table', test: n => /table/i.test(n),
    commands: ['player', 'standings', 'recap', 'h2h', 'hall', 'wrap', 'tourney', 'cash', 'seats', 'roles'] },
};
const homeOf = cmd => Object.values(HOME).find(h => h.commands.includes(cmd));
const THREAD = new Set([10, 11, 12]);

// the server's channel list, kept for 10 minutes; only fetched when a command looks like it's in the wrong place
let list = { at: 0, guild: '', chans: null };
async function channels(guild) {
  if (list.chans && list.guild === guild && Date.now() - list.at < 600e3) return list.chans;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const c = new AbortController(), t = setTimeout(() => c.abort(), 1200);
  try {
    const r = await fetch(`${API}/guilds/${guild}/channels`, { headers: { Authorization: `Bot ${token}` }, signal: c.signal });
    if (!r.ok) return null;
    list = { at: Date.now(), guild, chans: await r.json() };
    return list.chans;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

/** null when the command may run here, otherwise the hint text to send back (ephemeral). */
export async function wrongChannel(i, fetchChannels = channels) {
  const home = homeOf(i.data && i.data.name);
  if (!home || !i.guild_id) return null; // anywhere commands, and DMs
  const ch = i.channel || { id: i.channel_id };
  if (!THREAD.has(ch.type) && ch.name && home.test(ch.name)) return null; // the quick case, no Discord call
  const chans = await fetchChannels(i.guild_id);
  if (!Array.isArray(chans)) return null; // can't tell, so don't get in the way
  const text = chans.filter(c => c.type === 0 || c.type === 5);
  const parentId = THREAD.has(ch.type) ? ch.parent_id : null;
  const here = text.find(c => c.id === (parentId || ch.id));
  if (here && home.test(here.name)) return null;
  const target = text.find(c => home.test(c.name));
  if (!target) return null; // the server has no such channel: allow it anywhere
  return `/${i.data.name} lives in <#${target.id}>. Try it there.`;
}
