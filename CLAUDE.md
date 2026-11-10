# Ren's Poker Night: project notes for Claude

Stats for a home poker game. Results live in a Google Sheet; a dashboard website reads the sheet live;
a phone entry page (Google Apps Script) writes each night's results into the sheet.

```
Google Sheet ("Poker Stats")  <──writes──  Entry page (Apps Script web app, poker-entry/)
        │
        └──read live (CSV)──>  Dashboard (static HTML on Vercel, poker-dashboard/)
                                https://renpokernight.vercel.app
```

## Where things live

| Piece | Location |
|---|---|
| Data | Google Sheet ID `1YxoWSWgeTRrEiPlm1Ys85s4UsHKxSzpPHEssynXEytM`, shared "Anyone with the link can view" (required for the dashboard) |
| Live dashboard | Vercel project **renpokernight** (personal account `renjrsaturnino-5667`), production URL https://renpokernight.vercel.app. Root dir `poker-dashboard/vercel`, static pages + `api/` functions, no build step, framework none. Connected to GitHub repo plsrenren/renpokernight since Oct 20, 2026: merging to main deploys production, PRs get preview deploys. `vercel --prod` from the CLI also works |
| Dashboard snapshot copy | claude.ai artifact https://claude.ai/artifact/LoHQxkyWcDKsdTMdW78zpC (snapshot of the data built in; claude.ai blocks fetches to Google, so it never updates by itself) |
| Entry page | Apps Script bound to the sheet (Extensions → Apps Script). Deployed Oct 21, 2026 (access: Only myself): https://script.google.com/macros/s/AKfycbw0mcMTo7sT94TVOOKg5FHtPml5aVAIBUcRCGNGig-CPvJPpm5DiDLSxDmCdNVOUxWedg/exec . Install steps in `poker-entry/SETUP.md` |
| PKO mockup (review only) | claude.ai artifact https://claude.ai/artifact/PTZadaxo3kkgmx5wEmbr6a |

## Files

```
CLAUDE.md
poker-dashboard/
  template.html        SOURCE of the dashboard. Edit this, never the built files.
  build.ps1            Builds index.html (artifact copy, data snapshot inlined) and vercel/index.html (live-only site)
  index.html           Built: for the claude.ai artifact (old snapshot)
  src/                 Sources for the other pages: recap-src.html, hall-src.html, h2h-src.html (built into vercel/*.html
                       by inlining the logo where __LOGO__ appears) and the parts of recap-core.js:
                       cat core.part.js stories.part.js members.part.js hof.part.js card.part.js > ../vercel/recap-core.js
  vercel/              What Vercel deploys (project root dir). cleanUrls on, so /recap serves recap.html.
    index.html recap.html hall.html h2h.html entry.html (entry = redirect to the Apps Script page)
    recap-core.js      Shared logic (browser + API): parsing, recap stories, Hall of Fame, player cards, h2h, quarter wrap
    api/               Serverless functions: recap/card/hall/h2h/wrap (PNG cards via satori + resvg), avatar (Discord pfps/banners),
                       discord (slash commands endpoint; ?setup=1 registers commands), invite (who reacted to /tourney or /cash),
                       roles (results roles), _tourney.js/_roles.js/_discord.js helpers, _assets/ fonts + logo
                       blackjack: _blackjack.js (/daily /blackjack /chips, play chips in Upstash Redis via KV_REST_API_URL/TOKEN),
                       bjcards (table picture under each hand)
                       duel: _duel.js (/duel rock paper scissors or high card for the same chips; high card picture = bjcards?m=duel)
                       uth: _uth.js (/uth Ultimate Texas Hold'em vs the dealer for the same chips; table picture = bjcards?m=uth)
                       roulette: _roulette.js (/roulette shared 30s table; the opening call stays awake to spin, so discord.js maxDuration is 60) + roulette.js (wheel picture)
                       baccarat: _baccarat.js (/baccarat Player/Banker/Tie; picture = bjcards?m=bac)
                       seats: _seats.js (/seats random seat order from the latest invite's reactions) + seats.js (table picture)
    vercel.json        Function durations + included files. Env vars on Vercel: DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY
poker-entry/
  Code.gs              Apps Script server: doGet, getSetup(), saveNight(payload), Discord recap post. The live copy has the
                       private webhook URL filled in: never commit it, and never ask Renato to replace his Code.gs wholesale.
  Invite.gs            Load-from-invite, quarter wrap auto-post, roles refresh (calls the site's /api/invite, /api/wrap, /api/roles)
  Index.html           Apps Script page (phone UI). Talks to Code.gs via google.script.run
  SETUP.md             Install + usage guide for the entry page
  mockups/             pko-mockup.html (+ -artifact copy), Index.before-pko.html (rollback copy)
.claude/
  launch.json          Local preview servers (node): poker-dashboard 8765, poker-entry 8766, poker-site 8767, pko-mockup 8768
  serve*.js            Tiny node servers. serve-entry.js injects a FAKE google.script.run with sample players for testing
```

