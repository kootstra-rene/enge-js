
mdlr('[test]enge:psx:cpu', ({ include, test }) => {

  const { describe, it, expect, beforeEach, before, after } = test;

  const globalNames = ['vector', 'psx', 'map', 'gte'];
  const savedGlobals = {};
  const vector = { pc: 0x80000080 };

  // Records the GTE commands executed; every command takes 8 cycles.
  const gteCommands = [];
  const gte = {
    cycles: () => 8,
    command: (command) => gteCommands.push(command),
  };

  let cpu, cpuException, cpuInterrupt;

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    globalThis.vector = vector;
    globalThis.psx = { clock: 0, eventClock: 0 };
    globalThis.map = new Int32Array(0x4000);
    globalThis.gte = gte;
  });

  after(async () => {
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  beforeEach(async () => {
    ({ cpu, cpuException, cpuInterrupt } = include('enge:psx:cpu'));
    map.fill(0);
    gteCommands.length = 0;
    psx.clock = 0;
  });

  describe('edge triggered I_STAT', () => {

    it('should set I_STAT when the IRQ line becomes active', async () => {
      cpu.setIrqLine(0x80, true);
      expect(cpu.istat).to.eql(0x80);
    });

    it('should not set I_STAT again while the line stays active', async () => {
      cpu.setIrqLine(0x80, true);
      cpu.istat &= ~0x80; // acknowledge
      cpu.setIrqLine(0x80, true);
      expect(cpu.istat).to.eql(0);
    });

    it('should set I_STAT again after the line was released', async () => {
      cpu.setIrqLine(0x80, true);
      cpu.istat &= ~0x80;
      cpu.setIrqLine(0x80, false);
      cpu.setIrqLine(0x80, true);
      expect(cpu.istat).to.eql(0x80);
    });

    it('should not clear I_STAT when the line is released', async () => {
      cpu.setIrqLine(0x10, true);
      cpu.setIrqLine(0x10, false);
      expect(cpu.istat).to.eql(0x10);
    });

  });

  describe('CAUSE.IP2 (bit 10)', () => {

    it('should be set while I_STAT & I_MASK is non zero, before the IRQ is taken', async () => {
      cpu.istat = 0x01;
      cpu.imask = 0x01;
      expect((cpu.getCtrl(13) >> 10) & 1).to.eql(1);
    });

    it('should be clear when the pending IRQ is masked', async () => {
      cpu.istat = 0x01;
      cpu.imask = 0x02;
      expect((cpu.getCtrl(13) >> 10) & 1).to.eql(0);
    });

    it('should clear once the IRQ is acknowledged', async () => {
      cpu.sr = 0x401;
      cpu.istat = 0x01;
      cpu.imask = 0x01;
      expect(cpuInterrupt({ pc: 0x1000 })).to.eql(vector);
      expect(cpu.getCtrl(13) & 0x7c).to.eql(0x00); // excode 0 = interrupt
      cpu.istat = 0;
      expect((cpu.getCtrl(13) >> 10) & 1).to.eql(0);
    });

    it('should not be reported by a later syscall exception', async () => {
      cpu.sr = 0x401;
      cpu.istat = 0x01;
      cpu.imask = 0x01;
      cpuInterrupt({ pc: 0x1000 });
      cpu.istat = 0;
      cpuException(8 << 2, 0x2000);
      expect(cpu.getCtrl(13) >>> 0).to.eql(8 << 2);
    });

  });

  describe('interrupt check after unmasking', () => {

    // The main loop only checks interrupts once psx.clock reaches
    // psx.eventClock; eventClock 0 means "check after this block".
    beforeEach(async () => {
      psx.clock = 5000;
      psx.eventClock = 10000;
    });

    it('should request a check when SR is written', async () => {
      cpu.setCtrl(12, 0x401);
      expect(psx.eventClock).to.eql(0);
    });

    it('should request a check when CAUSE is written', async () => {
      cpu.setCtrl(13, 0x100);
      expect(psx.eventClock).to.eql(0);
    });

    it('should request a check on RFE', async () => {
      cpu.sr = 0x04;
      cpu.rfe();
      expect(cpu.sr & 0x0f).to.eql(0x01);
      expect(psx.eventClock).to.eql(0);
    });

    it('should not request a check for other COP0 registers', async () => {
      cpu.setCtrl(7, 0);
      expect(psx.eventClock).to.eql(10000);
    });

    it('should request a check when a device raises an IRQ', async () => {
      cpu.raiseIrq(0x08);
      expect(cpu.istat).to.eql(0x08);
      expect(psx.eventClock).to.eql(0);
    });

    it('should request a check on the rising edge of an IRQ line', async () => {
      cpu.setIrqLine(0x80, true);
      expect(psx.eventClock).to.eql(0);
    });

  });

  describe('software interrupts', () => {

    it('should be taken with excode 0 and keep IP0/IP1 in CAUSE', async () => {
      cpu.sr = 0x101;
      cpu.setCtrl(13, 0x100);
      expect(cpuInterrupt({ pc: 0x1000 })).to.eql(vector);
      expect(cpu.getCtrl(13) & 0x37c).to.eql(0x100);
      expect(cpu.epc).to.eql(0x1000);
    });

    it('should not be taken while masked in SR', async () => {
      cpu.sr = 0x201;
      cpu.setCtrl(13, 0x100);
      const entry = { pc: 0x1000 };
      expect(cpuInterrupt(entry)).to.eql(entry);
    });

  });

  describe('interrupt on a GTE command', () => {

    const RTPS = 0x4a180001;
    const NCLIP = 0x4b400006;
    const MTC2 = 0x48800000; // COP2 but not a command

    beforeEach(async () => {
      cpu.sr = 0x401;
      cpu.istat = 0x01;
      cpu.imask = 0x01;
    });

    it('should execute the GTE command before taking the interrupt', async () => {
      map[0x1000 >>> 2] = RTPS;
      expect(cpuInterrupt({ pc: 0x1000 })).to.eql(vector);
      expect(gteCommands).to.eql([RTPS & 0x1ffffff]);
      expect(cpu.epc).to.eql(0x1000); // the BIOS handler skips it on return
      expect(psx.clock).to.eql(8);
    });

    it('should recognise both COP2 command opcodes (0x4a and 0x4b)', async () => {
      map[0x1000 >>> 2] = NCLIP;
      cpuInterrupt({ pc: 0x1000 });
      expect(gteCommands).to.eql([NCLIP & 0x1ffffff]);
    });

    it('should not execute other COP2 instructions', async () => {
      map[0x1000 >>> 2] = MTC2;
      cpuInterrupt({ pc: 0x1000 });
      expect(gteCommands).to.eql([]);
    });

    it('should not execute the GTE command when no interrupt is taken', async () => {
      cpu.imask = 0;
      map[0x1000 >>> 2] = RTPS;
      cpuInterrupt({ pc: 0x1000 });
      expect(gteCommands).to.eql([]);
    });

  });

})
