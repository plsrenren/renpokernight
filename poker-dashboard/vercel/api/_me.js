// The sign-in badge in the top right of every page (badge.js): who you are, your chips, your loadout and a few numbers for the hover card.
// GET /api/me (vercel.json rewrite into discord.js?web=me, so no function slot of its own). One Redis pipeline (the same reads as
// the /shop loadout) + the cached sheet copy. Also sets or clears the readable "cas_in" marker, so a browser that signed in before
// the marker existed gets it on its first visit, and a browser whose session ran out stops asking.
import { loadout, champsFor } from './_shop.js';
import { marker } from './_casino.js';
import { ITEMS, ACC_ITEMS } from '../loot.js';
import { latestQuarter } from '../recap-core.js';
import { kv } from './_blackjack.js';
import { buffReads, activeBuffs, buffView } from './_buffs.js';

const r2 = n => Math.round(n * 100) / 100;
/** this quarter on the sheet for one player: { label, net, nights, place, players } (nights 0 = hasn't played yet) */
export function quarterOf(recs, name) {
  if (!recs || !recs.length) return null;
  const q = latestQuarter(recs), scope = recs.filter(r => r.quarter === q), tot = {};
  scope.forEach(r => tot[r.player] = (tot[r.player] || 0) + r.net);
  const mine = scope.filter(r => r.player === name), ranked = Object.entries(tot).sort((a, b) => b[1] - a[1]);
  return { label: q, net: r2(tot[name] || 0), nights: new Set(mine.map(r => r.key)).size,
    place: mine.length ? ranked.findIndex(([n]) => n === name) + 1 : 0, players: ranked.length };
}

export async function meWeb(me, sheet, out) {
  if (!me) return out({ me: null }, 200, { 'Set-Cookie': marker(false) });
  const [L, s, bf] = await Promise.all([loadout(me.id), sheet ? sheet().catch(() => null) : null, kv(...buffReads(me.id)).catch(() => [])]);
  const ids = (s && s.ids) || {}, sheetName = Object.keys(ids).find(n => ids[n] === me.id) || null;
  // same count as /collection: pack items you have + accolades you've earned, out of everything in play (champion borders on top)
  const got = ITEMS.filter(i => L.owned[i.id]).length + ACC_ITEMS.filter(i => L.earned.includes(i.id)).length;
  return out({ me: {
    id: me.id, name: me.name, player: sheetName, bal: L.bal || 0, rank: L.rank, of: L.of, eq: L.eq, packs: L.packs,
    own: got, all: ITEMS.length + ACC_ITEMS.length, champs: (champsFor(me.id, s) || []).length,
    q: sheetName && s ? quarterOf(s.recs, sheetName) : null,
    buffs: buffView(activeBuffs(bf[0], bf[1], me.id)),   // /daily buffs from poker nights (_buffs.js)
  } }, 200, { 'Set-Cookie': marker(true) });
}
