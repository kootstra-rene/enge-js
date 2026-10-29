mdlr('[test]enge:psx:stall', ({ include, test }) => {

  const { describe, it, expect, before, after } = test;
  const { stubWindow, setSearch } = include('enge:psx:test-window');

  const globalNames = ['psx', 'cpu', 'gpu', 'map', 'renderer', 'context', 'abort', 'hex', 'trace', 'calls',
    'getCacheEntry', 'memRead8', 'memRead16', 'memRead32', 'memWrite8', 'memWrite16', 'memWrite32',
    'fastCache', 'invalidateCache', 'codeWords', 'invalidateCodeWord', 'stallReport'];
  const savedGlobals = {};
  const savedWarn = console.warn;
  let restoreWindow;

  const T0 = 8, T1 = 9;
  const LUI = (rt, imm) => ((0x0f << 26) | (rt << 16) | (imm & 0xffff)) >>> 0;
  const LW = (rt, rs, off) => ((0x23 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
  const ANDI = (rt, rs, imm) => ((0x0c << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
  const BEQ = (rs, rt, off) => ((0x04 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
  const NOP = 0;

  let stall, reads32, warnings, read32;

  // Runs `frames` animation frames of `perFrame` blocks each, like mainLoop.
  const runFrames = (pc, frames, perFrame = 20) => {
    let entry = getCacheEntry(pc);
    for (let f = 0; f < frames; ++f) {
      for (let i = 0; i < perFrame; ++i) {
        stall.block(entry);
        entry = entry.code(psx);
      }
      stall.endFrame();
    }
  };

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    restoreWindow = stubWindow({ location: { href: '', search: '' } });
    setSearch('?debug-stall');
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    // same as hex() in code/utils.js: keeps only the last `length` digits
    globalThis.hex = (value, length) => ('00000000' + (value >>> 0).toString(16)).substr(-(length || 8));
    globalThis.trace = () => {};
    globalThis.calls = 0;
    globalThis.psx = { clock: 0, addEvent: () => ({}), setEvent: () => {} };
    globalThis.renderer = { fpsRenderCounter: 0, fpsCounter: 0 };
    globalThis.context = { counter: 0 };
    globalThis.gpu = { status: 0x14802000 };
    globalThis.cpu = { gpr: new Int32Array(32), dr: 0, dv: 0, sr: 0, cause: 0, epc: 0, istat: 0, imask: 0, pc: 0 };
    globalThis.map = new Int32Array(0x02000000 >> 2);
    reads32 = 0;
    // GPUSTAT reads back 0, so the loop below never ends
    globalThis.memRead32 = read32 = addr => { ++reads32; return addr === 0x01801814 ? 0 : map[(addr & 0x001fffff) >>> 2]; };
    globalThis.memWrite32 = (addr, data) => { map[(addr & 0x001fffff) >>> 2] = data; };
    for (const name of ['memRead8', 'memRead16', 'memWrite8', 'memWrite16']) globalThis[name] = () => 0;

    ({ getCacheEntry: globalThis.getCacheEntry } = include('enge:psx:rec'));
    for (const name of ['fastCache', 'invalidateCache', 'codeWords', 'invalidateCodeWord']) {
      if (window[name]) globalThis[name] = window[name];
    }
    ({ stall } = include('enge:psx:stall'));
    warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  after(async () => {
    console.warn = savedWarn;
    restoreWindow();
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  describe('disassembler', () => {

    const text = (word, pc = 0x80010000) => stall.disasm(word, pc).text;

    it('should decode loads, stores and immediates', async () => {
      expect(text(LUI(T0, 0x1f80))).to.eql('lui t0, 0x1f80');
      expect(text(LW(T1, T0, 0x1814))).to.eql('lw t1, 0x1814(t0)');
      expect(text(LW(T1, 29, -8))).to.eql('lw t1, -0x8(sp)');
      expect(text(ANDI(T1, T1, 0x1000))).to.eql('andi t1, t1, 0x1000');
      expect(text(0x27bdffe8)).to.eql('addiu sp, sp, -0x18');
      expect(text(NOP)).to.eql('nop');
    });

    it('should decode branch and jump targets', async () => {
      expect(text(BEQ(T1, 0, -3), 0x80010008)).to.eql('beq t1, zero, 0x80010000');
      expect(text(0x1000ffff, 0x80010000)).to.eql('b 0x80010000');
      expect(text(0x0c004000, 0x80010000)).to.eql('jal 0x80010000');
      expect(text(0x03e00008)).to.eql('jr ra');
      expect(text(0x0100f809)).to.eql('jalr t0');
    });

    it('should decode COP0 and GTE instructions', async () => {
      expect(text(0x40026000)).to.eql('mfc0 v0, sr');
      expect(text(0x40826000)).to.eql('mtc0 v0, sr');
      expect(text(0x42000010)).to.eql('rfe');
      expect(text(0x4a180001)).to.eql('rtps 0x180001');
      expect(text(0x4a280030)).to.eql('rtpt 0x280030');
      expect(text(0x48027000)).to.eql('mfc2 v0, $14');
      expect(text(0xe8ae0000)).to.eql('swc2 $14, 0x0(a1)');
    });

  });

  describe('detection', () => {

    it('should report a loop that polls a hardware register', async () => {
      // 0x80001000: lui t0, 0x1f80; lw t1, 0x1814(t0); andi t1, t1, 0x1000; beq t1, zero, loop; nop
      [LUI(T0, 0x1f80), LW(T1, T0, 0x1814), ANDI(T1, T1, 0x1000), BEQ(T1, 0, -4), NOP]
        .forEach((word, i) => { map[(0x1000 >>> 2) + i] = word; });
      cpu.gpr[T0] = 0x1f800000 | 0;
      warnings = [];
      runFrames(0x1000, 200);

      const report = window.stallReport || '';
      expect(warnings.length > 0).to.eql(true);
      expect(report.includes('0x1f801814  32  GPUSTAT/GP1')).to.eql(true);
      expect(report.includes('lw t1, 0x1814(t0)  ; [0x1f801814] GPUSTAT/GP1')).to.eql(true);
      expect(report.includes('block 0x80001000')).to.eql(true);
      expect(report.includes('beq t1, zero, 0x80001000')).to.eql(true);
    });

    it('should restore the memory accessors after the report', async () => {
      const before = reads32;
      runFrames(0x1000, 1, 1);
      expect(memRead32 === read32).to.eql(true);
      expect(reads32 > before).to.eql(true); // still the original function underneath
    });

    it('should report a stall only once', async () => {
      warnings = [];
      runFrames(0x1000, 300);
      expect(warnings.length).to.eql(0);
    });

    it('should not report while new code keeps running', async () => {
      // 60 different straight-line blocks, a different one every frame
      for (let b = 0; b < 60; ++b) {
        const pc = 0x10000 + b * 0x40;
        map[pc >>> 2] = 0x08000000 | ((pc + 0x40) >>> 2); // j next block
        map[(pc >>> 2) + 1] = NOP;
      }
      warnings = [];
      let entry;
      for (let f = 0; f < 300; ++f) {
        entry = getCacheEntry(0x10000 + (f % 60) * 0x40);
        stall.block(entry);
        entry.code(psx);
        stall.endFrame();
      }
      expect(warnings.length).to.eql(0);
    });

    // 60 straight-line blocks in a ring: more than the default 48
    const bigLoop = () => {
      for (let b = 0; b < 60; ++b) {
        const pc = 0x20000 + b * 0x40;
        const next = b < 59 ? pc + 0x40 : 0x20000;
        map[pc >>> 2] = 0x08000000 | (next >>> 2); // j next
        map[(pc >>> 2) + 1] = NOP;
      }
    };

    it('should not report a loop larger than the block limit', async () => {
      bigLoop();
      warnings = [];
      runFrames(0x20000, 300, 60);
      expect({ warnings: warnings.length, blocks: stall.status().blocksLastFrame }).to.eql({ warnings: 0, blocks: 60 });
    });

    it('should capture on request, stalled or not', async () => {
      bigLoop();
      warnings = [];
      expect(stall.capture().startsWith('capturing')).to.eql(true);
      runFrames(0x20000, 30, 60);
      const report = window.stallReport || '';
      expect(report.includes('[STALL] captured on request: 60 block(s) ran in 30 frames')).to.eql(true);
      expect(report.includes('block 0x80020000')).to.eql(true);
      expect(memRead32 === read32).to.eql(true);
    });

    it('should watch larger loops with ?debug-stall=N', async () => {
      setSearch('?debug-stall=100');
      const { stall: wide } = include('enge:psx:stall');
      setSearch('?debug-stall');
      bigLoop();
      warnings = [];
      let entry = getCacheEntry(0x20000);
      for (let f = 0; f < 200; ++f) {
        for (let i = 0; i < 60; ++i) { wide.block(entry); entry = entry.code(psx); }
        wide.endFrame();
      }
      expect({ limit: wide.status().maxBlocks, reported: warnings.length > 0 }).to.eql({ limit: 100, reported: true });
      expect((window.stallReport || '').includes('running the same 60 block(s)')).to.eql(true);
    });

  });

})
