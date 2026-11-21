// /info: posts the welcome post (option C2, picked Nov 21 2026) in the channel it's used in, meant for #info so it can be pinned.
// Two cards: intro + site links, then "Start here" with the few commands everyone needs. Pitbosses, Renato and admins only.
// The bot posts it as a normal message (no "used /info" header) and answers the user privately; if the bot can't send
// messages in that channel it falls back to answering the command in public. Edit the text here, then run /info again.
import { channels, HOME } from './_channels.js';
const API = 'https://discord.com/api/v10';
const SITE = 'https://renpokernight.vercel.app';

export const INFO_COMMAND = { name: 'info', description: 'Post the welcome post with site links and starter commands here (pitbosses only)', type: 1 };

/** The two embeds. chan = { table, casino } channel ids when known, so the text can link them. */
export function infoEmbeds(chan = {}) {
  const at = (id, name) => id ? `<#${id}>` : `#${name}`;
  const L = (label, path) => `[${label}](${SITE}${path})`;
  return [
    { color: 0xc0392b, title: '♠️ Poker Club @ The Study', thumbnail: { url: `${SITE}/icon-192.png` },
      description: 'Stats, recaps and a casino for our home game. Everything updates right after each night is saved.\n\n'
        + `📊 ${L('Dashboard', '/')} · 📰 ${L('Recap', '/recap')} · 🏆 ${L('Hall of Fame', '/hall')}\n`
        + `⚔️ ${L('Head to head', '/h2h')} · 🎰 ${L('Casino', '/casino')} · 🃏 ${L('Poker room', '/poker')} · 🎴 ${L('Study Cards', '/shop')}` },
    { color: 0x5865f2, title: '🚀 Start here',
      description: [
        `\`/player\` your card and stats (in ${at(chan.table, 'the-table')})`,
        '🗓️ React to a game invite with any emoji to say you\'re in',
        `\`/daily\` free chips, \`/earn\` every way to get more (in ${at(chan.casino, 'casino')})`,
        '-# Type / to see everything else.',
      ].join('\n') },
  ];
}

async function homeChannels(guild) {
  const list = guild ? await channels(guild).catch(() => null) : null;
  if (!Array.isArray(list)) return {};
  const text = list.filter(c => c.type === 0 || c.type === 5);
  const find = h => (text.find(c => h.test(c.name)) || {}).id;
  return { table: find(HOME.table), casino: find(HOME.casino) };
}

/** Answer to /info: post in the channel, tell the user privately. */
export async function postInfo(i) {
  const embeds = infoEmbeds(await homeChannels(i.guild_id));
  const chId = (i.channel && i.channel.id) || i.channel_id;
  const c = new AbortController(), t = setTimeout(() => c.abort(), 1500);
  try {
    const r = await fetch(`${API}/channels/${chId}/messages`, { method: 'POST', signal: c.signal,
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds, allowed_mentions: { parse: [] } }) });
    if (r.ok) return { type: 4, data: { flags: 64, content: 'Posted 👍 Hover it and pick **Pin Message** to pin it.' } };
    console.error('info post', r.status, await r.text().catch(() => ''));
  } catch (e) { console.error('info post', e); } finally { clearTimeout(t); }
  return { type: 4, data: { allowed_mentions: { parse: [] }, embeds } }; // no Send Messages there: answer in public instead
}
