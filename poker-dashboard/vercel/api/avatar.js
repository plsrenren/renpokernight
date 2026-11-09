// /api/avatar?id=<discord user id>              the player's current Discord pfp as a PNG
// /api/avatar?id=<discord user id>&kind=banner  their profile banner (Nitro only)
// A miss is a 404 (the page falls back to initials / the default card glow). Banner misses also send the
// player's Discord profile colour, when they've picked one, in the X-Accent-Color header.
import { avatarPng, bannerPng, accentColor } from './_discord.js';

export default async function handler(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const id = q.get('id') || '', banner = q.get('kind') === 'banner';
  if (!/^\d{17,20}$/.test(id)) { res.status(400).send('id must be a Discord user ID'); return; }
  const png = banner ? await bannerPng(id) : await avatarPng(id);
  if (!png) {
    if (banner) { const c = await accentColor(id); if (c) res.setHeader('X-Accent-Color', c); }
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    res.status(404).send(banner ? 'no banner' : 'no avatar');
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(png);
}
