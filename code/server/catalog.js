// The game and BIOS lists the emulator's Network section reads, as name,url CSV.
mdlr('enge:server:catalog', ({ include }) => {
  const fs = include('[node]fs/promises');
  const path = include('[node]path');

  const csvField = (value) => /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

  const csvText = (entries) =>
    ['name,url', ...entries.map(({ name, url }) => `${csvField(name)},${csvField(url)}`)].join('\n') + '\n';

  const httpPathFor = (relativePath) =>
    `/${relativePath.split(path.sep).map(segment => encodeURIComponent(segment)).join('/')}`;

  const byName = (left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });

  const walkFiles = async (root) => {
    const files = [];
    const visit = async (directory) => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
        }
        else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    };
    await visit(root);
    return files;
  };

  const buildGamesCatalog = async (gamesRoot) => {
    const entries = [];
    for (const file of await walkFiles(gamesRoot)) {
      if (path.extname(file).toLowerCase() === '.cue') {
        const relative = path.relative(gamesRoot, file);
        const parts = relative.split(path.sep);
        const name = parts.length > 1 ? parts[0] : path.basename(file, path.extname(file));
        entries.push({ name, url: httpPathFor(relative) });
      }
    }
    return csvText(entries.sort(byName));
  };

  const buildBiosCatalog = async (gamesRoot) => {
    const entries = [];
    const seen = new Set();
    for (const file of await walkFiles(gamesRoot)) {
      const filename = path.basename(file);
      const lower = filename.toLowerCase();
      const isBios = lower.startsWith('scph') || lower === 'bios.bin' || lower === 'openbios.bin';
      if (isBios && !seen.has(lower)) {
        seen.add(lower);
        entries.push({ name: filename, url: httpPathFor(path.relative(gamesRoot, file)) });
      }
    }
    return csvText(entries.sort(byName));
  };

  // An existing file is kept, so a hand-edited list survives a restart.
  const ensureCatalog = async (catalogPath, build) => {
    try {
      await fs.access(catalogPath);
      console.log(`using existing catalog: ${catalogPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await fs.writeFile(catalogPath, await build(), 'utf8');
      console.log(`created catalog: ${catalogPath}`);
    }
  };

  const ensureCatalogs = async (gamesRoot) => {
    await ensureCatalog(path.join(gamesRoot, 'games.csv'), () => buildGamesCatalog(gamesRoot));
    await ensureCatalog(path.join(gamesRoot, 'bios.csv'), () => buildBiosCatalog(gamesRoot));
  };

  return { buildBiosCatalog, buildGamesCatalog, ensureCatalogs };
})
