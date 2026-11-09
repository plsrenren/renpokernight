/**
 * Game Night Entry — a phone-friendly page for adding a night's results to the Poker Stats sheet.
 * Paste this file and Index.html into Extensions → Apps Script, then Deploy → New deployment → Web app.
 */

// ---- Settings ---------------------------------------------------------------
const SPREADSHEET_ID = '1YxoWSWgeTRrEiPlm1Ys85s4UsHKxSzpPHEssynXEytM';
const INPUT_TAB = 'Input';
const MEMBERS_TAB = 'Members';

// Optional: paste a Discord webhook URL to offer "Post to Discord" after saving.
// Keep it private: anyone with this URL can post in your channel.
const DISCORD_WEBHOOK_URL = '';
// Optional: a PIN people must type before saving (leave '' for none).
const ENTRY_PIN = '';
// Optional: link to your dashboard, added to the Discord post.
const DASHBOARD_URL = 'https://renpokernight.vercel.app';

// Input tab columns (1-based)
const COL = { date: 1, type: 2, player: 3, cashIn: 4, buys: 5, cashOut: 6, notes: 7, pnl: 8, win: 9, quarter: 10 };
const WIDTH = 10;

// ---- Page -------------------------------------------------------------------
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Game Night Entry')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

/** Rows of the Input tab that have a date and a player. */
function inputRows_(sheet) {
  const last = lastDataRow_(sheet);
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, WIDTH).getValues().filter(r => r[COL.date - 1] && r[COL.player - 1]);
}

/** Last row with a value in column A (ignores formatted or formula-only rows further down). */
function lastDataRow_(sheet) {
  const colA = sheet.getRange(1, COL.date, Math.max(sheet.getLastRow(), 1), 1).getValues();
  for (let i = colA.length - 1; i >= 0; i--) if (colA[i][0] !== '' && colA[i][0] !== null) return i + 1;
  return 1;
}

const dayKey_ = d => Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd');

