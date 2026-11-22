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
    index.html recap.html hall.html h2h.html casino.html shop.html poker.html entry.html (entry = redirect to the Apps Script page; casino.html = copy of src/casino-src.html;
                       shop.html = copy of src/shop-src.html, which is built from the shop mockup CSS and does NOT link lateshow.css)
    poker.html         Poker room (Nov 2026) = copy of src/poker-src.html. Host-run no-limit Hold'em, one table, 8 seats, casino chips (bj:bal).
                       Server: api/_poker.js (web/IO, /api/poker = vercel.json rewrite into discord.js?web=poker) + api/_pokergame.js (pure rules:
                       betting, side pots, timers via deadline/nextAt + client "tick", host open/pause/close). Table = one JSON in pk:t + version pk:v,
                       saved with a Lua compare-and-set (2 Redis commands per move). Live: Ably (env ABLY_API_KEY, server-side; browser gets token
                       requests limited to poker:table subscribe + poker:chat; capability must be in Ably's sorted form or the mac fails);
                       ably.min.js is self-hosted (v2.29.0). Without Ably the page polls. Hosts = Renato, admins, pitboss role. Cash-outs pay after
                       the save and add a "poker room" feed line (NOT feedCmds: no house books/rakeback). Monday cron closes a room idle 3h+.
                       Seat look = mockup style B (nameplate + angled cards; table animations Nov 21: bigger board, cards slide from the dealer seat and flip, dealt cards fly out, bets slide to the pot, pot slides to the winner with count-up, winner spotlight, bets = option D (tight casino-color chip stacks + slanted tag with the move and amount; the seat label hides while its bet is on the felt), pot = gold tag, all-in run out shown slowly via holdView (publicView.runout); all in fxAfter(), timed from a start so re-renders continue them), border/bar wash/sticker from plates.js, title on tap. Layout (Nov 20): no table talk; the open room is full browser width Hand log, Rules and Host (hosts only) are buttons at the top right of the table bar, each dropping down a panel (one at a time, stays open through updates, tap outside closes); once seated the table rotates so your seat is at the bottom (seatPos); no phone tab bar on this page (by request), phones fit one screen. Four-color deck (h red, d blue, c green, s black; class su-<suit>), hover a card to zoom it (mouse only). Signed-out visitors watch only (listen-only Ably token via GET /api/poker?token=1). Host extras (Host panel): bomb pot next hand (2/5/10 BB each, skips pre-flop), straddle on/off (mandatory 2x BB by the seat after the BB, 3+ players, acts last pre-flop), nit game (2/5/10 BB, starts with the next hand: last player without a pot win pays everyone, then it ends; new arrivals start as nits; NIT tag on seats). All three can also be set in the Open room form (cfg.straddle/bomb/nit). Bots (Host panel, Nov 21): Add bot seats a test player (ids bot:N, fake chips, rebuy at 0, act via tick/botMove, never paid); while any bot sits, every human sitting is marked test from the next hand (s.back = stack at that moment, + top-ups) and on leave/close gets exactly s.back, no feed line; Remove clears all bots.
    ably.min.js        Ably browser library (Apache 2.0), served for /poker
    loot.js            Study Cards items (195 in play; 36 pfp borders after the 9 Gemini frames were added Nov 20 2026 (overlay art = FX/UNDER svgs in loot.js, drawn on Discord with resvg in borderBox); 27 stickers after Rivered, Tilted, Last Call, Snowed In were added Nov 19 2026; t:bubble-boy retired Nov 2026 for the earned poker title: titles, pfp borders, overall bars, stickers; RETIRED ids stay in BY_ID but leave packs/loadout/cards, owners get the dupe refund once via loadout()), odds 55/30/11/4, duplicate refunds, pack designs,
                       Champion borders (CHAMP, champItem, championsFrom: ids c:<ovr|cash|tour>:<Q4-2026|2026>, earned from the sheet for every finished quarter/year,
                       never stored or sold; equip checks champsFor() in _shop.js; slanted date tab + icon, year versions get a foil sheen on the site),
                       border decorations (DECO), sticker SVGs, and LOOK (simplified looks for the Discord images). ES module used by the
                       browser (/shop, dashboard card) and the API. Item ids are slot letter + key, e.g. t:coin-flip-merchant, b:btn, o:sunset, s:shark
    cosmetics.css      Border/bar/sticker/title CSS for the dashboard player card and /shop (champion borders .cb-champ-*) (.cbw.cb-<key>, .cbar-<key>, .cos-stk, .cos-ttl); every selector starts with html
    lateshow.css       "Late Show" look (Nov 2026), linked last on every page; every selector is prefixed with html so it beats
                       the page's own <style> (which sits in <body>)
    recap-core.js      Shared logic (browser + API): parsing, recap stories, Hall of Fame, player cards, h2h, quarter wrap
    api/               Serverless functions: recap/card/hall/h2h/wrap (PNG cards via satori + resvg, all drawn by _late.js = Late Show design),
                       ALL picture endpoints (recap/card/hall/h2h/wrap/bjcards/seats/roulette) are ONE function, api/img.js, reached by vercel.json rewrites
                       (/api/recap -> /api/img?fn=recap); the code sits in _recap.js _card.js _hall.js _h2h.js _wrap.js _bjcards.js _seatsimg.js _wheel.js.
                       Why (Nov 20 2026): every deployment stores each function with its own satori+resvg copy; 203 deployments hit 75% of Hobby's
                       10 GB Function Storage. Don't add new picture functions: add a case to img.js. vercel.json ignoreCommand skips deploys when
                       nothing under poker-dashboard/vercel changed (entry-page-only PRs don't deploy). avatar (Discord pfps/banners; &anim=1 = animated GIF pfp, used only on player cards),
                       discord (slash commands endpoint; ?setup=1 registers commands), invite (who reacted to the latest /game invite; /game type:Tournament|Cash replaced /tourney + /cash on Nov 21 2026, old names still answered),
                       roles (results roles + chip rewards; trusts a POSTed sheet only with header X-Roles-Key = env ROLES_KEY, which Invite.gs reads from
                       Script Properties; otherwise reads Google's copy), _tourney.js/_roles.js/_discord.js helpers, _assets/ fonts + logo
                       blackjack: _blackjack.js (/daily /blackjack /freebet /chips; splits up to 6 hands (MAX_HANDS) in both games; /freebet = mode 'free' on the same hand code:
                       free double hard 9-11, free split any pair but 10s, dealer hits soft 17, dealer 22 pushes, Push 22 side bet 11:1 (g.side, max 25), hand.free = house money;
                       site table #freebet (cas:cur fb), feed game name "free bet"; play chips in Upstash Redis via KV_REST_API_URL/TOKEN; daily resets once a day at 16:00 UTC, not 24h after the last claim; first claim of each week (Monday 16:00 UTC on) pays WEEKLY_CLAIM $100, the rest DAILY $50, no separate welcome bonus),
                       bjcards (table picture under each hand)
                       pictures: _attach.js draws the bjcards/roulette picture inside the discord.js reply and uploads it as attachment://table.png
                       (multipart), so Discord doesn't fetch it afterwards; falls back to the /api/bjcards link if drawing runs past ~1.8s.
                       Late replies (Nov 22 2026): if a casino reply isn't ready ~2.4s after Discord sent the tap (timed from the interaction id, so cold
                       starts count), discord.js inTime() defers (6/5) and finishLate() edits/follows up through the webhook. Blackjack + UTH buttons
                       carry the hand step (bj|uth:<act>:<id>:<step>): an older step changes nothing and redraws the table; Play again twice re-shows
                       the hand it already dealt (g.next) instead of charging another Game code keeps
                       building the link URLs as before; discord.js POST wraps casino replies with withPicture(), roulette's spin edit uses attachPicture()
                       duel: _duel.js (/duel rock paper scissors or high card for the same chips; high card picture = bjcards?m=duel; both stakes taken in one Lua step;
                       RPS: "Call it off" refunds both after 3 min, sweepDuels refunds duels stuck 30+ min (run on /duel and /daily, du:live hash))
                       uth: _uth.js (/uth Ultimate Texas Hold'em vs the dealer for the same chips; no 3x pre-flop bet (only 4x or check), by request; table picture = bjcards?m=uth)
                       roulette: _roulette.js (/roulette shared 30s table; the opening call stays awake to spin, so discord.js maxDuration is 60; a table that never spun
                       is spun by the next tap, New round or /roulette for up to a day) + roulette.js (wheel picture)
                       baccarat: _baccarat.js (/baccarat Player/Banker/Tie; picture = bjcards?m=bac)
                       seats: _seats.js (/seats random seat order from the latest invite's reactions) + seats.js (table picture)
                       info: _info.js (/info posts the 2-card welcome post (links + Start here) as a normal bot message in that channel, for #info + pin; running it again in that channel edits the same post (id in Redis info:msg:<channel>), so wording changes = edit _info.js, deploy, /info; pitbosses/Renato/admins only)
                       channels: _channels.js (casino commands only in #casino, poker commands only in #the-table, matched by channel name; wrong channel = ephemeral "lives in #x" hint; /fish /donkey anywhere; no such channel = allowed anywhere)
                       casino: _casino.js (site /casino page: Discord sign-in + blackjack/UTH/baccarat/daily with the same bj:bal chips;
                       /api/login and /api/casino are vercel.json rewrites into discord.js?web=, so no extra function. Env DISCORD_CLIENT_SECRET,
                       redirect https://renpokernight.vercel.app/api/login in the Developer Portal. Game rules stay in the _game.js files, shared)
                       rewards: _rewards.js (casino chips for real nights: RSVP/showed up/places/bad beat (on top of consolation)/consolation/PKO/Heater/cold streak/comeback/giant killer/rebuy grit/bring a friend ("brought by X" note on a first-timer)/quarter champ/most improved; listed in the casino lobby (folded bar, 3 groups) via REWARD_LIST; cas:feed (300 kept) gets bj/uth/baccarat hands, roulette spins, duels, daily claims, rewards, and the lobby rolls a player's run of hands in one game (gaps under 10 min) into one "session line" (groupFeed in _casino.js); amounts in R, only nights from REWARDS_START; run by api/roles.js after each entry-page save, then posts a plain-text "who got what" note in the #casino Discord channel (channel id cached in rw:chan; bot needs Send Messages there);
                       recomputed from the sheet and diffed against rw:paid, so re-saves pay only the difference; a night missing from the sheet entirely is never clawed back. Not in the recap post, by request)
                       shop: _shop.js (Study Cards: /pack $100 for 3 cosmetics, tear + flip buttons, third card Uncommon+, duplicates refund chips;
                       /loadout (ephemeral menus) and /tip user amount note (moves bj:bal chips, atomic Lua script). Every game takes bets with takeChips() (DEBIT Lua in _blackjack.js: check + take in one step);
                       never read the balance and then HINCRBYFLOAT a bet separately. Chip slash commands use the in-memory sheet copy, never wait on Google (3s limit). Keys sh:own:<id>, sh:eq, sh:packs, sh:pk:<pack> (7 days), sh:open:<id> (packs with face-down cards). Cards land in sh:own at purchase but stay out of loadout/menus/equip until flipped (hiddenCards); /shop resumes a half-open pack (POST {a:reveal}).
                       Site /shop talks to /api/shop = vercel.json rewrite into discord.js?web=shop (shopWeb); /api/login?to=shop returns to /shop.
                       Pack + card images = bjcards?m=pack|cards (_shopimg.js); equipped items drawn on /player (_late.js) and the dashboard card)
                       house books + rakeback: every house-game hand (blackjack, free bet, UTH, baccarat, roulette) goes through feedCmds(me, game, net, wager), which also
                       counts hs:all / hs:wk:<week> (house win per game) and rb:wk:<week> (player net) + rb:vol:<week> (player total bet). <week> = Monday's date, weeks start Monday 16:00 UTC.
                       _rakeback.js pays last week once (rb:done:<week>): 10% of net loss + 0.25% of all bets, max $250 (RAKE in _blackjack.js), then posts amounts only in #casino
                       (never show anyone's losses, by request). Run by the Vercel cron Mondays 16:00 UTC -> /api/roles?rakeback=1. Lobby + /chips show "rakeback so far". /earn = public "how to earn chips" (amounts from REWARD_LIST, FIRST_CLAIM/DAILY, RAKE.cap, TICKET). /house = ephemeral
                       house books (pitbosses, Renato, admins only; inviteBlocked(..., strict)). New house games must pass the wager to feedCmds
                       lottery: _lottery.js (quarter lottery: 1 ticket per $10 of Cash_In in the quarter, jackpot = all buy-ins 1:1 in chips;
                       drawn by hand with /lottery draw (host only, live ticket roll in Discord, draws the last finished quarter once), Lucky Ticket role (_roles.js);
                       /lottery odds|draw, lobby prize wheel with pfps (spins to the winner once per viewer), lobby panel, card at /api/wrap?lottery=<quarter>, spinning wheel GIF at /api/wrap?lottery=<quarter>&spin=1 (_wheelgif.js; no spare function slot). Some names are shown
                       with tickets but never drawn (SKIP in _lottery.js), by request: don't mention it anywhere user-facing)
                       accolades: _accolades.js + ACC in loot.js (42 earned items, ids a:<k>, tier 'Earned', never in packs, all kept forever): 24 casino (5 borders, 16 titles, 3 stickers: Whale, Natural, Lucky Ticket)
                       + 18 home poker (poker: 1; 4 borders, 13 titles, 1 sticker (Monster Night); Got the Milk only counts nights from MILK_FROM 2026-09-19, not retroactive) worked out from the sheet by pokerFrom(), checkPoker() in roles.js after each night + Monday cron, notes in #the-table.
                       First run of each set (ac:init / ac:pinit) hands out already-earned ones SILENTLY, by request; only later unlocks post.
                       Hand counter (invisible to players): feedCmds() also bumps ac:n:<id> (hands per game, daily, tips received, naturals, royal, believer)
                       and adds the player to ac:dirty; discord.js runs checkAccolades() after each answer (waitUntil), roles.js after each night and
                       the Monday cron (plus weeklyAccolades() for High Roller/Beat the House/Whale/Regular, each week once via ac:wk:<week>).
                       Stamped in ac:own:<id> (kept forever). Chip Leader (live #1 border) was REMOVED by request: accolades are only things people keep forever.
                       Earned overall bars (Nov 2026, 10, ids a:<k>, slot 'Overall bar', key acc-<k>, CSS .cbar-acc-<k> in cosmetics.css, Discord look = ACC .look copied into LOOK.bar): poker Hot Streak, Podium, Highlight Reel, Ironman, Glow Up (pokerFrom; new poker sets are handed out quietly once via ac:pinit:<POKER_SET>) + casino Hot Shoe, Heavy Hitter, Unbeaten, Hot Table, Clean Sweep (ac:n bjbest/rlbest/dubest via the STREAK Lua in statCmds, heavy, sweep). Only the 4 hardest shimmer (shine: 1), by request.
                       Unlocks post a short note in #casino. No accolades page, by request: the note (why, 24 chars max) replaces the rarity line in /loadout + /shop tiles
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
  last-game cash in/out donuts, standings table.
  The buy-ins vs cash-outs chart has an **All / Reg Only** toggle (Reg Only = Members-tab status "Member"; remembered per browser). Mirrors the sheet's old "Dashboard" tab.
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
- Late Show look (Nov 20 2026, same tokens as the site). Pick date, buy-in amount, Cash/Tournament; tick players on a CHECKLIST
  (Members-tab people only, grouped Regulars/Sometimes/Guests by status, guests folded, most recent first, search box; tap again
  to remove; no pictures, by request) or add a first-timer by name. Load from invite ticks reactors ("reacted").
  A first-timer's row asks "Who brought X?" (name buttons) and saving adds "brought by X" to their note (bring-a-friend chips).
  GOTCHA: Google's page server strips "//" comments naively, INCLUDING inside `template strings` (it knows '' and "" only).
  A URL in a template string killed the whole page on Nov 20 2026 ("missing ) after argument list"). Never put "//" inside a
  template string in Index.html; build URLs with +. A hidden red "Problem:" line under the title shows page errors.
  memberFaces() in Invite.gs (Discord IDs) is unused since the checklist replaced the faces.
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
