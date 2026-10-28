#!/usr/bin/env node
'use strict';

// Run one PlayStation executable in eNGE without a browser, the way
// PCSX-Redux runs it with `-no-ui -run -stdout -testmode -loadexe`:
//
//   node tests/nugget/headless.js --bios openbios.bin [options] test.ps-exe
//
// The emulator modules under code/ are loaded unbundled into this process.
// The browser pieces they touch (DOM, storage, audio, the WebGL canvas) are
// replaced by small stand-ins. Two things the test programs rely on from
// PCSX-Redux are provided here:
//
//   - TTY output: BIOS putchar (A0:3Ch, B0:3Dh) and the PCSX-Redux debug
//     port byte at 1F802080h are written to stdout.
//   - exit: a 16-bit write to 1F802082h (pcsx_exit) ends the run, and the
//     value written becomes this process's exit code.
//
// Options:
//   --bios <file>        BIOS image (required), e.g. nugget's openbios.bin
//   --timeout <seconds>  wall-clock limit, default 60; exit 124 when hit
//   --renderer <mode>    auto (default), webgl or stub. webgl uses the real
//                        WebGL 1 renderer through the optional `gl` package
//                        (headless-gl, needs a display such as Xvfb); stub
//                        keeps eNGE's CPU-side VRAM mirror and drops draws.
//   --quiet              no harness diagnostics on stderr
//
// Exit codes: the program's own pcsx_exit code, 124 on timeout, 70 when the
// emulator stopped with an error.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CODE = path.join(ROOT, 'code');

const EXIT_TIMEOUT = 124;
const EXIT_EMULATOR = 70;

const usage = () => {
  process.stderr.write('usage: headless.js --bios <bios.bin> [--timeout s] [--renderer auto|webgl|stub] [--quiet] <exe>\n');
  process.exit(2);
};

const parseArgs = argv => {
  const options = { bios: null, timeout: 60, renderer: 'auto', quiet: false, exe: null };
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i];
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? argv[++i];
    switch (name) {
      case '--bios': options.bios = value(); break;
      case '--timeout': options.timeout = Number(value()); break;
      case '--renderer': options.renderer = value(); break;
      case '--quiet': options.quiet = true; break;
      case '--help': case '-h': usage(); break;
      default:
        if (arg.startsWith('-')) usage();
        options.exe = arg;
    }
  }
  if (!options.bios || !options.exe || !(options.timeout > 0)) usage();
  if (!['auto', 'webgl', 'stub'].includes(options.renderer)) usage();
  return options;
};

const options = parseArgs(process.argv.slice(2));
const note = (...args) => { if (!options.quiet) process.stderr.write(`[enge] ${args.join(' ')}\n`); };

// ---------------------------------------------------------------------------
// Output: TTY bytes go straight to stdout, unbuffered by line so a hang still
// shows what was printed before it.

let ttyBuffer = [];
const tty = byte => {
  ttyBuffer.push(byte & 0xff);
  if (byte === 10 || ttyBuffer.length >= 4096) flushTty();
};
const flushTty = () => {
  if (!ttyBuffer.length) return;
  fs.writeSync(1, Buffer.from(ttyBuffer));
  ttyBuffer = [];
};

// ---------------------------------------------------------------------------
// Browser stand-ins.

const noop = () => { };
const element = () => ({
  style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  addEventListener: noop, removeEventListener: noop, setAttribute: noop, appendChild: noop,
  click: noop, querySelector: () => null, querySelectorAll: () => [],
});

const storage = new Map();
const localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear(),
};

class AudioContextStub {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
  }
  createGain() { return { connect: noop, gain: { value: 1, setValueAtTime: noop } }; }
  createScriptProcessor() { return { connect: noop, disconnect: noop }; }
  resume() { return Promise.resolve(); }
}

let display = null; // canvas for the webgl renderer

