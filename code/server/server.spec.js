mdlr('[test]enge:server', ({ include, test }) => {
  const { describe, it, before, after, expect } = test;
  const fsp = include('[node]fs/promises');
  const http2 = include('[node]http2');
  const os = include('[node]os');
  const path = include('[node]path');
  const { decode } = include('core:router:url');
  const { createRouter } = include('enge:server');

  const CARD_BYTES = 128 * 1024;

  describe('the server', () => {
    let root;
    let server;
    let client;

    const request = (method, url, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
      const stream = client.request({ ':method': method, ':path': url, ...headers }, { endStream: !body });
      const chunks = [];
      let response;
      stream.on('response', (value) => { response = value; });
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve({ status: response[':status'], headers: response, body: Buffer.concat(chunks) }));
      if (body) {
        stream.end(body);
      }
    });

    const put = (url, body) => request('PUT', url, { headers: { 'content-length': body.length }, body });

    before(async () => {
      root = await fsp.mkdtemp(path.join(os.tmpdir(), 'enge-server-'));
      const docs = path.join(root, 'docs');
      const games = path.join(root, 'games');
      await fsp.mkdir(docs);
      await fsp.mkdir(path.join(games, 'Final #7 (100%)'), { recursive: true });
      await fsp.writeFile(path.join(docs, 'page.css'), 'body{}');
      await fsp.writeFile(path.join(games, 'scph1001.bin'), Buffer.alloc(8));
      await fsp.writeFile(path.join(games, 'Final #7 (100%)', 'disc.bin'), Buffer.from('0123456789'));
      await fsp.writeFile(path.join(root, 'secret.txt'), 'secret');
      const router = await createRouter({ docs, games, cloud: path.join(root, 'cloud') });
      // What the monitor does with an endpoint's router.
      server = http2.createServer();
      server.on('stream', (stream, headers) => {
        try {
          router.match(decode(`http://m${headers[':path']}`, true), stream, headers)[0]();
        } catch {
          stream.respond({ ':status': 400 });
          stream.end();
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      client = http2.connect(`http://127.0.0.1:${server.address().port}`);
    });

    after(async () => {
      client.close();
      await new Promise((resolve) => server.close(resolve));
      await fsp.rm(root, { recursive: true, force: true });
    });

    it('should serve files from the emulator and the games folder', async () => {
      const css = await request('GET', '/page.css');
      expect([css.status, css.headers['content-type'], css.body.toString()]).to.eql([200, 'text/css; charset=utf-8', 'body{}']);
      expect((await request('GET', '/scph1001.bin')).status).to.eql(200);
    });

    it('should serve a byte range of a file with an awkward name', async () => {
      const url = `/${encodeURIComponent('Final #7 (100%)')}/disc.bin`;
      const { status, headers, body } = await request('GET', url, { headers: { range: 'bytes=2-4' } });
      expect([status, body.toString()]).to.eql([206, '234']);
      expect(headers['content-range']).to.eql('bytes 2-4/10');
      expect(headers['content-length']).to.eql('3');
    });

    it('should answer an impossible range', async () => {
      const url = `/${encodeURIComponent('Final #7 (100%)')}/disc.bin`;
      const { status, headers } = await request('GET', url, { headers: { range: 'bytes=20-30' } });
      expect([status, headers['content-range']]).to.eql([416, 'bytes */10']);
    });

    it('should answer HEAD without a body', async () => {
      const { status, headers, body } = await request('HEAD', '/scph1001.bin');
      expect([status, headers['content-length'], body.length]).to.eql([200, '8', 0]);
    });

    it('should not leave its folders', async () => {
      for (const url of ['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%252fsecret.txt']) {
        expect((await request('GET', url)).status).to.eql(404);
      }
    });

    it('should answer a malformed URL and stay up', async () => {
      expect((await request('GET', '/%zz')).status).to.eql(400);
      expect((await request('GET', '/page.css')).status).to.eql(200);
    });

    it('should survive a file it can not open', async () => {
      const file = path.join(root, 'docs', 'locked.bin');
      await fsp.writeFile(file, 'x');
      await fsp.chmod(file, 0);
      expect((await request('GET', '/locked.bin')).status).to.eql(500);
      expect((await request('GET', '/page.css')).status).to.eql(200);
    });

    it('should generate the BIOS list', async () => {
      const { status, body } = await request('GET', '/bios.csv');
      expect([status, body.toString()]).to.eql([200, 'name,url\nscph1001.bin,scph1001.bin\n']);
    });

    it('should send no CORS headers, so other sites can not reach the saves', async () => {
      const { headers } = await request('GET', '/api/status');
      expect(headers['access-control-allow-origin']).to.eql(undefined);
      expect((await request('OPTIONS', '/api/state')).status).to.eql(405);
    });

    it('should refuse other methods', async () => {
      expect((await request('POST', '/api/state')).status).to.eql(405);
      expect((await request('DELETE', '/page.css')).status).to.eql(405);
    });

    it('should keep the two memory cards apart', async () => {
      expect((await request('GET', '/api/memorycard')).status).to.eql(404);
      expect((await put('/api/memorycard', Buffer.alloc(CARD_BYTES, 1))).status).to.eql(204);
      expect(JSON.parse((await request('GET', '/api/status')).body)).to.eql({ state: false, memorycard: true, memorycard2: false });
      expect((await put('/api/memorycard-2', Buffer.alloc(CARD_BYTES, 2))).status).to.eql(204);
      expect((await request('GET', '/api/memorycard')).body[0]).to.eql(1);
      expect((await request('GET', '/api/memorycard-2')).body[0]).to.eql(2);
    });

    it('should refuse a memory card of the wrong size', async () => {
      const { status, body } = await put('/api/memorycard-2', Buffer.alloc(10));
      expect([status, body.toString()]).to.eql([400, 'Memory card must be exactly 128 KB']);
    });

    it('should refuse a card that is too large', async () => {
      expect((await put('/api/memorycard', Buffer.alloc(CARD_BYTES + 1))).status).to.eql(413);
    });

    it('should store a save state, but only valid JSON', async () => {
      expect((await put('/api/state', Buffer.from('nope'))).status).to.eql(400);
      expect((await put('/api/state', Buffer.from('{"a":1}'))).status).to.eql(204);
      const { headers, body } = await request('GET', '/api/state');
      expect([headers['content-type'], body.toString()]).to.eql(['application/json', '{"a":1}']);
    });
  });
})
