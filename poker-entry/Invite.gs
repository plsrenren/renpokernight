/**
 * Invite.gs: extras for the entry page. Uses the settings at the top of Code.gs (nothing to fill in here).
 *  - loadInvite: who reacted ✅ / 🤔 on the latest /tourney or /cash invite in Discord (read by the dashboard site).
 *  - postQuarterWrapIfNew: after saving the first night of a new quarter, posts last quarter's wrap card to Discord, once.
 *  - syncRoles: after saving, moves the results roles in Discord (Quarter Leader, Heater, Cash King, ...).
 *  - memberFaces: Discord IDs from the Members tab, so the entry page can show pfps.
 */

/** { kind, date, in: [{ name, known }], maybe: [...], cant: [...] } from the site's /api/invite. link is optional. */
function loadInvite(link) {
  const site = String(DASHBOARD_URL || '').replace(/\/$/, '');
  if (!site) throw new Error('Set DASHBOARD_URL in Code.gs first.');
  const res = UrlFetchApp.fetch(site + '/api/invite' + (link ? '?link=' + encodeURIComponent(link) : ''), { muteHttpExceptions: true });
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { error: res.getContentText().slice(0, 200) }; }
  if (res.getResponseCode() !== 200) throw new Error(body.error || ('The site said ' + res.getResponseCode()));
  return body;
}

const quarterOf_ = d => { d = new Date(d); return 'Q' + (Math.floor(d.getMonth() / 3) + 1) + ' ' + d.getFullYear(); };

/** dateStr = 'yyyy-mm-dd' of the night just saved. Returns { posted, quarter }. */
function postQuarterWrapIfNew(dateStr) {
  if (!DISCORD_WEBHOOK_URL || !DASHBOARD_URL) return { posted: false };
  const [y, m, d] = String(dateStr).split('-').map(Number), night = new Date(y, m - 1, d);
  const q = quarterOf_(night), key = dayKey_(night);
  const rows = inputRows_(ss_().getSheetByName(INPUT_TAB));
  const earlierThisQuarter = rows.some(r => quarterOf_(r[COL.date - 1]) === q && dayKey_(r[COL.date - 1]) < key);
  if (earlierThisQuarter) return { posted: false };
  const prev = new Date(night.getFullYear(), night.getMonth() - 3, 1), pq = quarterOf_(prev);
  if (!rows.some(r => quarterOf_(r[COL.date - 1]) === pq)) return { posted: false };
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('wrapPosted:' + pq)) return { posted: false, quarter: pq };

  const site = DASHBOARD_URL.replace(/\/$/, '');
  const res = UrlFetchApp.fetch(site + '/api/wrap?q=' + encodeURIComponent(pq), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ input: inputCsv_(), members: membersCsv_() }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Wrap card failed: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  const embed = { title: `🏁 ${pq} wrapped`, description: `That's a wrap on ${pq} @ The Study.`, color: 0xf1c75b, url: site + '/hall', image: { url: 'attachment://wrap.png' } };
  UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, { method: 'post', payload: { payload_json: JSON.stringify({ embeds: [embed] }), 'files[0]': res.getBlob().setName('wrap.png') } });
  props.setProperty('wrapPosted:' + pq, new Date().toISOString());
  return { posted: true, quarter: pq };
}

/** After a save: asks the site to move the results roles in Discord (Quarter Leader, Heater, ...). Returns the site's report. */
function syncRoles() {
  const site = String(DASHBOARD_URL || '').replace(/\/$/, '');
  if (!site) return { changes: [], errors: [] };
  // The site only trusts this sheet with the secret key (Project Settings > Script Properties > ROLES_KEY, same value as
  // ROLES_KEY in Vercel). Without it the site still works, but reads the sheet from Google itself (a minute or two behind).
  const key = PropertiesService.getScriptProperties().getProperty('ROLES_KEY') || '';
  const res = UrlFetchApp.fetch(site + '/api/roles', {
    method: 'post', contentType: 'application/json', headers: key ? { 'X-Roles-Key': key } : {},
    payload: JSON.stringify({ input: inputCsv_(), members: membersCsv_() }), muteHttpExceptions: true });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { changes: [], errors: ['Roles: the site said ' + res.getResponseCode()] }; }
}

/** Pfps for the entry page's faces: { site, ids: { name: discordId } } from the Members tab column whose header mentions "Discord". */
function memberFaces() {
  const site = String(DASHBOARD_URL || '').replace(/\/$/, '');
  const sh = ss_().getSheetByName(MEMBERS_TAB), ids = {};
  if (!sh || sh.getLastRow() < 2) return { site, ids };
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const col = values[0].findIndex(h => /discord/i.test(h));
  if (col < 0) return { site, ids };
  values.slice(1).forEach(r => {
    const name = String(r[0] || '').trim(), id = String(r[col] || '').replace(/[^\d]/g, '');
    if (name && /^\d{17,20}$/.test(id)) ids[name] = id;
  });
  return { site, ids };
}
