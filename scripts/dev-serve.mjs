// ============================================================
//  SA RECRUITERS — scripts/dev-serve.mjs
// ============================================================
//  Tiny zero-dependency static file server (Node >= 18).
//  Serves the repo root for the Freebuff preview and makes
//  generated artifacts (e.g. security-fixes.zip, the migration
//  SQL) directly downloadable by URL.
//
//  Binds 0.0.0.0 and honors the PORT injected by the platform:
//    npm run serve          -> http://0.0.0.0:${PORT:-3000}
// ============================================================

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.toml': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Pretty URL for the admin console, matching Cloudflare Pages' /admin ->
    // admin.html behavior (and loginWithGoogle()'s redirectTo: '/admin').
    if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = resolve(join(ROOT, normalize(pathname)));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    const s = await stat(filePath).catch(() => null);
    const target = s && s.isDirectory() ? join(filePath, 'index.html') : filePath;
    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[dev-serve] serving ${ROOT} at http://${HOST}:${PORT}`);
});
