mdlr('[test]enge:psx:rec', ({ include, test }) => {

  const { describe, it, expect, before, after } = test;

  const globalNames = ['window', 'psx', 'cpu', 'map', 'renderer', 'context', 'abort', 'hex', 'trace', 'calls', 'getCacheEntry', 'fastCache', 'invalidateCache'];
  const savedGlobals = {};

  // R-type JALR: rs in bits 21..25, rd in bits 11..15, funct 0x09
  const JALR = (rd, rs) => ((rs << 21) | (rd << 11) | 0x09) >>> 0;
  const NOP = 0;

  // Compile (first call) and run (second call) the block at pc.
  const runBlock = (pc) => getCacheEntry(pc).code(psx).code(psx);

  const runJalr = (pc, rd, rs) => {
    map[pc >> 2] = JALR(rd, rs);
    map[(pc + 4) >> 2] = NOP; // branch delay slot
    return runBlock(pc);
  };

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    globalThis.window = { location: { href: '', search: '' } };
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    globalThis.hex = (value, length) => (value >>> 0).toString(16).padStart(length || 8, '0');
    globalThis.trace = () => {};
    globalThis.calls = 0;
    globalThis.psx = { clock: 0, addEvent: () => ({}), setEvent: () => {} };
    globalThis.renderer = { fpsRenderCounter: 0, fpsCounter: 0 };
    globalThis.context = { counter: 0 };
    globalThis.map = new Int32Array(0x00200000 >> 2);
    globalThis.cpu = { gpr: new Int32Array(32), dr: 0, dv: 0 };
    ({ getCacheEntry: globalThis.getCacheEntry } = include('enge:psx:rec'));
    // compiled RAM blocks check the SMC guard through these window globals
    globalThis.fastCache = window.fastCache;
    globalThis.invalidateCache = window.invalidateCache;
  });

  after(async () => {
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  describe('JALR', () => {

    it('should jump to the old rs value when rd equals rs', async () => {
      cpu.gpr.fill(0);
      cpu.gpr[8] = 0x2000;
      const target = runJalr(0x1000, 8, 8); // jalr t0, t0
      expect(target.pc).to.eql(0x2000);
      expect(cpu.gpr[8]).to.eql(0x1008);
    });

    it('should jump to the old ra value for jalr ra, ra', async () => {
      cpu.gpr.fill(0);
      cpu.gpr[31] = 0x4000;
      const target = runJalr(0x3000, 31, 31);
      expect(target.pc).to.eql(0x4000);
      expect(cpu.gpr[31]).to.eql(0x3008);
    });

    it('should link into rd and leave rs untouched when they differ', async () => {
      cpu.gpr.fill(0);
      cpu.gpr[9] = 0x6000;
      const target = runJalr(0x5000, 31, 9); // jalr ra, t1
      expect(target.pc).to.eql(0x6000);
      expect(cpu.gpr[31]).to.eql(0x5008);
      expect(cpu.gpr[9]).to.eql(0x6000);
    });

    it('should not write r0 when rd is zero', async () => {
      cpu.gpr.fill(0);
      cpu.gpr[9] = 0x8000;
      const target = runJalr(0x7000, 0, 9); // jalr zero, t1
      expect(target.pc).to.eql(0x8000);
      expect(cpu.gpr[0]).to.eql(0);
    });

  });

})
