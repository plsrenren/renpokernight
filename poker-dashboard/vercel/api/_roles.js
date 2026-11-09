// Discord roles from results. The bot creates any missing role (with its colour) and moves each one to whoever holds it now.
//   Quarter Leader       top net in the latest quarter
//   Last Night's Winner  winner of the most recent night
//   Heater               finished up in each of their last 3 games, and played one of the last 4 nights
//   Tourney King         best tournament net this quarter
//   Cash King            best cash game net this quarter
//   2025 Champion, ...   top net of each finished year (a keepsake, a new role every year)
// Only touches players with a Discord ID in the Members tab, and only these roles. Roles are found by name,
// so recolouring or moving them in Discord is fine, renaming makes the bot create a fresh one.
// Needs the bot's Manage Roles permission, and the bot's own role above these roles.
const API = 'https://discord.com/api/v10';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const ROLE_COLORS = { "Quarter Leader": 0xf1c75b, "Last Night's Winner": 0x8ee0b0, Heater: 0xff7a45, 'Tourney King': 0xd9a21b, 'Cash King': 0x8f78f0 };
const CHAMP_COLOR = 0xe0507f;

/** { roleName: [player names] } worked out from game records (see gameRecords). */
export function computeRoles(recs, now = new Date()) {
  const out = { "Quarter Leader": [], "Last Night's Winner": [], Heater: [], 'Tourney King': [], 'Cash King': [] };
  if (!recs.length) return out;
  const top = list => { const t = {}; list.forEach(r => t[r.player] = (t[r.player] || 0) + r.net);
    const best = Object.entries(t).sort((a, b) => b[1] - a[1])[0]; return best && best[1] > 0 ? [best[0]] : []; };
  const qSorted = [...new Set(recs.map(r => r.quarter))].sort((a, b) => { const [qa, ya] = a.split(' '), [qb, yb] = b.split(' '); return (yb - ya) || (qb.slice(1) - qa.slice(1)); });
  const q = qSorted[0], inQ = recs.filter(r => r.quarter === q);
  out["Quarter Leader"] = top(inQ);
  out['Tourney King'] = top(inQ.filter(r => r.type === 'Tournament'));
  out['Cash King'] = top(inQ.filter(r => r.type !== 'Tournament'));
  const nights = [...new Set(recs.map(r => r.key + '|' + r.type))].sort();
  const last = nights[nights.length - 1], lastRows = recs.filter(r => r.key + '|' + r.type === last);
  const winners = lastRows.filter(r => r.win).map(r => r.player);
  out["Last Night's Winner"] = winners.length ? [...new Set(winners)] : top(lastRows);
  const recent = new Set(nights.slice(-4));
  const byPlayer = {}; recs.forEach(r => (byPlayer[r.player] ||= []).push(r));
  out.Heater = Object.entries(byPlayer).filter(([, g]) => g.length >= 3 && g.slice(-3).every(r => r.net > 0) && recent.has(g[g.length - 1].key + '|' + g[g.length - 1].type)).map(([p]) => p);
  const years = [...new Set(recs.map(r => r.y))].filter(y => y < now.getFullYear()).sort();
  for (const y of years) { const w = top(recs.filter(r => r.y === y)); if (w.length) out[`${y} Champion`] = w; }
  return out;
}

async function dc(method, path, body) {
  for (let t = 0; t < 4; t++) {
    const r = await fetch(API + path, { method, headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': 'Poker results' },
      body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await sleep(1000 * ((await r.json().catch(() => ({}))).retry_after || 1) + 100); continue; }
    if (r.status === 204) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data: j } : { ok: false, status: r.status, data: j };
  }
  return { ok: false, status: 429 };
}

/** Applies computeRoles to every server the bot is in. ids = { playerName: discordId }. Returns a short report. */
export async function syncRoles(recs, ids) {
  const want = computeRoles(recs), report = { changes: [], errors: [], holders: {} };
  for (const [role, names] of Object.entries(want)) report.holders[role] = names;
  const guilds = await dc('GET', '/users/@me/guilds');
  if (!guilds.ok || !Array.isArray(guilds.data)) { report.errors.push("Couldn't list the bot's servers."); return report; }
  const known = Object.entries(ids); // [name, id]
  for (const g of guilds.data.slice(0, 3)) {
    const rolesRes = await dc('GET', `/guilds/${g.id}/roles`);
    if (!rolesRes.ok) { report.errors.push(`Can't read roles in ${g.name}.`); continue; }
    const roleId = {};
    for (const role of Object.keys(want)) {
      const found = rolesRes.data.find(r => r.name === role);
      if (found) { roleId[role] = found.id; continue; }
      const made = await dc('POST', `/guilds/${g.id}/roles`, { name: role, color: ROLE_COLORS[role] ?? CHAMP_COLOR, hoist: false, mentionable: false });
      if (!made.ok) { report.errors.push(made.status === 403 ? `The bot needs the Manage Roles permission in ${g.name}.` : `Couldn't create "${role}" (${made.status}).`); continue; }
      roleId[role] = made.data.id; report.changes.push(`created ${role}`);
    }
    for (const [name, uid] of known) {
      const mem = await dc('GET', `/guilds/${g.id}/members/${uid}`);
      if (!mem.ok) continue; // not in this server
      const has = new Set(mem.data.roles || []);
      for (const [role, holders] of Object.entries(want)) {
        const rid = roleId[role]; if (!rid) continue;
        const should = holders.includes(name);
        if (should === has.has(rid)) continue;
        const res = await dc(should ? 'PUT' : 'DELETE', `/guilds/${g.id}/members/${uid}/roles/${rid}`);
        if (res.ok) report.changes.push(`${should ? '+' : '−'} ${role}: ${name}`);
        else report.errors.push(res.status === 403 ? `Can't change "${role}": drag the bot's role above it in Server Settings > Roles.` : `Couldn't update ${name} (${res.status}).`);
        await sleep(150);
      }
    }
  }
  report.errors = [...new Set(report.errors)];
  return report;
}
