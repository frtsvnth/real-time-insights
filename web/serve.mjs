// Минимальный статик-сервер для продовой сборки (без nginx и лишних зависимостей).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.join(import.meta.dirname, 'dist');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = path.normalize(path.join(DIST_DIR, urlPath));
    if (!filePath.startsWith(DIST_DIR)) filePath = DIST_DIR;
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  })
  .listen(PORT, '0.0.0.0', () => console.log(`web слушает на порту ${PORT}`));
