// Casino chips for real poker nights. Runs after each save on the entry page (it calls /api/roles, which calls this).
// Everything is worked out again from the whole sheet each time and compared with what was already paid (rw:paid),
// so a night pays once, and fixing a result and saving again pays (or takes back) only the difference.
// Only nights from REWARDS_START on count; older nights never pay. Chips go to the Discord ID on the Members tab
// (RSVP chips go straight to whoever reacted on the invite, Members tab or not).
//
// Per night (amounts in R below):
//   RSVP            reacted to the /tourney or /cash invite for that night
//   Showed up       reacted AND played
//   1st / 2nd / 3rd cash games by net, tournaments by cash out; only players who finished up or cashed; ties both get it
//   Bad beat        the night's biggest loser: 20% of the real loss back, up to $100 (on top of consolation)
//   Consolation     everyone who lost money that night
//   PKO bounties    1 chip per $1 of bounty money won (notes "PKO bounties $X"; ~ $10 per knockout at a $40 buy-in)
//   Heater          once per streak, when someone has finished up 3 nights in a row
// Per finished quarter (paid when the first night of the next quarter is saved):
//   Quarter champ   top net of the quarter
import { kv } from './_blackjack.js';
import { parseCSV } from '../recap-core.js';
import { dc, latestInvite, readReacts } from './_tourney.js';

export const REWARDS_START = '2026-11-13';   // nights on or after this date pay chips
export const R = { rsvp: 25, showed: 50, places: [200, 100, 50], badBeatPct: 0.2, badBeatMax: 100, consolation: 20,
  pkoPerDollar: 1, heater: 100, champ: 1000 };
const LABEL = { rsvp: 'RSVP', showed: 'showed up', p1: '1st place', p2: '2nd place', p3: '3rd place', bad: 'bad beat insurance',
  cons: 'consolation', pko: 'PKO bounties', heater: 'Heater', champ: 'quarter champion' };
const r2 = n => Math.round(n * 100) / 100;
const money = s => { const n = parseFloat(String(s).replace(/[$,\s]/g, '')); return isNaN(n) ? 0 : n; };

