mdlr('[test]enge:psx:pgxp', ({ include, test }) => {

  const { describe, it, expect, before, after } = test;

  const globalNames = ['window', 'psx', 'cpu', 'map', 'ram', 'renderer', 'context', 'abort', 'hex', 'trace', 'calls',
    'getCacheEntry', 'memRead32', 'memWrite32', 'gte', 'pgxp', 'gpu', 'clearCodeCache',
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
  const VALID = 0x10;

  // RTPS result used throughout: SX2 = 100.25, SY2 = 50.75
  const SXY_WORD = (50 << 16) | 100;
  const SXY_FRAC = 1 | (3 << 2);

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

    it('should keep the quarter-pixel fraction of SX2/SY2', async () => {
      projectPoint();
      expect(gte.get(SXY2) >>> 0).to.eql(SXY_WORD);
      expect(gte.frac(SXY2)).to.eql(SXY_FRAC);
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

})
