mdlr('[test]enge:psx:dma', ({ include, test }) => {

  const { describe, it, expect, beforeEach, before, after } = test;

  // Ported from ps1-tests dma/otc-test (https://github.com/JaCzekanski/ps1-tests,
  // MIT). Only the 13 cases listed as passing in its psx.log, captured on real
  // hardware, are included.

  const globalNames = ['window', 'psx', 'cpu', 'gpu', 'ram', 'renderer', 'abort', 'hex', 'clearCodeCache'];
  const savedGlobals = {};

  const DPCR = 0x10f0;
  const MADR = 0x10e0;
  const BCR = 0x10e4;
  const CHCR = 0x10e8;

  // CHCR::OTC(): to RAM, backward, sync mode 0, start, manual trigger
  const OTC = 0x11000002;

  const createScheduler = () => {
    const events = [];
    const psx = {
      clock: 0,
      addEvent: (clocks, cb) => {
        const event = { active: false, clock: psx.clock + clocks, start: psx.clock, cb };
        events.push(event);
        return event;
      },
      setEvent: (event, clocks) => { event.active = true; event.start = psx.clock; event.clock = psx.clock + clocks; },
      updateEvent: (event, clocks) => { event.active = true; event.start = event.clock; event.clock += clocks; },
      unsetEvent: event => { event.active = false; },
      // the CPU is stalled while the OTC runs: let pending transfers complete
      settle: () => {
        for (let guard = 0; guard < 1000; ++guard) {
          const due = events.filter(e => e.active);
          if (!due.length) return;
          const next = due.reduce((a, b) => (b.clock < a.clock ? b : a));
          psx.clock = Math.max(psx.clock, next.clock);
          next.cb(next, psx.clock);
        }
      },
    };
    return psx;
  };

  let dma;

  const BASE = 0x1000;
  const fill = () => [0x11111111, 0x22222222, 0x33333333, 0x44444444].forEach((v, i) => ram.setUint32(BASE + 4 * i, v, true));
  const buf = () => [0, 1, 2, 3].map(i => ram.getUint32(BASE + 4 * i, true));
  const cleared = [0x00ffffff, BASE, BASE + 4, BASE + 8];
  const untouched = [0x11111111, 0x22222222, 0x33333333, 0x44444444];

  // setupDmaOtc(&buf[3], 4, control)
  const runOtc = (control, words = 4) => {
    dma.wr32(MADR, BASE + 12);
    dma.wr32(BCR, words);
    dma.wr32(CHCR, control);
    psx.settle();
  };

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    globalThis.window = { location: { search: '' } };
    globalThis.clearCodeCache = () => {};
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    globalThis.hex = (value, length) => (value >>> 0).toString(16).padStart(length || 8, '0');
    globalThis.renderer = new Proxy({}, { get: () => () => {} });
  });

  after(async () => {
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  beforeEach(async () => {
    globalThis.psx = createScheduler();
    globalThis.cpu = { istat: 0, raiseIrq(mask) { this.istat |= mask; } };
    globalThis.ram = new DataView(new ArrayBuffer(2 * 1024 * 1024));
    ({ gpu: globalThis.gpu } = include('enge:psx:gpu'));
    ({ dma } = include('enge:psx:dma'));
    dma.wr32(DPCR, 0x08000000); // only the OTC master enable, as in the test
    fill();
  });

  describe('OTC transfers (channel 6)', () => {

    it('should build a reverse linked list ending in 0xffffff', async () => {
      runOtc(OTC);
      expect(buf()).to.eql(cleared);
    });

    it('should not start with the automatic start trigger', async () => {
      runOtc(OTC & ~0x10000000);
      expect(buf()).to.eql(untouched);
    });

    it('should not start without the start flag', async () => {
      runOtc(OTC & ~0x01000000);
      expect(buf()).to.eql(untouched);
    });

    it('should ignore a forward address step', async () => {
      runOtc(OTC & ~0x00000002);
      expect(buf()).to.eql(cleared);
    });

    it('should ignore the from-RAM direction', async () => {
      runOtc(OTC | 0x00000001);
      expect(buf()).to.eql(cleared);
    });

    it('should ignore sync mode 1 (blocks)', async () => {
      runOtc(OTC | (1 << 9));
      expect(buf()).to.eql(cleared);
    });

    it('should ignore sync mode 2 (linked list)', async () => {
      runOtc(OTC | (2 << 9));
      expect(buf()).to.eql(cleared);
    });

    it('should ignore the reserved sync mode 3', async () => {
      runOtc(OTC | (3 << 9));
      expect(buf()).to.eql(cleared);
    });

    it('should not transfer while the OTC master enable is off', async () => {
      dma.wr32(DPCR, 0x00000000);
      runOtc(OTC);
      expect(buf()).to.eql(untouched);
    });

  });

  describe('OTC control register', () => {

    it('should hardwire unwritable bits to zero', async () => {
      dma.wr32(CHCR, 0b01110000011101110000011100000011);
      expect(dma.rd32(CHCR) >>> 0).to.eql(0b01010000000000000000000000000010);
    });

    it('should hardwire the backward step bit to one', async () => {
      dma.wr32(CHCR, 0);
      expect(dma.rd32(CHCR) >>> 0).to.eql(0b10);
    });

    it('should read unused control bits as zero', async () => {
      dma.wr32(CHCR, 0b10001110100010001111100011111100);
      expect(dma.rd32(CHCR) >>> 0).to.eql(0b10);
    });

    it('should clear start and trigger after a transfer', async () => {
      runOtc(OTC, 32 * 1024);
      expect(dma.rd32(CHCR) >>> 0).to.eql(0b10);
    });

  });

  describe('DICR interrupt flags', () => {

    const DICR = 0x10f4;
    const EN6 = 1 << 22;   // channel 6 IRQ enable
    const FLAG6 = 1 << 30; // channel 6 IRQ flag
    const MASTER = 1 << 23;

    it('should raise IRQ3 when a completed channel is enabled', async () => {
      dma.wr32(DICR, MASTER | EN6);
      runOtc(OTC);
      expect(dma.rd32(DICR) >>> 0).to.eql((0x80000000 | FLAG6 | MASTER | EN6) >>> 0);
      expect(cpu.istat).to.eql(0x08);
    });

    it('should not set the flag without the master enable', async () => {
      dma.wr32(DICR, EN6);
      runOtc(OTC);
      expect(dma.rd32(DICR) >>> 0).to.eql(EN6);
      expect(cpu.istat).to.eql(0);
    });

    it('should not set the flag for a channel that is not enabled', async () => {
      dma.wr32(DICR, MASTER);
      runOtc(OTC);
      expect(dma.rd32(DICR) >>> 0).to.eql(MASTER);
      expect(cpu.istat).to.eql(0);
    });

    it('should keep b31 set when the channel enable is turned off', async () => {
      dma.wr32(DICR, MASTER | EN6);
      runOtc(OTC);
      dma.wr32(DICR, MASTER);
      expect(dma.rd32(DICR) >>> 0).to.eql((0x80000000 | FLAG6 | MASTER) >>> 0);
    });

    it('should acknowledge a flag with a byte store to 0x10f7, clearing the other lanes', async () => {
      dma.wr32(DICR, MASTER | EN6 | 0x3f);
      runOtc(OTC);
      dma.wr08(0x10f7, 0x40);
      expect(dma.rd32(DICR) >>> 0).to.eql(0);
    });

    it('should clear the enables on a halfword store to the low half', async () => {
      dma.wr32(DICR, MASTER | EN6);
      dma.wr16(0x10f4, 0x8000);
      expect(dma.rd32(DICR) >>> 0).to.eql((0x80000000 | 0x8000) >>> 0);
      expect(cpu.istat).to.eql(0x08);
    });

    it('should write the enables with a halfword store to 0x10f6', async () => {
      dma.wr32(DICR, 0x3f);
      dma.wr16(0x10f6, 0x00c0);
      expect(dma.rd32(DICR) >>> 0).to.eql(MASTER | EN6);
    });

  });

  describe('register access', () => {

    it('should read DICR in byte and halfword lanes', async () => {
      dma.wr32(0x10f4, 0x00c0803f);
      expect(dma.rd08(0x10f4)).to.eql(0x3f);
      expect(dma.rd08(0x10f5)).to.eql(0x80);
      expect(dma.rd08(0x10f6)).to.eql(0xc0);
      expect(dma.rd08(0x10f7)).to.eql(0x80); // b31: forced by b15
      expect(dma.rd16(0x10f6)).to.eql(0x80c0);
      expect(dma.rd16(0x10f4)).to.eql(0x803f);
    });

    it('should read unmapped registers as zero', async () => {
      for (const reg of [0x10d0, 0x10d4, 0x10d8, 0x10f8, 0x10fc]) {
        expect(dma.rd32(reg)).to.eql(0);
        expect(dma.rd16(reg + 2)).to.eql(0);
        expect(dma.rd08(reg + 3)).to.eql(0);
      }
    });

    it('should ignore writes to unmapped registers', async () => {
      for (const reg of [0x10d0, 0x10d4, 0x10d8, 0x10f8, 0x10fc]) {
        dma.wr32(reg, 0xffffffff);
        dma.wr16(reg + 2, 0xffff);
        dma.wr08(reg + 1, 0xff);
      }
      expect(dma.rd32(0x10f4) >>> 0).to.eql(0);
    });

    it('should clear the other lanes of MADR on a halfword store', async () => {
      dma.wr32(MADR, 0x00123456);
      dma.wr16(MADR + 2, 0x0078);
      expect(dma.rd32(MADR)).to.eql(0x00780000);
    });

    it('should keep the other lanes of BCR on byte and halfword stores', async () => {
      dma.wr32(BCR, 0x12345678);
      dma.wr16(BCR + 2, 0xabcd);
      expect(dma.rd32(BCR) >>> 0).to.eql(0xabcd5678);
      dma.wr08(BCR + 1, 0xef);
      expect(dma.rd32(BCR) >>> 0).to.eql(0xabcdef78);
    });

  });

})
