mdlr('[test]enge:psx:rec', ({ include, test }) => {

  const { describe, it, expect, before, after } = test;

  const { stubWindow } = include('enge:psx:test-window');
  let restoreWindow;

  const globalNames = ['psx', 'cpu', 'map', 'renderer', 'context', 'abort', 'hex', 'trace', 'calls', 'getCacheEntry', 'fastCache', 'invalidateCache', 'memRead32'];
  const savedGlobals = {};

  // R-type JALR: rs in bits 21..25, rd in bits 11..15, funct 0x09
  const JALR = (rd, rs) => ((rs << 21) | (rd << 11) | 0x09) >>> 0;
  const NOP = 0;
  const I = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
  const LW = (rt, rs, imm) => I(0x23, rs, rt, imm);
  const LWL = (rt, rs, imm) => I(0x22, rs, rt, imm);
  const LWR = (rt, rs, imm) => I(0x26, rs, rt, imm);
  const ADDIU = (rt, rs, imm) => I(0x09, rs, rt, imm);
  const ADDU = (rd, rs, rt) => ((rs << 21) | (rt << 16) | (rd << 11) | 0x21) >>> 0;
  const JR_RA = ((31 << 21) | 0x08) >>> 0;
  const MTC0 = (rt, rd) => ((0x10 << 26) | (4 << 21) | (rt << 16) | (rd << 11)) >>> 0;
  const RFE = 0x42000010;
  const V0 = 2, V1 = 3, A0 = 4, A1 = 5, T0 = 8, T1 = 9;
  const DATA = 0x10000;
  const RETURN = 0x8000;

  const load = (addr, words) => words.forEach((word, i) => { map[(addr >>> 2) + i] = word; });

  const reset = () => {
    cpu.gpr.fill(0);
    cpu.dr = cpu.dv = 0;
    cpu.gpr[31] = RETURN;
    cpu.gpr[A0] = DATA;
  };

  // Compile (first call) and run (second call) the block at pc.
  const runBlock = (pc) => getCacheEntry(pc).code(psx).code(psx);

  const runJalr = (pc, rd, rs) => {
    map[pc >> 2] = JALR(rd, rs);
    map[(pc + 4) >> 2] = NOP; // branch delay slot
    return runBlock(pc);
  };

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    restoreWindow = stubWindow({ location: { href: '', search: '' } });
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    globalThis.hex = (value, length) => (value >>> 0).toString(16).padStart(length || 8, '0');
    globalThis.trace = () => {};
    globalThis.calls = 0;
    globalThis.psx = { clock: 0, addEvent: () => ({}), setEvent: () => {} };
    globalThis.renderer = { fpsRenderCounter: 0, fpsCounter: 0 };
    globalThis.context = { counter: 0 };
    globalThis.map = new Int32Array(0x00200000 >> 2);
    globalThis.memRead32 = addr => map[addr >>> 2];
    const { cpu: realCpu } = include('enge:psx:cpu');
    globalThis.cpu = {
      gpr: new Int32Array(32), dr: 0, dv: 0,
      lwl: realCpu.lwl, lwr: realCpu.lwr,
      setCtrl: (reg, value) => cpu.writes.push([reg, value]),
      rfe: () => cpu.writes.push(['rfe']),
      writes: [],
    };
    ({ getCacheEntry: globalThis.getCacheEntry } = include('enge:psx:rec'));
    // compiled RAM blocks check the SMC guard through these window globals
    globalThis.fastCache = window.fastCache;
    globalThis.invalidateCache = window.invalidateCache;
  });

  after(async () => {
    restoreWindow();
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

  describe('load delay', () => {

    it('should cancel the first of two loads to the same register', async () => {
      reset();
      cpu.gpr[V0] = 0x11111111;
      load(DATA, [0xaaaaaaaa, 0xbbbbbbbb]);
      load(0x9000, [LW(V0, A0, 0), LW(V0, A0, 4), ADDU(V1, V0, 0), ADDU(A1, V0, 0), JR_RA, NOP]);
      runBlock(0x9000);
      expect(cpu.gpr[V1]).to.eql(0x11111111); // delay slot of 2nd load: 1st was cancelled
      expect(cpu.gpr[A1]).to.eql(0xbbbbbbbb | 0);
    });

    it('should delay the LWL result by one instruction', async () => {
      reset();
      cpu.gpr[V0] = 0x11111111;
      load(DATA, [0xaabbccdd]);
      load(0x9100, [LWL(V0, A0, 3), ADDU(V1, V0, 0), ADDU(A1, V0, 0), JR_RA, NOP]);
      runBlock(0x9100);
      expect(cpu.gpr[V1]).to.eql(0x11111111);
      expect(cpu.gpr[A1]).to.eql(0xaabbccdd | 0);
    });

    it('should delay the LWR result by one instruction', async () => {
      reset();
      cpu.gpr[V0] = 0x11111111;
      load(DATA, [0xaabbccdd]);
      load(0x9180, [LWR(V0, A0, 0), ADDU(V1, V0, 0), ADDU(A1, V0, 0), JR_RA, NOP]);
      runBlock(0x9180);
      expect(cpu.gpr[V1]).to.eql(0x11111111);
      expect(cpu.gpr[A1]).to.eql(0xaabbccdd | 0);
    });

    it('should load an unaligned word with an LWL/LWR pair', async () => {
      reset();
      cpu.gpr[A0] = DATA + 1;
      load(DATA, [0x44332211, 0x88776655]);
      load(0x9200, [LWL(V0, A0, 3), LWR(V0, A0, 0), NOP, ADDU(V1, V0, 0), JR_RA, NOP]);
      runBlock(0x9200);
      expect(cpu.gpr[V1]).to.eql(0x55443322);
    });

    it('should merge LWL into the value of a pending load to the same register', async () => {
      reset();
      cpu.gpr[V0] = 0x11111111;
      load(DATA, [0x12345678, 0xaabbccdd]);
      load(0x9300, [LW(V0, A0, 0), LWL(V0, A0, 5), NOP, ADDU(V1, V0, 0), JR_RA, NOP]);
      runBlock(0x9300);
      expect(cpu.gpr[V1]).to.eql(0xccdd5678 | 0);
    });

    it('should merge LWL into a load deferred from the previous block', async () => {
      reset();
      cpu.gpr[V0] = 0x11111111;
      cpu.gpr[31] = 0x9500;
      load(DATA, [0x12345678, 0xaabbccdd]);
      load(0x9400, [JR_RA, LW(V0, A0, 0)]); // load in the branch delay slot
      load(0x9500, [LWL(V0, A0, 5), NOP, ADDU(V1, V0, 0), JR_RA, NOP]);
      expect(runBlock(0x9400).pc).to.eql(0x9500);
      expect(cpu.dr).to.eql(V0);
      runBlock(0x9500);
      expect(cpu.gpr[V1]).to.eql(0xccdd5678 | 0);
    });

  });

  describe('interrupt check', () => {

    it('should end the block after MTC0 to SR', async () => {
      reset();
      cpu.writes = [];
      load(0x9600, [ADDIU(T0, 0, 0x401), MTC0(T0, 12), ADDIU(T1, 0, 2), JR_RA, NOP]);
      expect(runBlock(0x9600).pc).to.eql(0x9608);
      expect(cpu.writes).to.eql([[12, 0x401]]);
      expect(cpu.gpr[T1]).to.eql(0);
    });

    it('should end the block after MTC0 to CAUSE', async () => {
      reset();
      load(0x9680, [MTC0(T0, 13), ADDIU(T1, 0, 2), JR_RA, NOP]);
      expect(runBlock(0x9680).pc).to.eql(0x9684);
    });

    it('should not end the block after MTC0 to other registers', async () => {
      reset();
      load(0x9700, [MTC0(T0, 7), ADDIU(T1, 0, 2), JR_RA, NOP]);
      expect(runBlock(0x9700).pc).to.eql(RETURN);
      expect(cpu.gpr[T1]).to.eql(2);
    });

    it('should end the block after RFE', async () => {
      reset();
      load(0x9800, [RFE, ADDIU(T1, 0, 2), JR_RA, NOP]);
      expect(runBlock(0x9800).pc).to.eql(0x9804);
      expect(cpu.gpr[T1]).to.eql(0);
    });

    it('should carry a pending load across the block end', async () => {
      reset();
      cpu.gpr[V0] = 0x11111111;
      load(DATA, [0x12345678]);
      load(0x9900, [LW(V0, A0, 0), MTC0(V0, 12), JR_RA, NOP]);
      expect(runBlock(0x9900).pc).to.eql(0x9908);
      expect(cpu.writes.pop()).to.eql([12, 0x11111111]); // MTC0 is in the load delay slot
      expect(cpu.gpr[V0]).to.eql(0x12345678);
    });

  });

})
