mdlr('enge:server:args', ({ include }) => {
  const path = include('[node]path');

  const VALUE_OPTIONS = ['port', 'docs', 'games', 'cloud', 'tls-key', 'tls-cert'];

  const camelCase = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

  const parseArgs = (argv) => {
    const options = {
      port: 8000,
      docs: 'docs',
      games: 'games',
      cloud: 'cloud-data',
      tlsKey: null,
      tlsCert: null,
    };
    const set = (name, value) => {
      options[camelCase(name)] = name === 'port' ? Number(value) : value;
    };
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === '--http') {
        throw new Error('--http is gone: the server only speaks HTTPS. Pass --tls-key and --tls-cert to use your own certificate.');
      }
      const match = argument.match(/^--([a-z-]+)=(.*)$/);
      if (match && VALUE_OPTIONS.includes(match[1])) {
        set(match[1], match[2]);
      }
      else if (argument.startsWith('--') && VALUE_OPTIONS.includes(argument.slice(2))) {
        index += 1;
        set(argument.slice(2), argv[index]);
      }
    }
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
      throw new Error(`Invalid port: ${options.port}`);
    }
    if (Boolean(options.tlsKey) !== Boolean(options.tlsCert)) {
      throw new Error('HTTPS requires both --tls-key and --tls-cert');
    }
    if (!options.tlsKey) {
      options.tlsKey = path.join('.enge-certs', 'server-key.pem');
      options.tlsCert = path.join('.enge-certs', 'server-cert.pem');
    }
    return options;
  };

  return { parseArgs };
})
