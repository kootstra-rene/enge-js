#!/usr/bin/env node

// eNGE LAN server: emulator files, game files, and cloud saves on one port.
// The server uses Node's standard library, including crypto for HTTPS
// certificate generation.

const fs = require('node:fs');
const fsp = fs.promises;
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { URL } = require('node:url');
const { createSelfSignedCertificate } = require('./tools/self-signed-cert');

const MAX_STATE_BYTES = 32 * 1024 * 1024;
const MEMORY_CARD_BYTES = 128 * 1024;

function parseArgs(argv) {
  const options = {
    port: 8000,
    docs: 'docs',
    games: 'games',
    cloud: 'cloud-data',
    https: true,
    tlsKey: null,
    tlsCert: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--https') {
      options.https = true;
      continue;
    }
    if (argument === '--http') {
      options.https = false;
      continue;
    }
    const match = argument.match(/^--(port|docs|games|cloud|tls-key|tls-cert)=(.*)$/);
    if (match) {
      const name = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[name] = name === 'port' ? Number(match[2]) : match[2];
      continue;
    }
    if (['--port', '--docs', '--games', '--cloud', '--tls-key', '--tls-cert'].includes(argument)) {
      const name = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = argv[++index];
      options[name] = name === 'port' ? Number(value) : value;
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (Boolean(options.tlsKey) !== Boolean(options.tlsCert)) {
    throw new Error('HTTPS requires both --tls-key and --tls-cert');
  }
  if (options.https && !options.tlsKey) {
    options.tlsKey = path.join('.enge-certs', 'server-key.pem');
    options.tlsCert = path.join('.enge-certs', 'server-cert.pem');
  }
  return options;
}

function csvField(value) {
  return /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvText(entries) {
  return ['name,url', ...entries.map(entry => `${csvField(entry.name)},${csvField(entry.url)}`)].join('\n') + '\n';
}

function httpPathFor(relativePath) {
  return `/${relativePath.split(path.sep).map(segment => encodeURIComponent(segment)).join('/')}`;
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await visit(root);
  return files;
}

async function ensureGamesCatalog(gamesRoot) {
  const catalogPath = path.join(gamesRoot, 'games.csv');
  try {
    await fsp.access(catalogPath);
    console.log(`using existing games catalog: ${catalogPath}`);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const entries = [];
  for (const file of await walkFiles(gamesRoot)) {
    if (path.extname(file).toLowerCase() !== '.cue') continue;
    const relative = path.relative(gamesRoot, file);
    const parts = relative.split(path.sep);
    const name = parts.length > 1
      ? parts[0]
      : path.basename(file, path.extname(file));
    entries.push({ name, url: httpPathFor(relative) });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  await fsp.writeFile(catalogPath, csvText(entries), 'utf8');
  console.log(`created games catalog: ${catalogPath} with ${entries.length} CUE game(s)`);
}

async function buildBiosCatalog(gamesRoot) {
  const entries = [];
  const seen = new Set();
  for (const file of await walkFiles(gamesRoot)) {
    const filename = path.basename(file);
    const lower = filename.toLowerCase();
    if (!lower.startsWith('scph') && lower !== 'bios.bin' && lower !== 'openbios.bin') continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    entries.push({ name: filename, url: httpPathFor(path.relative(gamesRoot, file)) });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  return csvText(entries);
}

async function ensureBiosCatalog(gamesRoot) {
  const catalogPath = path.join(gamesRoot, 'bios.csv');
  try {
    await fsp.access(catalogPath);
    console.log(`using existing BIOS catalog: ${catalogPath}`);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const catalog = await buildBiosCatalog(gamesRoot);
  await fsp.writeFile(catalogPath, catalog, 'utf8');
  console.log(`created BIOS catalog: ${catalogPath}`);
}

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.csv': 'text/csv; charset=utf-8',
    '.cue': 'text/plain; charset=utf-8',
    '.json': 'application/json',
    '.bin': 'application/octet-stream',
    '.iso': 'application/octet-stream',
    '.mcr': 'application/octet-stream',
  }[extension] || 'application/octet-stream';
}

function safeJoin(root, requestPath) {
  const rootPath = path.resolve(root);
  const relative = requestPath.replace(/^\/+/, '');
  const candidate = path.resolve(rootPath, relative);
  return candidate === rootPath || candidate.startsWith(`${rootPath}${path.sep}`) ? candidate : null;
}

function rangeFor(header, size) {
  if (!header) return null;
  if (!header.startsWith('bytes=') || header.includes(',')) return { error: 'Invalid range' };
  const [startText, endText] = header.slice(6).split('-', 2);
  let start;
  let end;
  if (startText === '') {
    const length = Number(endText);
    if (!Number.isSafeInteger(length) || length <= 0) return { error: 'Invalid range' };
    start = Math.max(0, size - Math.min(length, size));
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Number(endText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      return { error: 'Invalid range' };
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function cors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  response.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
}

function sendText(response, status, text) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(text);
}

async function serveFile(response, request, file) {
  let stats;
  try {
    stats = await fsp.stat(file);
    if (!stats.isFile()) return false;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  const range = rangeFor(request.headers.range, stats.size);
  if (range?.error) {
    sendText(response, 416, range.error);
    return true;
  }
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', contentType(file));
  if (range) {
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
    response.setHeader('Content-Length', range.end - range.start + 1);
    if (request.method === 'HEAD') return response.end(), true;
    fs.createReadStream(file, { start: range.start, end: range.end }).pipe(response);
    return true;
  }
  response.statusCode = 200;
  response.setHeader('Content-Length', stats.size);
  if (request.method === 'HEAD') return response.end(), true;
  fs.createReadStream(file).pipe(response);
  return true;
}

async function requestBody(request, limit) {
  const declaredLength = Number(request.headers['content-length']);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > limit) {
    throw Object.assign(new Error('Payload is missing or too large'), { statusCode: 413 });
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > limit) throw Object.assign(new Error('Payload is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (received !== declaredLength) throw Object.assign(new Error('Invalid payload'), { statusCode: 400 });
  return Buffer.concat(chunks);
}

async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, data);
  await fsp.rename(temporary, file);
}

async function handleCloud(response, request, pathname, cloudRoot) {
  if (pathname === '/api/status' && request.method === 'GET') {
    const [state, memorycard] = await Promise.all([
      fsp.access(path.join(cloudRoot, 'state.json')).then(() => true).catch(() => false),
      fsp.access(path.join(cloudRoot, 'memorycard.mcr')).then(() => true).catch(() => false),
    ]);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ state, memorycard }));
    return true;
  }
  const files = {
    '/api/state': { name: 'state.json', type: 'application/json', limit: MAX_STATE_BYTES },
    '/api/memorycard': { name: 'memorycard.mcr', type: 'application/octet-stream', limit: MEMORY_CARD_BYTES },
  };
  const target = files[pathname];
  if (!target) return false;
  const file = path.join(cloudRoot, target.name);
  if (request.method === 'GET') {
    try {
      const data = await fsp.readFile(file);
      response.setHeader('Content-Type', target.type);
      response.setHeader('Content-Length', data.length);
      response.end(data);
    } catch (error) {
      if (error.code === 'ENOENT') sendText(response, 404, 'Nothing has been saved yet');
      else throw error;
    }
    return true;
  }
  if (request.method !== 'PUT') {
    response.setHeader('Allow', 'GET, PUT, OPTIONS');
    sendText(response, 405, 'Method not allowed');
    return true;
  }
  const data = await requestBody(request, target.limit);
  if (target.name === 'state.json') {
    try {
      JSON.parse(data.toString('utf8'));
    } catch {
      sendText(response, 400, 'Save state must be valid JSON');
      return true;
    }
  }
  if (target.name === 'memorycard.mcr' && data.length !== MEMORY_CARD_BYTES) {
    sendText(response, 400, 'Memory card must be exactly 128 KB');
    return true;
  }
  await atomicWrite(file, data);
  response.statusCode = 204;
  response.end();
  return true;
}

function localAddress() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const address of interfaces || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '127.0.0.1';
}

async function ensureTlsCertificate(keyFile, certFile) {
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) return;

  const addresses = [...new Set(Object.values(os.networkInterfaces())
    .flatMap(interfaces => interfaces || [])
    .filter(address => address.family === 'IPv4' && !address.internal)
    .map(address => address.address))];
  const pems = createSelfSignedCertificate(addresses);

  const resolvedKeyFile = path.resolve(keyFile);
  const resolvedCertFile = path.resolve(certFile);
  await Promise.all([
    fsp.mkdir(path.dirname(resolvedKeyFile), { recursive: true }),
    fsp.mkdir(path.dirname(resolvedCertFile), { recursive: true }),
  ]);
  const suffix = `.tmp-${process.pid}`;
  const tempKeyFile = `${resolvedKeyFile}${suffix}`;
  const tempCertFile = `${resolvedCertFile}${suffix}`;
  await Promise.all([
    fsp.writeFile(tempKeyFile, pems.privateKey, { mode: 0o600 }),
    fsp.writeFile(tempCertFile, pems.certificate),
  ]);
  try {
    await fsp.rename(tempKeyFile, resolvedKeyFile);
    await fsp.rename(tempCertFile, resolvedCertFile);
  } catch (error) {
    await Promise.allSettled([
      fsp.unlink(resolvedKeyFile),
      fsp.unlink(resolvedCertFile),
      fsp.unlink(tempKeyFile),
      fsp.unlink(tempCertFile),
    ]);
    throw error;
  }
  console.log(`generated self-signed HTTPS certificate at ${certFile}`);
}