## Sheet structure

**Input** tab (one row per player per night), header row 1:
`Event_Date | Game_Type | Player_Name | Cash_In | Buy_In | Cash_Out | Notes | PnL | Win | Quarter`
- Event_Date `M/D/YYYY`; Game_Type `Cash` or `Tournament` (PKO nights are still `Tournament`)
- Cash_In = total dollars in (buy-ins + rebuys + top-ups); Buy_In = count of buy-ins incl. rebuys; Cash_Out dollars
- PnL = Cash_Out − Cash_In; Win = TRUE for the night's top net; Quarter like `Q4 2026`
- Rows colored by game type (tournament blue, cash green). H2, I2, J2 hold ARRAYFORMULAs that fill H:J for every row;
  Code.gs must never write into H:J below them (that breaks the column with #REF!; happened Oct 21, 2026).
**Members** tab: col A name, col B games played, col C status (Member / Sometimes / Guest), col D first join date.
Other tabs (Dashboard, Comparison, Hall of Fame, Blinds Schedule, Calc_Data) are not used by our code.

Reading the sheet: `https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&sheet=Input` (CORS allowed;
works from any website). Updates appear within a minute or two.

Data quirks: some cash nights don't balance exactly (e.g. Oct 2, 2026: $560 in, $555 out). Buy-in amounts vary
(e.g. Dong $149 for 4). Some Win=TRUE winners had negative-ish nights; Win is simply the top net of the night.

## Dashboard (poker-dashboard/template.html)

Plain HTML + Chart.js 4.4.1 (cdnjs). Fonts: Bricolage Grotesque (display), IBM Plex Sans (body), IBM Plex Mono (numbers).
Felt-green accent, light + dark themes via CSS tokens. Mobile-friendly.
- Homepage: Year + Quarter dropdowns (separate), **defaults to the current quarter** (latest quarter in the data).
  Tiles (total buy-ins, top winner, recent winner, cash/tournament count), buy-ins vs cash-outs bar chart,
  last-game cash in/out donuts, standings table. Mirrors the sheet's old "Dashboard" tab.
- Player page (`#player-Name` hash): playing-card style **player card** (corner = period rank as A/2..10/J/Q/K + suit,
  initials, status from Members, badges, net, 6 stats), profit-over-time line with **All / Cash / Tournament** toggle
  (toggle sits in a fixed spot on the title row), Net by night (quarter view) / Net by quarter (year/all),
  cash vs tournament table, streaks, game log with finish place. Own Year + Quarter dropdowns, **opens on current quarter**.
- Every player name, bar, and legend entry is clickable.
- Watch out: element IDs must be unique (a duplicate `pQuarter` ID once blanked the Net-by-night chart;
  the player quarter dropdown is `pQuarterSel`, the chart canvas is `pQuarter`).

**Build:** `powershell -ExecutionPolicy Bypass -File poker-dashboard\build.ps1` (Windows; it fetches Input + Members CSV
for the artifact snapshot). On another OS, the build is just string replacement of `/*__SNAPSHOT__*/`, `/*__MEMBERS__*/`,
`/*__SNAPSHOT_DATE__*/` in template.html; the Vercel copy wraps the result in `<!doctype html><html><head>…</head><body>…</body></html>`
with empty snapshots.

**Deploy to Vercel:** deploy `poker-dashboard/vercel/index.html` as `index.html` to project `renpokernight`, target production.
Options: Vercel connector `create_deployment` (inline utf-8 file, `projectSettings.framework: null`), or the CLI:
`npm i -g vercel`, then in `poker-dashboard/vercel`: `vercel link --project renpokernight` and `vercel --prod`.
After deploying, verify by downloading https://renpokernight.vercel.app and comparing bytes/SHA1 with the local file,
then open it and confirm "Live from Google Sheets" and the row count.

## Entry page (poker-entry/)

Apps Script web app, execute as owner, access "Only myself". Settings at top of Code.gs: `SPREADSHEET_ID`, `DISCORD_WEBHOOK_URL` (empty),
`ENTRY_PIN` (empty), `DASHBOARD_URL` (https://renpokernight.vercel.app).
- Pick date, buy-in amount, Cash/Tournament; tap player chips (A–Z, only players seen in the 3 months before the night's date;
  tapped chips stay in place highlighted, tap again to remove) or type a new name.
  Typed names match existing players case-insensitively; typos become new players (no "did you mean" yet).
- Per player: buy-ins − / + (cash in auto = buys × amount, overridable), cash out (blank = $0), note.
- **Tournament top-up** field per player: added to Cash_In, not counted as a buy-in, note "top-up $X".
- **Payouts card** (tournaments): split like `70/30` or presets; optional **buy-in back** to the next place
  (taken off the pool first); pick players per place; cash outs auto-fill, odd cents to 1st. Remembers split.
  Verified against the real Oct 10, 2026 night: $789 pool → $552.30 / $236.70.
- **PKO** (tournaments, optional): bounty share % of each buy-in (default 50%). Every entry incl. rebuys adds the
  starting bounty; bounty money is excluded from the prize pool. Log knockouts **in order** (victim, knocker):
  knocker gets floor(half) of victim's bounty as cash, the rest is added to the knocker's bounty; a victim with
  rebuys left restarts at the starting bounty. Last player standing keeps their own bounty. "Fill places from
  knockout order". Save is blocked until all knockouts are logged. Notes get "PKO bounties $X".
- Balance bar: total in / out / difference; unbalanced nights need "Save anyway". Duplicate dates need confirmation.
- Draft auto-saved in localStorage; PKO on/off + share remembered; knockouts cleared each night.
- Saved rows are sorted by net; formatting copied from the last row of the same game type.
- Updating after install: paste new code → Save → Deploy → Manage deployments → edit → New version → Deploy (URL unchanged).

## Testing locally

Start a server from `.claude/launch.json` (Claude's preview tools, or `node .claude/serve-entry.js`).
`poker-entry` (port 8766) uses fake data: players Renato, Kurt, Dong, Carlos, Mike, Shawn, Iverson, JP, Christian,
Kyler, Tommy, Ryan, Jerry; date 2026-10-10 simulates a duplicate; saved payloads land in `window.__saved`.
Check money logic by scripting the page (click chips, set selects, read `state` and `#tDiff`) and comparing with hand math.

## User preferences

- Wants mockups/previews **before shipping** bigger features.
- Prefers seeing results at the current quarter by default; likes the playing-card look.
- Talks casually and briefly; explain what changed and what was/wasn't verified.

## Open ideas (not done)

- Add a Discord webhook to the entry page.
- Player photos: add a "Photo" column to Members (Drive share links or direct image URLs), show on card/standings,
  fall back to initials. Photos would be public on the site.
- Per-player variable buy-ins as a list of amounts (e.g. $40 + $40 + $27) instead of count × amount.
- "Did you mean Carlos?" for near-miss names.
- Put the project in a private GitHub repo and connect it to Vercel for auto-deploys.