/** Everything the page needs to start: players (most frequent first), defaults, options. */
function getSetup() {
  const book = ss_();
  const rows = inputRows_(book.getSheetByName(INPUT_TAB));
  const counts = {}, lastPlayed = {};
  rows.forEach(r => {
    const n = String(r[COL.player - 1]).trim(), d = dayKey_(r[COL.date - 1]);
    counts[n] = (counts[n] || 0) + 1;
    if (!lastPlayed[n] || d > lastPlayed[n]) lastPlayed[n] = d;
  });

  const status = {};
  const members = book.getSheetByName(MEMBERS_TAB);
  if (members && members.getLastRow() > 1) {
    members.getRange(2, 1, members.getLastRow() - 1, 3).getValues().forEach(r => {
      const n = String(r[0] || '').trim(); if (n) status[n] = String(r[2] || '').trim();
    });
  }
  const names = [...new Set([...Object.keys(status), ...Object.keys(counts)])];
  const players = names.map(n => ({ name: n, status: status[n] || '', games: counts[n] || 0, lastPlayed: lastPlayed[n] || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Guess tonight's buy-in from the most recent night: the most common cash-in per buy-in
  let defaultBuyIn = 40, lastNight = null;
  if (rows.length) {
    const lastKey = rows.map(r => dayKey_(r[0])).sort().pop();
    const night = rows.filter(r => dayKey_(r[0]) === lastKey);
    const per = {};
    night.forEach(r => { const b = Number(r[COL.buys - 1]) || 1; const v = Math.round(Number(r[COL.cashIn - 1]) / b * 100) / 100; per[v] = (per[v] || 0) + 1; });
    defaultBuyIn = Number(Object.keys(per).sort((a, b) => per[b] - per[a])[0]) || 40;
    lastNight = { date: lastKey, type: String(night[0][COL.type - 1]), players: night.length };
  }
  return { players, defaultBuyIn, lastNight, needsPin: !!ENTRY_PIN, discord: !!DISCORD_WEBHOOK_URL };
}

/**
 * Saves one night. payload = { pin, date: 'yyyy-mm-dd', type: 'Cash'|'Tournament',
 *   players: [{ name, buys, cashIn, cashOut, notes }], postDiscord, allowDuplicate }
 */
function saveNight(payload) {
  if (ENTRY_PIN && String(payload.pin || '') !== ENTRY_PIN) throw new Error('That PIN is not right.');
  const type = payload.type;
  if (type !== 'Cash' && type !== 'Tournament') throw new Error('Pick Cash or Tournament.');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(payload.date || '');
  if (!m) throw new Error('Pick the date of the game.');
  const date = new Date(+m[1], +m[2] - 1, +m[3]);

  const players = (payload.players || []).map(p => ({
    name: String(p.name || '').trim(),
    buys: Math.max(1, Math.round(Number(p.buys) || 1)),
    cashIn: round2_(Number(p.cashIn) || 0),
    cashOut: round2_(Number(p.cashOut) || 0),
    notes: String(p.notes || '').trim(),
  }));
  if (players.length < 2) throw new Error('Add at least two players.');
  const seen = {};
  players.forEach(p => {
    if (!p.name) throw new Error('Every player needs a name.');
    const k = p.name.toLowerCase();
    if (seen[k]) throw new Error(p.name + ' is listed twice.');
    seen[k] = true;
    if (p.cashIn < 0 || p.cashOut < 0) throw new Error('Amounts cannot be negative.');
  });

  players.forEach(p => p.net = round2_(p.cashOut - p.cashIn));
  players.sort((a, b) => b.net - a.net);
  const quarter = 'Q' + (Math.floor(date.getMonth() / 3) + 1) + ' ' + date.getFullYear();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = ss_().getSheetByName(INPUT_TAB);
    const existing = inputRows_(sheet);
    const key = dayKey_(date);
    if (!payload.allowDuplicate && existing.some(r => dayKey_(r[0]) === key)) {
      throw new Error('DUPLICATE: The sheet already has results for ' + key + '.');
    }

    const last = lastDataRow_(sheet);
    const start = last + 1, n = players.length;

    // Inputs (A:G)
    sheet.getRange(start, 1, n, 7).setValues(players.map(p => [date, type, p.name, p.cashIn, p.buys, p.cashOut, p.notes]));

    // PnL / Win / Quarter (H:J): leave columns filled by an ARRAYFORMULA in row 2 alone (any value
    // typed below it breaks the whole column with #REF!), reuse per-row formulas, otherwise write values
    const headFormulas = sheet.getRange(2, COL.pnl, 1, 3).getFormulas()[0];
    const prevFormulas = last >= 2 ? sheet.getRange(last, COL.pnl, 1, 3).getFormulas()[0] : ['', '', ''];
    const targetFormulas = sheet.getRange(start, COL.pnl, n, 3).getFormulas();
    const computed = players.map((p, i) => [p.net, i === 0, quarter]); // Win = the night's top finisher
    for (let c = 0; c < 3; c++) {
      const col = COL.pnl + c;
      if (/ARRAYFORMULA/i.test(headFormulas[c])) continue;
      if (prevFormulas[c]) {
        sheet.getRange(last, col).copyTo(sheet.getRange(start, col, n, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      } else {
        for (let i = 0; i < n; i++) {
          if (!targetFormulas[i][c]) sheet.getRange(start + i, col).setValue(computed[i][c]);
        }
      }
    }

    // Match the look of the last night of the same game type (row colors, number formats)
    let styleRow = 0;
    const types = sheet.getRange(2, COL.type, Math.max(last - 1, 1), 1).getValues();
    for (let i = types.length - 1; i >= 0; i--) if (String(types[i][0]) === type) { styleRow = i + 2; break; }
    if (!styleRow && last >= 2) styleRow = last;
    if (styleRow) sheet.getRange(styleRow, 1, 1, WIDTH).copyTo(sheet.getRange(start, 1, n, WIDTH), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  let discordPosted = false;
  if (payload.postDiscord && DISCORD_WEBHOOK_URL) {
    postDiscord_(date, type, players);
    discordPosted = true;
  }
  const totalIn = players.reduce((s, p) => s + p.cashIn, 0);
  return { saved: players.length, winner: players[0].net > 0 ? players[0].name : '', winnerNet: players[0].net, totalIn: round2_(totalIn), quarter, discordPosted };
}

function key_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE, MMM d, yyyy'); }
function round2_(n) { return Math.round(n * 100) / 100; }
function money_(n) { return (n < 0 ? '-$' : n > 0 ? '+$' : '$') + Math.abs(n).toFixed(2); }

/**
 * Posts the night to Discord. Tries the recap card image first (drawn by the dashboard site from the sheet as it
 * is right now), and falls back to a text summary if the image can't be made.
 */
function postDiscord_(date, type, players) {
  const when = key_(date), night = dayKey_(date), dayName = Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEEE');
  const site = DASHBOARD_URL ? DASHBOARD_URL.replace(/\/$/, '') : '';
  const recapPage = site ? site + '/recap#' + night : '';
  let png = null;
  if (site) {
    try {
      const res = UrlFetchApp.fetch(site + '/api/recap?night=' + night + '&type=' + encodeURIComponent(type), {
        method: 'post', contentType: 'application/json', payload: JSON.stringify({ input: inputCsv_(), members: membersCsv_() }), muteHttpExceptions: true });
      if (res.getResponseCode() === 200) png = res.getBlob().setName('recap.png');
      else console.warn('Recap image failed: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    } catch (e) { console.warn('Recap image failed: ' + e); }
  }
  if (png) {
    const embed = { title: `${dayName} Night @ The Study`, description: `${when} · ${type}`, color: 0x6e52c8, image: { url: 'attachment://recap.png' } };
    if (recapPage) embed.url = recapPage;
    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, { method: 'post', payload: { payload_json: JSON.stringify({ embeds: [embed] }), 'files[0]': png } });
    return;
  }
  // Fallback: text summary
  const pot = players.reduce((s, p) => s + p.cashIn, 0);
  const medals = ['🥇', '🥈', '🥉'];
  const embed = {
    title: `🃏 ${dayName} Night @ The Study`,
    description: `${when} · ${type} · ${players.length} players · $${pot.toFixed(2)} in play`,
    color: 0x6e52c8,
    fields: [{ name: 'Results', value: players.map((p, i) => `${medals[i] || '•'} **${p.name}** ${money_(p.net)}`).join('\n').slice(0, 1024) }],
  };
  if (recapPage || site) embed.url = recapPage || site;
  UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ embeds: [embed] }) });
}

/** The Input tab as CSV text (dates and money as shown in the sheet), for the recap image. */
function inputCsv_() {
  const sheet = ss_().getSheetByName(INPUT_TAB);
  const last = lastDataRow_(sheet);
  const values = sheet.getRange(1, 1, last, WIDTH).getDisplayValues();
  return values.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
}

/** The Members tab as CSV text (names, status, Discord IDs), so the recap image can show pfps. */
function membersCsv_() {
  const sheet = ss_().getSheetByName(MEMBERS_TAB);
  if (!sheet || sheet.getLastRow() < 1) return '';
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
  return values.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
}

/**
 * Test or re-post: pick this in the Apps Script editor's function menu and press Run to post the most recent
 * night's recap to Discord. Nothing is saved or changed in the sheet.
 */
function postLatestRecap() {
  if (!DISCORD_WEBHOOK_URL) throw new Error('Paste your Discord webhook URL into DISCORD_WEBHOOK_URL first.');
  const rows = inputRows_(ss_().getSheetByName(INPUT_TAB));
  if (!rows.length) throw new Error('No games in the sheet yet.');
  const lastKey = rows.map(r => dayKey_(r[0])).sort().pop();
  const night = rows.filter(r => dayKey_(r[0]) === lastKey);
  const type = String(night[night.length - 1][COL.type - 1]);
  const players = night.filter(r => String(r[COL.type - 1]) === type).map(r => {
    const cashIn = Number(r[COL.cashIn - 1]) || 0, cashOut = Number(r[COL.cashOut - 1]) || 0;
    return { name: String(r[COL.player - 1]).trim(), cashIn, cashOut, net: round2_(cashOut - cashIn) };
  }).sort((a, b) => b.net - a.net);
  postDiscord_(new Date(night[0][0]), type, players);
}
