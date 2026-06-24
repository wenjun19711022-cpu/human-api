'use strict';
// FindMe — local server (zero dependencies).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('./src/api');
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res) {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const fp = path.join(PUBLIC, path.normalize(u));
  if (!fp.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(fp, (e, d) => {
    if (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream'
    });
    res.end(d);
  });
}

http.createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  serveStatic(req, res);
}).listen(PORT, () => console.log('FindMe running on http://localhost:' + PORT));
