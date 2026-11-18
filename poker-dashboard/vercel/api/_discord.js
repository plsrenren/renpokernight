// Looks up a Discord user's current avatar, banner and profile colour. Needs a bot token in the Vercel env var
// DISCORD_BOT_TOKEN (the bot never has to join a server). Everything returns null when there's no token,
// nothing set, or Discord is slow, and callers fall back to initials / the default card colours.
const HOUR = 3600e3;
const users = new Map();   // id -> { at, user }
const images = new Map();  // url -> { at, png }
const failed = new Set();  // ids whose last lookup failed

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
  // a page full of pfps asks for many users at once, so Discord can rate limit (429): wait it out once and retry
  for (let tries = 0; tries < 2; tries++) {
    try {
      const r = await get(`https://discord.com/api/v10/users/${id}`, { headers: { Authorization: `Bot ${token}` } }, 3000);
      if (r.status === 429 && tries === 0) {
        const wait = Math.min(2000, 1000 * (+(await r.json().catch(() => ({}))).retry_after || +r.headers.get('retry-after') || 1));
        await new Promise(ok => setTimeout(ok, wait)); continue;
      }
      if (r.ok || r.status === 404) { const user = r.ok ? await r.json() : null; users.set(id, { at: Date.now(), user }); failed.delete(id); return user; }
      break;
    } catch (e) { break; }
  }
  // Discord was slow or busy: not cached, so the next request asks again (and the caller can say "try again", not "no pfp")
  failed.add(id);
  return hit ? hit.user : null;
}
/** true when the last lookup of this user failed (Discord slow / rate limited), as opposed to them having no pfp */
export const lookupFailed = id => failed.has(String(id));
/** forget a cached user (their pfp changed, so the old picture link is gone) */
const forget = id => users.delete(id);

async function image(url, ms = 3000) {
  const hit = images.get(url);
  if (hit && Date.now() - hit.at < 6 * HOUR) return hit.png;
  try {
    const r = await get(url, {}, ms);
    if (!r.ok) return null;
    const png = Buffer.from(await r.arrayBuffer());
    images.set(url, { at: Date.now(), png });
    return png;
  } catch (e) {
    return null;
  }
}

export async function avatarPng(id, size = 128) {
  let u = await discordUser(id);
  if (!u || !u.avatar) return null;
  const png = await image(`https://cdn.discordapp.com/avatars/${id}/${u.avatar}.png?size=${size}`);
  if (png) return png;
  // the cached user can be hours old: if they changed their pfp, the old link is dead, so look them up again once
  forget(id); u = await discordUser(id);
  return u && u.avatar ? image(`https://cdn.discordapp.com/avatars/${id}/${u.avatar}.png?size=${size}`) : null;
}
/** the animated pfp as a GIF when it is one (avatar hash starts with a_), else null */
export async function avatarGif(id, size = 128) {
  const u = await discordUser(id);
  // GIFs can be big (600 KB+), so they get longer than the 3s a still pfp gets
  return u && u.avatar && u.avatar.startsWith('a_') ? image(`https://cdn.discordapp.com/avatars/${id}/${u.avatar}.gif?size=${size}`, 7000) : null;
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
