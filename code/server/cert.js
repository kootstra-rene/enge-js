// A self-signed HTTPS certificate made with Node's crypto alone, valid for localhost and the LAN addresses.
mdlr('enge:server:cert', ({ include }) => {
  const crypto = include('[node]crypto');
  const fs = include('[node]fs/promises');
  const os = include('[node]os');
  const path = include('[node]path');

  function der(tag, value) {
    const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let length;
    if (content.length < 128) {
      length = Buffer.from([content.length]);
    } else {
      const bytes = [];
      for (let remaining = content.length; remaining; remaining >>>= 8) bytes.unshift(remaining & 0xff);
      length = Buffer.from([0x80 | bytes.length, ...bytes]);
    }
    return Buffer.concat([Buffer.from([tag]), length, content]);
  }

  const sequence = (...values) => der(0x30, Buffer.concat(values));
  const set = (...values) => der(0x31, Buffer.concat(values));
  const integer = value => {
    let bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from([value]);
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return der(0x02, bytes);
  };

  function oid(value) {
    const arcs = value.split('.').map(Number);
    const encoded = [40 * arcs[0] + arcs[1]];
    for (const arc of arcs.slice(2)) {
      const bytes = [arc & 0x7f];
      for (let remaining = Math.floor(arc / 128); remaining; remaining = Math.floor(remaining / 128)) {
        bytes.unshift(0x80 | (remaining & 0x7f));
      }
      encoded.push(...bytes);
    }
    return der(0x06, Buffer.from(encoded));
  }

  function algorithmIdentifier() {
    return sequence(oid('1.2.840.113549.1.1.11'), der(0x05, Buffer.alloc(0)));
  }

  function commonName() {
    return sequence(set(sequence(oid('2.5.4.3'), der(0x0c, Buffer.from('localhost')))));
  }

  function utcTime(date) {
    const two = value => String(value).padStart(2, '0');
    const year = date.getUTCFullYear();
    const text = `${two(year % 100)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}` +
      `${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
    return der(0x17, Buffer.from(text));
  }

  function ipv4Bytes(address) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
      throw new Error(`Invalid IPv4 address for certificate: ${address}`);
    }
    return Buffer.from(parts);
  }

  function extension(id, value, critical = false) {
    return sequence(oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), der(0x04, value));
  }

  function pem(label, bytes) {
    const base64 = bytes.toString('base64').match(/.{1,64}/g).join('\n');
    return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
  }

  function createSelfSignedCertificate(addresses = []) {
    const keys = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: 65537,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const names = [der(0x82, Buffer.from('localhost'))];
    for (const address of new Set(['127.0.0.1', ...addresses])) {
      names.push(der(0x87, ipv4Bytes(address)));
    }
    const extensions = sequence(
      extension('2.5.29.19', sequence(), true),
      extension('2.5.29.15', der(0x03, Buffer.from([5, 0xa0])), true),
      extension('2.5.29.37', sequence(oid('1.3.6.1.5.5.7.3.1'))),
      extension('2.5.29.17', sequence(...names)),
    );
    const now = new Date();
    const expiry = new Date(now);
    expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
    const name = commonName();
    const tbs = sequence(
      der(0xa0, integer(2)),
      integer(crypto.randomBytes(16)),
      algorithmIdentifier(),
      name,
      sequence(utcTime(now), utcTime(expiry)),
      name,
      keys.publicKey,
      der(0xa3, extensions),
    );
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(tbs);
    signer.end();
    const certificate = sequence(tbs, algorithmIdentifier(), der(0x03, Buffer.concat([Buffer.from([0]), signer.sign(keys.privateKey)])));
    return {
      privateKey: keys.privateKey,
      certificate: pem('CERTIFICATE', certificate),
    };
  }

  const lanAddresses = () => [...new Set(Object.values(os.networkInterfaces())
    .flatMap(interfaces => interfaces ?? [])
    .filter(({ family, internal }) => family === 'IPv4' && !internal)
    .map(({ address }) => address))];

  const fileExists = (file) => fs.access(file).then(() => true, () => false);

  const ensureTlsCertificate = async (keyFile, certFile) => {
    if (await fileExists(keyFile) && await fileExists(certFile)) {
      return;
    }
    const pems = createSelfSignedCertificate(lanAddresses());
    const resolvedKeyFile = path.resolve(keyFile);
    const resolvedCertFile = path.resolve(certFile);
    await fs.mkdir(path.dirname(resolvedKeyFile), { recursive: true });
    await fs.mkdir(path.dirname(resolvedCertFile), { recursive: true });
    const suffix = `.tmp-${process.pid}`;
    await fs.writeFile(`${resolvedKeyFile}${suffix}`, pems.privateKey, { mode: 0o600 });
    await fs.writeFile(`${resolvedCertFile}${suffix}`, pems.certificate);
    await fs.rename(`${resolvedKeyFile}${suffix}`, resolvedKeyFile);
    await fs.rename(`${resolvedCertFile}${suffix}`, resolvedCertFile);
    console.log(`generated self-signed HTTPS certificate at ${certFile}`);
  };

  return { createSelfSignedCertificate, ensureTlsCertificate, lanAddresses };
})