function createServer(options) {
  const docsRoot = path.resolve(options.docs);
  const gamesRoot = path.resolve(options.games);
  const cloudRoot = path.resolve(options.cloud);
  const handler = async (request, response) => {
    cors(response);
    const protocol = options.https ? 'https' : 'http';
    const requestUrl = new URL(request.url, `${protocol}://${request.headers.host || 'localhost'}`);
    console.log(`${request.socket.remoteAddress} ${request.method} ${requestUrl.pathname} Range=${request.headers.range || '-'}`);
    try {
      if (request.method === 'OPTIONS') return response.writeHead(204).end();
      if (await handleCloud(response, request, requestUrl.pathname, cloudRoot)) return;
      if (requestUrl.pathname === '/bios.csv' && (request.method === 'GET' || request.method === 'HEAD')) {
        const data = Buffer.from(await buildBiosCatalog(gamesRoot));
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Length', data.length);
        return request.method === 'HEAD' ? response.end() : response.end(data);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendText(response, 405, 'Method not allowed');
      const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
      const docsFile = safeJoin(docsRoot, decodeURIComponent(requestedPath));
      if (docsFile && await serveFile(response, request, docsFile)) return;
      const gamesFile = safeJoin(gamesRoot, decodeURIComponent(requestedPath));
      if (gamesFile && await serveFile(response, request, gamesFile)) return;
      sendText(response, 404, 'Not found');
    } catch (error) {
      console.error(error);
      sendText(response, error.statusCode || 500, error.message || 'Internal server error');
    }
  };
  if (!options.https) return http.createServer(handler);
  return https.createServer({
    key: fs.readFileSync(path.resolve(options.tlsKey)),
    cert: fs.readFileSync(path.resolve(options.tlsCert)),
  }, handler);
}

async function start(options) {
  await ensureGamesCatalog(path.resolve(options.games));
  await ensureBiosCatalog(path.resolve(options.games));
  if (options.https) await ensureTlsCertificate(options.tlsKey, options.tlsCert);
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '0.0.0.0', resolve);
  });
  const protocol = options.https ? 'https' : 'http';
  console.log(`eNGE server listening on ${protocol}://${localAddress()}:${options.port}`);
  console.log(`docs=${path.resolve(options.docs)} games=${path.resolve(options.games)} cloud=${path.resolve(options.cloud)}`);
  return server;
}

if (require.main === module) {
  start(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildBiosCatalog,
  createServer,
  ensureBiosCatalog,
  ensureGamesCatalog,
  parseArgs,
  rangeFor,
};
