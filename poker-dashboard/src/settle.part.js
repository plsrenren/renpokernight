
// ---------- Settle up: everyone who lost pays the banker, the banker pays the winners ----------
// The banker is the first of BANKERS who played that night (Dong, or Renato when Dong isn't there).
export const BANKERS = ['Dong', 'Renato'];

/** { playerName: venmoUsername } from the Members tab CSV: any header containing "venmo". Takes "@name", "name" or a venmo.com link. */
export function memberVenmo(text) {
  const rows = parseCSV(String(text || '').trim());
  if (rows.length < 2) return {};
  const col = rows[0].findIndex(h => /venmo/i.test(h));
  if (col < 0) return {};
  const out = {};
  for (const r of rows.slice(1)) {
    const name = (r[0] || '').trim(), user = venmoUser(r[col]);
    if (name && user) out[name] = user;
  }
  return out;
}
export function venmoUser(s) {
  s = String(s || '').trim();
  const m = s.match(/venmo\.com\/(?:u\/)?([A-Za-z0-9_-]+)/i) || s.match(/recipients=([A-Za-z0-9_-]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '');
  return /^[A-Za-z0-9_-]{2,40}$/.test(s) && !/^(u|code|account)$/i.test(s) ? s : '';
}
/** Venmo "pay" link with the person, amount and note filled in (opens the app on phones). */
export const venmoPayUrl = (user, amount, note) =>
  `https://venmo.com/?txn=pay&audience=private&recipients=${encodeURIComponent(user)}&amount=${r2(amount).toFixed(2)}&note=${encodeURIComponent(note || '')}`;

/**
 * night = one entry from toNights(). Returns
 * { banker, bankerNet, pay: [{ name, amt }] (owe the banker, biggest first), get: [{ name, amt }] (banker pays them),
 *   inTotal, outTotal, off } where off = how far the night's nets are from adding up to $0 (0 when it balances).
 */
export function settleUp(night, bankers = BANKERS) {
  const rows = night.rows.map(r => ({ name: r.player, net: r2(r.net) }));
  const lc = s => s.toLowerCase();
  const banker = bankers.find(b => rows.some(r => lc(r.name) === lc(b)));
  const bankerName = banker ? rows.find(r => lc(r.name) === lc(banker)).name : bankers[0];
  const others = rows.filter(r => r.name !== bankerName);
  const pay = others.filter(r => r.net < 0).map(r => ({ name: r.name, amt: r2(-r.net) })).sort((a, b) => b.amt - a.amt);
  const get = others.filter(r => r.net > 0).map(r => ({ name: r.name, amt: r2(r.net) })).sort((a, b) => b.amt - a.amt);
  const inTotal = r2(pay.reduce((s, p) => s + p.amt, 0)), outTotal = r2(get.reduce((s, p) => s + p.amt, 0));
  const me = rows.find(r => r.name === bankerName);
  return { banker: bankerName, bankerPlayed: !!me, bankerNet: me ? me.net : 0, pay, get, inTotal, outTotal,
    off: r2(rows.reduce((s, r) => s + r.net, 0)) };
}

const SETTLE_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const usd2 = n => '$' + r2(Math.abs(n)).toFixed(2);
/**
 * The Discord message for a night's settle-up (used by the entry page's post and by /settle).
 * venmo = memberVenmo(), ids = memberIds(). ping = mention the people who owe money.
 */
export function settleMessage(night, venmo = {}, ids = {}, { site = '', ping = true } = {}) {
  const s = settleUp(night), b = s.banker, bv = venmo[b];
  const when = `${SETTLE_MON[night.m - 1]} ${night.d}`, note = `Poker ${when} @ The Study`;
  const line = (p, to) => `• **${p.name}** ${usd2(p.amt)}` + (venmo[to] ? ` · [Pay on Venmo](${venmoPayUrl(venmo[to], p.amt, note)})` : '');
  const parts = [];
  if (s.pay.length) parts.push(`**Send ${b} your loss** (${s.pay.length})`, ...s.pay.map(p => line(p, b)));
  if (s.get.length) parts.push('', `**${b} pays out** (${s.get.length})`, ...s.get.map(p => `• **${p.name}** ${usd2(p.amt)}` + (venmo[p.name] ? ` · [Venmo](${venmoPayUrl(venmo[p.name], p.amt, note)})` : '')));
  if (!s.pay.length && !s.get.length) parts.push('Nothing to settle.');
  const foot = [];
  if (s.bankerPlayed) foot.push(`${b}'s own night: ${s.bankerNet >= 0 ? '+' : '−'}${usd2(s.bankerNet)}`);
  if (s.off) foot.push(`heads up: the night is off by ${usd2(s.off)}, ${b} covers it`);
  if (!bv) foot.push(`add ${b}'s Venmo to the Members tab for Pay links`);
  const pingIds = ping ? s.pay.map(p => ids[p.name]).filter(Boolean) : [];
  return {
    content: pingIds.length ? `💸 ${pingIds.map(id => `<@${id}>`).join(' ')} settle up with ${b}` : '',
    allowed_mentions: { users: pingIds },
    embeds: [{
      title: `💸 Settle up · ${when} ${night.type === 'Tournament' ? 'tournament' : 'cash game'}`, color: 0xf1c75b,
      ...(site ? { url: `${site}/recap#${night.key}` } : {}),
      description: (`Everyone who's down Venmos **${b}**${bv ? ` (@${bv})` : ''}. ${b} pays the winners.\n\n` + parts.join('\n')).slice(0, 4000),
      ...(foot.length ? { footer: { text: foot.join(' · ') } } : {}),
    }],
  };
}