Object.assign(globalThis, {
  window: globalThis,
  localStorage,
  AudioContext: AudioContextStub,
  requestAnimationFrame: noop,
  cancelAnimationFrame: noop,
  alert: message => note('alert:', message),
  document: {
    baseURI: 'file:///',
    visibilityState: 'visible',
    scripts: [],
    title: '',
    addEventListener: noop,
    removeEventListener: noop,
    createElement: element,
    getElementById: id => (id === 'display' ? display : null),
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  addEventListener: noop,
  removeEventListener: noop,
});
// rec.js prints throughput every emulated second when served from file://
globalThis.location = { href: 'http://localhost/', search: '', protocol: 'http:' };
try { globalThis.navigator.getGamepads = () => []; } catch { /* read-only navigator */ }

// The PS-EXE and BIOS are handed to eNGE through its own loaders, which fetch.
globalThis.fetch = async url => {
  const file = url instanceof URL ? url : new URL(url, 'file:///');
  const data = fs.readFileSync(file.protocol === 'file:' ? decodeURIComponent(file.pathname) : String(url));
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return { ok: true, status: 200, arrayBuffer: async () => buffer };
};

// ---------------------------------------------------------------------------
// Renderer.

const createGlCanvas = () => {
  let createContext;
  try {
    createContext = require('gl');
  } catch {
    return null;
  }
  const gl = createContext(1024, 512, { preserveDrawingBuffer: true });
  if (!gl) return null;
  const ext = gl.getExtension('STACKGL_resize_drawingbuffer');
  const limit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096;
  const clamp = value => Math.max(1, Math.min(limit, value | 0));
  // The display canvas is resized for every video mode change, sometimes to
  // 0 while a mode is being set up; headless-gl rejects that, a browser
  // does not. Nothing is read back from the default framebuffer.
  const resize = () => { try { ext?.resize(clamp(width), clamp(height)); } catch { /* keep the old size */ } };
  let width = 1024, height = 512;
  return {
    ...element(),
    getContext: type => (type === 'webgl' || type === 'experimental-webgl' ? gl : null),
    get width() { return width; },
    set width(value) { width = value; resize(); },
    get height() { return height; },
    set height(value) { height = value; resize(); },
    clientWidth: 1024,
    clientHeight: 512,
  };
};

// Draws are dropped; uploads and readbacks use the same CPU-side VRAM mirror
// the WebGL renderer keeps (enge-webgl.js loadImage/storeImage).
const createStubRenderer = () => {
  const vram = new Uint16Array(1024 * 512);
  return {
    fpsRenderCounter: 0,
    fpsCounter: 0,
    vram,
    loadImage(x, y, w, h, buffer) {
      let o = 0;
      for (let j = 0; j < h; ++j) {
        const offsetY = ((y + j) % 512) * 1024;
        for (let i = 0; i < w; ++i) buffer[o++] = vram[offsetY + ((x + i) % 1024)];
      }
    },
    storeImage(img) {
      const data = img.buffer;
      let o = 0;
      for (let j = 0; j < img.h; ++j) {
        const offsetY = ((img.y + j) % 512) * 1024;
        for (let i = 0; i < img.w; ++i) vram[offsetY + ((img.x + i) % 1024)] = data[o++];
      }
    },
    moveImage(sx, sy, dx, dy, w, h) {
      const copy = new Uint16Array(w * h);
      this.loadImage(sx, sy, w, h, copy);
      this.storeImage({ x: dx, y: dy, w, h, buffer: copy });
    },
    getVramState: () => new Uint16Array(vram),
    setVramState: buffer => vram.set(buffer),
    onVBlankBegin() { ++this.fpsCounter; },
    onVBlankEnd: noop,
    drawLine: noop, drawRectangle: noop, drawTriangle: noop, fillRectangle: noop,
    setDrawAreaTL: noop, setDrawAreaBR: noop, setDrawAreaOF: noop, updateDrawArea: noop,
    setMode: noop,
  };
};

// ---------------------------------------------------------------------------
// Module loader compatible with the mdlr bundler: modules are registered by
// id and every include runs the factory again (mdlr does not cache).

const registry = new Map();
const moduleId = id => id.replace(/^\[(?:unit|mdlr)\]/, '');
globalThis.mdlr = (id, factory) => {
  if (typeof factory === 'function') registry.set(moduleId(id), factory);
};
const include = id => {
  const factory = registry.get(moduleId(id));
  if (!factory) throw new Error(`Module not found: ${id}`);
  return factory({ module_id: id, include });
};

mdlr('base64', () => ({
  decode: text => new Uint8Array(Buffer.from(text, 'base64')),
  encode: data => Buffer.from(data.buffer ?? data).toString('base64'),
}));

const loadSource = file => vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });

