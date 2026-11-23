// Poker room hand histories in the browser (My hands on /poker): turns one saved hand (from GET /api/poker?hands=1, see
// _pokergame.js "Hand histories" for the event list) into replay steps, a PokerStars-style text block that trackers read
// (PokerTracker 4, Hold'em Manager 3, GTO Wizard, Hand2Note) and an easy-read text block. No storage, no network.
// The server only ever sends your own hole cards; other players' cards are in 'show' events when the table saw them.
(function (root) {
  const SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RN = { T: '10' };
  const cardText = c => (RN[c[0]] || c[0]) + SYM[c[1]];
  const money = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
  const POS_MID = { 0: [], 1: ['UTG'], 2: ['UTG', 'CO'], 3: ['UTG', 'HJ', 'CO'], 4: ['UTG', 'MP', 'HJ', 'CO'], 5: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'] };
  const STREET = ['Pre-flop', 'Flop', 'Turn', 'River'];
  const VERB = { posts: 'post', folds: 'fold', checks: 'check', calls: 'call', bets: 'bet', raises: 'raise', gets: 'get', shows: 'show', wins: 'win', 'rabbit hunts': 'rabbit hunt' };

  /** position name of seat i in hand h, counted from the button over the players dealt in */
  function posOf(h, i) {
    const order = []; for (let k = 0; k < 8; k++) { const j = (h.btn + k) % 8; if (h.seats.some(s => s.i === j)) order.push(j); }
    const n = order.length, at = order.indexOf(i); if (at < 0 || n < 2) return '';
    if (n === 2) return at === 0 ? 'BTN' : 'BB';
    return ['BTN', 'SB', 'BB', ...POS_MID[n - 3]][at] || '';
  }

  /** the events with one win line per player per pot kind (side pots won by the same player add up) */
  function events(h) {
    const out = []; let n = 0;
    h.ev.forEach(e => {
      if (e[0] === 'board') { // a run out after an all-in comes as one event: split it into flop, turn and river like a normal hand
        let cs = e[1].slice();
        while (cs.length) { const take = n === 0 ? 3 : 1; out.push(['board', cs.slice(0, take)]); cs = cs.slice(take); n += take; }
        return;
      }
      if (e[0] === 'win') { const same = out.find(x => x[0] === 'win' && x[1] === e[1] && x[3] === e[3]); if (same) { same[2] += e[2]; return; } }
      out.push(e[0] === 'win' ? e.slice() : e);
    });
    return out;
  }

  /** Plays a hand through. Returns { steps (one table state per event, for the replayer), net (your result), pot, ... } */
  function replay(h) {
    const name = {}, st = {}, start = {}; h.seats.forEach(s => { name[s.i] = s.name; st[s.i] = s.stack; start[s.i] = s.stack; });
    const bet = {}, folded = {}, label = {}, won = {}, shown = { ...h.cards };
    let pot = 0, cur = 0, board = [], board2 = null, street = 0, rabbit = null, winner = null, total = 0;
    const steps = [];
    const sum = () => Object.values(bet).reduce((a, b) => a + b, 0);
    const push = (msg, act = -1) => steps.push({ st: { ...st }, bet: { ...bet }, pot, board: board.slice(), board2: board2 && board2.slice(), folded: { ...folded }, label: { ...label }, shown: { ...shown }, msg, act, rabbit, winner });
    const collect = () => { pot += sum(); Object.keys(bet).forEach(k => delete bet[k]); cur = 0; Object.keys(label).forEach(k => { if (!folded[k]) delete label[k]; }); };
    const add = (i, a) => { st[i] -= a; bet[i] = (bet[i] || 0) + a; };
    push(`Hand #${h.n}. ${name[h.btn] || 'Seat ' + (h.btn + 1)} has the button`);
    let collected = false;
    const EV = events(h);
    EV.forEach((e, k) => {
      const [type, i] = e, nm = name[i];
      if (type === 'post') { add(i, e[2]); cur = Math.max(cur, bet[i]); label[i] = { sb: 'SB', bb: 'BB', straddle: 'Straddle', bomb: 'Bomb' }[e[3]]; push(`${nm} posts ${e[3] === 'bomb' ? 'the bomb pot' : e[3] === 'sb' ? 'the small blind' : e[3] === 'bb' ? 'the big blind' : 'a straddle'}, ${money(e[2])}`); return; }
      if (type === 'act') {
        const kind = e[2], next = EV.slice(k + 1).find(x => x[0] === 'act');
        const nx = next && !EV.slice(k + 1, EV.indexOf(next)).some(x => x[0] === 'board') ? next[1] : -1;
        if (kind === 'f') { folded[i] = true; label[i] = 'Fold'; push(`${nm} folds`, nx); }
        else if (kind === 'x') { label[i] = 'Check'; push(`${nm} checks`, nx); }
        else if (kind === 'c') { add(i, e[3]); label[i] = e[4] ? 'All in' : 'Call'; push(`${nm} calls ${money(e[3])}${e[4] ? ', all in' : ''}`, nx); }
        else { add(i, e[3] - (bet[i] || 0)); cur = e[3]; label[i] = e[4] ? 'All in' : kind === 'b' ? 'Bet' : 'Raise'; push(`${nm} ${e[4] ? 'is all in for' : kind === 'b' ? 'bets' : 'raises to'} ${money(e[3])}`, nx); }
        return;
      }
      if (type === 'board') { collect(); board.push(...e[1]); street = board.length === 3 ? 1 : board.length === 4 ? 2 : 3; push(`${STREET[street]}: ${e[1].map(cardText).join(' ')}`); return; }
      if (type === 'board2') { const base = board.slice(0, 5 - e[1].length); board2 = [...base, ...e[1]]; push(`Second board: ${e[1].map(cardText).join(' ')}`); return; }
      if (type === 'ret') { if (bet[i] >= e[2]) bet[i] -= e[2]; else { collect(); pot -= e[2]; } st[i] += e[2]; push(`${nm} gets ${money(e[2])} back (nobody called it)`); return; }
      if (type === 'show') { shown[i] = e[2]; push(`${nm} shows ${e[2].map(cardText).join(' ')}${e[3] ? ' (' + e[3] + ')' : ''}`); return; }
      if (type === 'win') {
        if (!collected) { collect(); collected = true; Object.keys(label).forEach(x => { if (!folded[x]) delete label[x]; }); }
        st[i] += e[2]; pot -= e[2]; total += e[2]; won[i] = (won[i] || 0) + e[2]; label[i] = 'Wins ' + money(won[i]); winner = winner === null ? i : winner;
        push(`${nm} ${e[3] === 'run1' ? 'wins run 1,' : e[3] === 'run2' ? 'wins run 2,' : e[3] === 'side' ? 'wins a side pot,' : e[3] === 'main' ? 'wins the main pot,' : 'wins'} ${money(e[2])}${e[4] ? ' with ' + e[4] : ''}`);
        return;
      }
      if (type === 'rabbit') { rabbit = e[1]; push(`${e[2]} rabbit hunts: ${e[1].map(cardText).join(' ')}`); return; }
      if (type === 'note') push(e[1]);
    });
    const me = h.me, wins = h.ev.filter(e => e[0] === 'win');
    return { steps, start, end: st, pot: total, board, board2, net: me >= 0 ? Math.round((st[me] - start[me]) * 100) / 100 : 0, pos: me >= 0 ? posOf(h, me) : '',
      mine: me >= 0 ? h.cards[me] : null, winners: [...new Set(wins.map(e => name[e[1]]))], showdown: h.ev.some(e => e[0] === 'show' && e[3]) };
  }

  // ---------- PokerStars-style text (what trackers import) ----------
  const etParts = ms => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value); return p; };
  const etStamp = ms => { const p = etParts(ms); return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second} ET`; };
  const cs = a => a.join(' ');
  function stars(h) {
    const name = {}; h.seats.forEach(s => { name[s.i] = s.name; });
    const L = [], bet = {}, put = {}, folded = {}, role = {};
    let cur = 0, board = [], street = 0;
    h.ev.forEach(e => { if (e[0] === 'post' && e[3] === 'sb') role[e[1]] = 'small blind'; if (e[0] === 'post' && e[3] === 'bb') role[e[1]] = 'big blind'; });
    L.push(`PokerStars Hand #${Math.floor(h.at)}: Hold'em No Limit (${money(h.sb)}/${money(h.bb)} USD) - ${etStamp(h.at)}`);
    L.push(`Table 'The Study' 8-max Seat #${h.btn + 1} is the button`);
    h.seats.forEach(s => L.push(`Seat ${s.i + 1}: ${s.name} (${money(s.stack)} in chips)`));
    const posts = h.ev.filter(e => e[0] === 'post');
    posts.forEach(e => { const i = e[1]; bet[i] = (bet[i] || 0) + e[2]; put[i] = (put[i] || 0) + e[2]; cur = Math.max(cur, bet[i]);
      L.push(e[3] === 'sb' ? `${name[i]}: posts small blind ${money(e[2])}` : e[3] === 'bb' ? `${name[i]}: posts big blind ${money(e[2])}` : e[3] === 'straddle' ? `${name[i]}: posts straddle ${money(e[2])}` : `${name[i]}: posts the ante ${money(e[2])}`); });
    L.push('*** HOLE CARDS ***');
    if (h.me >= 0 && h.cards[h.me]) L.push(`Dealt to ${name[h.me]} [${cs(h.cards[h.me])}]`);
    const after = []; // shows, wins and rets are written in tracker order at the end
    events(h).forEach(e => {
      const [type, i] = e;
      if (type === 'act') {
        const k = e[2], ai = e[4] ? ' and is all-in' : '';
        if (k === 'f') { folded[i] = street; L.push(`${name[i]}: folds`); }
        else if (k === 'x') L.push(`${name[i]}: checks`);
        else if (k === 'c') { bet[i] = (bet[i] || 0) + e[3]; put[i] = (put[i] || 0) + e[3]; L.push(`${name[i]}: calls ${money(e[3])}${ai}`); }
        else { const was = cur; put[i] = (put[i] || 0) + e[3] - (bet[i] || 0); bet[i] = e[3]; cur = e[3]; L.push(k === 'b' ? `${name[i]}: bets ${money(e[3])}${ai}` : `${name[i]}: raises ${money(e[3] - was)} to ${money(e[3])}${ai}`); }
      } else if (type === 'board') {
        Object.keys(bet).forEach(x => delete bet[x]); cur = 0;
        const old = board.slice(); board.push(...e[1]); street = board.length === 3 ? 1 : board.length === 4 ? 2 : 3;
        L.push(street === 1 ? `*** FLOP *** [${cs(board)}]` : `*** ${street === 2 ? 'TURN' : 'RIVER'} *** [${cs(old)}] [${cs(e[1])}]`);
      } else if (['board2', 'ret', 'show', 'win', 'rabbit', 'note'].includes(type)) after.push(e);
    });
    const rets = after.filter(e => e[0] === 'ret'), shows = after.filter(e => e[0] === 'show'), wins = after.filter(e => e[0] === 'win'), b2 = after.find(e => e[0] === 'board2');
    rets.forEach(e => { put[e[1]] -= e[2]; L.push(`Uncalled bet (${money(e[2])}) returned to ${name[e[1]]}`); });
    const sdShows = shows.filter(e => e[3]), sd = sdShows.length > 0;
    if (b2) L.push(`*** SECOND BOARD *** [${cs(board.slice(0, 5 - b2[1].length).concat(b2[1]))}]`);
    if (sd) { L.push('*** SHOW DOWN ***'); sdShows.forEach(e => L.push(`${name[e[1]]}: shows [${cs(e[2])}] (${e[3]})`)); }
    wins.forEach(e => L.push(`${name[e[1]]} collected ${money(e[2])} from ${e[3] === 'main' ? 'main pot' : e[3] === 'side' ? 'side pot' : 'pot'}`));
    if (!sd) { const w = wins[0] && wins[0][1], late = shows.find(e => e[1] === w); if (w !== undefined) L.push(late ? `${name[w]}: shows [${cs(late[2])}]` : `${name[w]}: doesn't show hand`); }
    const pot = wins.reduce((a, e) => a + e[2], 0);
    L.push('*** SUMMARY ***', `Total pot ${money(pot)} | Rake $0`);
    if (board.length) L.push(`Board [${cs(board)}]`);
    const won = {}; wins.forEach(e => won[e[1]] = (won[e[1]] || 0) + e[2]);
    const sdBy = {}; sdShows.forEach(e => sdBy[e[1]] = e);
    h.seats.forEach(s => {
      const i = s.i, r = role[i] ? ` (${role[i]})` : i === h.btn ? ' (button)' : '';
      let x;
      if (folded[i] !== undefined) x = `folded ${['before Flop', 'on the Flop', 'on the Turn', 'on the River'][folded[i]]}${folded[i] === 0 && !put[i] ? " (didn't bet)" : ''}`;
      else if (sdBy[i]) x = won[i] ? `showed [${cs(sdBy[i][2])}] and won (${money(won[i])}) with ${sdBy[i][3]}` : `showed [${cs(sdBy[i][2])}] and lost with ${sdBy[i][3]}`;
      else x = won[i] ? `collected (${money(won[i])})` : 'mucked';
      L.push(`Seat ${i + 1}: ${s.name}${r} ${x}`);
    });
    return L.join('\n');
  }

  // ---------- easy-read text ----------
  function plain(h) {
    const r = replay(h), me = h.me, name = {}; h.seats.forEach(s => { name[s.i] = s.name; });
    const p = etParts(h.at), when = new Date(h.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const L = [`HAND #${h.n} · ${when} · ${money(h.sb)}/${money(h.bb)}${h.test ? ' · test table' : ''}`];
    if (me >= 0 && h.cards[me]) L.push(`You (${r.pos}) were dealt ${h.cards[me].map(cardText).join(' ')}`);
    const mine = name[me];
    const you = m => mine && m.startsWith(mine + ' ') ? 'You ' + m.slice(mine.length + 1).replace(/^(posts|folds|checks|calls|bets|raises|gets|shows|wins|rabbit hunts)\b/, v => VERB[v]).replace(/^is all in/, 'are all in') : m;
    r.steps.slice(1).forEach(s => { const line = you(s.msg); L.push(/^(Flop|Turn|River|Second board)/.test(line) ? `${line}   (pot ${money(s.pot)})` : '  ' + line); });
    if (me >= 0) L.push(`  Your result: ${signed(r.net)}`);
    return L.join('\n');
  }

  /** a whole session as one file: 'stars' (trackers) or 'plain' */
  function file(hands, kind) {
    if (kind === 'stars') return hands.map(stars).join('\n\n\n') + '\n';
    const net = hands.reduce((a, h) => a + replay(h).net, 0);
    const d = hands.length ? new Date(hands[0].at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return `THE STUDY POKER ROOM · ${d} · ${hands.length} hand${hands.length === 1 ? '' : 's'} · ${signed(net)}\n\n` + hands.map(plain).join('\n\n') + '\n';
  }

  root.PokerHands = { replay, stars, plain, file, posOf, cardText, money, signed };
})(typeof window !== 'undefined' ? window : globalThis);
