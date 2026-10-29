mdlr('[test]enge:psx:dma-hardware', ({ include, test }) => {

  const { describe, it, expect, beforeEach, after } = test;

  // Ported from the nugget DMA tests (https://github.com/pcsx-redux/nugget,
  // tests/dma, MIT), which check the DMA controller on real hardware: GPU
  // transfers in block and linked-list mode, DICR interrupt flags and OTC.
  // The register accesses are the tests' own; the polling loops wait in
  // emulated time.

  const { createMachine } = include('enge:psx:test-machine');

  const GPU_DATA = 0x1f801810, GPU_STATUS = 0x1f801814;
  const IREG = 0x1f801070, IMASK = 0x1f801074;
  const DPCR = 0x1f8010f0, DICR = 0x1f8010f4;
  const IRQ_VBLANK = 1 << 0, IRQ_DMA = 1 << 3;
  const DMA_GPU = 2, DMA_GPUOTC = 6;
  const MADR = ch => 0x1f801080 + 16 * ch, BCR = ch => MADR(ch) + 4, CHCR = ch => MADR(ch) + 8;

  const BUF = 0x80100000; // where the test's local variables live

  let m;
  beforeEach(async () => { m = createMachine(); });
  after(async () => { m?.dispose(); });

  const r32 = addr => m.read32(addr) >>> 0;
  const w32 = (addr, value) => m.write32(addr, value >> 0);
  const sendGPUStatus = v => w32(GPU_STATUS, v);
  const sendGPUData = v => w32(GPU_DATA, v);

  // while (cond()) poll; gives up after `cycles`
  const waitWhile = (cond, cycles = 33868800, step = 32) => m.idleUntil(() => !cond(), cycles, step);

  // the tests' wait loop: until a DMA IRQ, counting VBlanks up to `limit`
  const waitDmaIrq = limit => {
    let count = 0;
    for (;;) {
      if (waitWhile(() => (r32(IREG) & (IRQ_VBLANK | IRQ_DMA)) === 0, 33868800, 256) < 0) return 1;
      if (r32(IREG) & IRQ_DMA) return 0;
      w32(IREG, r32(IREG) & ~IRQ_VBLANK);
      if (count++ === limit) return 1;
    }
  };

  // The common start of the GPU DMA tests: GPU reset, display on, E1 = 0,
  // DMA channel 2 enabled (or not), DICR with the channel 2 IRQ enabled,
  // DMA direction CPU -> GP0, and the words the transfer starts from.
  const startGpuDma = ({ dpcr = 0x00000800, words, madr = addr => addr, bcr, chcr }) => {
    sendGPUStatus(0);
    sendGPUStatus(0x04000001);
    sendGPUData(0xe1000000);
    w32(DPCR, dpcr);
    w32(DICR, 0x00840000);
    w32(IMASK, IRQ_VBLANK | IRQ_DMA);
    m.load(BUF, words);
    sendGPUStatus(0x04000002);
    waitWhile(() => (r32(GPU_STATUS) & 0x10000000) === 0);
    w32(MADR(DMA_GPU), madr(BUF));
    w32(BCR(DMA_GPU), bcr);
    w32(CHCR(DMA_GPU), chcr);
  };

  const finishGpuDma = limit => {
    const timeout = waitDmaIrq(limit);
    w32(IREG, 0);
    return {
      timeout,
      exceptions: m.exceptions.length,
      stat: r32(GPU_STATUS) & 0x000007ff,
      bcr: r32(BCR(DMA_GPU)),
      madr: r32(MADR(DMA_GPU)),
      chcr: r32(CHCR(DMA_GPU)),
      dicr: r32(DICR),
    };
  };

  const hex = v => '0x' + (v >>> 0).toString(16).padStart(8, '0');
  const asHex = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'timeout' || k === 'exceptions' ? v : hex(v)]));

  describe('GPU DMA, block mode', () => {

    // One word, E1 = 555h, block mode: finishes, DICR flag set, BCR counted.
    const normal = (name, madr) => it(name, async () => {
      startGpuDma({ words: [0xe1000555], madr, bcr: 0x00010001, chcr: 0x01000201 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 1, madr: (BUF + 4) & 0xffffff, chcr: 0x00000201, dicr: 0x84840000,
      }));
      w32(DICR, (r.dicr & ~0x7f000000) | 0x04000000);
      expect(hex(r32(DICR))).to.eql(hex(0x00840000));
    });

    normal('normal_dma');
    normal('normal_dma_with_3_upper_bits', addr => (addr | 0xe0000000) >>> 0);
    normal('normal_dma_with_8_upper_bits', addr => (addr | 0xff000000) >>> 0);

    it('normal_dma_odd_address', async () => {
      startGpuDma({ words: [0xe1000555], madr: addr => addr | 3, bcr: 0x00010001, chcr: 0x01000201 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 1, madr: ((BUF + 4) & 0xffffff) | 3, chcr: 0x00000201, dicr: 0x84840000,
      }));
      w32(DICR, (r.dicr & ~0x7f000000) | 0x04000000);
      expect(hex(r32(DICR))).to.eql(hex(0x00840000));
    });

    // DICR master enable, channel enable and force bits gate the IRQ: the
    // flag stays set, but a DMA IRQ is only signalled while the flag is set
    // and an edge of the master flag (bit 31) happens.
    it('normal_dma_dicr_toggle', async () => {
      startGpuDma({ words: [0xe1000555], bcr: 0x00010001, chcr: 0x01000201 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 1, madr: (BUF + 4) & 0xffffff, chcr: 0x00000201, dicr: 0x84840000,
      }));
      const step = (dicr, limit, timeout, expected) => {
        w32(DICR, dicr);
        const read = r32(DICR);
        const t = waitDmaIrq(limit);
        w32(IREG, 0);
        expect({ timeout: t, dicr: hex(read) }).to.eql({ timeout, dicr: hex(expected) });
      };
      step(0x00800000, 32, 1, 0x84800000);
      step(0x00000000, 32, 1, 0x04000000);
      step(0x00800000, 128, 0, 0x84800000);
      step(0x00008000, 32, 1, 0x84008000);
      step(0x00800000, 32, 1, 0x84800000);
    });

    // A transfer started with the channel disabled in DPCR stays pending
    // (CHCR busy, MADR/BCR untouched, no IRQ).
    const disabled = (name, offset) => it(name, async () => {
      startGpuDma({ dpcr: 0, words: [0xe1000555], madr: addr => addr | offset, bcr: 0x00010001, chcr: 0x01000201 });
      const r = finishGpuDma(32);
      expect(asHex(r)).to.eql(asHex({
        timeout: 1, exceptions: 0, stat: 0, bcr: 0x00010001, madr: (BUF & 0xffffff) | offset, chcr: 0x01000201, dicr: 0x00840000,
      }));
    });

    disabled('disabled_dma', 0);
    disabled('disabled_dma_odd_address', 3);

  });

  describe('GPU DMA, linked-list mode', () => {

    // node header: next address in bits 0-23, word count in 24-31
    const node = (count, next) => (((count << 24) | (next & 0xffffff)) >>> 0);

    // three one-word nodes: two GP0 nops, then E1 with the terminator
    it('linked_dma_3_links', async () => {
      const words = [node(1, BUF + 8), 0, node(1, BUF + 16), 0, 0x01ffffff, 0xe1000555];
      startGpuDma({ words, bcr: 0x12345678, chcr: 0x01000401 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 0x12345678, madr: 0x00ffffff, chcr: 0x00000401, dicr: 0x84840000,
      }));
      w32(DICR, (r.dicr & ~0x7f000000) | 0x04000000);
      expect(hex(r32(DICR))).to.eql(hex(0x00840000));
    });

    // The same with bits 0-1 set in the links: the controller ignores them.
    it('linked_dma_3_oddlinks', async () => {
      const words = [node(1, BUF + 8) | 3, 0, node(1, BUF + 16) | 3, 0, 0x01ffffff, 0xe1000555];
      startGpuDma({ words, bcr: 0x12345678, chcr: 0x01000401 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 0x12345678, madr: 0x00ffffff, chcr: 0x00000401, dicr: 0x84840000,
      }));
      w32(DICR, (r.dicr & ~0x7f000000) | 0x04000000);
      expect(hex(r32(DICR))).to.eql(hex(0x00840000));
    });

    it('linked_dma_ffffff_terminator', async () => {
      startGpuDma({ words: [0x01ffffff, 0xe1000555], bcr: 0x12345678, chcr: 0x01000401 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 0x12345678, madr: 0x00ffffff, chcr: 0x00000401, dicr: 0x84840000,
      }));
      w32(DICR, (r.dicr & ~0x7f000000) | 0x04000000);
      expect(hex(r32(DICR))).to.eql(hex(0x00840000));
    });

    // Any address with bit 23 set ends the list, MADR keeps it and DICR bit
    // 15 (bus error) is set as well.
    const terminator = (name, word, madr) => it(name, async () => {
      startGpuDma({ words: [word, 0xe1000555], bcr: 0x12345678, chcr: 0x01000401 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 0x12345678, madr, chcr: 0x00000401, dicr: 0x84848000,
      }));
      let dicr = r.dicr & 0xffffff;
      w32(DICR, dicr | 0x04000000);
      dicr = r32(DICR);
      expect(hex(dicr)).to.eql(hex(0x80848000));
      dicr &= 0xff7fff;
      w32(DICR, dicr);
      expect(hex(r32(DICR))).to.eql(hex(0x00840000));
    });

    terminator('linked_dma_fffff0_terminator', 0x01fffff0, 0x00fffff0);
    terminator('linked_dma_800000_terminator', 0x01800000, 0x00800000);
    terminator('linked_dma_800001_terminator', 0x01800001, 0x00800001);

    // MADR and DICR bit 15 as for the terminators above
    it('linked_dma_800000_terminator_dicr_toggle', async () => {
      startGpuDma({ words: [0x01800000, 0xe1000555], bcr: 0x12345678, chcr: 0x01000401 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 0x12345678, madr: 0x00800000, chcr: 0x00000401, dicr: 0x84848000,
      }));
      w32(DICR, 0x00008000);
      expect(hex(r32(DICR))).to.eql(hex(0x84008000));
      w32(DICR, 0x00000000);
      expect(hex(r32(DICR))).to.eql(hex(0x04000000));
    });

    // The node points at a word holding the terminator, with bits 0-1 set.
    it('linked_dma_odd_terminator', async () => {
      const terminatorAt = BUF + 8;
      startGpuDma({ words: [((terminatorAt & 0xffffff) | 0x01000001) >>> 0, 0xe1000555, 0x00ffffff], bcr: 0x12345678, chcr: 0x01000401 });
      const r = finishGpuDma(128);
      expect(asHex(r)).to.eql(asHex({
        timeout: 0, exceptions: 0, stat: 0x555, bcr: 0x12345678, madr: 0x00ffffff, chcr: 0x00000401, dicr: 0x84840000,
      }));
      w32(DICR, (r.dicr & 0xffffff) | 0x04000000);
      expect(hex(r32(DICR))).to.eql(hex(0x00840000));
    });

  });

  describe('OTC (channel 6)', () => {

    const OTC_BUF = 0x80110000; // s_otcBuf[10]
    const otcAt = i => OTC_BUF + 4 * i;

    // otcRun: clear the table, start the channel with chcrWrite, optionally
    // change DPCR, poll CHCR busy, read everything back
    const otcRun = (dpcrBefore, chcrWrite, dpcrAfter) => {
      m.load(OTC_BUF, new Array(10).fill(0xdeadbeef));
      w32(DPCR, dpcrBefore);
      w32(DICR, 0x00c00000);
      w32(IREG, 0);
      w32(CHCR(DMA_GPUOTC), 0);
      w32(MADR(DMA_GPUOTC), otcAt(8));
      w32(BCR(DMA_GPUOTC), 8);
      w32(CHCR(DMA_GPUOTC), chcrWrite);
      const before = r32(CHCR(DMA_GPUOTC));
      if (dpcrAfter !== dpcrBefore) w32(DPCR, dpcrAfter);
      const timeout = waitWhile(() => r32(CHCR(DMA_GPUOTC)) & 0x01000000, 1000000) < 0 ? 1 : 0;
      const r = {
        before, timeout,
        chcr: r32(CHCR(DMA_GPUOTC)), madr: r32(MADR(DMA_GPUOTC)), bcr: r32(BCR(DMA_GPUOTC)), dicr: r32(DICR),
      };
      w32(CHCR(DMA_GPUOTC), 0);
      w32(DICR, 0x7f000000);
      w32(DICR, 0);
      w32(IREG, 0);
      r.good = 0;
      for (let i = 2; i <= 8; ++i) {
        if (m.peek32(otcAt(i)) === (otcAt(i - 1) & 0xffffff)) r.good++;
      }
      r.term = m.peek32(otcAt(1));
      r.guardLo = m.peek32(otcAt(0));
      r.guardHi = m.peek32(otcAt(9));
      return r;
    };

    const pick = (r, keys) => Object.fromEntries(keys.map(k => [k, typeof r[k] === 'number' && k !== 'timeout' && k !== 'good' ? hex(r[k]) : r[k]]));

    // with the channel disabled the start bit (24) is kept
    it('otc_chcr_readback', async () => {
      w32(DPCR, 0);
      w32(CHCR(DMA_GPUOTC), 0xffffffff);
      const ones = r32(CHCR(DMA_GPUOTC));
      w32(CHCR(DMA_GPUOTC), 0xeeffffff);
      const onesNoStart = r32(CHCR(DMA_GPUOTC));
      w32(CHCR(DMA_GPUOTC), 0);
      const zero = r32(CHCR(DMA_GPUOTC));
      expect([ones, onesNoStart, zero].map(hex)).to.eql([0x51000002, 0x40000002, 0x00000002].map(hex));
    });

    // Started transfers: the table is written from s_otcBuf[8] down, each
    // entry pointing at the one before, the last one FFFFFFh; MADR keeps the
    // start address.
    const started = (name, chcrWrite, chcr) => it(name, async () => {
      const r = otcRun(0x08000000, chcrWrite, 0x08000000);
      const keys = ['timeout', 'chcr', 'madr', 'bcr', 'dicr', 'good', 'term', 'guardLo', 'guardHi'];
      expect(pick(r, keys)).to.eql(pick({
        timeout: 0, chcr, madr: otcAt(8) & 0xffffff, bcr: 8, dicr: 0xc0c00000, good: 7, term: 0x00ffffff, guardLo: 0xdeadbeef, guardHi: 0xdeadbeef,
      }, keys));
    });

    started('otc_start_11000002', 0x11000002, 0x00000002);
    started('otc_start_11000000', 0x11000000, 0x00000002);
    started('otc_start_51000f07', 0x51000f07, 0x40000002);
    started('otc_start_11000f05', 0x11000f05, 0x00000002);

    // Transfers that do not run: no trigger bit, no start bit, or channel
    // disabled; the table is left alone. `run` marks the cases that pass.
    const idle = (name, dpcr, chcrWrite, timeout, chcr, run = it) => run(name, async () => {
      const r = otcRun(dpcr, chcrWrite, dpcr);
      const keys = ['timeout', 'chcr', 'bcr', 'dicr', 'good', 'term'];
      expect(pick(r, keys)).to.eql(pick({ timeout, chcr, bcr: 8, dicr: 0x00c00000, good: 0, term: 0xdeadbeef }, keys));
    });

    // without the trigger bit (28) the transfer does not run
    idle('otc_start_41000002', 0x08000000, 0x41000002, 1, 0x41000002);
    idle('otc_start_01000002', 0x08000000, 0x01000002, 1, 0x01000002);
    idle('otc_start_01000000', 0x08000000, 0x01000000, 1, 0x01000002);
    idle('otc_start_10000002', 0x08000000, 0x10000002, 0, 0x10000002);
    // with the channel disabled the start bit is kept
    idle('otc_start_disabled', 0x00000000, 0x11000002, 1, 0x11000002);

    // Enabling the channel in DPCR starts a transfer already latched in CHCR.
    it('otc_start_disabled_then_enabled', async () => {
      const r = otcRun(0x00000000, 0x11000002, 0x08000000);
      const keys = ['timeout', 'chcr', 'dicr', 'good', 'term'];
      expect(pick(r, keys)).to.eql(pick({ timeout: 0, chcr: 0x00000002, dicr: 0xc0c00000, good: 7, term: 0x00ffffff }, keys));
    });

  });

})