/** Rows from the Input CSV with what the rewards need: night, player, net, cash out, PKO bounty money. */
export function nightRows(csv) {
  const [head, ...body] = parseCSV(String(csv || '').trim());
  if (!head) return [];
  const ix = n => head.findIndex(h => h.trim() === n);
  const c = { date: ix('Event_Date'), type: ix('Game_Type'), player: ix('Player_Name'), cin: ix('Cash_In'), cout: ix('Cash_Out'), notes: ix('Notes'), q: ix('Quarter') };
  return body.filter(r => /^\d+\/\d+\/\d{4}$/.test((r[c.date] || '').trim()) && (r[c.player] || '').trim()).map(r => {
    const [m, d, y] = r[c.date].trim().split('/').map(Number);
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, type = (r[c.type] || '').trim() || 'Cash';
    const cin = money(r[c.cin]), cout = money(r[c.cout]), pko = ((r[c.notes] || '').match(/PKO bounties \$([\d.,]+)/) || [])[1];
    return { key, night: key + '|' + type, type, player: r[c.player].trim(), cin, cout, net: r2(cout - cin), pko: pko ? money(pko) : 0,
      quarter: (r[c.q] || '').trim() || `Q${Math.floor((m - 1) / 3) + 1} ${y}` };
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Everything owed, as { 'what|who': { who, whoType: 'name'|'id', why, amt, night } }. rsvps = { night: [discordIds] }. */
export function owed(rows, rsvps = {}, ids = {}, start = REWARDS_START) {
  const out = {}, add = (night, why, who, amt, whoType = 'name') => { if (amt) out[`${night}|${why}|${who}`] = { night, why, who, whoType, amt: r2(amt) }; };
  const nights = {}; rows.forEach(r => (nights[r.night] ||= []).push(r));
  for (const [night, list] of Object.entries(nights)) {
    if (night.split('|')[0] < start) continue;
    // places
    const tourney = list[0].type === 'Tournament';
    const ranked = list.filter(r => r.net > 0 || (tourney && r.cout > 0)).sort((a, b) => tourney ? (b.cout - a.cout) || (b.net - a.net) : b.net - a.net);
    let place = 0;
    ranked.forEach((r, k) => {
      const prev = ranked[k - 1], tied = prev && (tourney ? prev.cout === r.cout && prev.net === r.net : prev.net === r.net);
      if (!tied) place = k;
      if (place < 3) add(night, 'p' + (place + 1), r.player, R.places[place]);
    });
    // bad beat + consolation
    const losers = list.filter(r => r.net < 0), worst = losers.length ? Math.min(...losers.map(r => r.net)) : 0;
    losers.forEach(r => { add(night, 'cons', r.player, R.consolation); if (r.net === worst) add(night, 'bad', r.player, Math.min(R.badBeatMax, -r.net * R.badBeatPct)); });
    // PKO
    list.forEach(r => r.pko > 0 && add(night, 'pko', r.player, r.pko * R.pkoPerDollar));
    // RSVP + showed up (reactors are Discord IDs)
    const played = new Set(list.map(r => ids[r.player]).filter(Boolean));
    (rsvps[night] || []).forEach(id => { add(night, 'rsvp', id, R.rsvp, 'id'); if (played.has(id)) add(night, 'showed', id, R.showed, 'id'); });
  }
  // Heater: 3 up in a row, once per streak (keyed by the streak's first night)
  const byPlayer = {}; rows.forEach(r => (byPlayer[r.player] ||= []).push(r));
  for (const [p, g] of Object.entries(byPlayer)) {
    let run = [];
    for (const r of g) {
      run = r.net > 0 ? [...run, r] : [];
      if (run.length === 3 && run[2].key >= start) add(run[0].night, 'heater', p, R.heater);
    }
  }
  // finished quarters: paid when the next quarter's first night is saved (only quarters that end after REWARDS_START)
  const qs = {}; rows.forEach(r => (qs[r.quarter] ||= []).push(r));
  const qKey = q => { const [n, y] = q.split(' '); return +y * 10 + +n.slice(1); };
  const order = Object.keys(qs).sort((a, b) => qKey(a) - qKey(b));
  order.forEach((q, k) => {
    const next = order[k + 1];
    if (!next || qs[next][0].key < start) return;
    const tot = {}; qs[q].forEach(r => tot[r.player] = (tot[r.player] || 0) + r.net);
    const best = Math.max(...Object.values(tot));
    if (best > 0) Object.entries(tot).filter(([, v]) => v === best).forEach(([p]) => add('Q:' + q, 'champ', p, R.champ));
  });
  return out;
}

/** Saves who reacted on the latest invite as the RSVP list of the night it was for (once per night). */
async function captureRsvp(rows, idsByName) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const me = await dc('/users/@me');
  if (!me) return null;
  const msg = await latestInvite(me.id);
  if (!msg) return null;
  const [used] = await kv(['GET', 'rw:invite:' + msg.id]);
  if (used) return used;
  // the invite belongs to the newest night dated from 1 day before it was posted to 10 days after
  const posted = new Date(msg.timestamp), day = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
  const lo = iso(posted - day), hi = iso(+posted + 10 * day);
  const night = [...new Set(rows.filter(r => r.key >= lo && r.key <= hi && r.key >= REWARDS_START).map(r => r.night))].sort().pop();
  if (!night) return null;
  const [have] = await kv(['GET', 'rw:rsvp:' + night]);
  if (have) return night;
  const names = Object.fromEntries(Object.entries(idsByName).map(([n, id]) => [id, n]));
  const got = await readReacts(msg.channel_id, msg.id, names);
  if (got.error) return null;
  const list = got.lists[0];
  await kv(['SET', 'rw:rsvp:' + night, JSON.stringify(list.map(u => u.id))], ['SET', 'rw:invite:' + msg.id, night],
    ...list.map(u => ['HSETNX', 'bj:name', u.id, u.name]));
  return night;
}

/** Pays what's owed minus what was paid. csv = Input tab CSV, ids = { sheetName: discordId }. Returns a short report. */
export async function payRewards(csv, ids) {
  const [lock] = await kv(['SET', 'rw:lock', '1', 'NX', 'EX', 25]);
  if (!lock) return { skipped: 'already running' };
  try {
    const rows = nightRows(csv);
    let rsvpNight = null;
    try { rsvpNight = await captureRsvp(rows, ids); } catch (e) { console.error('rewards rsvp', e); }
    const nights = [...new Set(rows.filter(r => r.key >= REWARDS_START).map(r => r.night))];
    const saved = nights.length ? await kv(...nights.map(n => ['GET', 'rw:rsvp:' + n])) : [];
    const rsvps = {}; nights.forEach((n, k) => { try { if (saved[k]) rsvps[n] = JSON.parse(saved[k]); } catch (e) {} });
    const want = owed(rows, rsvps, ids);
    const [paidRaw] = await kv(['HGETALL', 'rw:paid']);
    const paid = {}; for (let k = 0; k < (paidRaw || []).length; k += 2) paid[paidRaw[k]] = +paidRaw[k + 1];
    // what changed, per payout line (including lines that are no longer owed: a fixed typo takes the chips back)
    const cmds = [], perPerson = {}, noId = new Set();
    for (const key of new Set([...Object.keys(want), ...Object.keys(paid)])) {
      const w = want[key], delta = r2((w ? w.amt : 0) - (paid[key] || 0));
      if (!delta) continue;
      const [night, why, who] = key.split('|').length === 4 ? [key.split('|').slice(0, 2).join('|'), ...key.split('|').slice(2)] : key.split('|');
      const isId = /^\d{17,20}$/.test(who), id = isId ? who : ids[who];
      if (!id) { noId.add(who); continue; }   // no Discord ID on the Members tab yet: paid once it's added
      cmds.push(['HINCRBYFLOAT', 'bj:bal', id, delta], ['HSET', 'rw:paid', key, w ? w.amt : 0]);
      if (!isId) cmds.push(['HSETNX', 'bj:name', id, who]);
      const p = perPerson[id] ||= { id, name: isId ? null : who, total: 0, lines: [] };
      p.total = r2(p.total + delta); p.lines.push(`${LABEL[why] || why} ${delta > 0 ? '+' : ''}${delta}`);
    }
    // one "Just now" feed line per person on the casino page
    const [names] = Object.keys(perPerson).length ? await kv(['HGETALL', 'bj:name']) : [[]];
    const nm = {}; for (let k = 0; k < (names || []).length; k += 2) nm[names[k]] = names[k + 1];
    for (const p of Object.values(perPerson)) {
      p.name = p.name || nm[p.id] || 'Someone';
      cmds.push(['LPUSH', 'cas:feed', JSON.stringify({ id: p.id, name: p.name, game: 'poker night', net: p.total, src: 'night', at: Date.now() })]);
    }
    if (cmds.length) cmds.push(['LTRIM', 'cas:feed', 0, 29]);
    if (cmds.length) await kv(...cmds);
    return { paid: Object.values(perPerson).map(p => ({ name: p.name, total: p.total, lines: p.lines })), rsvpNight, waitingForDiscordId: [...noId] };
  } finally { await kv(['DEL', 'rw:lock']).catch(() => {}); }
}
