const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildBiosCatalog, createServer, ensureGamesCatalog, parseArgs, rangeFor } = require('./server');

test('parseArgs provides the single-port defaults and overrides', () => {
  assert.deepEqual(parseArgs(['--port', '8123', '--docs=public']), {
    port: 8123,
    docs: 'public',
    games: 'games',
    cloud: 'cloud-data',
  });
});

test('rangeFor supports byte ranges and suffix ranges', () => {
  assert.deepEqual(rangeFor('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(rangeFor('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(rangeFor('bytes=-10', 100), { start: 90, end: 99 });
  assert.equal(rangeFor('bytes=100-110', 100).error, 'Invalid range');
});

test('catalog generation finds CUE games and BIOS files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enge-server-'));
  await fs.mkdir(path.join(root, 'Tekken 2'), { recursive: true });
  await fs.writeFile(path.join(root, 'Tekken 2', 'Tekken 2.cue'), 'FILE "Tekken 2.bin" BINARY\n');
  await fs.writeFile(path.join(root, 'scph1001.bin'), Buffer.alloc(16));
  await fs.writeFile(path.join(root, 'openbios.bin'), Buffer.alloc(16));
  await ensureGamesCatalog(root);
  const games = await fs.readFile(path.join(root, 'games.csv'), 'utf8');
  const bios = await buildBiosCatalog(root);
  assert.match(games, /Tekken 2,\/Tekken%202\/Tekken%202\.cue/);
  assert.match(bios, /scph1001\.bin,\/scph1001\.bin/);
  assert.match(bios, /openbios\.bin,\/openbios\.bin/);
  await fs.rm(root, { recursive: true, force: true });
});

test('server serves byte ranges and cloud files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enge-server-'));
  const docs = path.join(root, 'docs');
  const games = path.join(root, 'games');
  const cloud = path.join(root, 'cloud');
  await fs.mkdir(path.join(docs, 'images'), { recursive: true });
  await fs.mkdir(games, { recursive: true });
  await fs.writeFile(path.join(docs, 'index.html'), '<!doctype html>');
  await fs.writeFile(path.join(docs, 'images', 'menu.svg'), '<svg></svg>');
  await fs.writeFile(path.join(games, 'test.bin'), Buffer.from('0123456789'));

  const server = createServer({ docs, games, cloud });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const rangeResponse = await fetch(`http://127.0.0.1:${port}/test.bin`, {
      headers: { Range: 'bytes=2-5' },
    });
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await rangeResponse.text(), '2345');

    const imageResponse = await fetch(`http://127.0.0.1:${port}/images/menu.svg`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/svg+xml');
    assert.equal(await imageResponse.text(), '<svg></svg>');

    const stateResponse = await fetch(`http://127.0.0.1:${port}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"version":1}',
    });
    assert.equal(stateResponse.status, 204);
    const loadedState = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(await loadedState.text(), '{"version":1}');

    const invalidCard = await fetch(`http://127.0.0.1:${port}/api/memorycard`, {
      method: 'PUT',
      body: Buffer.alloc(16),
    });
    assert.equal(invalidCard.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
