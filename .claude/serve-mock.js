// Serves the PKO entry-page mockup as-is (local preview only).
const http = require('http'), fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'poker-entry', 'mockups', 'pko-mockup.html');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
}).listen(process.env.PORT || 8768);
