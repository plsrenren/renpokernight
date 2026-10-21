// Local preview of poker-entry/Index.html with a fake google.script.run (testing only).
const http = require('http'), fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'poker-entry', 'Index.html');
const stub = `<script>
window.__saved = [];
const players = ['Renato','Kurt','Dong','Carlos','Mike','Shawn','Iverson','JP','Christian','Kyler','Tommy','Ryan','Jerry']
  .map((n, i) => ({ name: n, status: 'Member', games: 40 - i * 3 }));
window.google = { script: { get run() {
  let ok = () => {}, fail = () => {};
  const api = {
    withSuccessHandler(f) { ok = f; return api; },
    withFailureHandler(f) { fail = f; return api; },
    getSetup() { setTimeout(() => ok({ players, defaultBuyIn: 40, lastNight: { date: '2026-10-10', type: 'Tournament', players: 9 }, needsPin: false, discord: true }), 100); },
    saveNight(p) { setTimeout(() => {
      if (p.date === '2026-10-10' && !p.allowDuplicate) return fail(new Error('DUPLICATE: The sheet already has results for 2026-10-10.'));
      window.__saved.push(p);
      const net = p.players.map(x => ({ n: x.name, v: x.cashOut - x.cashIn })).sort((a, b) => b.v - a.v);
      ok({ saved: p.players.length, winner: net[0].n, winnerNet: net[0].v, totalIn: 0, quarter: 'Q4 2026', discordPosted: p.postDiscord });
    }, 200); },
  };
  return api;
} } };
</script>`;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file, 'utf8').replace('</head>', stub + '</head>'));
}).listen(process.env.PORT || 8766);
