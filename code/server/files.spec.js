mdlr('[test]enge:server:files', ({ include, test }) => {
  const { describe, it, expect } = test;
  const { contentType, rangeFor, safeJoin } = include('enge:server:files');

  describe('rangeFor', () => {
    it('should have no range without a header', async () => {
      expect(rangeFor(undefined, 100)).to.eql(null);
    });

    it('should read byte ranges and suffix ranges', async () => {
      expect(rangeFor('bytes=10-19', 100)).to.eql({ start: 10, end: 19 });
      expect(rangeFor('bytes=90-', 100)).to.eql({ start: 90, end: 99 });
      expect(rangeFor('bytes=-10', 100)).to.eql({ start: 90, end: 99 });
    });

    it('should cut a range off at the end of the file', async () => {
      expect(rangeFor('bytes=90-200', 100)).to.eql({ start: 90, end: 99 });
    });

    it('should refuse what it can not serve', async () => {
      for (const header of ['bytes=100-110', 'bytes=5-1', 'bytes=-0', 'bytes=0-1,2-3', 'items=0-1']) {
        expect(rangeFor(header, 100)).to.eql({ error: 'Invalid range' });
      }
    });
  });

  describe('safeJoin', () => {
    it('should stay inside the folder', async () => {
      expect(safeJoin('/srv/games', '/a/b.bin')).to.eql('/srv/games/a/b.bin');
    });

    it('should refuse a path that leaves the folder', async () => {
      for (const request of ['/../secret', '/a/../../secret', '/../games-other/x']) {
        expect(safeJoin('/srv/games', request)).to.eql(null);
      }
    });

    it('should refuse a NUL byte', async () => {
      expect(safeJoin('/srv/games', '/a\0.bin')).to.eql(null);
    });
  });

  describe('contentType', () => {
    it('should fall back to binary', async () => {
      expect(contentType('a.JS')).to.eql('text/javascript; charset=utf-8');
      expect(contentType('disc.bin')).to.eql('application/octet-stream');
    });
  });
})
