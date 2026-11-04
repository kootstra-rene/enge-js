// The eNGE LAN server: the emulator, game files and cloud saves on one HTTPS port.
// Run it from the bundle in the root server.js, which `enge:server:main` starts.
mdlr('enge:server', ({ include }) => {
  const fs = include('[node]fs');
  const http2 = include('[node]http2');
  const path = include('[node]path');
  const { Router } = include('core:router');
  const { decode } = include('core:router:url');
  const { lanAddresses, ensureTlsCertificate } = include('enge:server:cert');
  const { ensureCatalogs, buildBiosCatalog } = include('enge:server:catalog');
  const { addCloudRoutes } = include('enge:server:cloud');
  const { safeJoin, send, sendText, serveFile } = include('enge:server:files');

  // The page of the [web]enge:webgl2-app module, whose bundle build.sh puts in the docs folder.
  // Its policy is the one the monitor gives this app with the exceptions from csp.json.
  const APP_PAGE = Buffer.from('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
    + '<body><webgl2-app></webgl2-app><script src="/enge-webgl2-app.js"></script></body></html>');
  const APP_HEADERS = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'credentialless',
    'cross-origin-resource-policy': 'same-site',
    'content-security-policy': [
      `default-src 'self'`,
      `connect-src 'self'`,
      `object-src 'none'`,
      // the recompiler's new Function
      `script-src 'unsafe-eval'`,
      // the audio worklet's data: URL
      `script-src-elem 'self' data:`,
      `worker-src 'self'`,
      `style-src 'none'`,
      `style-src-elem 'self'`,
      `frame-ancestors 'self'`,
      `img-src 'self'`,
      `font-src 'self'`,
      `media-src 'self'`,
    ].join('; '),
  };

  const createRouter = ({ games, cloud }) => {
    const router = new Router('server');
    router.get('/', ({ stream }) => send(stream, 200, 'text/html; charset=utf-8', APP_PAGE, APP_HEADERS));
    router.get('/bios.csv', async ({ stream }) => {
      send(stream, 200, 'text/csv; charset=utf-8', Buffer.from(await buildBiosCatalog(path.resolve(games))));
    });
    addCloudRoutes(router, path.resolve(cloud));
    return router;
  };

  // Everything without a route is a file, from the emulator's folder first and then the games.
  const serveStatic = async (stream, headers, requestPath, { docs, games }) => {
    if (headers[':method'] !== 'GET' && headers[':method'] !== 'HEAD') {
      sendText(stream, 405, 'Method not allowed');
      return;
    }
    for (const root of [docs, games]) {
      const file = safeJoin(root, requestPath);
      if (file && await serveFile(stream, headers, file)) {
        return;
      }
    }
    sendText(stream, 404, 'Not found');
  };

  const createServer = (options) => {
    const router = createRouter(options);
    const server = http2.createSecureServer({
      key: fs.readFileSync(path.resolve(options.tlsKey)),
      cert: fs.readFileSync(path.resolve(options.tlsCert)),
    });

    server.on('stream', async (stream, headers) => {
      // A browser cancels requests it no longer needs, such as read-ahead on a disc image.
      stream.on('error', (error) => console.warn(`stream: ${error.message}`));
      const address = stream.session?.socket?.remoteAddress ?? '-';
      console.log(`${address} ${headers[':method']} ${headers[':path']} Range=${headers.range ?? '-'}`);

      let descriptor;
      try {
        descriptor = decode(`https://${headers[':authority'] ?? 'localhost'}${headers[':path']}`, true);
      } catch {
        sendText(stream, 400, 'Bad request');
        return;
      }
      try {
        const [handler] = router.match(descriptor, stream, headers);
        if (handler) {
          await handler();
        }
        else {
          await serveStatic(stream, headers, descriptor.server.path, options);
        }
      } catch (error) {
        if (!error.statusCode) {
          console.error(error);
        }
        sendText(stream, error.statusCode ?? 500, error.statusCode ? error.message : 'Internal server error');
      }
    });
    return server;
  };

  const start = async (options) => {
    await ensureCatalogs(path.resolve(options.games));
    await ensureTlsCertificate(options.tlsKey, options.tlsCert);
    const server = createServer(options);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, '0.0.0.0', resolve);
    });
    console.log(`eNGE server listening on https://${lanAddresses()[0] ?? '127.0.0.1'}:${options.port}`);
    console.log(`docs=${path.resolve(options.docs)} games=${path.resolve(options.games)} cloud=${path.resolve(options.cloud)}`);
    return server;
  };

  return { createServer, start };
})

// The program. It is a module of its own because the bundle starts the module it is built for.
mdlr('enge:server:main', ({ include }) => {
  const { parseArgs } = include('enge:server:args');
  const { start } = include('enge:server');

  (async () => {
    try {
      await start(parseArgs(process.argv.slice(2)));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  })();
})
