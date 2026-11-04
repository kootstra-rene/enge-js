// The eNGE backend: game files and cloud saves. The monitor serves it as a configured endpoint.
mdlr('enge:server', ({ include }) => {
  const path = include('[node]path');
  const { Router } = include('core:router');
  const { ensureCatalogs, buildBiosCatalog } = include('enge:server:catalog');
  const { addCloudRoutes } = include('enge:server:cloud');
  const { safeJoin, send, sendText, serveFile } = include('enge:server:files');

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

  const createRouter = async (options) => {
    const { docs, games, cloud } = options;
    await ensureCatalogs(path.resolve(games));

    const router = new Router('server');
    router.get('/bios.csv', async ({ stream }) => {
      send(stream, 200, 'text/csv; charset=utf-8', Buffer.from(await buildBiosCatalog(path.resolve(games))));
    });
    addCloudRoutes(router, path.resolve(cloud));

    const match = (descriptor, stream, headers) => {
      const [route] = router.match(descriptor, stream, headers);
      return [async () => {
        try {
          if (route) {
            await route();
          }
          else {
            await serveStatic(stream, headers, descriptor.server.path, { docs, games });
          }
        } catch (error) {
          if (!error.statusCode) {
            console.error(error);
          }
          sendText(stream, error.statusCode ?? 500, error.statusCode ? error.message : 'Internal server error');
        }
      }];
    };
    return { match };
  };

  return { createRouter };
})
