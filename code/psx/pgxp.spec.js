mdlr('[test]enge:psx:pgxp', ({ include, test }) => {

  const { describe, it, expect, before, after } = test;

  const globalNames = ['window', 'psx', 'cpu', 'map', 'ram', 'renderer', 'context', 'abort', 'hex', 'trace', 'calls',
    'getCacheEntry', 'memRead32', 'memRead16', 'memWrite32', 'memWrite16', 'memWrite8', 'gte', 'pgxp', 'gpu', 'clearCodeCache',
    'fastCache', 'invalidateCache', 'codeWords', 'invalidateCodeWord', 'nextPrimitive', 'pgxpMemFrac', 'pgxpGprFrac'];
  const savedGlobals = {};

  // MIPS encodings used by the test programs
  const T0 = 8, T1 = 9, T2 = 10, T3 = 11, RA = 31;
  const SWC2 = (rt, rs, off) => ((0x3a << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
  const MFC2 = (rt, rd) => ((0x12 << 26) | (rt << 16) | (rd << 11)) >>> 0;
  const LW = (rt, rs, off) => ((0x23 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
  const SW = (rt, rs, off) => ((0x2b << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
  const ADDIU = (rt, rs, imm) => ((0x09 << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
  const OR = (rd, rs, rt) => ((rs << 21) | (rt << 16) | (rd << 11) | 0x25) >>> 0;
  const JR_RA = ((RA << 21) | 0x08) >>> 0;
  const NOP = 0;

  const SXY2 = 14;
  const DATA = 0x00100000;
  const VALID = 0x300; // x and y half valid

  // RTPS result used throughout: SX2 = 100.25, SY2 = 50.75
  const SXY_WORD = (50 << 16) | 100;
  const SXY_FRAC = 4 | (12 << 4); // .25 = 4/16, .75 = 12/16

  // OFX/OFY carry the fraction; H = 0 makes the projection term zero, so
  // SX2 = OFX / 10000h and SY2 = OFY / 10000h.
  const projectPoint = () => {
    for (let r = 0; r < 64; ++r) gte.set(r, 0);
    gte.set(0x27, 1000);                       // TRZ, gives a non-zero SZ3
    gte.set(0x38, (100 << 16) + 0x4000);       // OFX = 100.25
    gte.set(0x39, (50 << 16) + 0xc000);        // OFY = 50.75
    gte.command(0x00080001);                   // RTPS, sf = 1
  };

  let address = 0x1000;
  const runProgram = (words) => {
    const pc = address;
    address += 0x100;
    words.forEach((word, i) => { map[(pc >>> 2) + i] = word; });
    cpu.gpr[RA] = 0x8000;
    const entry = getCacheEntry(pc);
    let target = entry.code(psx);
    if (target === entry) target = entry.code(psx); // first call only compiled
    return entry;
  };

  const fracAt = (addr) => pgxp.fracAt(addr, map[(addr & 0x1fffff) >>> 2]);

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    globalThis.window = { location: { href: '', search: '?pgxp' } };
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    // same as hex() in code/utils.js: keeps only the last `length` digits
    globalThis.hex = (value, length) => ('00000000' + (value >>> 0).toString(16)).substr(-(length || 8));
    globalThis.trace = () => {};
    globalThis.calls = 0;
    globalThis.clearCodeCache = () => {};
    globalThis.nextPrimitive = () => {}; // provided by the renderer
    globalThis.psx = { clock: 0, addEvent: () => ({}), setEvent: () => {} };
    globalThis.context = { counter: 0 };
    globalThis.cpu = { gpr: new Int32Array(32), dr: 0, dv: 0, istat: 0 };
    // RAM + scratchpad laid out like mmu.js: masked address / 4
    globalThis.map = new Int32Array(0x02000000 >> 2);
    globalThis.ram = new DataView(map.buffer, 0, 2 * 1024 * 1024);
    globalThis.memRead32 = addr => map[(addr < 0x00800000 ? addr & 0x001fffff : addr) >>> 2];
    globalThis.memWrite32 = (addr, data) => { map[(addr < 0x00800000 ? addr & 0x001fffff : addr) >>> 2] = data; };
    const bytes = new DataView(map.buffer);
    globalThis.memWrite16 = (addr, data) => bytes.setInt16(addr < 0x00800000 ? addr & 0x001fffff : addr, data, true);
    globalThis.memRead16 = addr => bytes.getInt16(addr < 0x00800000 ? addr & 0x001fffff : addr, true);
    globalThis.memWrite8 = (addr, data) => bytes.setInt8(addr < 0x00800000 ? addr & 0x001fffff : addr, data);

    globalThis.renderer = { fpsRenderCounter: 0, fpsCounter: 0 };
    ({ gte: globalThis.gte } = include('enge:psx:gte'));
    ({ pgxp: globalThis.pgxp, pgxpMemFrac: globalThis.pgxpMemFrac, pgxpGprFrac: globalThis.pgxpGprFrac } = include('enge:psx:pgxp'));
    ({ getCacheEntry: globalThis.getCacheEntry } = include('enge:psx:rec'));
    // compiled blocks use the code-invalidation globals rec.js publishes on window
    for (const name of ['fastCache', 'invalidateCache', 'codeWords', 'invalidateCodeWord']) {
      if (window[name]) globalThis[name] = window[name];
    }
  });

  after(async () => {
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  describe('GTE', () => {

    it('should keep the 1/16-pixel fraction of SX2/SY2', async () => {
      projectPoint();
      expect(gte.get(SXY2) >>> 0).to.eql(SXY_WORD);
      expect(gte.frac(SXY2)).to.eql(SXY_FRAC);
    });

    it('should keep sixteenths of a pixel (half a pixel at the 8x render scale)', async () => {
      for (let r = 0; r < 64; ++r) gte.set(r, 0);
      gte.set(0x27, 1000);
      gte.set(0x38, (100 << 16) + 0x1000);     // OFX = 100.0625
      gte.set(0x39, (50 << 16) + 0xf000);      // OFY = 50.9375
      gte.command(0x00080001);
      expect(gte.get(SXY2) >>> 0).to.eql(SXY_WORD);
      expect(gte.frac(SXY2)).to.eql(1 | (15 << 4));
    });

    it('should round negative coordinates down, with the fraction above them', async () => {
      for (let r = 0; r < 64; ++r) gte.set(r, 0);
      gte.set(0x27, 1000);
      gte.set(0x38, -(100 << 16) - 0x4000);    // OFX = -100.25 = -101 + 12/16
      gte.set(0x39, (50 << 16) + 0x8000);      // OFY = 50.5
      gte.command(0x00080001);
      expect(gte.get(SXY2) >>> 0).to.eql(((50 << 16) | (-101 & 0xffff)) >>> 0);
      expect(gte.frac(SXY2)).to.eql(12 | (8 << 4));
    });

    it('should shift the fraction through the SXY FIFO', async () => {
      projectPoint();
      gte.command(0x00080001); // RTPS again: SXY2 -> SXY1
      expect(gte.frac(0x0d)).to.eql(SXY_FRAC);
      gte.set(0x0f, 0); // SXYP write pushes a value without a fraction
      expect([gte.frac(0x0c), gte.frac(0x0d), gte.frac(0x0e)]).to.eql([SXY_FRAC, SXY_FRAC, 0]);
    });

    it('should drop the fraction when SXY is written directly', async () => {
      projectPoint();
      gte.set(SXY2, SXY_WORD);
      expect(gte.frac(SXY2)).to.eql(0);
    });

  });

  describe('recompiled code', () => {

    it('should store the fraction with SWC2', async () => {
      projectPoint();
      cpu.gpr[T0] = DATA;
      runProgram([SWC2(SXY2, T0, 0), JR_RA, NOP]);
      expect(map[DATA >>> 2] >>> 0).to.eql(SXY_WORD);
      expect(fracAt(DATA)).to.eql(SXY_FRAC | VALID);
    });

    it('should carry the fraction through MFC2 and SW', async () => {
      projectPoint();
      cpu.gpr[T0] = DATA;
      runProgram([MFC2(T1, SXY2), NOP, SW(T1, T0, 4), JR_RA, NOP]);
      expect(fracAt(DATA + 4)).to.eql(SXY_FRAC | VALID);
    });

    it('should carry the fraction through LW, a register move and SW', async () => {
      projectPoint();
      cpu.gpr[T0] = DATA;
      runProgram([SWC2(SXY2, T0, 0), LW(T2, T0, 0), NOP, OR(T3, T2, 0), SW(T3, T0, 8), JR_RA, NOP]);
      expect(fracAt(DATA + 8)).to.eql(SXY_FRAC | VALID);
    });

    it('should carry the fraction through the scratchpad', async () => {
      projectPoint();
      cpu.gpr[T0] = 0x1f800000 | 0;
      cpu.gpr[T1] = DATA;
      runProgram([SWC2(SXY2, T0, 0x10), LW(T2, T0, 0x10), NOP, SW(T2, T1, 0x20), JR_RA, NOP]);
      expect(fracAt(DATA + 0x20)).to.eql(SXY_FRAC | VALID);
    });

    it('should not carry the fraction when the value was changed', async () => {
      projectPoint();
      cpu.gpr[T0] = DATA;
      runProgram([SWC2(SXY2, T0, 0), LW(T2, T0, 0), NOP, ADDIU(T2, T2, 1), SW(T2, T0, 12), JR_RA, NOP]);
      expect(fracAt(DATA + 12)).to.eql(0);
    });

    it('should not use the fraction after the word was changed by another write', async () => {
      projectPoint();
      cpu.gpr[T0] = DATA;
      runProgram([SWC2(SXY2, T0, 0x30), JR_RA, NOP]);
      expect(fracAt(DATA + 0x30)).to.eql(SXY_FRAC | VALID);
      map[(DATA + 0x30) >>> 2] = SXY_WORD + 1; // e.g. a byte store or DMA
      expect(fracAt(DATA + 0x30)).to.eql(0);
    });

    it('should not generate PGXP code when PGXP is disabled', async () => {
      const enabled = pgxp;
      globalThis.pgxp = { enabled: false };
      try {
        cpu.gpr[T0] = DATA;
        const entry = runProgram([SWC2(SXY2, T0, 0), LW(T2, T0, 0), SW(T2, T0, 4), JR_RA, NOP]);
        expect(entry.code.toString().includes('pgxp')).to.eql(false);
      }
      finally {
        globalThis.pgxp = enabled;
      }
    });

  });

  describe('GPU', () => {

    const LIST = 0x2000;
    let gpu, drawn;

    before(async () => {
      globalThis.renderer = new Proxy({
        drawTriangle(data, c1, xy1, c2, xy2, c3, xy3) {
          const frac = globalThis.gpu.pgxpFrac;
          drawn.push(frac ? [frac[xy1], frac[xy2], frac[xy3]] : null);
        },
      }, { get: (target, key) => target[key] || (() => {}) });
      ({ gpu } = include('enge:psx:gpu'));
      globalThis.gpu = gpu;
    });

    const runList = (packet) => {
      drawn = [];
      map[LIST >>> 2] = ((packet.length << 24) | 0x00ffffff) | 0; // header: size, end of list
      packet.forEach((word, i) => { map[(LIST >>> 2) + 1 + i] = word; });
      gpu.dmaTransferMode0401(LIST, 0); // GPU linked-list DMA (channel 2)
      return drawn;
    };

    it('should pass the fraction of precise vertices to the renderer', async () => {
      projectPoint();
      runList([0x20ffffff | 0, 0, 0x00100010, 0x00200020]);
      pgxp.swc2(SXY2, LIST + 8); // vertex 1 written by the game with SWC2
      expect(runList([0x20ffffff | 0, SXY_WORD, 0x00100010, 0x00200020])).to.eql([[SXY_FRAC | VALID, 0, 0]]);
    });

    it('should not pass fractions when no vertex is precise', async () => {
      expect(runList([0x20ffffff | 0, 0x00050005, 0x00100010, 0x00200020])).to.eql([null]);
    });

  });

  describe('halfwords, LWC2 and MTC2', () => {

    const SH = (rt, rs, off) => ((0x29 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
    const LH = (rt, rs, off) => ((0x21 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
    const LWC2 = (rt, rs, off) => ((0x32 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
    const MTC2 = (rt, rd) => ((0x12 << 26) | (4 << 21) | (rt << 16) | (rd << 11)) >>> 0;

    it('should keep the x fraction when a coordinate is stored with SH', async () => {
      projectPoint();
      cpu.gpr[T0] = DATA + 0x40;
      map[(DATA + 0x40) >>> 2] = 0;
      runProgram([MFC2(T1, SXY2), NOP, SH(T1, T0, 0), JR_RA, NOP]);
      expect(map[(DATA + 0x40) >>> 2]).to.eql(100);
      expect(fracAt(DATA + 0x40)).to.eql(4 | 0x100); // x .25, x valid only
    });

    it('should load a fraction into the GTE with LWC2', async () => {
      projectPoint();
      cpu.gpr[T0] = DATA + 0x50;
      runProgram([SWC2(SXY2, T0, 0), JR_RA, NOP]);
      gte.set(0x0c, 0); // clear SXY0
      runProgram([LWC2(0x0c, T0, 0), JR_RA, NOP]);
      expect(gte.frac(0x0c)).to.eql(SXY_FRAC);
    });

    it('should move a fraction into the GTE with MTC2', async () => {
      projectPoint();
      runProgram([MFC2(T1, SXY2), NOP, MTC2(T1, 0x0d), JR_RA, NOP]);
      expect(gte.frac(0x0d)).to.eql(SXY_FRAC);
    });

    it('should carry the fraction of the loaded half with LH', async () => {
      projectPoint();
      cpu.gpr[T0] = DATA + 0x60;
      runProgram([SWC2(SXY2, T0, 0), LH(T2, T0, 2), NOP, SW(T2, T0, 4), JR_RA, NOP]);
      // y (50.75) loaded into the low half of t2 and stored as a word: x fraction .75
      expect(fracAt(DATA + 0x64)).to.eql(12 | 0x100);
    });

  });

  describe('CPU mode (?pgxp=cpu)', () => {

    const ANDI = (rt, rs, imm) => ((0x0c << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
    const SLL = (rd, rt, sa) => ((rt << 16) | (rd << 11) | (sa << 6) | 0x00) >>> 0;
    const SRL = (rd, rt, sa) => ((rt << 16) | (rd << 11) | (sa << 6) | 0x02) >>> 0;
    const SRA = (rd, rt, sa) => ((rt << 16) | (rd << 11) | (sa << 6) | 0x03) >>> 0;
    const ADDU = (rd, rs, rt) => ((rs << 21) | (rt << 16) | (rd << 11) | 0x21) >>> 0;
    const SUBU = (rd, rs, rt) => ((rs << 21) | (rt << 16) | (rd << 11) | 0x23) >>> 0;
    const SH = (rt, rs, off) => ((0x29 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
    const LH = (rt, rs, off) => ((0x21 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
    const LHU = (rt, rs, off) => ((0x25 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
    const T4 = 12, T5 = 13;
    const names = ['pgxp', 'pgxpMemFrac', 'pgxpGprFrac', 'getCacheEntry'];
    const saved = {};
    let cpuPgxp, cpuGetCacheEntry;

    const use = () => { globalThis.pgxp = cpuPgxp; globalThis.getCacheEntry = cpuGetCacheEntry; };

    before(async () => {
      for (const name of names) saved[name] = globalThis[name];
      window.location.search = '?pgxp=cpu';
      ({ pgxp: globalThis.pgxp, pgxpMemFrac: globalThis.pgxpMemFrac, pgxpGprFrac: globalThis.pgxpGprFrac } = include('enge:psx:pgxp'));
      ({ getCacheEntry: globalThis.getCacheEntry } = include('enge:psx:rec'));
      for (const name of ['fastCache', 'invalidateCache', 'codeWords', 'invalidateCodeWord']) {
        if (window[name]) globalThis[name] = window[name];
      }
      cpuPgxp = globalThis.pgxp;
      cpuGetCacheEntry = globalThis.getCacheEntry;
    });

    after(async () => {
      window.location.search = '?pgxp';
      for (const name of names) globalThis[name] = saved[name];
    });

    // project, then run the program with t0 = buffer and store the result word (t4) at t0+4
    const run = (words, offset = 0x70) => {
      use();
      projectPoint();
      cpu.gpr[T0] = DATA + offset;
      runProgram([MFC2(T1, SXY2), NOP, ...words, SW(T4, T0, 4), JR_RA, NOP]);
      return { word: map[(DATA + offset + 4) >>> 2], frac: fracAt(DATA + offset + 4) };
    };

    it('should keep the fraction when an integer offset is added', async () => {
      const r = run([ADDIU(T4, T1, 0x10)]);
      expect(r.word).to.eql(SXY_WORD + 0x10);
      expect(r.frac).to.eql(SXY_FRAC | VALID);
    });

    it('should keep both halves through split and re-pack with andi/srl/sll/or', async () => {
      const r = run([ANDI(T2, T1, 0xffff), SRL(T3, T1, 16), SLL(T3, T3, 16), OR(T4, T2, T3)], 0x80);
      expect(r.word).to.eql(SXY_WORD);
      expect(r.frac).to.eql(SXY_FRAC | VALID);
    });

    it('should keep both halves when x and y << 16 are packed with addu', async () => {
      const r = run([ANDI(T2, T1, 0xffff), SRA(T3, T1, 16), SLL(T3, T3, 16), ADDU(T4, T2, T3)], 0x90);
      expect(r.word).to.eql(SXY_WORD);
      expect(r.frac).to.eql(SXY_FRAC | VALID);
    });

    it('should carry halves through SH and LH/LHU', async () => {
      // store x and y as separate halfwords, read them back, re-pack
      const r = run([SH(T1, T0, 0), SRL(T2, T1, 16), SH(T2, T0, 2), NOP,
        LHU(T3, T0, 0), LH(T5, T0, 2), NOP, SLL(T5, T5, 16), OR(T4, T3, T5)], 0xa0);
      expect(fracAt(DATA + 0xa0)).to.eql(SXY_FRAC | VALID); // the halfword-written word
      expect(r.word).to.eql(SXY_WORD);
      expect(r.frac).to.eql(SXY_FRAC | VALID);
    });

    it('should drop a half when two fractions are added', async () => {
      // x + x: both have an x fraction, so the x half is dropped; y stays
      const r = run([ANDI(T2, T1, 0xffff), ADDU(T4, T1, T2)], 0xb0);
      expect(r.word).to.eql(SXY_WORD + 100);
      expect(r.frac).to.eql((SXY_FRAC & 0xf0) | 0x200);
    });

    it('should drop the fraction for a mask that cuts the coordinate', async () => {
      const r = run([ANDI(T4, T1, 0x00ff)], 0xc0);
      expect(r.frac).to.eql(0);
    });

    it('should drop the fraction when the position is subtracted', async () => {
      const r = run([SUBU(T4, 0, T1)], 0xd0);
      expect(r.frac).to.eql(0);
    });

    it('should not generate ALU tracking without CPU mode', async () => {
      globalThis.pgxp = saved.pgxp;
      globalThis.getCacheEntry = saved.getCacheEntry;
      try {
        const entry = runProgram([ADDIU(T4, T1, 0x10), SLL(T3, T1, 16), OR(T4, T2, T3), JR_RA, NOP]);
        expect(entry.code.toString().includes('pgxp.alu')).to.eql(false);
      }
      finally {
        use();
      }
    });

  });

  describe('coverage statistics (?debug-pgxp)', () => {

    const LUI = (rt, imm) => ((0x0f << 26) | (rt << 16) | (imm & 0xffff)) >>> 0;
    const ORI = (rt, rs, imm) => ((0x0d << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
    const SH = (rt, rs, off) => ((0x29 << 26) | (rs << 21) | (rt << 16) | (off & 0xffff)) >>> 0;
    const saved = {};
    const names = ['pgxp', 'pgxpMemFrac', 'pgxpGprFrac', 'getCacheEntry'];
    let logs, debugPgxp, debugGetCacheEntry;
    const savedLog = console.log;

    // linked-list packet at base: [header, cmd, xy0, xy1, xy2]
    const header = (base) => { map[base >>> 2] = ((4 << 24) | 0x00ffffff) | 0; map[(base >>> 2) + 1] = 0x20ffffff | 0; };
    const drawList = (base) => { gpu.dmaTransferMode0401(base, 0); pgxp.report(); return window.pgxpStats || ''; };

    before(async () => {
      for (const name of names) saved[name] = globalThis[name];
      window.location.search = '?pgxp&debug-pgxp';
      ({ pgxp: globalThis.pgxp, pgxpMemFrac: globalThis.pgxpMemFrac, pgxpGprFrac: globalThis.pgxpGprFrac } = include('enge:psx:pgxp'));
      ({ getCacheEntry: globalThis.getCacheEntry } = include('enge:psx:rec'));
      for (const name of ['fastCache', 'invalidateCache', 'codeWords', 'invalidateCodeWord']) {
        if (window[name]) globalThis[name] = window[name];
      }
      debugPgxp = globalThis.pgxp;
      debugGetCacheEntry = globalThis.getCacheEntry;
      logs = [];
      console.log = (...args) => logs.push(args.join(' '));
    });

    after(async () => {
      console.log = savedLog;
      window.location.search = '?pgxp';
      delete window.pgxpStats;
      for (const name of names) globalThis[name] = saved[name];
    });

    it('should count precise vertices and name the store that wrote the others', async () => {
      const base = 0x4000;
      header(base);
      projectPoint();
      cpu.gpr[T0] = base;
      const entry = runProgram([
        SWC2(SXY2, T0, 8),                              // xy0: precise
        LUI(T1, 0x0010), ORI(T1, T1, 0x0010), SW(T1, T0, 12), // xy1: SW of a constant
        ADDIU(T2, 0, 0x20), SH(T2, T0, 16), SH(T2, T0, 18),   // xy2: two halfwords
        JR_RA, NOP]);
      const at = (i) => '0x' + ((0x80000000 | (entry.pc + 4 * i)) >>> 0).toString(16).padStart(8, '0');
      const line = drawList(base);
      expect(line.includes('1/3 polygon vertices precise (33.3%)')).to.eql(true);
      expect(line.includes(`SW of a register without a fraction: 1 (at ${at(3)} x1)`)).to.eql(true);
      expect(line.includes(`written with SH (halfword): 1 (at ${at(6)} x1)`)).to.eql(true);
      expect(logs.includes(line)).to.eql(true);
    });

    it('should report vertices that were never stored by the CPU', async () => {
      const base = 0x5000;
      header(base);
      [0x00050005, 0x00100010, 0x00200020].forEach((w, i) => { map[(base >>> 2) + 2 + i] = w; }); // e.g. CD DMA
      const line = drawList(base);
      expect(line.includes('0/3 polygon vertices precise')).to.eql(true);
      expect(line.includes('never stored by the CPU (e.g. loaded by DMA): 3')).to.eql(true);
    });

    it('should report vertices changed after the last CPU store', async () => {
      const base = 0x6000;
      header(base);
      cpu.gpr[T0] = base;
      cpu.gpr[T1] = 0x00100010;
      runProgram([SW(T1, T0, 8), SW(T1, T0, 12), SW(T1, T0, 16), JR_RA, NOP]);
      map[(base >>> 2) + 2] = 0x00300030; // overwritten without a tracked store
      const line = drawList(base);
      expect(line.includes('changed after the last CPU store (DMA or an untracked path): 1')).to.eql(true);
      expect(line.includes('SW of a register without a fraction: 2')).to.eql(true);
    });

    it('should count polygons written to GP0 by the CPU', async () => {
      [0x20ffffff | 0, 0x00050005, 0x00100010, 0x00200020].forEach(w => gpu.wr32r1810(w));
      pgxp.report();
      expect((window.pgxpStats || '').includes('3 vertices in polygons written to GP0 by the CPU')).to.eql(true);
    });

    it('should not generate the statistics code without ?debug-pgxp', async () => {
      globalThis.getCacheEntry = saved.getCacheEntry;
      globalThis.pgxp = saved.pgxp;
      try {
        cpu.gpr[T0] = DATA;
        const entry = runProgram([SW(T1, T0, 0), SH(T1, T0, 4), SWC2(SXY2, T0, 8), JR_RA, NOP]);
        expect(entry.code.toString().includes('noteStore')).to.eql(false);
        expect(entry.code.toString().includes('pgxp.pc')).to.eql(false);
      }
      finally {
        globalThis.pgxp = debugPgxp;
        globalThis.getCacheEntry = debugGetCacheEntry;
      }
    });

  });

})
