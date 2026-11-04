mdlr('[test]enge:server:catalog', ({ include, test }) => {
  const { describe, it, before, after, expect } = test;
  const fs = include('[node]fs/promises');
  const os = include('[node]os');
  const path = include('[node]path');
  const { buildBiosCatalog, buildGamesCatalog, ensureCatalogs } = include('enge:server:catalog');

  describe('ISO files', () => {
    let root;

    before(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'enge-iso-'));
      await fs.mkdir(path.join(root, 'Sheet'));
      await fs.writeFile(path.join(root, 'Sheet', 'sheet.cue'), 'FILE "Disc.ISO" BINARY\n  TRACK 01 MODE2/2352\n');
      await fs.writeFile(path.join(root, 'Sheet', 'disc.iso'), Buffer.alloc(2352));
      await fs.mkdir(path.join(root, 'Two'));
      await fs.writeFile(path.join(root, 'Two', 'Disc 1.iso'), Buffer.alloc(2352 * 2));
      await fs.writeFile(path.join(root, 'Two', 'Disc 2.ISO'), Buffer.alloc(2352 * 3));
      await fs.writeFile(path.join(root, 'cooked.iso'), Buffer.alloc(2048 * 4));
      await fs.writeFile(path.join(root, 'empty.iso'), '');
    });

    after(async () => {
      await fs.rm(root, { recursive: true, force: true });
    });

    it('should list raw images by their own name, without those a CUE sheet names', async () => {
      expect(await buildGamesCatalog(root)).to.eql(
        'name,url\nDisc 1,/Two/Disc%201.iso\nDisc 2,/Two/Disc%202.ISO\nSheet,/Sheet/sheet.cue\n');
    });
  });

  describe('catalogs', () => {
    let root;

    before(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'enge-catalog-'));
      await fs.mkdir(path.join(root, 'Tekken 2'));
      await fs.writeFile(path.join(root, 'Tekken 2', 'Tekken 2.cue'), 'FILE "Tekken 2.bin" BINARY\n');
      await fs.writeFile(path.join(root, 'a, "b".cue'), '');
      await fs.writeFile(path.join(root, 'scph1001.bin'), Buffer.alloc(16));
      await fs.writeFile(path.join(root, 'openbios.bin'), Buffer.alloc(16));
    });

    after(async () => {
      await fs.rm(root, { recursive: true, force: true });
    });

    it('should list the BIOS files', async () => {
      expect(await buildBiosCatalog(root)).to.eql('name,url\nopenbios.bin,/openbios.bin\nscph1001.bin,/scph1001.bin\n');
    });

    it('should write the games list, quoting and encoding names', async () => {
      await ensureCatalogs(root);
      const games = await fs.readFile(path.join(root, 'games.csv'), 'utf8');
      expect(games).to.eql('name,url\n"a, ""b""",/a%2C%20%22b%22.cue\nTekken 2,/Tekken%202/Tekken%202.cue\n');
    });

    it('should keep a list that already exists', async () => {
      await fs.writeFile(path.join(root, 'games.csv'), 'name,url\nmine,/mine.cue\n');
      await ensureCatalogs(root);
      expect(await fs.readFile(path.join(root, 'games.csv'), 'utf8')).to.eql('name,url\nmine,/mine.cue\n');
    });
  });
})
