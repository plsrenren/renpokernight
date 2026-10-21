# Game Night Entry: setup

A phone-friendly page that adds one night's results to the **Input** tab of the Poker Stats sheet.

## Install (about 5 minutes, once)

1. Open the Poker Stats Google Sheet.
2. **Extensions → Apps Script.**
3. In the editor, replace everything in `Code.gs` with the contents of `Code.gs` from this folder.
   (Easiest on a computer: open the file on GitHub and use the **Copy raw file** button.)
4. Click **+** next to Files → **HTML**, name it `Index` (exactly), and paste in `Index.html`.
5. Optional settings at the top of `Code.gs`:
   - `DISCORD_WEBHOOK_URL`: paste your Discord webhook to get a "Post results to Discord" checkbox.
   - `ENTRY_PIN`: set a PIN if other people will use the link.
   - `DASHBOARD_URL`: your dashboard link, added to the Discord post (already set to https://renpokernight.vercel.app).
6. Click **Save** (disk icon).
7. **Deploy → New deployment →** gear icon → **Web app**.
   - Execute as: **Me**
   - Who has access: **Only myself**. Only your Google account can open the page; anyone else gets a Google
     "you need access" screen. (Pick **Anyone with Google account** only if others should enter results, and set a PIN then.)
8. Click **Deploy**, approve the permissions Google asks for (it is your own script), and copy the **Web app URL**.
9. Open that URL on your phone (signed in to the same Google account in the browser) and add it to your home screen.
10. Check it: save a test night, confirm the rows appear at the bottom of the **Input** tab, then delete those rows.
    The dashboard (https://renpokernight.vercel.app) picks up new rows within a minute or two.

## Using it

1. Date defaults to today. Set the buy-in amount and Cash or Tournament.
2. Tap each player's name (most frequent players first). New player? Type the name and tap Add.
3. Use − / + for rebuys; cash in fills itself (buy-ins × amount). You can overwrite it for add-ons.
   On tournament nights each player also has a **Top-up** box. It's added to their cash in
   (Cash_In in the sheet) without counting as a buy-in, and "top-up $X" is added to their note.
4. Enter each player's cash out. Leave it blank for $0.
   On tournament nights, use the **Payouts** card instead:
   - Enter the split (e.g. `70/30`, `50/30/20`) or tap a preset. The prize pool is everything bought in, top-ups included.
   - Tick **Buy-in back for 3rd** (or 4th, etc.) to return one buy-in to the next finisher. That amount comes off
     the pool first and the rest is split. The amount defaults to the buy-in; change it under "Amount back".
   - Pick who finished in each place. Their cash outs fill in, and everyone else gets $0.
   - Odd cents go to 1st so the night always balances. Untick "Fill cash outs" to type them yourself.
   - The page remembers your split and buy-in-back choice for next time.
   **PKO (progressive knockout) tournaments:** tick **PKO** under the game type and set the
   **bounty share** (50% by default, so a $40 buy-in puts a $20 bounty on each player).
   - Every buy-in, rebuys included, puts that share on the player's head. That money pays out through
     knockouts, and only the rest goes into the prize pool for the split.
   - In the **Knockouts** card, log each knockout **in the order it happened**: who busted, and who knocked them out.
     The knocker gets half the bounty in cash and the other half is added to their own bounty.
     If the busted player still has rebuys (from the − / + counter), they come back with a fresh bounty.
   - Each player shows their bounties won and the bounty on their head as you go.
     Remove a wrong knockout with ×; everything after it recalculates.
   - When only one player is left, they win and keep their own bounty.
     Tap **Fill places from knockout order** to set 1st, 2nd, 3rd from the order people were knocked out.
   - Cash outs fill in as place payout + bounty cash, and the page won't save until every knockout is logged.
   - In the sheet, Cash_Out includes bounties, and each player's note gets "PKO bounties $X" so you can tell them apart.
     Game_Type stays "Tournament", so the dashboard handles PKO nights like any other tournament.
   - The page remembers whether PKO was on and your bounty share. Knockouts are cleared for each new night.
5. The bar at the bottom shows total in, total out and the difference.
   If they don't match, you have to tick "Save anyway" first.
6. Tap **Save night**. Rows are added to Input sorted by net, with PnL, Win and Quarter filled in
   and the same row colors as previous nights of that game type.

If you close the page before saving, your entry is kept on that phone and comes back next time.
If the sheet already has rows for that date, it asks before adding more.

## Updating the code later

Paste the new code, Save, then **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**.
The URL stays the same.
