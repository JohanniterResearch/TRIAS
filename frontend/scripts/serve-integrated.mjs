// Isolated acceptance server: real production SPA and transparent API proxy.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as proxyRequest } from 'node:http';
import { extname, join, normalize } from 'node:path';
const root = join(import.meta.dirname, '../dist/ambulanzsystem-frontend/browser');
const target = new URL(process.env.PAKET_D_API ?? 'http://127.0.0.1:5148');
const types = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
createServer((req, res) => {
  if (req.url.startsWith('/api') || req.url.startsWith('/hubs') || req.url.startsWith('/health')) {
    const upstream = proxyRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
    return;
  }
  const requested = normalize(join(root, new URL(req.url, 'http://localhost').pathname));
  const file =
    requested.startsWith(root) && existsSync(requested) && statSync(requested).isFile()
      ? requested
      : join(root, 'index.html');
  res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(Number(process.env.PAKET_D_PORT ?? 4348), '127.0.0.1');
