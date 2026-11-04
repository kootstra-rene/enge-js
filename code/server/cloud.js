// Cloud saves: one save state and both memory cards, in a folder on the server.
mdlr('enge:server:cloud', ({ include }) => {
  const fs = include('[node]fs/promises');
  const path = include('[node]path');
  const { httpError, send, sendText } = include('enge:server:files');

  const MAX_STATE_BYTES = 32 * 1024 * 1024;
  const MEMORY_CARD_BYTES = 128 * 1024;

  const validateState = (data) => {
    try {
      JSON.parse(data.toString('utf8'));
    } catch {
      throw httpError(400, 'Save state must be valid JSON');
    }
  };

  const validateMemoryCard = (data) => {
    if (data.length !== MEMORY_CARD_BYTES) {
      throw httpError(400, 'Memory card must be exactly 128 KB');
    }
  };

  const MEMORY_CARD = { type: 'application/octet-stream', limit: MEMORY_CARD_BYTES, validate: validateMemoryCard };
  const TARGETS = [
    { route: '/api/state', status: 'state', file: 'state.json', type: 'application/json', limit: MAX_STATE_BYTES, validate: validateState },
    { route: '/api/memorycard', status: 'memorycard', file: 'memorycard.mcr', ...MEMORY_CARD },
    { route: '/api/memorycard-2', status: 'memorycard2', file: 'memorycard-2.mcr', ...MEMORY_CARD },
  ];

  const readBody = async (stream, headers, limit) => {
    const declaredLength = Number(headers['content-length']);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > limit) {
      throw httpError(413, 'Payload is missing or too large');
    }
    const chunks = [];
    let received = 0;
    for await (const chunk of stream) {
      received += chunk.length;
      if (received > limit) {
        throw httpError(413, 'Payload is too large');
      }
      chunks.push(chunk);
    }
    if (received !== declaredLength) {
      throw httpError(400, 'Invalid payload');
    }
    return Buffer.concat(chunks);
  };

  let writes = 0;
  const atomicWrite = async (file, data) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    writes += 1;
    const temporary = `${file}.${process.pid}.${writes}.tmp`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, file);
  };

  const exists = (file) => fs.access(file).then(() => true, () => false);

  const addCloudRoutes = (router, cloudRoot) => {
    router.get('/api/status', async ({ stream }) => {
      const found = await Promise.all(TARGETS.map(async ({ status, file }) => [status, await exists(path.join(cloudRoot, file))]));
      send(stream, 200, 'application/json', Buffer.from(JSON.stringify(Object.fromEntries(found))));
    });

    for (const { route, file, type, limit, validate } of TARGETS) {
      const target = path.join(cloudRoot, file);
      router.get(route, async ({ stream }) => {
        let data;
        try {
          data = await fs.readFile(target);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
          sendText(stream, 404, 'Nothing has been saved yet');
          return;
        }
        send(stream, 200, type, data);
      });
      router.put(route, async ({ stream, headers }) => {
        const data = await readBody(stream, headers, limit);
        validate(data);
        await atomicWrite(target, data);
        stream.respond({ ':status': 204 }, { endStream: true });
      });
    }
  };

  return { addCloudRoutes };
})
