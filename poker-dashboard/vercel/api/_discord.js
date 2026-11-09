// Looks up a Discord user's current avatar, banner and profile colour. Needs a bot token in the Vercel env var
// DISCORD_BOT_TOKEN (the bot never has to join a server). Everything returns null when there's no token,
// nothing set, or Discord is slow, and callers fall back to initials / the default card colours.
const HOUR = 3600e3;
const users = new Map();   // id -> { at, user }
const images = new Map();  // url -> { at, png }

async function get(url, opts, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

/** The Discord user object ({ avatar, banner, accent_color, ... }) or null. Cached for 6 hours. */
export async function discordUser(id) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !/^\d{17,20}$/.test(String(id))) return null;
  const hit = users.get(id);
  if (hit && Date.now() - hit.at < 6 * HOUR) return hit.user;
  try {
    const r = await get(`https://discord.com/api/v10/users/${id}`, { headers: { Authorization: `Bot ${token}` } }, 3000);
    const user = r.ok ? await r.json() : null;
    users.set(id, { at: r.ok ? Date.now() : Date.now() - 5 * HOUR, user }); // failures retry in an hour
    return user;
  } catch (e) {
    return null;
  }
}

async function image(url) {
  const hit = images.get(url);
  if (hit && Date.now() - hit.at < 6 * HOUR) return hit.png;
  try {
    const r = await get(url, {}, 3000);
    if (!r.ok) return null;
    const png = Buffer.from(await r.arrayBuffer());
    images.set(url, { at: Date.now(), png });
    return png;
  } catch (e) {
    return null;
  }
}

export async function avatarPng(id, size = 128) {
  const u = await discordUser(id);
  return u && u.avatar ? image(`https://cdn.discordapp.com/avatars/${id}/${u.avatar}.png?size=${size}`) : null;
}

/** Profile banner (Nitro only) as PNG bytes, or null. Animated banners come back as their first frame. */
export async function bannerPng(id, size = 600) {
  const u = await discordUser(id);
  return u && u.banner ? image(`https://cdn.discordapp.com/banners/${id}/${u.banner}.png?size=${size}`) : null;
}

/** The profile colour people pick in Discord, as "#rrggbb", or null. */
export async function accentColor(id) {
  const u = await discordUser(id);
  return u && Number.isInteger(u.accent_color) ? '#' + u.accent_color.toString(16).padStart(6, '0') : null;
}
