
// ---------- Members tab: Discord IDs for pfps ----------
export const MEMBERS_URL = SHEET_URL.replace('sheet=Input', 'sheet=Members');
/** { playerName: discordId } from the Members tab CSV. Name is column A; the ID column is any header containing "discord". */
export function memberIds(text) {
  const rows = parseCSV(String(text || '').trim());
  if (rows.length < 2) return {};
  const col = rows[0].findIndex(h => /discord/i.test(h));
  if (col < 0) return {};
  const out = {};
  for (const r of rows.slice(1)) {
    const name = (r[0] || '').trim(), id = String(r[col] || '').replace(/[^\d]/g, '');
    if (name && /^\d{17,20}$/.test(id)) out[name] = id;
  }
  return out;
}
export const avatarUrl = id => `/api/avatar?id=${id}`;
