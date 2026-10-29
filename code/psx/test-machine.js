mdlr('enge:psx:test-machine', ({ include }) => {

  // A complete emulated PlayStation for the specs: the same modules the
  // emulator page assembles (enge:psx), without a BIOS, a display or audio.
  //
  //   const m = createMachine();
  //   const { labels } = m.asm(0x80010000, `
  //     add:  jr    $ra
  //           addu  $v0, $a0, $a1
  //   `);
  //   m.call(labels.add, 1, 2).v0  // 3
  //   m.dispose();
  //
  // The modules talk through globals (psx, cpu, gpu, map, ...), so only one
  // machine can exist at a time. createMachine() saves every global it or the
  // modules touch and dispose() puts them back.
  //
  // Exceptions: reaching the exception vector (80h, or the debug vector 40h)
  // calls m.onException with { from, cause, epc, sr, badvaddr }, records it in m.exceptions and returns from
  // the exception (rfe) to the address onException returns, or EPC + 4 by
  // default, like a minimal handler would. Set m.onException = null to run
  // whatever code is at 80h instead.
  //
  // Renderer: draws are dropped. VRAM uploads, readbacks, VRAM copies and
  // fills work on a CPU-side copy of VRAM, the way the WebGL renderer keeps
  // its VRAM mirror; rasterised pixels are not modelled.

  const { assemble } = include('enge:psx:test-asm');

  const PSX_SPEED = 44100 * 768;
  const RETURN = 0x80000ff0;   // `call` returns here
  const IDLE = 0x80000f00;     // `idle` spins here, 16 cycles per pass
  const STACK = 0x801ffff0;

  const noop = () => { };

  const createRenderer = () => {
    const vram = new Uint16Array(1024 * 512);
    const copy = (x, y, w, h, buffer) => {
      let o = 0;
      for (let j = 0; j < h; ++j) {
        const row = ((y + j) & 511) * 1024;
        for (let i = 0; i < w; ++i) buffer[o++] = vram[row + ((x + i) & 1023)];
      }
    };
    const paste = (x, y, w, h, buffer) => {
      let o = 0;
      for (let j = 0; j < h; ++j) {
        const row = ((y + j) & 511) * 1024;
        for (let i = 0; i < w; ++i) vram[row + ((x + i) & 1023)] = buffer[o++];
      }
    };
    return {
      vram,
      fpsCounter: 0,
      fpsRenderCounter: 0,
      draws: [],
      loadImage: (x, y, w, h, buffer) => copy(x, y, w, h, buffer),
      storeImage: img => paste(img.x, img.y, img.w, img.h, img.buffer),
      moveImage(sx, sy, dx, dy, w, h) {
        const buffer = new Uint16Array(w * h);
        copy(sx, sy, w, h, buffer);
        paste(dx, dy, w, h, buffer);
      },
      // GP0(02h), as enge-webgl.js fillRectangle/clearVRAM do it
      fillRectangle(data) {
        const x = (data[1] << 16 >> 16) & 0x3f0;
        const y = (data[1] >> 16) & 0x1ff;
        const w = ((((data[2] << 16) >>> 16) & 0x3ff) + 15) & ~15;
        const h = (data[2] >> 16) & 0x1ff;
        if (!w || !h) return;
        const c = data[0] & 0xf8f8f8;
        const pixel = (((c >>> 19) & 0x1f) << 10) | (((c >>> 11) & 0x1f) << 5) | ((c >>> 3) & 0x1f);
        paste(x, y, w, h, new Uint16Array(w * h).fill(pixel));
      },
      drawLine(...args) { this.draws.push(['line', ...args]); },
      drawRectangle(...args) { this.draws.push(['rectangle', ...args]); },
      drawTriangle(...args) { this.draws.push(['triangle', ...args]); },
      getVramState: () => new Uint16Array(vram),
      setVramState: buffer => vram.set(buffer),
      onVBlankBegin() { ++this.fpsCounter; },
      onVBlankEnd: noop,
      setDrawAreaTL: noop, setDrawAreaBR: noop, setDrawAreaOF: noop, updateDrawArea: noop,
      setMode: noop,
    };
  };

  class AudioContextStub {
    constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createGain() { return { connect: noop, gain: { value: 1, setValueAtTime: noop } }; }
    createScriptProcessor() { return { connect: noop, disconnect: noop }; }
    resume() { return Promise.resolve(); }
  }

  const element = () => ({
    style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop,
  });

  let active = null;

  const createMachine = (options = {}) => {
    if (active) active.dispose();

    // --- save the globals -------------------------------------------------
    const saved = new Map();
    for (const name of Object.getOwnPropertyNames(globalThis)) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    const restore = () => {
      for (const name of Object.getOwnPropertyNames(globalThis)) {
        if (!saved.has(name)) {
          try { delete globalThis[name]; } catch { /* non-configurable */ }
        }
      }
      for (const [name, descriptor] of saved) {
        const current = Object.getOwnPropertyDescriptor(globalThis, name);
        if (!current || !descriptor.configurable) {
          if (descriptor.writable && current && current.value !== descriptor.value) globalThis[name] = descriptor.value;
          continue;
        }
        if (current.value !== descriptor.value || current.get !== descriptor.get) {
          Object.defineProperty(globalThis, name, descriptor);
        }
      }
    };

    // --- the browser pieces the modules touch ----------------------------
    // Without a browser, window is the global object, as it is in one.
    // A runner may provide a plain window object; keep its properties.
    if (typeof window === 'undefined' || window !== globalThis) {
      if (typeof window !== 'undefined') Object.assign(globalThis, window);
      globalThis.window = globalThis;
    }
    if (typeof location === 'undefined') {
      globalThis.location = { href: 'http://localhost/', search: '' };
    }
    if (typeof document === 'undefined') {
      globalThis.document = {
        title: '', scripts: [], baseURI: 'http://localhost/',
        addEventListener: noop, createElement: element,
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      };
    }
    if (typeof localStorage === 'undefined') {
      const store = new Map();
      globalThis.localStorage = {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
      };
    }
    if (typeof window.addEventListener !== 'function') window.addEventListener = noop;    globalThis.AudioContext = AudioContextStub;
    globalThis.AudioWorkletNode = undefined;

    // --- what enge:psx:index and the renderer provide --------------------
    const tty = [];
    Object.assign(globalThis, {
      PSX_SPEED,
      // as enge:utils hex: the low `length` digits (the recompiler relies on it)
      hex: (value, length) => ('00000000' + (value >>> 0).toString(16)).substr(-(length || 8)),
      abort: (...args) => { throw new Error(`abort: ${args.join(' ')}`); },
      context: { timeStamp: 0, realtime: 0, emutime: 0, counter: 0 },
      // BIOS calls reach trace() at A0h/B0h/C0h; keep putchar output
      trace: (pc, fn) => {
        if ((pc === 0xa0 && fn === 0x3c) || (pc === 0xb0 && fn === 0x3d)) tty.push(cpu.gpr[4] & 0xff);
      },
      renderer: options.renderer || createRenderer(),
      primitiveId: 0,
      nextPrimitive: noop,
    });

    // --- the emulator, as enge:psx assembles it (no gamepad, no page) -----
    Object.assign(globalThis, include('enge:psx:core'));
    Object.assign(globalThis, include('enge:psx:serial'));
    Object.assign(globalThis, include('enge:psx:cpu'));
    Object.assign(globalThis, include('enge:psx:cdr'));
    Object.assign(globalThis, include('enge:psx:mdec'));
    Object.assign(globalThis, include('enge:psx:gpu'));
    Object.assign(globalThis, include('enge:psx:gte'));
    Object.assign(globalThis, include('enge:psx:pgxp'));
    Object.assign(globalThis, include('enge:psx:mmu'));
    Object.assign(globalThis, include('enge:psx:rec'));
    Object.assign(globalThis, include('enge:psx:spu'));
    Object.assign(globalThis, include('enge:psx:stall'));
    globalThis.vector = getCacheEntry(0x80);

    // --- the machine ------------------------------------------------------
    const phys = addr => (addr >>> 0) & 0x01ffffff;
    const ramIndex = addr => (addr >>> 0) & 0x001fffff;

    const m = {
      PSX_SPEED,
      RETURN,
      get psx() { return psx; },
      get cpu() { return cpu; },
      get gpu() { return gpu; },
      get gte() { return gte; },
      get dma() { return dma; },
      get spu() { return spu; },
      get joy() { return joy; },
      get renderer() { return renderer; },
      get ram() { return ram; },
      get clock() { return psx.clock; },
      tty: () => String.fromCharCode(...tty),

      // bus accesses as the CPU makes them (with their access time)
      read8: addr => memRead8(phys(addr)),
      read16: addr => memRead16(phys(addr)),
      read32: addr => memRead32(phys(addr)),
      write8: (addr, value) => memWrite8(phys(addr), value),
      write16: (addr, value) => memWrite16(phys(addr), value),
      write32: (addr, value) => memWrite32(phys(addr), value),

      // RAM without side effects or timing
      peek32: addr => ram.getUint32(ramIndex(addr), true),
      peek16: addr => ram.getUint16(ramIndex(addr), true),
      peek8: addr => ram.getUint8(ramIndex(addr)),
      poke32: (addr, value) => { ram.setUint32(ramIndex(addr), value >>> 0, true); clearCodeCache(ramIndex(addr), 4); },
      poke16: (addr, value) => { ram.setUint16(ramIndex(addr), value & 0xffff, true); clearCodeCache(ramIndex(addr) & ~3, 4); },
      poke8: (addr, value) => { ram.setUint8(ramIndex(addr), value & 0xff); clearCodeCache(ramIndex(addr) & ~3, 4); },

      load(addr, words) {
        const base = ramIndex(addr);
        words.forEach((word, i) => ram.setUint32(base + 4 * i, word >>> 0, true));
        clearCodeCache(base, 4 * words.length);
      },

      // assemble MIPS code at addr and load it; returns { labels, end, words }
      asm(addr, source) {
        const result = assemble(source, addr);
        m.load(addr, result.words);
        return result;
      },

      exceptions: [],
      onException: undefined,

      // Run from pc until execution reaches `until` (block granularity) or
      // the cycle budget runs out (throws).
      run(pc, { until = RETURN, cycles = PSX_SPEED } = {}) {
        const stop = phys(until) < 0x00800000 ? ramIndex(until) : phys(until);
        const limit = psx.clock + cycles;
        let entry = getCacheEntry(pc >>> 0);
        const $ = psx;
        while (entry.pc !== stop) {
          entry = entry.code($);
          if ($.clock >= $.eventClock) entry = $.handleEvents(entry);
          if (entry === vector || entry.pc === 0x40) entry = exception(entry);
          if ($.clock > limit) {
            cpu.pc = entry.pc;
            throw new Error(`run: no return after ${cycles} cycles (pc ${hex(entry.pc)})`);
          }
        }
        cpu.pc = entry.pc;
        return m;
      },

      // Call the function at addr with up to four arguments; returns v0/v1.
      call(addr, ...args) {
        const opts = (args.length && typeof args[args.length - 1] === 'object') ? args.pop() : {};
        args.forEach((value, i) => { cpu.gpr[4 + i] = value >> 0; });
        cpu.gpr[29] = STACK;
        cpu.gpr[31] = RETURN;
        cpu.clearLoadDelay();
        m.run(addr, { until: RETURN, ...opts });
        return { v0: cpu.gpr[2] >>> 0, v1: cpu.gpr[3] >>> 0 };
      },

      // Let `cycles` pass with the CPU spinning in a loop (events, DMA and
      // interrupts happen as they would).
      idle(cycles) {
        const target = psx.clock + cycles;
        let entry = getCacheEntry(IDLE);
        const $ = psx;
        while ($.clock < target) {
          entry = entry.code($);
          if ($.clock >= $.eventClock) entry = $.handleEvents(entry);
          if (entry === vector || entry.pc === 0x40) entry = exception(entry);
        }
        cpu.pc = entry.pc;
        return m;
      },

      // Advance until predicate() is true or the budget runs out; returns the
      // cycles it took, or -1.
      idleUntil(predicate, cycles = PSX_SPEED, step = 16) {
        const start = psx.clock;
        while (!predicate()) {
          if (psx.clock - start > cycles) return -1;
          m.idle(step);
        }
        return psx.clock - start;
      },

      dispose() {
        if (active === m) active = null;
        restore();
      },
    };

    const exception = entry => {
      if (m.onException === null) return entry;
      const ex = { from: entry.pc, cause: cpu.getCtrl(13) >>> 0, epc: cpu.epc >>> 0, sr: cpu.sr >>> 0, badvaddr: cpu.getCtrl(8) >>> 0 };
      m.exceptions.push(ex);
      const resume = m.onException ? m.onException(ex) : undefined;
      cpu.rfe();
      return getCacheEntry((resume ?? ex.epc + 4) >>> 0);
    };

    // the return and idle stubs: spin in place
    m.asm(RETURN, 'ret: b ret\n nop');
    m.asm(IDLE, `idle: ${'nop\n'.repeat(14)} b idle\n nop`);

    active = m;
    return m;
  };

  return { createMachine };
})
