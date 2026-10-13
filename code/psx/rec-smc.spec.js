mdlr('[test]enge:psx:rec-smc', ({ include, test }) => {

  const { describe, it, expect, before, after } = test;

  const globalNames = ['window', 'psx', 'cpu', 'map', 'renderer', 'context', 'abort', 'hex', 'trace', 'calls', 'getCacheEntry', 'codeWords', 'invalidateCodeWord'];
  const savedGlobals = {};

  // MIPS encodings used by the test programs
  const ADDIU = (rt, rs, imm) => ((0x09 << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
  const JR_RA = ((31 << 21) | 0x08) >>> 0;
  const NOP = 0;
  const V0 = 2, V1 = 3;
  const RETURN = 0x8000;

  let clearCodeCache;

  // Same RAM path as memWrite32 in mmu.js.
  const store32 = (addr, data) => {
    map[addr >>> 2] = data;
    if (codeWords[addr >>> 2]) invalidateCodeWord(addr);
  };

  const load = (addr, words) => words.forEach((word, i) => { map[(addr >>> 2) + i] = word; });

  // Run the block at pc (compiling it first when needed) and return the target.
  const run = (pc) => {
    let entry = getCacheEntry(pc);
    let target = entry.code(psx);
    if (target === entry) target = entry.code(psx); // first call only compiled
    return target;
  };

  const reset = () => {
    cpu.gpr.fill(0);
    cpu.gpr[31] = RETURN;
  };

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    globalThis.window = { location: { href: '', search: '' } };
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    // same as hex() in code/utils.js: keeps only the last `length` digits
    globalThis.hex = (value, length) => ('00000000' + (value >>> 0).toString(16)).substr(-(length || 8));
    globalThis.trace = () => {};
    globalThis.calls = 0;
    globalThis.psx = { clock: 0, addEvent: () => ({}), setEvent: () => {} };
    globalThis.renderer = { fpsRenderCounter: 0, fpsCounter: 0 };
    globalThis.context = { counter: 0 };
    globalThis.map = new Int32Array(0x00200000 >> 2);
    globalThis.cpu = { gpr: new Int32Array(32), dr: 0, dv: 0 };
    ({ getCacheEntry: globalThis.getCacheEntry, clearCodeCache } = include('enge:psx:rec'));
    globalThis.codeWords = window.codeWords;
    globalThis.invalidateCodeWord = window.invalidateCodeWord;
  });

  after(async () => {
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  describe('self-modifying code', () => {

    it('should run new code after a store into the middle of a block', async () => {
      load(0x1000, [NOP, NOP, ADDIU(V0, 0, 1), JR_RA, NOP]);
      reset();
      expect(run(0x1000).pc).to.eql(RETURN);
      expect(cpu.gpr[V0]).to.eql(1);

      store32(0x1008, ADDIU(V0, 0, 2));
      reset();
      run(0x1000);
      expect(cpu.gpr[V0]).to.eql(2);
    });

    it('should run new code after a store to the first word of a block', async () => {
      load(0x1100, [ADDIU(V0, 0, 1), JR_RA, NOP]);
      reset();
      run(0x1100);
      expect(cpu.gpr[V0]).to.eql(1);

      store32(0x1100, ADDIU(V0, 0, 3));
      reset();
      run(0x1100);
      expect(cpu.gpr[V0]).to.eql(3);
    });

    it('should not recompile a block when data next to it is written', async () => {
      load(0x1200, [ADDIU(V0, 0, 1), JR_RA, NOP, 0x12345678]);
      reset();
      run(0x1200);
      const compiled = getCacheEntry(0x1200).code;

      store32(0x120c, 0x0badf00d); // the word right after the delay slot
      store32(0x11fc, 0x0badf00d); // the word right before the block
      expect(getCacheEntry(0x1200).code).to.eql(compiled);
    });

    it('should invalidate a block that spans two code lines from either line', async () => {
      // 0x13f8..0x1408 crosses the 256-byte line boundary at 0x1400
      load(0x13f8, [ADDIU(V0, 0, 1), NOP, ADDIU(V1, 0, 1), JR_RA, NOP]);
      reset();
      run(0x13f8);
      expect([cpu.gpr[V0], cpu.gpr[V1]]).to.eql([1, 1]);

      store32(0x1400, ADDIU(V1, 0, 2)); // second line
      reset();
      run(0x13f8);
      expect([cpu.gpr[V0], cpu.gpr[V1]]).to.eql([1, 2]);

      store32(0x13f8, ADDIU(V0, 0, 2)); // first line
      reset();
      run(0x13f8);
      expect([cpu.gpr[V0], cpu.gpr[V1]]).to.eql([2, 2]);
    });

    it('should invalidate every block containing the word when blocks overlap', async () => {
      load(0x1500, [NOP, NOP, ADDIU(V0, 0, 1), ADDIU(V1, 0, 1), JR_RA, NOP]);
      reset();
      run(0x1500);
      reset();
      run(0x1508); // a second block entered in the middle of the first

      store32(0x150c, ADDIU(V1, 0, 5));
      reset();
      run(0x1500);
      expect(cpu.gpr[V1]).to.eql(5);
      reset();
      run(0x1508);
      expect(cpu.gpr[V1]).to.eql(5);
    });

    it('should stop watching a word once no compiled block contains it', async () => {
      load(0x1600, [ADDIU(V0, 0, 1), JR_RA, NOP]);
      reset();
      run(0x1600);
      expect(codeWords[0x1600 >>> 2]).to.eql(1);

      store32(0x1600, ADDIU(V0, 0, 2));
      expect(codeWords[0x1600 >>> 2]).to.eql(0);

      reset();
      run(0x1600);
      expect(codeWords[0x1600 >>> 2]).to.eql(1);
    });

    it('should invalidate blocks covered by a DMA write (clearCodeCache)', async () => {
      load(0x1700, [NOP, NOP, ADDIU(V0, 0, 1), JR_RA, NOP]);
      reset();
      run(0x1700);
      expect(cpu.gpr[V0]).to.eql(1);

      map[0x1708 >>> 2] = ADDIU(V0, 0, 7); // DMA writes RAM directly
      clearCodeCache(0x80001708, 4);
      reset();
      run(0x1700);
      expect(cpu.gpr[V0]).to.eql(7);
    });

    it('should handle a DMA range that wraps around the end of RAM', async () => {
      load(0x0040, [NOP, ADDIU(V0, 0, 1), JR_RA, NOP]);
      reset();
      run(0x0040);
      expect(cpu.gpr[V0]).to.eql(1);

      map[0x0044 >>> 2] = ADDIU(V0, 0, 9);
      clearCodeCache(0x001fff00, 0x200); // 0x1fff00..0x200100, wraps to 0x0000..0x0100
      reset();
      run(0x0040);
      expect(cpu.gpr[V0]).to.eql(9);
    });

  });

})