loadSource(path.join(CODE, 'utils.js'));
for (const name of fs.readdirSync(path.join(CODE, 'psx')).sort()) {
  if (name.endsWith('.js') && !name.endsWith('.spec.js')) loadSource(path.join(CODE, 'psx', name));
}
loadSource(path.join(CODE, 'enge-psx.js'));

Object.assign(globalThis, include('enge:utils'));

let rendererName = 'stub';
if (options.renderer !== 'stub') {
  display = createGlCanvas();
  if (display) {
    loadSource(path.join(CODE, 'enge-webgl.js'));
    include('enge:webgl');
    if (renderer?.gl) rendererName = 'webgl';
  }
  if (rendererName !== 'webgl') {
    if (options.renderer === 'webgl') {
      process.stderr.write('[enge] the webgl renderer needs the `gl` package and a display (see tests/nugget/README.md)\n');
      process.exit(2);
    }
    display = null;
  }
}
if (rendererName === 'stub') {
  globalThis.renderer = createStubRenderer();
  globalThis.primitiveId = 0;
  globalThis.nextPrimitive = noop;
}

include('enge:psx');

// ---------------------------------------------------------------------------
// Hooks: TTY and exit.

class ProgramExit extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}
class EmulatorStop extends Error { }

let exitCode = null;

globalThis.abort = (...args) => { throw new EmulatorStop(args.join(' ')); };

// Recompiled blocks look these up as globals on every call, so wrapping the
// globals is enough to see the stores.
const DEBUG_PUTC = 0x01802080;
const DEBUG_EXIT = 0x01802082;
const { memWrite8, memWrite16, memWrite32 } = globalThis;

globalThis.memWrite8 = (base, data) => {
  if (base === DEBUG_PUTC) return tty(data);
  return memWrite8(base, data);
};
globalThis.memWrite16 = (base, data) => {
  if (base === DEBUG_EXIT) {
    exitCode = (data << 16) >> 16;
    throw new ProgramExit(exitCode);
  }
  return memWrite16(base, data);
};
globalThis.memWrite32 = (base, data) => {
  if (base === DEBUG_PUTC) return tty(data);
  return memWrite32(base, data);
};

// BIOS calls: rec.js calls trace(pc, t1) at the top of the A0/B0/C0 vectors.
globalThis.trace = (pc, fn) => {
  if ((pc === 0xa0 && fn === 0x3c) || (pc === 0xb0 && fn === 0x3d)) tty(cpu.gpr[4]);
};

// ---------------------------------------------------------------------------
// Run.

const finish = (code, message) => {
  flushTty();
  if (message) note(message);
  process.exit(code);
};

const main = async () => {
  const started = Date.now();
  const deadline = started + options.timeout * 1000;
  note(`renderer=${rendererName} bios=${path.basename(options.bios)} exe=${path.basename(options.exe)}`);

  try {
    await loadBiosFromURL(path.resolve(options.bios));
    // loadFileData boots the BIOS to the shell entry, then loads the PS-EXE.
    await loadBiosFromURL(path.resolve(options.exe));
  } catch (error) {
    if (error instanceof ProgramExit) return finish(error.code, `exited with ${error.code} during boot`);
    return finish(EXIT_EMULATOR, `emulator stopped while loading: ${error.stack || error.message}`);
  }

  let entry = getCacheEntry(cpu.pc);
  const $ = psx;
  try {
    for (;;) {
      for (let i = 0; i < 200000; ++i) {
        entry = entry.code($);
        if ($.clock >= $.eventClock) entry = $.handleEvents(entry);
      }
      if (Date.now() > deadline) {
        cpu.pc = entry.pc;
        return finish(EXIT_TIMEOUT, `timeout after ${options.timeout}s at pc=${hex(cpu.pc)} (${(psx.clock / PSX_SPEED).toFixed(1)}s emulated)`);
      }
    }
  } catch (error) {
    if (error instanceof ProgramExit) {
      return finish(error.code, `exited with ${error.code} after ${(psx.clock / PSX_SPEED).toFixed(2)}s emulated, ${((Date.now() - started) / 1000).toFixed(1)}s wall`);
    }
    return finish(EXIT_EMULATOR, `emulator stopped at pc=${hex(entry?.pc ?? cpu.pc)}: ${error.stack || error.message}`);
  }
};

main();
