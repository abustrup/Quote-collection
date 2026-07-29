#!/usr/bin/env node
/**
 * Serve the site locally, so a change can be seen before it is published.
 *
 * The collection is a static site with no build step; the only reason this
 * exists at all is that ES modules and `fetch` refuse to work from `file://`.
 * It is therefore deliberately small — no dependencies, no watching, no
 * reloading — and it is not meant to face the internet.
 *
 * Usage:
 *   node scripts/serve.mjs [--port 8080] [--root .]
 *
 * Then open http://localhost:8080/
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}));

function parseArgs(argv) {
  const options = { port: Number(process.env.PORT) || 8080, root: REPO_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') options.port = Number(argv[i += 1]);
    else if (argv[i] === '--root') options.root = path.resolve(argv[i += 1]);
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('--port must be a number between 1 and 65535');
  }
  return options;
}

/**
 * Turn a request path into a file inside the root, or null.
 *
 * `path.resolve` collapses `..` before the prefix check, so a request for
 * `/../../etc/passwd` cannot escape — worth doing even on a personal machine,
 * because a dev server is exactly the sort of thing that gets left running.
 */
function resolvePath(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const resolved = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

async function findFile(target) {
  try {
    const stats = await stat(target);
    if (stats.isFile()) return { file: target, size: stats.size, mtime: stats.mtime };
    if (stats.isDirectory()) {
      const index = path.join(target, 'index.html');
      const indexStats = await stat(index);
      if (indexStats.isFile()) return { file: index, size: indexStats.size, mtime: indexStats.mtime };
    }
  } catch {
    return null;
  }
  return null;
}

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const { root } = server.options;
  const method = request.method ?? 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    send(response, 405, 'Only GET and HEAD are served here.\n');
    return;
  }

  const requestPath = new URL(request.url, 'http://localhost').pathname;
  const target = resolvePath(root, requestPath);
  if (target === null) {
    send(response, 403, 'Outside the site root.\n');
    return;
  }

  const found = await findFile(target);
  if (!found) {
    send(response, 404, `Nothing at ${requestPath}\n`);
    process.stdout.write(`404 ${requestPath}\n`);
    return;
  }

  // No caching at all: the whole point of running this is to look at the change
  // just made, and a cached quotes.json is a confusing way to lose ten minutes.
  response.writeHead(200, {
    'content-type': TYPES.get(path.extname(found.file).toLowerCase()) ?? 'application/octet-stream',
    'content-length': found.size,
    'cache-control': 'no-store',
    'last-modified': found.mtime.toUTCString(),
  });

  if (method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(found.file)
    .on('error', () => response.destroy())
    .pipe(response);
});

const options = parseArgs(process.argv.slice(2));
server.options = options;

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(`Port ${options.port} is already in use. Try: node scripts/serve.mjs --port 8081\n`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(options.port, () => {
  process.stdout.write(`Serving ${path.relative(process.cwd(), options.root) || '.'} at http://localhost:${options.port}/\nCtrl-C to stop.\n`);
});
