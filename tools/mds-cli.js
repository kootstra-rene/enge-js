#!/usr/bin/env node
// Command line front-end for tools/mds.js
// usage: node tools/mds-cli.js mdsfile [outputfile.bin]

const fs = require('node:fs');
const path = require('node:path');

// minimal mdlr shim so the browser module can be loaded in node
const modules = {};
global.mdlr = (name, factory) => {
  modules[name] = factory({ include: dependency => modules[dependency] });
};
require(path.join(__dirname, 'mds.js'));
const { mds } = modules['enge:tools:mds'];

function main(argv) {
  if (argv.length !== 1 && argv.length !== 2) {
    console.error(`usage: ${path.basename(process.argv[1])} mdsfile [outputfile.bin]`);
    return 1;
  }

  const mdsFilename = argv[0];
  if (path.extname(mdsFilename).toLowerCase() !== '.mds') {
    console.error('filename must end in .mds');
    return 1;
  }
  const baseName = mdsFilename.slice(0, -4);
  const binFilename = argv.length === 2 ? argv[1] : `${baseName}.bin`;
  const cueFilename = binFilename.replace(/(\.bin)?$/i, '.cue');

  try {
    const mdsData = fs.readFileSync(mdsFilename);
    const descriptor = mds.parse(mdsData);

    // "*.mdf" means: same name as the mds file, with the given extension
    const filename = descriptor.sessions[0]?.tracks[0]?.filename || '*.mdf';
    const mdfFilename = filename.startsWith('*')
      ? baseName + filename.slice(1)
      : path.join(path.dirname(mdsFilename), filename);

    console.error(`Converting ${mdfFilename} to ${binFilename}.`);
    const { bin, cue } = mds.convert(mdsData, fs.readFileSync(mdfFilename), path.basename(binFilename));

    for (const session of descriptor.sessions) {
      for (const track of session.tracks) {
        console.error(`  track ${String(track.number).padStart(2, '0')}: ${track.length} sectors of ${track.sectorSize} bytes` +
          (track.subchannelSize ? ` (${track.subchannelSize} bytes subchannel stripped)` : ''));
      }
    }

    fs.writeFileSync(binFilename, bin);
    fs.writeFileSync(cueFilename, cue);
    console.error(`Wrote ${binFilename} (${bin.length} bytes) and ${cueFilename}`);
    return 0;
  }
  catch (e) {
    console.error(e.message);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
