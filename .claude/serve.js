// Serves poker-dashboard/index.html wrapped like the artifact skeleton, for local preview only.
const http = require('http'), fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'poker-dashboard', 'index.html');
http.createServer((req, res) => {
  const body = fs.readFileSync(file, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0;font:14px system-ui}</style></head><body>' + body + '</body></html>');
}).listen(process.env.PORT || 8765);
