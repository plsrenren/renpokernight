/**
 * Invite.gs: extras for the entry page. Uses the settings at the top of Code.gs (nothing to fill in here).
 *  - loadInvite: who reacted ✅ / 🤔 on the latest /tourney or /cash invite in Discord (read by the dashboard site).
 *  - postQuarterWrapIfNew: after saving the first night of a new quarter, posts last quarter's wrap card to Discord, once.
 *  - syncRoles: after saving, moves the results roles in Discord (Quarter Leader, Heater, Cash King, ...).
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
  const res = UrlFetchApp.fetch(site + '/api/roles', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ input: inputCsv_(), members: membersCsv_() }), muteHttpExceptions: true });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { changes: [], errors: ['Roles: the site said ' + res.getResponseCode()] }; }
}
