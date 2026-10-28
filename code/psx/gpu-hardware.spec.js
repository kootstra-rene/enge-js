mdlr('[test]enge:psx:gpu-hardware', ({ include, test }) => {

  const { describe, it, xit, expect, before, beforeEach, after } = test;

  // Ported from the nugget GPU tests that check the GPU's command handling
  // and DMA rather than rendered pixels (https://github.com/pcsx-redux/nugget,
  // tests/gpu-command, gpu-irq, gpu-dma-dreq, gpu-dma-loop, gpu-dma-ring,
  // gpustat10, gpustat-480i and the status case of gpu-async-stress, MIT),
  // all verified on real hardware.

  const { createMachine } = include('enge:psx:test-machine');
  const { gpuHelpers } = include('enge:psx:test-gpu');

  const hex = v => '0x' + (v >>> 0).toString(16).padStart(8, '0');

  let m, g;
  const fresh = () => { m = createMachine(); g = gpuHelpers(m); };
  after(async () => { m?.dispose(); });

  // ASSERT_STAT_EQ(expected, mask)
  const statEq = (expected, mask) => expect(hex(g.gpuStatus() & mask)).to.eql(hex(expected));

  describe('GP0 environment commands in GPUSTAT (gpu-command)', () => {

    before(async () => { fresh(); g.rasterFullReset(); });

    // Issue a GP0 env command word and let the GPU consume it before the read.
    const cmdSend = word => { g.waitGPU(); g.sendGPUData(word); g.waitGPU(); };

    // GP0(E1) draw-mode fields reflect in GPUSTAT bits 0-10: texpage X base
    // = 5, Y base 1 = 1, semi-transparency = 2, texture depth = 1, dither =
    // 1, draw-to-display = 1 -> low bits 6D5h.
    it('command_e1_draw_mode_reflects_in_gpustat', async () => {
      g.rasterReset();
      cmdSend(0xe10006d5);
      statEq(0x6d5, 0x7ff);
    });

    // GP0(E6) set-mask-while-drawing reflects in GPUSTAT.11 (and leaves the
    // check-mask bit 12 clear).
    it('command_e6_set_mask_reflects_in_gpustat', async () => {
      g.rasterReset();
      cmdSend(0xe6000001);
      statEq(0x800, 0x1800);
    });

    // GP0(E6) check-mask-before-draw reflects in GPUSTAT.12 (and leaves the
    // set-mask bit 11 clear).
    it('command_e6_check_mask_reflects_in_gpustat', async () => {
      g.rasterReset();
      cmdSend(0xe6000002);
      statEq(0x1000, 0x1800);
    });

  });

  describe('GP0(1Fh) / GP1(02h) IRQ flag (gpu-irq)', () => {

    const GPUSTAT_IRQ = 0x01000000;

    before(async () => { fresh(); g.rasterFullReset(); });

    // Request IRQ1 via GP0(1Fh) and let the GPU consume it before the read.
    const gpuIrqRequest = () => { g.waitGPU(); g.gpuWrite(0x1f000000); g.waitGPU(); };
    // Acknowledge IRQ1 via GP1(02h), then let the status bit settle.
    const gpuIrqAck = () => { g.sendGPUStatus(0x02000000); for (let i = 0; i < 64; ++i) g.gpuStatus(); };

    it('irq_clear_after_reset', async () => {
      g.rasterReset();
      gpuIrqRequest();
      statEq(GPUSTAT_IRQ, GPUSTAT_IRQ);
      g.rasterReset();
      statEq(0, GPUSTAT_IRQ);
    });

    it('irq_gp0_1f_sets_flag', async () => {
      g.rasterReset();
      gpuIrqRequest();
      statEq(GPUSTAT_IRQ, GPUSTAT_IRQ);
    });

    it('irq_gp1_02_acknowledges', async () => {
      g.rasterReset();
      gpuIrqRequest();
      statEq(GPUSTAT_IRQ, GPUSTAT_IRQ);
      gpuIrqAck();
      statEq(0, GPUSTAT_IRQ);
    });

  });

  describe('GPU DMA and GPUSTAT.28 (gpu-dma-dreq)', () => {

    // GPU DMA in sync mode 1 waits for GPUSTAT.28 before each block. With
    // GP1(04h)=2 that bit drops after a polygon or line command word and
    // stays low until the command is complete, so a block boundary inside
    // one of those stops the channel for good: CHCR stays busy, MADR and
    // BCR show the blocks already sent. Poly-lines are in that class too.
    // Rectangles, blocks of whole commands, GP1(04h)=1 and linked lists all
    // complete. A CPU-fed poly-line longer than the FIFO streams if each
    // word waits for GPUSTAT.25 and loses words if it does not.

    const GP0 = 0x1f801810, GP1 = 0x1f801814;
    const D2_MADR = 0x1f8010a0, D2_BCR = 0x1f8010a4, D2_CHCR = 0x1f8010a8, DPCR = 0x1f8010f0;
    const LIMIT = 400000; // polls
    const DONE = 0xffffffff;
    const BUF = 0x80100000;   // buf[512]
    const NODE = 0x80101000;  // node[257]

    const r32 = a => m.read32(a) >>> 0;
    const w32 = (a, v) => m.write32(a, v >> 0);
    // a poll loop of up to `polls` iterations; one poll is a few cycles
    const poll = (cond, polls = LIMIT) => m.idleUntil(cond, polls * 4, 16) >= 0;

    let seed = 0;
    const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
    const xy = (x, y) => ((((y << 16) >> 16) & 0xffff) << 16 | (x & 0xffff)) >>> 0;

    let buf = [];

    const gpuSetup = () => {
      w32(GP1, 0x00000000);
      w32(GP1, 0x01000000);
      w32(GP1, 0x03000000);
      w32(GP1, 0x08000001);
      w32(GP1, 0x06c60260);
      w32(GP1, 0x07040010);
      w32(GP0, 0xe1000400);
      w32(GP0, 0xe3000000);
      w32(GP0, 0xe4000000 | (239 << 10) | 319);
      w32(GP0, 0xe5000000);
      w32(GP0, 0xe6000000);
    };

    // Packet generators fill buf; GP0(00h) nops go first, to move the block
    // boundaries.
    const lines = (n, nops) => {
      buf = []; seed = 12345;
      for (let i = 0; i < nops; ++i) buf.push(0);
      for (let i = 0; i < n; ++i) {
        const x = 10 + rnd(300), y = 10 + rnd(220);
        buf.push(0x40ff8040, xy(x, y), xy(x + rnd(9) - 4, y + rnd(9) - 4));
      }
      return buf.length;
    };
    const glines = n => {
      buf = []; seed = 12345;
      for (let i = 0; i < n; ++i) {
        const x = 10 + rnd(300), y = 10 + rnd(220);
        buf.push(0x500000ff, xy(x, y), 0x00ff0000, xy(x + 5, y + 3));
      }
      return buf.length;
    };
    const rects = n => {
      buf = []; seed = 12345;
      for (let i = 0; i < n; ++i) {
        buf.push(0x6000c0c0);
        const x = rnd(310);
        buf.push(xy(x, rnd(230)), xy(4, 3));
      }
      return buf.length;
    };
    const tris = (n, nops) => {
      buf = []; seed = 12345;
      for (let i = 0; i < nops; ++i) buf.push(0);
      for (let i = 0; i < n; ++i) {
        const x = 10 + rnd(290), y = 10 + rnd(210);
        buf.push(0x2000c040, xy(x, y), xy(x + 8, y + 1), xy(x + 1, y + 6));
      }
      return buf.length;
    };
    const gtris = n => {
      buf = []; seed = 12345;
      for (let i = 0; i < n; ++i) {
        const x = 10 + rnd(290), y = 10 + rnd(210);
        buf.push(0x300000ff, xy(x, y), 0x0000ff00, xy(x + 8, y + 1), 0x00ff0000, xy(x + 1, y + 6));
      }
      return buf.length;
    };
    // zigzag poly-lines, 290 pixels wide, three rows apart
    const plines = (n, nops) => {
      buf = [];
      for (let i = 0; i < nops; ++i) buf.push(0);
      buf.push(0x48ff8040);
      for (let i = 0; i < n; ++i) buf.push(xy((i & 1) ? 300 : 10, 10 + i * 3));
      buf.push(0x55555555);
      return buf.length;
    };
    const gplines = (n, nops) => {
      buf = [];
      for (let i = 0; i < nops; ++i) buf.push(0);
      for (let i = 0; i < n; ++i) {
        buf.push(i ? ((i & 1) ? 0x0000ff00 : 0x00ff0000) : 0x580000ff);
        buf.push(xy((i & 1) ? 300 : 10, 10 + i * 3));
      }
      buf.push(0x55555555);
      return buf.length;
    };

    const waitDma = () => poll(() => (r32(D2_CHCR) & 0x01000000) === 0);

    // A block transfer of buf; sent === DONE means it completes, anything
    // else is the number of words the channel sends before it stops.
    const block = (words, bs, dir, sent) => {
      gpuSetup();
      w32(GP1, 0x04000000 | dir);
      const ba = Math.trunc(words / bs);
      m.load(BUF, buf);
      w32(D2_MADR, BUF);
      w32(D2_BCR, (ba << 16) | bs);
      w32(D2_CHCR, 0x01000201);
      const ok = waitDma() ? 1 : 0;
      const stat = r32(GP1), madr = r32(D2_MADR), bcr = r32(D2_BCR), chcr = r32(D2_CHCR);
      w32(D2_CHCR, 0);
      w32(GP1, 0);
      if (sent === DONE) {
        expect(ok).to.eql(1);
        return;
      }
      expect({ ok, chcr: hex(chcr), madr: hex(madr), bcr: hex(bcr), dreq: stat & 0x10000000 })
        .to.eql({ ok: 0, chcr: hex(0x01000201), madr: hex((BUF + sent * 4) & 0xffffff), bcr: hex(((ba - Math.trunc(sent / bs)) << 16) | bs), dreq: 0 });
    };

    const linked = words => {
      gpuSetup();
      w32(GP1, 0x04000002);
      m.load(NODE, [((words << 24) | 0x00ffffff) >>> 0, ...buf.slice(0, words)]);
      w32(D2_MADR, NODE);
      w32(D2_BCR, 0);
      w32(D2_CHCR, 0x01000401);
      const ok = waitDma() ? 1 : 0;
      w32(D2_CHCR, 0);
      w32(GP1, 0);
      expect(ok).to.eql(1);
    };

    before(async () => { fresh(); w32(DPCR, r32(DPCR) | 0x00000800); });

    it('rects_bs16_split', async () => block(rects(80), 16, 2, DONE));
    it('rects_bs1', async () => block(rects(80), 1, 2, DONE));
    // Block-mode GPU DMA ignores GPUSTAT.28 (and treats the words as VRAM
    // data, see dma-hardware): a block boundary inside a line or polygon
    // never stops the channel.
    xit('lines_bs16_split', async () => block(lines(80, 0), 16, 2, 16));
    xit('lines_bs1', async () => block(lines(80, 0), 1, 2, 1));
    it('lines_bs3_whole', async () => block(lines(80, 0), 3, 2, DONE));
    it('lines_bs15_whole', async () => block(lines(80, 0), 15, 2, DONE));
    it('lines_dir1_bs1', async () => block(lines(80, 0), 1, 1, DONE));
    it('lines_dir1_bs16', async () => block(lines(80, 0), 16, 1, DONE));
    it('glines_bs16_whole', async () => block(glines(60), 16, 2, DONE));
    it('glines_bs4_whole', async () => block(glines(60), 4, 2, DONE));
    it('tris_bs16_whole', async () => block(tris(60, 0), 16, 2, DONE));
    xit('tris_nop_bs1', async () => block(tris(60, 1), 1, 2, 2));
    xit('tris_2nop_bs2_split', async () => block(tris(60, 2), 2, 2, 4));
    xit('gtris_bs16_split', async () => block(gtris(40), 16, 2, 16));
    it('gtris_bs6_whole', async () => block(gtris(40), 6, 2, DONE));
    it('gtris_dir1_bs1', async () => block(gtris(40), 1, 1, DONE));
    it('linked_lines_240', async () => linked(lines(80, 0)));
    it('linked_lines_12', async () => linked(lines(4, 0)));
    it('linked_gtris_240', async () => linked(gtris(40)));
    it('linked_rects_240', async () => linked(rects(80)));

    // CPU-fed poly-line, GP1(04h)=1; paced: wait for GPUSTAT.25 before each
    // word. Records GPUSTAT bits 25/26/28 right after each word and the polls
    // spent waiting, then reads back a pixel on the last segment.
    const cpuPline = (n, paced) => {
      gpuSetup();
      w32(GP1, 0x04000001);
      w32(GP0, 0x02000000);
      w32(GP0, 0);
      w32(GP0, xy(320, 240));
      poll(() => (r32(GP1) & 0x14000000) === 0x14000000);
      const words = plines(n, 0);
      const bits = [], waits = [];
      let maxWait = 0, fullAt = -1;
      for (let i = 0; i < words; ++i) {
        let polls = 0;
        if (paced) {
          const start = m.clock;
          poll(() => (r32(GP1) & 0x02000000) !== 0);
          polls = Math.trunc((m.clock - start) / 4);
        }
        w32(GP0, buf[i]);
        const st = r32(GP1);
        bits.push(((st >>> 25) & 1) | (((st >>> 26) & 1) << 1) | (((st >>> 28) & 1) << 2));
        waits.push(Math.min(polls, 0xffff));
        if (polls > maxWait) maxWait = polls;
        if (fullAt < 0 && !(st & 0x02000000)) fullAt = i;
      }
      const idleOk = poll(() => (r32(GP1) & 0x14000000) === 0x14000000) ? 1 : 0;
      // readPx
      const x = ((n - 1) & 1) ? 300 : 10, y = 10 + (n - 1) * 3;
      poll(() => (r32(GP1) & 0x04000000) !== 0);
      w32(GP0, 0xc0000000);
      w32(GP0, xy(x, y));
      w32(GP0, xy(2, 1));
      const readOk = poll(() => (r32(GP1) & 0x08000000) !== 0) ? 1 : 0;
      const lastPx = r32(GP0) & 0xffff;
      w32(GP1, 0);
      return { words, bits, waits, maxWait, fullAt, idleOk, readOk, lastPx };
    };

    // GPUSTAT.25 drops after 11 queued words, then each further word waits
    // for one 290-pixel segment: the poly-line streams through the FIFO.
    // Bits 26 and 28 read 0 after every word of the list. The GP0 FIFO and
    // the drawing time are not emulated, and the last pixel depends on the
    // renderer.
    xit('pline_cpu_paced', async () => {
      const r = cpuPline(60, true);
      const busy = r.bits.reduce((a, b) => a | (b & 6), 0);
      expect({ idleOk: r.idleOk, readOk: r.readOk, waited: r.maxWait !== LIMIT, px: hex(r.lastPx), fullAt: r.fullAt, w10: r.waits[10], w11: r.waits[11] !== 0, busy })
        .to.eql({ idleOk: 1, readOk: 1, waited: true, px: hex(0x7e08), fullAt: -1, w10: 0, w11: true, busy: 0 });
    });

    // Unpaced, GPUSTAT.25 is 0 from the 11th word and the overflow loses the
    // terminator: the GPU never goes idle and the GP0(C0h) readback is eaten
    // as vertices. The GP0 FIFO is not emulated.
    xit('pline_cpu_unpaced', async () => {
      const r = cpuPline(60, false);
      expect({ fullAt: r.fullAt, idleOk: r.idleOk, readOk: r.readOk }).to.eql({ fullAt: 10, idleOk: 0, readOk: 0 });
    });

    // A poly-line is in the DREQ stall class: the block after the one holding
    // its command word never starts, whatever the block size.
    xit('pline_bs16_split', async () => block(plines(46, 0), 16, 2, 16));
    xit('pline_bs1', async () => block(plines(46, 0), 1, 2, 1));
    it('pline_dir1_bs1', async () => block(plines(46, 0), 1, 1, DONE));
    xit('gpline_bs16_split', async () => block(gplines(23, 1), 16, 2, 16));

  });

  describe('GPU linked-list DMA on a looping list (gpu-dma-loop)', () => {

    // A two-node list A -> B -> A that never reaches the FFFFFFh terminator:
    // the channel stays busy across five vblanks while MADR keeps moving
    // between the two nodes, DICR bit 15 stays clear, and writing CHCR with
    // bit 24 clear stops it. A terminated list is the control.

    const D2_MADR = 0x1f8010a0, D2_BCR = 0x1f8010a4, D2_CHCR = 0x1f8010a8, DPCR = 0x1f8010f0, DICR = 0x1f8010f4;
    const IREG = 0x1f801070, IMASK = 0x1f801074, GPU_STATUS = 0x1f801814;
    const VBLANKS = 5;
    const NODE_A = 0x80100000, NODE_B = 0x80100010;

    const r32 = a => m.read32(a) >>> 0;
    const w32 = (a, v) => m.write32(a, v >> 0);

    const run = (words, terminated) => {
      w32(GPU_STATUS, 0x00000000);
      w32(GPU_STATUS, 0x04000002);
      const a = NODE_A & 0xffffff, b = NODE_B & 0xffffff;
      m.load(NODE_A, [((words << 24) | b) >>> 0, 0]);
      m.load(NODE_B, [((words << 24) | (terminated ? 0xffffff : a)) >>> 0, 0]);
      w32(DPCR, r32(DPCR) | 0x00000800);
      w32(D2_MADR, a);
      w32(D2_BCR, 0);
      w32(D2_CHCR, 0x01000401);
      const r = { chcr: [r32(D2_CHCR)], madr: [r32(D2_MADR)], dicr: [r32(DICR)], madrChanges: 0 };
      let last = r.madr[0];
      for (let v = 1; v <= VBLANKS; ++v) {
        w32(IREG, ~1);
        m.idleUntil(() => {
          const madr = r32(D2_MADR);
          if (madr !== last) { r.madrChanges++; last = madr; }
          return (r32(IREG) & 1) !== 0;
        }, 2 * 33868800 / 50, 64);
        r.chcr.push(r32(D2_CHCR));
        r.madr.push(r32(D2_MADR));
        r.dicr.push(r32(DICR));
      }
      w32(D2_CHCR, 0x00000401);
      r.chcrAfterStop = r32(D2_CHCR);
      return r;
    };

    let term;
    before(async () => {
      fresh();
      w32(IMASK, 0);
      term = run(1, true);
    });

    it('terminatedListCompletes', async () => {
      expect({ busy: term.chcr[VBLANKS] & 0x01000000, madr: hex(term.madr[VBLANKS] & 0xffffff) }).to.eql({ busy: 0, madr: hex(0x00ffffff) });
    });

    it('loopStaysBusy', async () => {
      const loop0 = run(0, false), loop1 = run(1, false);
      for (let v = 0; v <= VBLANKS; ++v) {
        expect((loop0.chcr[v] & 0x01000000) !== 0 && (loop1.chcr[v] & 0x01000000) !== 0).to.be.true;
      }
    });

    it('loopKeepsWalking', async () => {
      const loop0 = run(0, false), loop1 = run(1, false);
      expect(loop0.madrChanges > 0 && loop1.madrChanges > 0).to.be.true;
    });

    it('loopRaisesNoDmaError', async () => {
      const loop0 = run(0, false), loop1 = run(1, false);
      expect([loop0.dicr[VBLANKS] & 0x8000, loop1.dicr[VBLANKS] & 0x8000]).to.eql([0, 0]);
    });

    it('chcrWriteStopsTheLoop', async () => {
      const loop0 = run(0, false), loop1 = run(1, false);
      expect([loop0.chcrAfterStop & 0x01000000, loop1.chcrAfterStop & 0x01000000]).to.eql([0, 0]);
    });

  });

  describe('GPUSTAT bits 0-10 follow GP0(E1h) and textured polygons (gpustat10)', () => {

    // GP0(E1h) loads GPUSTAT bits 0-10. A textured polygon loads the texpage
    // bits 0-8 from its texpage word and leaves bit 9 (dither) and bit 10
    // (draw to display area) alone; an untextured one leaves them all.

    const GPU_DATA = 0x1f801810, GPU_STATUS = 0x1f801814;
    const w32 = (a, v) => m.write32(a, v >> 0);
    before(async () => { fresh(); });
    after(async () => { w32(GPU_STATUS, 0); });

    const stat = () => {
      m.idleUntil(() => (g.gpuStatus() & 0x14000000) === 0x14000000, 1000000, 16);
      return hex(g.gpuStatus() & 0x7ff);
    };
    const setup = e1 => {
      w32(GPU_STATUS, 0x00000000);
      w32(GPU_DATA, 0xe3000000);
      w32(GPU_DATA, 0xe4000000 | 319 | (239 << 10));
      w32(GPU_DATA, 0xe5000000);
      w32(GPU_DATA, 0xe1000000 | e1);
    };
    const texTri = tp => {
      for (const v of [0x24808080, (10 << 16) | 10, 0, (10 << 16) | 20, tp << 16, (20 << 16) | 10, 0]) w32(GPU_DATA, v);
    };
    const flatTri = () => {
      for (const v of [0x20ffffff, (10 << 16) | 10, (10 << 16) | 20, (20 << 16) | 10]) w32(GPU_DATA, v);
    };

    it('e1LoadsBits0To10', async () => {
      setup(0x400);
      expect(stat()).to.eql(hex(0x400));
      setup(0x600);
      expect(stat()).to.eql(hex(0x600));
    });

    it('texturedPolyKeepsDfe', async () => {
      setup(0x400);
      texTri(0x0005);
      expect(stat()).to.eql(hex(0x405));
      flatTri();
      expect(stat()).to.eql(hex(0x405));
    });

    it('texturedPolyKeepsDither', async () => {
      setup(0x600);
      texTri(0x0005);
      expect(stat()).to.eql(hex(0x605));
    });

    it('texturedPolyIgnoresTexpageBits9And10', async () => {
      setup(0x400);
      texTri(0x0605);
      expect(stat()).to.eql(hex(0x405));
      setup(0x000);
      texTri(0x0605);
      expect(stat()).to.eql(hex(0x005));
    });

  });

  describe('GPUSTAT bits 31 and 13 in 480i (gpustat-480i)', () => {

    // NTSC 640x480 interlaced. Over six fields, timed in lines with root
    // counter 1 on hblank from the vblank IRQ: bit 31 reads 0 at vblank,
    // fields alternate between one where it rises (at line 22-24) and one
    // where it does not, and bit 13 flips a few lines into each field to
    // follow the previous one.

    const GPU_STATUS = 0x1f801814, IREG = 0x1f801070, IMASK = 0x1f801074;
    const FIELDS = 6, NONE = 0xffff;
    const r32 = a => m.read32(a) >>> 0;
    const w32 = (a, v) => m.write32(a, v >> 0);
    const timer1 = () => m.read16(0x1f801110) & 0xffff;

    let fields;
    before(async () => {
      fresh();
      w32(IMASK, 0);
      w32(GPU_STATUS, 0x00000000);
      w32(GPU_STATUS, 0x06000000 | 0x260 | (0xc60 << 12));
      w32(GPU_STATUS, 0x07000000 | 0x010 | (0x100 << 10));
      w32(GPU_STATUS, 0x05000000);
      w32(GPU_STATUS, 0x08000027);
      w32(GPU_STATUS, 0x03000000);
      m.write16(0x1f801114, 0x0100); // counter 1 on hblank
      w32(IREG, ~1);
      m.idleUntil(() => (r32(IREG) & 1) !== 0, 33868800, 16);
      w32(IREG, ~1);
      let vbl = timer1();
      fields = [];
      for (let f = 0; f < FIELDS; f++) {
        const p = { b31Rise: NONE, b31Fall: NONE, b13Rise: NONE, b13Fall: NONE, lines: 0 };
        let prev = r32(GPU_STATUS);
        p.firstStat = prev;
        m.idleUntil(() => {
          const s = r32(GPU_STATUS);
          const line = (timer1() - vbl) & 0xffff;
          if (r32(IREG) & 1) {
            w32(IREG, ~1);
            p.lines = line;
            vbl = timer1();
            return true;
          }
          const rise = (s & ~prev) >>> 0, fall = (prev & ~s) >>> 0;
          if ((rise & 0x80000000) && p.b31Rise === NONE) p.b31Rise = line;
          if ((fall & 0x80000000) && p.b31Fall === NONE) p.b31Fall = line;
          if ((rise & 0x2000) && p.b13Rise === NONE) p.b13Rise = line;
          if ((fall & 0x2000) && p.b13Fall === NONE) p.b13Fall = line;
          prev = s;
          return false;
        }, 33868800, 16);
        fields.push(p);
      }
    });
    after(async () => { w32(GPU_STATUS, 0); });

    const isLong = p => p.b31Rise !== NONE;

    it('bit31ZeroAtVBlank', async () => {
      expect(fields.map(p => (p.firstStat >>> 31))).to.eql(new Array(FIELDS).fill(0));
    });

    it('bit31AlternatesFields', async () => {
      for (let f = 1; f < FIELDS; f++) expect(isLong(fields[f - 1]) !== isLong(fields[f])).to.be.true;
    });

    it('bit31RisesAtLine23', async () => {
      for (const p of fields.filter(isLong)) {
        expect(p.b31Rise >= 22 && p.b31Rise <= 24 && p.b31Fall === NONE).to.be.true;
      }
    });

    it('bit13FollowsShortField', async () => {
      for (const p of fields.slice(1)) {
        if (isLong(p)) {
          expect({ b13: (p.firstStat & 0x2000) !== 0, fallOk: p.b13Fall >= 5 && p.b13Fall <= 7, rise: p.b13Rise })
            .to.eql({ b13: true, fallOk: true, rise: NONE });
        } else {
          expect({ b13: (p.firstStat & 0x2000) !== 0, riseOk: p.b13Rise >= 4 && p.b13Rise <= 6, fall: p.b13Fall })
            .to.eql({ b13: false, riseOk: true, fall: NONE });
        }
      }
    });

  });

  describe('GPUSTAT follows GP0(E1h) and GP0(E6h) between draws (gpu-async-stress)', () => {

    // Only the status case of the suite: the other three compare VRAM.

    before(async () => { fresh(); g.rasterFullReset(); });

    it('status_follows_env_commands', async () => {
      let seed = 4;
      const stressRand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 8; };
      g.rasterReset();
      g.rasterFillRect(256, 256, 128, 128, 0);
      let bad = 0;
      for (let i = 0; i < 500; i++) {
        const r = stressRand() & 0x1f, gg = stressRand() & 0x1f, b = stressRand() & 0x1f;
        g.rasterFlatRect((r << 3) | ((gg << 3) << 8) | ((b << 3) << 16), 256, 256, 128, 128);
        const tpage = stressRand() & 0x1ff;
        const mask = stressRand() & 3;
        g.sendGPUData(0xe1000000 | tpage);
        g.sendGPUData(0xe6000000 | mask);
        g.waitGPU();
        const stat = g.gpuStatus();
        if ((stat & 0x7ff) !== tpage) bad++;
        if (((stat >>> 11) & 3) !== mask) bad++;
      }
      g.sendGPUData(0xe6000000);
      g.sendGPUData(0xe1000400);
      expect(bad).to.eql(0);
    });

  });

  describe('GPU linked-list DMA on a ring the CPU keeps refilling (gpu-dma-ring)', () => {

    // A 16-slot ring of textured quads, each slot linking to the next and
    // the last back to the first; the CPU rewrites the slots behind the DMA
    // for ten vblanks, trailing it by 2 or by 8 slots. The channel stays
    // busy, laps the ring, raises no DMA error, and once a slot is made a
    // terminator it completes with MADR FFFFFFh and its DICR flag set.
    //
    // The texture the quads sample, uploaded first on hardware, only changes
    // pixels and is left out.

    const D2_MADR = 0x1f8010a0, D2_BCR = 0x1f8010a4, D2_CHCR = 0x1f8010a8, DPCR = 0x1f8010f0, DICR = 0x1f8010f4;
    const GPU_DATA = 0x1f801810, GPU_STATUS = 0x1f801814, IREG = 0x1f801070, IMASK = 0x1f801074;
    const RING = 16, SLOT_WORDS = 16, VBLANKS = 10, EXIT_LIMIT = 2000000, QUAD_WORDS = 12;
    const RING_ADDR = 0x80100000;
    const QUAD_TPAGE = 10 | (2 << 7);
    const r32 = a => m.read32(a) >>> 0;
    const w32 = (a, v) => m.write32(a, v >> 0);
    const slotAddr = k => (RING_ADDR + k * SLOT_WORDS * 4) & 0xffffff;
    const slotOf = madr => {
      madr &= 0xffffff;
      if (madr < slotAddr(0)) return -1;
      const off = Math.floor((madr - slotAddr(0)) / (SLOT_WORDS * 4));
      return off < RING ? off : -1;
    };
    const writeQuad = (k, seq) => {
      const c = Math.imul(seq, 0x0f0b07) & 0x007f7f7f;
      m.load(RING_ADDR + (k * SLOT_WORDS + 1) * 4, [
        0x3e000000 | c, 0, 0, c ^ 0x003f003f, 319, (QUAD_TPAGE << 16) | 63, c ^ 0x00003f3f, 239 << 16, 15 << 8,
        c ^ 0x003f3f00, (239 << 16) | 319, (15 << 8) | 63,
      ].map(v => v >>> 0));
    };
    const link = (k, next) => m.load(RING_ADDR + k * SLOT_WORDS * 4, [((QUAD_WORDS << 24) | next) >>> 0]);

    const run = trail => {
      w32(GPU_STATUS, 0x00000000);
      w32(GPU_STATUS, 0x06000000 | 0x260 | (0xc60 << 12));
      w32(GPU_STATUS, 0x07000000 | 0x010 | (0x100 << 10));
      w32(GPU_STATUS, 0x05000000);
      w32(GPU_STATUS, 0x08000001);
      for (const v of [0xe1000600, 0xe3000000, 0xe4000000 | 319 | (239 << 10), 0xe5000000]) w32(GPU_DATA, v);
      w32(GPU_STATUS, 0x03000000);
      w32(GPU_STATUS, 0x04000002);
      g.waitGPU();
      for (let k = 0; k < RING; k++) {
        link(k, slotAddr((k + 1) % RING));
        writeQuad(k, k);
      }
      w32(DPCR, r32(DPCR) | 0x00000800);
      w32(DICR, 0x00840000 | 0x7f000000);
      w32(IREG, ~0x8);
      w32(D2_MADR, slotAddr(0));
      w32(D2_BCR, 0);
      w32(D2_CHCR, 0x01000401);
      let prod = (RING - trail) % RING, last = 0, seq = RING;
      const a = { chcr: [r32(D2_CHCR)], dicr: [r32(DICR)], written: [0], laps: [0] };
      for (let v = 1; v <= VBLANKS; v++) {
        let written = 0, laps = 0;
        w32(IREG, ~1);
        m.idleUntil(() => {
          if (r32(IREG) & 1) return true;
          const d = slotOf(r32(D2_MADR));
          if (d < 0) return false;
          if (d < last) laps++;
          last = d;
          const target = (d + RING - trail) % RING;
          while (prod !== target) {
            writeQuad(prod, seq++);
            prod = (prod + 1) % RING;
            written++;
          }
          return false;
        }, 2 * 33868800 / 50, 64);
        a.chcr.push(r32(D2_CHCR));
        a.dicr.push(r32(DICR));
        a.written.push(written);
        a.laps.push(laps);
      }
      const d = slotOf(r32(D2_MADR));
      link(((d < 0 ? 0 : d) + RING / 2) % RING, 0xffffff);
      m.idleUntil(() => (r32(D2_CHCR) & 0x01000000) === 0, EXIT_LIMIT * 8, 16);
      a.exitChcr = r32(D2_CHCR);
      a.exitMadr = r32(D2_MADR);
      a.exitDicr = r32(DICR);
      if (a.exitChcr & 0x01000000) w32(D2_CHCR, 0x00000401);
      return a;
    };

    let high, mid;
    const runs = () => {
      if (!high) {
        fresh();
        w32(IMASK, 0);
        high = run(2);
        mid = run(RING / 2);
      }
      return [high, mid];
    };
    after(async () => { if (m) { w32(D2_CHCR, 0x00000401); w32(GPU_STATUS, 0); } });

    it('ringStaysBusy', async () => {
      for (const a of runs()) expect(a.chcr.every(c => (c & 0x01000000) !== 0)).to.be.true;
    });

    it('dmaLapsTheRing', async () => {
      for (const a of runs()) expect(a.laps.reduce((x, y) => x + y, 0) >= 1).to.be.true;
    });

    it('cpuKeepsProducing', async () => {
      for (const a of runs()) expect(Math.min(...a.written.slice(2)) > 0).to.be.true;
    });

    it('noDmaErrorWhileLooping', async () => {
      for (const a of runs()) expect(a.dicr.map(d => d & 0x00008000)).to.eql(new Array(VBLANKS + 1).fill(0));
    });

    it('exitByTerminatorCompletes', async () => {
      for (const a of runs()) {
        expect({ busy: a.exitChcr & 0x01000000, madr: hex(a.exitMadr & 0xffffff) }).to.eql({ busy: 0, madr: hex(0x00ffffff) });
      }
    });

    it('exitRaisesTheChannelFlag', async () => {
      for (const a of runs()) {
        expect({ flag: (a.exitDicr & 0x04000000) !== 0, error: a.exitDicr & 0x00008000 }).to.eql({ flag: true, error: 0 });
      }
    });

  });

})
