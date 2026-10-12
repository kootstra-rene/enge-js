#!/usr/bin/env node
// Command line front-end for tools/ccd.js
// usage: node tools/ccd-cli.js ccdfile [outputfile.cue]

const fs = require('node:fs');
const path = require('node:path');

// minimal mdlr shim so the browser module can be loaded in node
const modules = {};
global.mdlr = (name, factory) => {
  modules[name] = factory({ include: dependency => modules[dependency] });
};
require(path.join(__dirname, 'ccd.js'));
const { ccd } = modules['enge:tools:ccd'];

function main(argv) {
  if (argv.length !== 1 && argv.length !== 2) {
    console.error(`usage: ${path.basename(process.argv[1])} ccdfile [outputfile.cue]`);
    return 1;
  }

  const ccdFilename = argv[0];
  if (path.extname(ccdFilename).toLowerCase() !== '.ccd') {
    console.error('filename must end in .ccd');
    return 1;
  }
  const baseName = ccdFilename.slice(0, -4);
  const imgFilename = `${baseName}.img`;
  const cueFilename = argv.length === 2 ? argv[1] : `${baseName}.cue`;

  try {
    // the cue references the image relative to its own location
    const imgReference = path.relative(path.dirname(path.resolve(cueFilename)), path.resolve(imgFilename)).split(path.sep).join('/');
    const { cue, descriptor } = ccd.toCue(fs.readFileSync(ccdFilename, 'latin1'), imgReference);

    if (fs.existsSync(imgFilename)) {
      const sectors = fs.statSync(imgFilename).size / ccd.SECTOR_SIZE;
      if (!Number.isInteger(sectors)) console.error(`warning: ${imgFilename} size is not a multiple of ${ccd.SECTOR_SIZE}`);
      else if (descriptor.leadout !== undefined && sectors !== descriptor.leadout) {
        console.error(`warning: ${imgFilename} has ${sectors} sectors, CCD lead-out is at ${descriptor.leadout}`);
      }
    }
    else {
      console.error(`warning: ${imgFilename} not found`);
    }

    for (const track of descriptor.tracks) {
      console.error(`  track ${String(track.number).padStart(2, '0')}: ${track.control & 0x04 ? `data (mode ${track.mode})` : 'audio'} at sector ${track.index1}`);
    }

    fs.writeFileSync(cueFilename, cue);
    console.error(`Wrote ${cueFilename} (references ${imgReference})`);
    return 0;
  }
  catch (e) {
    console.error(e.message);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
