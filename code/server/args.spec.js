mdlr('[test]enge:server:args', ({ include, test }) => {
  const { describe, it, expect } = test;
  const { parseArgs } = include('enge:server:args');

  const rejects = (argv) => {
    try {
      parseArgs(argv);
    } catch (error) {
      return error.message;
    }
    return null;
  };

  describe('parseArgs', () => {
    it('should provide the defaults', async () => {
      expect(parseArgs([])).to.eql({
        port: 8000,
        docs: 'docs',
        games: 'games',
        cloud: 'cloud-data',
        tlsKey: '.enge-certs/server-key.pem',
        tlsCert: '.enge-certs/server-cert.pem',
      });
    });

    it('should read both forms of an option', async () => {
      const options = parseArgs(['--port', '8123', '--docs=public', '--tls-key', 'k.pem', '--tls-cert=c.pem']);
      expect([options.port, options.docs, options.tlsKey, options.tlsCert]).to.eql([8123, 'public', 'k.pem', 'c.pem']);
    });

    it('should refuse a bad port', async () => {
      expect(rejects(['--port', '70000'])).to.eql('Invalid port: 70000');
    });

    it('should refuse half a certificate', async () => {
      expect(rejects(['--tls-key', 'k.pem'])).to.eql('HTTPS requires both --tls-key and --tls-cert');
    });

    it('should say that plain HTTP is gone', async () => {
      expect(rejects(['--http']).startsWith('--http is gone')).to.eql(true);
    });
  });
})
