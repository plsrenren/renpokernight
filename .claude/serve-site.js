// Serves poker-dashboard/vercel/index.html exactly as the hosted site will (local preview only).
const http = require('http'), fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'poker-dashboard', 'vercel', 'index.html');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
}).listen(process.env.PORT || 8767);
