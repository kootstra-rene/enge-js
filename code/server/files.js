// Responses on HTTP/2 streams, and static files with byte ranges for large disc images.
mdlr('enge:server:files', ({ include }) => {
  const fs = include('[node]fs/promises');
  const path = include('[node]path');

  const CONTENT_TYPES = {
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
  };

  const NO_STORE = { 'cache-control': 'no-store, max-age=0' };

  const contentType = (file) => CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

  const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

  const isOpen = (stream) => !stream.destroyed && !stream.closed;

  const send = (stream, status, type, data, headers = {}) => {
    if (!isOpen(stream)) {
      return;
    }
    if (stream.headersSent) {
      stream.close();
      return;
    }
    stream.respond({ ':status': status, 'content-type': type, 'content-length': data.length, ...NO_STORE, ...headers });
    stream.end(data);
  };

  const sendText = (stream, status, text, headers) =>
    send(stream, status, 'text/plain; charset=utf-8', Buffer.from(text), headers);

  // Null when the path leaves the folder.
  const safeJoin = (root, requestPath) => {
    if (requestPath.includes('\0')) {
      return null;
    }
    const rootPath = path.resolve(root);
    const candidate = path.resolve(rootPath, requestPath.replace(/^\/+/, ''));
    return candidate === rootPath || candidate.startsWith(`${rootPath}${path.sep}`) ? candidate : null;
  };

  const rangeFor = (header, size) => {
    if (!header) {
      return null;
    }
    if (!header.startsWith('bytes=') || header.includes(',')) {
      return { error: 'Invalid range' };
    }
    const [startText, endText] = header.slice(6).split('-', 2);
    if (startText === '') {
      const length = Number(endText);
      if (!Number.isSafeInteger(length) || length <= 0) {
        return { error: 'Invalid range' };
      }
      return { start: Math.max(0, size - Math.min(length, size)), end: size - 1 };
    }
    const start = Number(startText);
    const end = endText === '' ? size - 1 : Number(endText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      return { error: 'Invalid range' };
    }
    return { start, end: Math.min(end, size - 1) };
  };

  // Answers false when there is no such file, so the caller can try another folder.
  const serveFile = async (stream, headers, file) => {
    let stats;
    try {
      stats = await fs.stat(file);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return false;
      }
      throw error;
    }
    if (!stats.isFile()) {
      return false;
    }

    const range = rangeFor(headers.range, stats.size);
    if (range?.error) {
      sendText(stream, 416, range.error, { 'content-range': `bytes */${stats.size}` });
      return true;
    }
    if (!isOpen(stream)) {
      return true;
    }
    const response = {
      ...NO_STORE,
      ':status': range ? 206 : 200,
      'accept-ranges': 'bytes',
      'content-type': contentType(file),
      'content-length': range ? range.end - range.start + 1 : stats.size,
      ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${stats.size}` } : {}),
    };
    if (headers[':method'] === 'HEAD') {
      stream.respond(response, { endStream: true });
      return true;
    }
    stream.respondWithFile(file, response, {
      ...(range ? { offset: range.start, length: range.end - range.start + 1 } : {}),
      onError: (error) => {
        console.error(`Unable to read ${file}:`, error.message);
        sendText(stream, 500, 'Internal server error');
      },
    });
    return true;
  };

  return { contentType, httpError, safeJoin, rangeFor, send, sendText, serveFile };
})
