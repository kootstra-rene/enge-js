
mdlr('[test]enge:psx:cpu', ({ include, test }) => {

  const { describe, it, expect, beforeEach, before, after } = test;

  const savedVector = globalThis.vector;
  const vector = { pc: 0x80000080 };

  let cpu, cpuException, cpuInterrupt;

  before(async () => {
    globalThis.vector = vector;
  });

  after(async () => {
    if (savedVector === undefined) delete globalThis.vector;
    else globalThis.vector = savedVector;
  });

  beforeEach(async () => {
    ({ cpu, cpuException, cpuInterrupt } = include('enge:psx:cpu'));
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

})
