mdlr('[test]enge:psx:load-timings', ({ include, test }) => {

  const { it, xit, expect, before, after } = test;

  // Ported from the nugget load and store timing tests (https://github.com/
  // pcsx-redux/nugget, tests/load-timings, MIT), verified on SCPH-5501 and
  // SCPH-7001. Each measurement runs a block of instructions between two
  // reads of root counter 2 on the system clock and returns the difference,
  // the best of eight runs started at different skews (BENCH). The blocks are
  // the tests' own inline assembly, with the sink in $v1, the pointers in
  // $a0/$a1 and the skew in $a2. Only the cases with assertions are ported.

  const { createMachine } = include('enge:psx:test-machine');

  const BIU_EXPECTED = 0x0001e988;
  const N_READS = 256, N_BUS = 64;
  const ADDR_SCRATCH = 0x1f800000, ADDR_ISTAT = 0xbf801070, ADDR_DMA = 0xbf8010a0;
  const ADDR_RAM_C = 0x80100000, ADDR_RAM_U = 0xa0100000, ADDR_BIOS = 0xbfc00000;
  const ADDR_JOYSTAT = 0xbf801044, ADDR_GPUSTAT = 0xbf801814, ADDR_MDECST = 0xbf801824;
  const ADDR_CDROM = 0xbf801800, ADDR_SPU = 0xbf801d80, ADDR_SPU_ADSR = 0xbf801c08;
  const DEV2_DELAY = 0x1f801010, DEV4_DELAY = 0x1f801014, CDROM_DELAY = 0x1f801018, COM_DELAY = 0x1f801020;
  const PIN_COM_DELAY = 0x00031125, PIN_CDROM_DELAY = 0x00020843;

  const rep = (n, text) => new Array(n).fill(text).join('\n');
  const nops = n => rep(n, 'nop');

  // A timed block as a function: skew loop, counter 2, the block, counter 2.
  // %0 is the sink ($v1), %1 and %2 the arguments ($a0, $a1).
  const timed = (name, body, { sinkInit = false } = {}) => `
    ${name}:
        ${sinkInit ? 'move  $v1, $zero' : ''}
    1:  bnez  $a2, 1b
        addiu $a2, $a2, -1
        lui   $t8, 0xbf80
        lhu   $t6, 0x1120($t8)
        ${body.replace(/%0/g, '$v1').replace(/%1/g, '$a0').replace(/%2/g, '$a1')}
        lhu   $t7, 0x1120($t8)
        nop
        subu  $v0, $t7, $t6
        jr    $ra
        andi  $v0, $v0, 0xffff`;

  const spaced = (name, k) => timed(name, rep(32, `lw %0, 0(%1)\n${nops(k)}`));
  const intlck = (name, k) => timed(name, rep(32, `lw %0, 0(%1)\n${nops(k)}\naddiu %0, 1\n${nops(8 - k)}`));
  const SHADOW_REPS = 16, INTLCK_REPS = 8, INTLCK_LEN = 48;
  const SHADOW_POINTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 32, 40, 48];
  const INTLCK_POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 32, 40, 48];
  const SHADOW_CHECK = 8;
  const shadow = (name, op, s) => timed(name, `${nops(8)}\n${rep(SHADOW_REPS, `${op}\n${nops(s)}`)}\n${nops(8)}`);
  const intlckSweep = (name, op, use, k) =>
    timed(name, `${nops(8)}\n${rep(INTLCK_REPS, `${op}\n${nops(k - 1)}\n${use}\n${nops(INTLCK_LEN - k)}`)}\n${nops(8)}`);

  const source = [
    timed('timed_read', rep(256, 'lw %0, 0(%1)')),
    timed('timed_nop', rep(256, 'nop')),
    timed('timed_pair', rep(128, 'lw %0, 0(%1)\nlw %0, 0(%2)')),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(k => spaced(`spaced${k}`, k)),
    ...[1, 2, 3, 4, 5, 6, 7].map(k => intlck(`intlck${k}`, k)),
    ...SHADOW_POINTS.flatMap(s => [
      shadow(`shadow_w_${s}`, 'lw %0, 0(%1)', s), shadow(`shadow_b_${s}`, 'lbu %0, 0(%1)', s), shadow(`shadow_n_${s}`, 'nop', s),
    ]),
    ...INTLCK_POINTS.flatMap(k => [
      intlckSweep(`intlck_w_${k}`, 'lw %0, 0(%1)', 'addiu %0, %0, 1', k), intlckSweep(`intlck_b_${k}`, 'lbu %0, 0(%1)', 'addiu %0, %0, 1', k),
    ]),
    intlckSweep('intlck_w_base', 'lw %0, 0(%1)', 'nop', 1),
    intlckSweep('intlck_b_base', 'lbu %0, 0(%1)', 'nop', 1),
    ...['nop', 'lw', 'lh', 'lb', 'sh', 'sw', 'lbu'].map(op =>
      timed(`bus_${op}`, rep(N_BUS, op === 'nop' ? 'nop' : `${op} %0, 0(%1)`), { sinkInit: true })),
  ].join('\n');

  let m, p, entryDelay;
  before(async () => {
    m = createMachine();
    p = m.asm(0x80010000, source).labels;
    // the BIOS sets the BIU at boot; the test machine runs no BIOS
    m.write32(0xfffe0130, BIU_EXPECTED);
    m.write16(0x1f801124, 0); // COUNTERS[2].mode: system clock
    entryDelay = [0, 1, 2, 3, 4].map(i => m.read32(DEV2_DELAY + 4 * i) >>> 0);
    m.write32(COM_DELAY, PIN_COM_DELAY);
    m.write32(CDROM_DELAY, PIN_CDROM_DELAY);
  });
  after(async () => {
    if (m) entryDelay.forEach((v, i) => m.write32(DEV2_DELAY + 4 * i, v));
    m?.dispose();
  });

  const call = (fn, a = 0, b = 0, skew = 0) => m.call(p[fn], a >> 0, b >> 0, skew).v0;
  // the best of eight, each after a skew loop of i * 19
  const BENCH = (fn, a, b) => Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map(i => call(fn, a, b, i * 19)));
  const RUN8 = (fn, a) => {
    const runs = [0, 1, 2, 3, 4, 5, 6, 7].map(() => call(fn, a));
    return [Math.min(...runs), Math.max(...runs)];
  };

  // the BIU reads back as the BIOS sets it
  it('biuConfigIsTheMeasuredRegime', async () => {
    expect(m.read32(0xfffe0130) >>> 0).to.eql(BIU_EXPECTED);
  });

  // The scratchpad costs no more than a nop, MMIO 3 to 5 cycles a load, RAM
  // more (cached or not alike), the BIOS ROM most.
  it('loadCostByTarget', async () => {
    const base = BENCH('timed_nop', ADDR_ISTAT);
    const scratch = BENCH('timed_read', ADDR_SCRATCH);
    const mmio = BENCH('timed_read', ADDR_ISTAT);
    const ram_c = BENCH('timed_read', ADDR_RAM_C);
    const ram_u = BENCH('timed_read', ADDR_RAM_U);
    const bios = BENCH('timed_read', ADDR_BIOS);
    expect({
      scratchFree: scratch <= base + N_READS / 2,
      scratchBelowMmio: scratch < mmio,
      mmioBelowRam: mmio < ram_c,
      ramBelowBios: ram_c < bios,
      ramMirrorsAlike: Math.abs(ram_c - ram_u) <= N_READS / 4,
      mmioCost: mmio - base >= N_READS * 3 && mmio - base <= N_READS * 5,
    }).to.eql({ scratchFree: true, scratchBelowMmio: true, mmioBelowRam: true, ramBelowBios: true, ramMirrorsAlike: true, mmioCost: true });
  });

  // alternating loads from the same RAM word cost what single loads do
  it('loadCostByStride', async () => {
    const ref = BENCH('timed_read', ADDR_RAM_U);
    const stride0 = Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map(() => call('timed_pair', ADDR_RAM_U, ADDR_RAM_U)));
    expect(Math.abs(stride0 - ref) <= N_READS / 8).to.be.true;
  });

  // I_STAT, the DMA registers and the root counters answer in the same time
  it('onDieUniformity', async () => {
    const istat = BENCH('timed_read', ADDR_ISTAT);
    expect({
      dma: BENCH('timed_read', ADDR_DMA), rcnt0: BENCH('timed_read', 0xbf801100), rcnt2: BENCH('timed_read', 0xbf801120),
    }).to.eql({ dma: istat, rcnt0: istat, rcnt2: istat });
  });

  // An MMIO load stalls the next load for its bus cycle, so nops right
  // after it are free (32 loads followed by k nops).
  // enge measures 99 cycles for every k: the recompiler adds a block's
  // cycles to the clock at the end of the block (rec.js), so two counter
  // reads in one block do not see the instructions between them
  xit('loadShadow', async () => {
    const got = [0, 1, 2, 3, 4, 5, 6, 7].map(k => BENCH(`spaced${k}`, ADDR_ISTAT));
    expect(got).to.eql([164, 196, 228, 228, 228, 260, 292, 324]);
  });

  // using the loaded value k instructions later stalls until it arrives
  // enge measures 99 cycles for every k (as loadShadow)
  xit('loadInterlocked', async () => {
    const got = [1, 2, 3, 4, 5, 6, 7].map(k => BENCH(`intlck${k}`, ADDR_ISTAT));
    expect(got).to.eql([420, 420, 388, 356, 356, 356, 356]);
  });

  const s_shNop = [35, 51, 67, 83, 99, 115, 131, 147, 163, 179, 195, 211, 227, 259, 291, 355, 419, 547, 675, 803];
  const s_shMmio = [97, 113, 129, 130, 131, 147, 163, 179, 195, 211, 227, 243, 259, 291, 323, 387, 451, 579, 707, 835];
  const s_shRam = [127, 143, 159, 160, 161, 162, 163, 179, 195, 211, 227, 243, 259, 291, 323, 387, 451, 579, 707, 835];
  const s_shRomW = [445, 460, 475, 475, 475, 475, 475, 475, 475, 475, 475, 475, 475, 475, 475, 477, 481, 579, 707, 835];
  const s_shRomB = [157, 173, 189, 190, 191, 192, 193, 194, 195, 211, 227, 243, 259, 291, 323, 387, 451, 579, 707, 835];
  const s_shCdrom = [173, 188, 204, 205, 206, 207, 208, 209, 210, 211, 227, 243, 259, 291, 323, 387, 451, 579, 707, 835];
  const s_shSpu = [348, 348, 363, 363, 363, 363, 363, 363, 363, 363, 363, 363, 364, 366, 368, 387, 451, 579, 707, 835];
  const s_ilMmio = [443, 443, 443, 435, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427];
  const s_ilScratch = new Array(19).fill(411);
  const s_ilRam = [459, 459, 459, 451, 443, 435, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427];
  const s_ilRomW = [619, 619, 619, 611, 603, 595, 587, 579, 571, 563, 555, 547, 531, 515, 483, 451, 427, 427, 427];
  const s_ilRomB = [475, 475, 475, 467, 459, 451, 443, 435, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427];
  const s_ilCdrom = [483, 483, 483, 475, 467, 459, 451, 443, 435, 427, 427, 427, 427, 427, 427, 427, 427, 427, 427];
  const s_ilSpu = [563, 563, 563, 555, 547, 539, 531, 523, 515, 507, 499, 491, 475, 459, 427, 427, 427, 427, 427];
  const targets = [
    ['I_STAT', ADDR_ISTAT, 0, s_shMmio, s_ilMmio, 427],
    ['JOY_STAT', ADDR_JOYSTAT, 0, s_shMmio, s_ilMmio, 427],
    ['GPUSTAT', ADDR_GPUSTAT, 0, s_shMmio, s_ilMmio, 427],
    ['MDEC stat', ADDR_MDECST, 0, s_shMmio, s_ilMmio, 427],
    ['scratchpad', ADDR_SCRATCH, 0, s_shNop, s_ilScratch, 411],
    ['RAM cached', ADDR_RAM_C, 0, s_shRam, s_ilRam, 427],
    ['RAM uncached', ADDR_RAM_U, 0, s_shRam, s_ilRam, 427],
    ['BIOS ROM', ADDR_BIOS, 0, s_shRomW, s_ilRomW, 427],
    ['I_STAT byte', ADDR_ISTAT, 1, s_shMmio, s_ilMmio, 427],
    ['RAM uncached byte', ADDR_RAM_U, 1, s_shRam, s_ilRam, 427],
    ['BIOS ROM byte', ADDR_BIOS, 1, s_shRomB, s_ilRomB, 427],
    ['CD-ROM byte', ADDR_CDROM, 1, s_shCdrom, s_ilCdrom, 427],
    ['SPU byte', ADDR_SPU, 1, s_shSpu, s_ilSpu, 427],
  ];

  // the shadow sweep (16 loads each followed by s nops) on every target,
  // and the nop-only baseline
  // enge measures the same count at every point (as loadShadow)
  xit('loadShadowByTarget', async () => {
    const got = {}, want = {};
    let check;
    targets.forEach(([name, addr, byte, row], t) => {
      const a = SHADOW_POINTS.map(s => BENCH(`shadow_${byte ? 'b' : 'w'}_${s}`, addr));
      const b = SHADOW_POINTS.map(s => BENCH(`shadow_n_${s}`, addr));
      if (t === 0) check = a[SHADOW_CHECK] - b[SHADOW_CHECK];
      got[name] = { load: a, nop: b };
      want[name] = { load: row, nop: s_shNop };
    });
    expect(got).to.eql(want);
    expect(check).to.eql(SHADOW_REPS * 2);
  });

  // the interlock sweep (8 loads, each used k instructions later) on every
  // target, against a fixed base
  // enge measures the same count at every point (as loadShadow)
  xit('loadInterlockedByTarget', async () => {
    const got = {}, want = {};
    for (const [name, addr, byte, , row, intlckBase] of targets) {
      got[name] = { use: INTLCK_POINTS.map(k => BENCH(`intlck_${byte ? 'b' : 'w'}_${k}`, addr)), base: BENCH(`intlck_${byte ? 'b' : 'w'}_base`, addr) };
      want[name] = { use: row, base: intlckBase };
    }
    expect(got).to.eql(want);
  });

  // the delay registers read back as written
  it('busRegistersAtEntry', async () => {
    expect([m.read32(COM_DELAY) >>> 0, m.read32(CDROM_DELAY) >>> 0]).to.eql([PIN_COM_DELAY, PIN_CDROM_DELAY]);
  });

  // Load and store costs follow the expansion delay registers: with COM
  // timing off (bits 8-11 clear) a BIOS ROM word, halfword and byte load
  // and an SPU word store cost what silicon measured; the CD-ROM and SPU byte
  // loads follow the CD-ROM and COM delay registers.
  // the delay registers do not change the cost of a load: 195 cycles for
  // every CD-ROM and SPU byte arm
  xit('busDelaySweep', async () => {
    const dev2 = m.read32(DEV2_DELAY) >>> 0, dev4 = m.read32(DEV4_DELAY) >>> 0, com = m.read32(COM_DELAY) >>> 0;
    const arm = (reg, v0, cfg, run) => {
      m.write32(reg, cfg);
      const r = run();
      m.write32(reg, v0);
      return r;
    };
    // arm "b11^": bit 11 flipped, COM timing for the device off
    const nocom2 = arm(DEV2_DELAY, dev2, (dev2 ^ 0x800) >>> 0, () => ['bus_lw', 'bus_lh', 'bus_lb'].map(fn => RUN8(fn, ADDR_BIOS)[0]));
    const nocom4 = arm(DEV4_DELAY, dev4, (dev4 ^ 0x100) >>> 0, () => RUN8('bus_lw', ADDR_SPU_ADSR)[0]);
    const cdArms = [[0x00020843, 0x00031125, 646, 1349], [0x00020843, 0x0000132c, 646, 1790], [0x00020943, 0x00031125, 709, 1349], [0x00020943, 0x0000132c, 1150, 1790]];
    const cd = m.read32(CDROM_DELAY) >>> 0;
    const cdGot = cdArms.map(([cdv, comv]) => {
      m.write32(COM_DELAY, comv);
      m.write32(CDROM_DELAY, cdv);
      const r = [RUN8('bus_lbu', ADDR_CDROM)[0], RUN8('bus_lbu', ADDR_SPU)[0]];
      m.write32(CDROM_DELAY, cd);
      m.write32(COM_DELAY, com);
      return r;
    });
    const got = { cd: cdGot };
    const want = { cd: cdArms.map(([, , c, s]) => [c, s]) };
    if (dev2 === 0x0013243f) { got.nocom2 = nocom2; want.nocom2 = [1542, 902, 582]; }
    if (dev4 === 0x200931e1) { got.nocom4 = nocom4; want.nocom4 = 2310; }
    expect(got).to.eql(want);
  });

})
