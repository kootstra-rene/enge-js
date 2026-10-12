#!/usr/bin/env node
// Command line front-end for tools/unecm.js
// usage: node tools/unecm-cli.js ecmfile [outputfile]

const fs = require('node:fs');
const path = require('node:path');

// minimal mdlr shim so the browser module can be loaded in node
const modules = {};
global.mdlr = (name, factory) => {
  modules[name] = factory({ include: dependency => modules[dependency] });
};
require(path.join(__dirname, 'unecm.js'));
const { unecm } = modules['enge:tools:unecm'];

function main(argv) {
  console.error('UNECM - Decoder for Error Code Modeler format v1.0');
  console.error('Copyright (C) 2002 Neill Corlett\n');

  if (argv.length !== 1 && argv.length !== 2) {
    console.error(`usage: ${path.basename(process.argv[1])} ecmfile [outputfile]`);
    return 1;
  }

  const inFilename = argv[0];
  if (inFilename.length < 5) {
    console.error(`filename '${inFilename}' is too short`);
    return 1;
  }
  if (inFilename.slice(-4).toLowerCase() !== '.ecm') {
    console.error('filename must end in .ecm');
    return 1;
  }
  const outFilename = argv.length === 2 ? argv[1] : inFilename.slice(0, -4);

  console.error(`Decoding ${inFilename} to ${outFilename}.`);

  let input;
  try {
    input = fs.readFileSync(inFilename);
  }
  catch (e) {
    console.error(`${inFilename}: ${e.message}`);
    return 1;
  }

  let output;
  try {
    output = unecm.decode(input);
  }
  catch (e) {
    console.error(e.message);
    return 1;
  }

  try {
    fs.writeFileSync(outFilename, output);
  }
  catch (e) {
    console.error(`${outFilename}: ${e.message}`);
    return 1;
  }

  console.error(`Decoded ${input.length} bytes -> ${output.length} bytes`);
  console.error('Done; file is OK');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
