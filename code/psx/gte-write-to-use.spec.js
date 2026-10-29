mdlr('[test]enge:psx:gte-write-to-use', ({ include, test }) => {

  const { describe, it, xit, expect, before, after } = test;

  // Ported from the nugget GTE write-to-use tests (https://github.com/
  // pcsx-redux/nugget, tests/gte-write-to-use, MIT), measured on SCPH-1000,
  // -1001, -5501 (two), -7001 and -9002 (RESULTS.md there).
  //
  // Every cell is one (command, input register) pair of the gte-latency
  // tests, with that test's scene and canary. A cell function writes the
  // register, waits 4 nops, writes a second value, waits N nops (N = 0..3)
  // and runs the command, starting A words (A = 0..3) past a 16-byte line:
  //
  //   mtc2/ctc2 a, reg; nop x4; mtc2/ctc2 b, reg; nop x N; cop2 CMD
  //
  // and the command's outputs are compared with two references through the
  // same function: a = b = scene value (old), a = b = canary (new). The
  // letter per N is O (old) or N (new), o / n the same with the written
  // register left out (the late write landed over the command's result), X
  // a mix, B when old and new give the same outputs. A cell passes when each
  // of its letters is the same at every A and matches the one measured on
  // all six consoles; '?' letters are not checked. The uncached run of the
  // original only prints, so it is left out.

  const { createMachine } = include('enge:psx:test-machine');

  const u32 = v => v >>> 0;
  const s32 = v => v | 0;
  const GWU_NMAX = 4, GWU_AMAX = 4;

  // common/hardware/cop2.h: command encoding
  const COP2_OP = (fake, sf, mx, v, cv, lm, fn) =>
    ((fake << 20) | (sf << 19) | (mx << 17) | (v << 15) | (cv << 13) | (lm << 10) | fn) >>> 0;
  const COP2_MX_RT = 0, COP2_MX_LL = 1, COP2_MX_LC = 2, COP2_MX_3 = 3;
  const COP2_V_V0 = 0, COP2_V_V1 = 1, COP2_V_V2 = 2, COP2_V_IR = 3;
  const COP2_CV_TR = 0, COP2_CV_BK = 1, COP2_CV_FC = 2, COP2_CV_NONE = 3;
  const COP2_RTPS = (sf, lm) => COP2_OP(1, sf, 0, 0, 0, lm, 0x01);
  const COP2_RTPT = (sf, lm) => COP2_OP(2, sf, 0, 0, 0, lm, 0x30);
  const COP2_NCLIP = COP2_OP(20, 0, 0, 0, 0, 0, 0x06);
  const COP2_OP_CP = (sf, lm) => COP2_OP(23, sf, 0, 0, 0, lm, 0x0c);
  const COP2_DPCS = (sf, lm) => COP2_OP(7, sf, 0, 0, 0, lm, 0x10);
  const COP2_DPCT = (sf, lm) => COP2_OP(15, sf, 0, 0, 0, lm, 0x2a);
  const COP2_DCPL = (sf, lm) => COP2_OP(6, sf, 0, 0, 0, lm, 0x29);
  const COP2_INTPL = (sf, lm) => COP2_OP(9, sf, 0, 0, 0, lm, 0x11);
  const COP2_MVMVA = (sf, mx, v, cv, lm) => COP2_OP(4, sf, mx, v, cv, lm, 0x12);
  const COP2_NCS = (sf, lm) => COP2_OP(12, sf, 0, 0, 0, lm, 0x1e);
  const COP2_NCT = (sf, lm) => COP2_OP(13, sf, 0, 0, 0, lm, 0x20);
  const COP2_NCCS = (sf, lm) => COP2_OP(16, sf, 0, 0, 0, lm, 0x1b);
  const COP2_NCCT = (sf, lm) => COP2_OP(17, sf, 0, 0, 0, lm, 0x3f);
  const COP2_NCDS = (sf, lm) => COP2_OP(14, sf, 0, 0, 0, lm, 0x13);
  const COP2_NCDT = (sf, lm) => COP2_OP(15, sf, 0, 0, 0, lm, 0x16);
  const COP2_CC = (sf, lm) => COP2_OP(19, sf, 0, 0, 0, lm, 0x1c);
  const COP2_CDP = (sf, lm) => COP2_OP(18, sf, 0, 0, 0, lm, 0x14);
  const COP2_SQR = (sf, lm) => COP2_OP(10, sf, 0, 0, 0, lm, 0x28);
  const COP2_AVSZ3 = COP2_OP(21, 1, 0, 0, 0, 0, 0x2d);
  const COP2_AVSZ4 = COP2_OP(22, 1, 0, 0, 0, 0, 0x2e);
  const COP2_GPF = (sf, lm) => COP2_OP(25, sf, 0, 0, 0, lm, 0x3d);
  const COP2_GPL = (sf, lm) => COP2_OP(26, sf, 0, 0, 0, lm, 0x3e);

  let m, gte;
  before(async () => {
    m = createMachine();
    gte = m.gte;
    // gte_enable(): SR.CU2
    m.asm(0x80030000, `
          mfc0  $t0, $12
          lui   $t1, 0x4000
          or    $t0, $t0, $t1
          mtc0  $t0, $12
          nop
          nop
          jr    $ra
          nop`);
    m.call(0x80030000);
  });
  after(async () => { m?.dispose(); });

  // the cell functions, each in its own 128-byte slot (16-byte aligned)
  let slot = 0x80040000;
  const cellFn = (K, reg, op, N, A) => {
    const addr = slot;
    slot += 128;
    const w = K === 'C' ? 'ctc2' : 'mtc2';
    m.asm(addr, [
      ...new Array(A).fill('nop'),
      `${w} $a0, $${reg}`, 'nop', 'nop', 'nop', 'nop',
      `${w} $a1, $${reg}`, ...new Array(N).fill('nop'),
      `cop2 ${op}`, 'nop', 'nop', 'jr $ra', 'nop',
    ].join('\n'));
    return addr;
  };

  // gte-latency-common.h
  const FIELDS = ['rgb0', 'rgb1', 'rgb2', 'mac0', 'mac1', 'mac2', 'mac3', 'ir0', 'ir1', 'ir2', 'ir3',
    'sxy0', 'sxy1', 'sxy2', 'sz0', 'sz1', 'sz2', 'sz3', 'flag'];
  const DATA_FIELD = { 8: 'ir0', 9: 'ir1', 10: 'ir2', 11: 'ir3', 12: 'sxy0', 13: 'sxy1', 14: 'sxy2', 16: 'sz0', 17: 'sz1',
    18: 'sz2', 19: 'sz3', 20: 'rgb0', 21: 'rgb1', 22: 'rgb2', 24: 'mac0', 25: 'mac1', 26: 'mac2', 27: 'mac3' };
  const read_full_state = () => ({
    rgb0: u32(gte.get(20)), rgb1: u32(gte.get(21)), rgb2: u32(gte.get(22)),
    mac0: s32(gte.get(24)), mac1: s32(gte.get(25)), mac2: s32(gte.get(26)), mac3: s32(gte.get(27)),
    ir0: s32(gte.get(8)), ir1: s32(gte.get(9)), ir2: s32(gte.get(10)), ir3: s32(gte.get(11)),
    sxy0: u32(gte.get(12)), sxy1: u32(gte.get(13)), sxy2: u32(gte.get(14)),
    sz0: u32(gte.get(16)), sz1: u32(gte.get(17)), sz2: u32(gte.get(18)), sz3: u32(gte.get(19)),
    flag: u32(gte.get(32 + 31)),
  });
  const results_equal = (a, b) => FIELDS.every(f => a[f] === b[f]);
  // the written data register left out of the comparison
  const mask = (r, c) => {
    if (c.ctrl || !(c.reg in DATA_FIELD)) return r;
    return { ...r, [DATA_FIELD[c.reg]]: 0 };
  };

  const run = (c, fn, which) => {
    let old;
    for (let pass = 0; pass < 2; pass++) {
      c.scene();
      old = c.read();
      m.call(fn, which === 1 ? c.canary : old, which === 0 ? old : c.canary);
    }
    return { r: read_full_state(), post: c.read(), old };
  };

  const classify = (c, fn) => {
    let { r: o, post: opost, old: oldv } = run(c, fn, 0);
    let { r: nw, post: npost } = run(c, fn, 1);
    let { r } = run(c, fn, 2);
    const kept = !c.ctrl && !(opost === oldv && npost === u32(c.canary));
    if (!kept) {
      o = mask(o, c);
      nw = mask(nw, c);
      r = mask(r, c);
    }
    if (results_equal(o, nw)) return 'B';
    if (results_equal(r, o)) return 'O';
    if (results_equal(r, nw)) return 'N';
    if (kept) {
      const mo = mask(o, c), mn = mask(nw, c), mr = mask(r, c);
      if (!results_equal(mo, mn)) {
        if (results_equal(mr, mo)) return 'o';
        if (results_equal(mr, mn)) return 'n';
      }
    }
    return 'X';
  };

  // The letters per N at A0..A3, and the check of the original: a letter is
  // compared when the console letter is not '?', and must then be the same
  // at every A. What a cell checks is reported as N0..N3: the letter seen,
  // or the four seen when they differ between A.
  const measure = (K, reg, op, cell) => {
    const res = [0, 1, 2, 3].map(A => [0, 1, 2, 3].map(N => classify(cell, cellFn(K, reg, op, N, A))).join(''));
    return [0, 1, 2, 3].map(N => {
      if (cell.expect[N] === '?') return '?';
      const seen = res.map(row => row[N]);
      return seen.every(l => l === seen[0]) ? seen[0] : seen.join('');
    }).join(' ');
  };

  const cells = list => {
    for (const [K, label, scene, op, reg, canary, expected] of list) {
      const cell = { label, scene, ctrl: K === 'C', reg, canary, expect: expected, read: () => u32(gte.get((K === 'C' ? 32 : 0) + reg)) };
      it(`${label} ${expected}`, async () => {
        expect(measure(K, reg, op, cell)).to.eql(expected.split('').join(' '));
      });
    }
  };

  describe('lighting (gwu-lighting.c, scenes of gte-latency.c)', () => {
    // Test scene used by all the lighting-family tests.
    //
    // LLM, LCM = identity diagonal (1.0 = 0x1000 in the 12.12 fixed-point
    // the GTE uses).
    //
    // V0 = (0, 0, 0x1000)   normal facing the +Z light
    // V1 = (0x1000, 0, 0)   normal along +X
    // V2 = (0, 0x1000, 0)   normal along +Y
    // BK = FC = 0
    // RGBC = (R=0x80, G=0x80, B=0x80, CODE=0)
    // IR0 = 0x1000          (used by INTPL/DCPL but kept stable across tests)
    // IR1/2/3 baseline matches V0's lighting result
    //
    // We reset every input the lighting tests use, before every probe iteration,
    // so prior canary writes can never leak between probes or tests.
    const scene_setup = () => {
      // LLM = identity diagonal
      gte.set(32 + 8, 0x00001000);
      gte.set(32 + 9, 0x00000000);
      gte.set(32 + 10, 0x00001000);
      gte.set(32 + 11, 0x00000000);
      gte.set(32 + 12, 0x1000);
      // LCM = identity diagonal
      gte.set(32 + 16, 0x00001000);
      gte.set(32 + 17, 0x00000000);
      gte.set(32 + 18, 0x00001000);
      gte.set(32 + 19, 0x00000000);
      gte.set(32 + 20, 0x1000);
      gte.set(32 + 13, 0);
      gte.set(32 + 14, 0);
      gte.set(32 + 15, 0); // BK
      gte.set(32 + 21, 0);
      gte.set(32 + 22, 0);
      gte.set(32 + 23, 0); // FC
      gte.set(0, 0x00000000); // V0
      gte.set(1, 0x00001000);
      gte.set(2, (0x0000 << 16) | 0x1000); // V1
      gte.set(3, 0);
      gte.set(4, (0x1000 << 16) | 0x0000); // V2
      gte.set(5, 0);
      gte.set(6, 0x00808080); // RGBC
      gte.set(8, 0x1000); // IR0 (12-bit unsigned, 1.0)
      gte.set(32 + 31, 0); // FLAG
    };

    // Compile-time GTE op encodings. The COP2_X(sf, lm) macros expand to
    // integer constants, which is what the inline asm "i" constraint needs.
    const OP_NCCT_SF1_LM1 = COP2_NCCT(1, 1);
    const OP_NCCS_SF1_LM1 = COP2_NCCS(1, 1);
    const OP_NCDT_SF1_LM1 = COP2_NCDT(1, 1);
    const OP_NCDS_SF1_LM1 = COP2_NCDS(1, 1);
    const OP_NCT_SF1_LM1 = COP2_NCT(1, 1);
    const OP_NCS_SF1_LM1 = COP2_NCS(1, 1);

    // Canary values: chosen to be wildly different from baseline and to
    // produce clearly different outputs.
    const CANARY_VXY = 0x40004000; // VX=0x4000, VY=0x4000
    // VZ canary chosen smaller than baseline (0x1000) so the perturbed
    // pipeline doesn't saturate to the same RGB value as the baseline.
    // 0x4000 was too large for NCT (no per-vertex color tint to shrink the
    // pipeline output), causing the sanity-pre output to saturate to the
    // same 0xff as baseline.
    const CANARY_VZ = 0x00000100;
    const CANARY_RGBC = 0x00404040; // R=G=B=0x40 (half intensity)
    const CANARY_LMAT = 0x00000800; // 0.5 in matrix entry (vs identity 1.0=0x1000)
    const CANARY_BK = 0x00010000; // BK = 65536 (16.0)
    const CANARY_FC = 0x00010000; // FC = 65536

    const scene_setup_ncdt = () => {
      scene_setup();
      gte.set(32 + 21, 0x1000); // RFC = 0x1000
      gte.set(32 + 22, 0x1000); // GFC
      gte.set(32 + 23, 0x1000); // BFC
      gte.set(8, 0x0800); // IR0 = 0.5 in 1.12
    };

    cells([
      ['D', 'NCCT VXY0', scene_setup, OP_NCCT_SF1_LM1, 0, CANARY_VXY, 'XXNN'],
      ['D', 'NCCT VZ0', scene_setup, OP_NCCT_SF1_LM1, 1, CANARY_VZ, 'NNNN'],
      ['D', 'NCCT VXY1', scene_setup, OP_NCCT_SF1_LM1, 2, CANARY_VXY, 'NNNN'],
      ['D', 'NCCT VZ1', scene_setup, OP_NCCT_SF1_LM1, 3, CANARY_VZ, 'NNNN'],
      ['D', 'NCCT VXY2', scene_setup, OP_NCCT_SF1_LM1, 4, CANARY_VXY, 'NNNN'],
      ['D', 'NCCT VZ2', scene_setup, OP_NCCT_SF1_LM1, 5, CANARY_VZ, 'NNNN'],
      ['D', 'NCCT RGBC', scene_setup, OP_NCCT_SF1_LM1, 6, CANARY_RGBC, 'NNNN'],
      ['C', 'NCCT L11L12', scene_setup, OP_NCCT_SF1_LM1, 8, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT L13L21', scene_setup, OP_NCCT_SF1_LM1, 9, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT L22L23', scene_setup, OP_NCCT_SF1_LM1, 10, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT L31L32', scene_setup, OP_NCCT_SF1_LM1, 11, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT L33', scene_setup, OP_NCCT_SF1_LM1, 12, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT LR1LR2', scene_setup, OP_NCCT_SF1_LM1, 16, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT LR3LG1', scene_setup, OP_NCCT_SF1_LM1, 17, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT LG2LG3', scene_setup, OP_NCCT_SF1_LM1, 18, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT LB1LB2', scene_setup, OP_NCCT_SF1_LM1, 19, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT LB3', scene_setup, OP_NCCT_SF1_LM1, 20, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCT RBK', scene_setup, OP_NCCT_SF1_LM1, 13, CANARY_BK, 'NNNN'],
      ['C', 'NCCT GBK', scene_setup, OP_NCCT_SF1_LM1, 14, CANARY_BK, 'NNNN'],
      ['C', 'NCCT BBK', scene_setup, OP_NCCT_SF1_LM1, 15, CANARY_BK, 'NNNN'],
      ['D', 'NCT VXY0', scene_setup, OP_NCT_SF1_LM1, 0, CANARY_VXY, 'XXNN'],
      ['D', 'NCT VZ0', scene_setup, OP_NCT_SF1_LM1, 1, CANARY_VZ, 'NNNN'],
      ['D', 'NCT VXY1', scene_setup, OP_NCT_SF1_LM1, 2, CANARY_VXY, 'NNNN'],
      ['D', 'NCT VZ1', scene_setup, OP_NCT_SF1_LM1, 3, CANARY_VZ, 'NNNN'],
      ['D', 'NCT VXY2', scene_setup, OP_NCT_SF1_LM1, 4, CANARY_VXY, 'NNNN'],
      ['D', 'NCT VZ2', scene_setup, OP_NCT_SF1_LM1, 5, CANARY_VZ, 'NNNN'],
      ['C', 'NCT L11L12', scene_setup, OP_NCT_SF1_LM1, 8, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT L13L21', scene_setup, OP_NCT_SF1_LM1, 9, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT L22L23', scene_setup, OP_NCT_SF1_LM1, 10, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT L31L32', scene_setup, OP_NCT_SF1_LM1, 11, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT L33', scene_setup, OP_NCT_SF1_LM1, 12, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT LR1LR2', scene_setup, OP_NCT_SF1_LM1, 16, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT LR3LG1', scene_setup, OP_NCT_SF1_LM1, 17, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT LG2LG3', scene_setup, OP_NCT_SF1_LM1, 18, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT LB1LB2', scene_setup, OP_NCT_SF1_LM1, 19, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT LB3', scene_setup, OP_NCT_SF1_LM1, 20, CANARY_LMAT, 'NNNN'],
      ['C', 'NCT RBK', scene_setup, OP_NCT_SF1_LM1, 13, CANARY_BK, 'NNNN'],
      ['C', 'NCT GBK', scene_setup, OP_NCT_SF1_LM1, 14, CANARY_BK, 'NNNN'],
      ['C', 'NCT BBK', scene_setup, OP_NCT_SF1_LM1, 15, CANARY_BK, 'NNNN'],
      ['D', 'NCDT VXY0', scene_setup_ncdt, OP_NCDT_SF1_LM1, 0, CANARY_VXY, 'XXNN'],
      ['D', 'NCDT VZ0', scene_setup_ncdt, OP_NCDT_SF1_LM1, 1, CANARY_VZ, 'NNNN'],
      ['D', 'NCDT VXY1', scene_setup_ncdt, OP_NCDT_SF1_LM1, 2, CANARY_VXY, 'NNNN'],
      ['D', 'NCDT VZ1', scene_setup_ncdt, OP_NCDT_SF1_LM1, 3, CANARY_VZ, 'NNNN'],
      ['D', 'NCDT VXY2', scene_setup_ncdt, OP_NCDT_SF1_LM1, 4, CANARY_VXY, 'NNNN'],
      ['D', 'NCDT VZ2', scene_setup_ncdt, OP_NCDT_SF1_LM1, 5, CANARY_VZ, 'NNNN'],
      ['D', 'NCDT RGBC', scene_setup_ncdt, OP_NCDT_SF1_LM1, 6, CANARY_RGBC, 'NNNN'],
      ['C', 'NCDT L11L12', scene_setup_ncdt, OP_NCDT_SF1_LM1, 8, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT L13L21', scene_setup_ncdt, OP_NCDT_SF1_LM1, 9, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT L22L23', scene_setup_ncdt, OP_NCDT_SF1_LM1, 10, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT L31L32', scene_setup_ncdt, OP_NCDT_SF1_LM1, 11, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT L33', scene_setup_ncdt, OP_NCDT_SF1_LM1, 12, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT LR1LR2', scene_setup_ncdt, OP_NCDT_SF1_LM1, 16, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT LR3LG1', scene_setup_ncdt, OP_NCDT_SF1_LM1, 17, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT LG2LG3', scene_setup_ncdt, OP_NCDT_SF1_LM1, 18, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT LB1LB2', scene_setup_ncdt, OP_NCDT_SF1_LM1, 19, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT LB3', scene_setup_ncdt, OP_NCDT_SF1_LM1, 20, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDT RBK', scene_setup_ncdt, OP_NCDT_SF1_LM1, 13, CANARY_BK, 'NNNN'],
      ['C', 'NCDT GBK', scene_setup_ncdt, OP_NCDT_SF1_LM1, 14, CANARY_BK, 'NNNN'],
      ['C', 'NCDT BBK', scene_setup_ncdt, OP_NCDT_SF1_LM1, 15, CANARY_BK, 'NNNN'],
      ['C', 'NCDT RFC', scene_setup_ncdt, OP_NCDT_SF1_LM1, 21, CANARY_FC, 'NNNN'],
      ['C', 'NCDT GFC', scene_setup_ncdt, OP_NCDT_SF1_LM1, 22, CANARY_FC, 'NNNN'],
      ['C', 'NCDT BFC', scene_setup_ncdt, OP_NCDT_SF1_LM1, 23, CANARY_FC, 'NNNN'],
    ]);

  });

  describe('singles (gwu-singles.c, scenes of gte-latency-singles.c)', () => {
    // Test scene shared by all the single-vertex lighting tests.
    //
    // V0 = (0x600, 0x800, 0xA00)   non-axis-aligned so EVERY L matrix entry
    //                              contributes to the lighting result. With an
    //                              axis-aligned V0, the canary on, say, L11
    //                              would have no effect because L11 is always
    //                              multiplied by V0_X=0 - we'd report a false
    //                              "latched at N=0" boundary.
    // LLM = identity diagonal
    // LCM = identity diagonal
    // BK = (0, 0, 0)
    // FC = (0x1000, 0x1000, 0x1000)   used by NCDS
    // IR0 = 0x800                     used by NCDS depth cue
    // RGBC = (0x80, 0x80, 0x80, 0)   used by NCCS / NCDS color stage
    const scene_setup = () => {
      gte.set(32 + 8, 0x00001000);
      gte.set(32 + 9, 0x00000000);
      gte.set(32 + 10, 0x00001000);
      gte.set(32 + 11, 0x00000000);
      gte.set(32 + 12, 0x1000);
      gte.set(32 + 16, 0x00001000);
      gte.set(32 + 17, 0x00000000);
      gte.set(32 + 18, 0x00001000);
      gte.set(32 + 19, 0x00000000);
      gte.set(32 + 20, 0x1000);
      gte.set(32 + 13, 0);
      gte.set(32 + 14, 0);
      gte.set(32 + 15, 0); // BK
      gte.set(32 + 21, 0x1000);
      gte.set(32 + 22, 0x1000);
      gte.set(32 + 23, 0x1000); // FC
      gte.set(0, (0x0800 << 16) | 0x0600); // V0: VX=0x600, VY=0x800
      gte.set(1, 0x00000A00); //     VZ=0xA00
      // V1, V2 set to placeholders (NCS/NCCS/NCDS don't read them).
      gte.set(2, 0);
      gte.set(3, 0);
      gte.set(4, 0);
      gte.set(5, 0);
      gte.set(6, 0x00808080); // RGBC
      gte.set(8, 0x0800); // IR0 = 0.5
      // Clear RGB FIFO and SXY FIFO so stale entries from prior probes
      // don't end up in the comparison. Single-vertex lighting ops only
      // push one entry per call; the older slots would otherwise hold
      // garbage from earlier tests.
      gte.set(20, 0);
      gte.set(21, 0);
      gte.set(22, 0); // RGB FIFO
      gte.set(12, 0);
      gte.set(13, 0);
      gte.set(14, 0); // SXY FIFO entries
      gte.set(16, 0);
      gte.set(17, 0);
      gte.set(18, 0);
      gte.set(19, 0); // SZ FIFO
      gte.set(24, 0);
      gte.set(25, 0);
      gte.set(26, 0);
      gte.set(27, 0); // MAC0..3
      gte.set(32 + 31, 0); // FLAG
    };

    const OP_NCS_SF1_LM1 = COP2_NCS(1, 1);
    const OP_NCCS_SF1_LM1 = COP2_NCCS(1, 1);
    const OP_NCDS_SF1_LM1 = COP2_NCDS(1, 1);

    // Canaries: values different from baseline that produce visibly
    // different GTE outputs. For 16/16-packed matrix entries we set BOTH
    // halves so the canary perturbs both the low and high entries.
    const CANARY_VXY = 0x05000400; // VX=0x400, VY=0x500 (vs 0x600/0x800)
    const CANARY_VZ = 0x00000400; // VZ=0x400 (vs 0xA00)
    const CANARY_RGBC = 0x00404040;
    const CANARY_LMAT = 0x07ff07ff; // both halves 0x7ff (off-diagonal 0 -> 0x7ff,
    // diagonal 0x1000 -> 0x7ff)
    const CANARY_BK = 0x00010000;
    const CANARY_FC = 0x00010000;

    cells([
      ['D', 'NCS VXY0', scene_setup, OP_NCS_SF1_LM1, 0, CANARY_VXY, 'XXNN'],
      ['D', 'NCS VZ0', scene_setup, OP_NCS_SF1_LM1, 1, CANARY_VZ, 'NNNN'],
      ['C', 'NCS L11L12', scene_setup, OP_NCS_SF1_LM1, 8, CANARY_LMAT, 'OXNN'],
      ['C', 'NCS L13L21', scene_setup, OP_NCS_SF1_LM1, 9, CANARY_LMAT, 'XNNN'],
      ['C', 'NCS L22L23', scene_setup, OP_NCS_SF1_LM1, 10, CANARY_LMAT, 'NNNN'],
      ['C', 'NCS L31L32', scene_setup, OP_NCS_SF1_LM1, 11, CANARY_LMAT, 'NNNN'],
      ['C', 'NCS L33', scene_setup, OP_NCS_SF1_LM1, 12, CANARY_LMAT, 'NNNN'],
      ['C', 'NCS LR1LR2', scene_setup, OP_NCS_SF1_LM1, 16, CANARY_LMAT, 'NNNN'],
      ['C', 'NCS LR3LG1', scene_setup, OP_NCS_SF1_LM1, 17, CANARY_LMAT, 'NNNN'],
      ['C', 'NCS LG2LG3', scene_setup, OP_NCS_SF1_LM1, 18, CANARY_LMAT, 'NNNN'],
      ['C', 'NCS LB1LB2', scene_setup, OP_NCS_SF1_LM1, 19, CANARY_LMAT, 'NNNN'],
      ['C', 'NCS LB3', scene_setup, OP_NCS_SF1_LM1, 20, CANARY_LMAT, 'NNNN'],
      ['C', 'NCS RBK', scene_setup, OP_NCS_SF1_LM1, 13, CANARY_BK, 'NNNN'],
      ['C', 'NCS GBK', scene_setup, OP_NCS_SF1_LM1, 14, CANARY_BK, 'NNNN'],
      ['C', 'NCS BBK', scene_setup, OP_NCS_SF1_LM1, 15, CANARY_BK, 'NNNN'],
      ['D', 'NCCS VXY0', scene_setup, OP_NCCS_SF1_LM1, 0, CANARY_VXY, 'XXNN'],
      ['D', 'NCCS VZ0', scene_setup, OP_NCCS_SF1_LM1, 1, CANARY_VZ, 'NNNN'],
      ['D', 'NCCS RGBC', scene_setup, OP_NCCS_SF1_LM1, 6, CANARY_RGBC, 'NNNN'],
      ['C', 'NCCS L11L12', scene_setup, OP_NCCS_SF1_LM1, 8, CANARY_LMAT, 'OXNN'],
      ['C', 'NCCS L13L21', scene_setup, OP_NCCS_SF1_LM1, 9, CANARY_LMAT, 'XNNN'],
      ['C', 'NCCS L22L23', scene_setup, OP_NCCS_SF1_LM1, 10, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCS L31L32', scene_setup, OP_NCCS_SF1_LM1, 11, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCS L33', scene_setup, OP_NCCS_SF1_LM1, 12, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCS LR1LR2', scene_setup, OP_NCCS_SF1_LM1, 16, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCS LR3LG1', scene_setup, OP_NCCS_SF1_LM1, 17, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCS LG2LG3', scene_setup, OP_NCCS_SF1_LM1, 18, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCS LB1LB2', scene_setup, OP_NCCS_SF1_LM1, 19, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCS LB3', scene_setup, OP_NCCS_SF1_LM1, 20, CANARY_LMAT, 'NNNN'],
      ['C', 'NCCS RBK', scene_setup, OP_NCCS_SF1_LM1, 13, CANARY_BK, 'NNNN'],
      ['C', 'NCCS GBK', scene_setup, OP_NCCS_SF1_LM1, 14, CANARY_BK, 'NNNN'],
      ['C', 'NCCS BBK', scene_setup, OP_NCCS_SF1_LM1, 15, CANARY_BK, 'NNNN'],
      ['D', 'NCDS VXY0', scene_setup, OP_NCDS_SF1_LM1, 0, CANARY_VXY, 'XXNN'],
      ['D', 'NCDS VZ0', scene_setup, OP_NCDS_SF1_LM1, 1, CANARY_VZ, 'NNNN'],
      ['D', 'NCDS RGBC', scene_setup, OP_NCDS_SF1_LM1, 6, CANARY_RGBC, 'NNNN'],
      ['C', 'NCDS L11L12', scene_setup, OP_NCDS_SF1_LM1, 8, CANARY_LMAT, 'OXNN'],
      ['C', 'NCDS L13L21', scene_setup, OP_NCDS_SF1_LM1, 9, CANARY_LMAT, 'XNNN'],
      ['C', 'NCDS L22L23', scene_setup, OP_NCDS_SF1_LM1, 10, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDS L31L32', scene_setup, OP_NCDS_SF1_LM1, 11, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDS L33', scene_setup, OP_NCDS_SF1_LM1, 12, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDS LR1LR2', scene_setup, OP_NCDS_SF1_LM1, 16, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDS LR3LG1', scene_setup, OP_NCDS_SF1_LM1, 17, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDS LG2LG3', scene_setup, OP_NCDS_SF1_LM1, 18, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDS LB1LB2', scene_setup, OP_NCDS_SF1_LM1, 19, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDS LB3', scene_setup, OP_NCDS_SF1_LM1, 20, CANARY_LMAT, 'NNNN'],
      ['C', 'NCDS RBK', scene_setup, OP_NCDS_SF1_LM1, 13, CANARY_BK, 'NNNN'],
      ['C', 'NCDS GBK', scene_setup, OP_NCDS_SF1_LM1, 14, CANARY_BK, 'NNNN'],
      ['C', 'NCDS BBK', scene_setup, OP_NCDS_SF1_LM1, 15, CANARY_BK, 'NNNN'],
      ['C', 'NCDS RFC', scene_setup, OP_NCDS_SF1_LM1, 21, CANARY_FC, 'NNNN'],
      ['C', 'NCDS GFC', scene_setup, OP_NCDS_SF1_LM1, 22, CANARY_FC, 'NNNN'],
      ['C', 'NCDS BFC', scene_setup, OP_NCDS_SF1_LM1, 23, CANARY_FC, 'NNNN'],
    ]);

  });

  describe('perspective (gwu-perspective.c, scenes of gte-latency-perspective.c)', () => {
    // Test scene for RTPS / RTPT.
    //
    // V0 = (0x300, 0x400, 0x500) (non-axis-aligned so every R-matrix entry
    //                             contributes to the projection)
    // V1 = (0x600, 0x700, 0x800)
    // V2 = (0x900, 0xA00, 0xB00)
    // RT = identity diagonal
    // TR = (100, 200, 0x4000)         (Z translation = 0x4000 so Z is well-
    //                                  defined, projection division works)
    // OFX = (160 << 16), OFY = (120 << 16)
    // H = 200
    // DQA = 0x100, DQB = 0
    //
    // Expected RTPS produces a screen-space (SX2, SY2) and depth (SZ3),
    // plus depth-cued IR0. Different from baseline when any input changes.
    const scene_setup = () => {
      // Rotation matrix R = identity diagonal
      gte.set(32 + 0, 0x00001000); // R11R12: R11=0x1000
      gte.set(32 + 1, 0x00000000); // R13R21
      gte.set(32 + 2, 0x00001000); // R22R23: R22=0x1000
      gte.set(32 + 3, 0x00000000); // R31R32
      gte.set(32 + 4, 0x1000); // R33

      // Translation
      gte.set(32 + 5, 100); // TRX
      gte.set(32 + 6, 200); // TRY
      gte.set(32 + 7, 0x4000); // TRZ (large enough to keep Z positive)

      // Screen / projection params
      gte.set(32 + 24, (160 << 16)); // OFX (16.16)
      gte.set(32 + 25, (120 << 16)); // OFY
      gte.set(32 + 26, 200); // H (projection plane Z)
      gte.set(32 + 27, 0x100); // DQA (depth-cue scaling)
      gte.set(32 + 28, 0); // DQB

      // Vertices
      gte.set(0, (0x0400 << 16) | 0x0300);
      gte.set(1, 0x00000500); // V0
      gte.set(2, (0x0700 << 16) | 0x0600);
      gte.set(3, 0x00000800); // V1
      gte.set(4, (0x0A00 << 16) | 0x0900);
      gte.set(5, 0x00000B00); // V2

      // Clear FIFOs (RTPS pushes one, RTPT pushes three).
      gte.set(12, 0);
      gte.set(13, 0);
      gte.set(14, 0); // SXY FIFO
      gte.set(16, 0);
      gte.set(17, 0);
      gte.set(18, 0);
      gte.set(19, 0); // SZ FIFO
      gte.set(20, 0);
      gte.set(21, 0);
      gte.set(22, 0); // RGB FIFO (unused, kept clean)
      gte.set(24, 0);
      gte.set(25, 0);
      gte.set(26, 0);
      gte.set(27, 0); // MAC0..3
      gte.set(8, 0); // IR0

      gte.set(32 + 31, 0); // FLAG
    };

    const OP_RTPS_SF1_LM1 = COP2_RTPS(1, 1);
    const OP_RTPT_SF1_LM1 = COP2_RTPT(1, 1);

    const CANARY_VXY = 0x05000400; // half each (vs 0x300/0x400 in baseline)
    const CANARY_VZ = 0x00000400;
    const CANARY_RMAT = 0x07ff07ff;
    const CANARY_TR = 0x00007fff;
    const CANARY_OF = 0x00800000; // OFX/OFY are 32-bit fixed-point
    const CANARY_H = 0x00000080; // canary H (vs 200 = 0xc8)
    const CANARY_DQA = 0x00000040;
    const CANARY_DQB = 0x00000080;

    cells([
      ['D', 'RTPS VXY0', scene_setup, OP_RTPS_SF1_LM1, 0, CANARY_VXY, 'NNNN'],
      ['D', 'RTPS VZ0', scene_setup, OP_RTPS_SF1_LM1, 1, CANARY_VZ, 'NNNN'],
      ['C', 'RTPS R11R12', scene_setup, OP_RTPS_SF1_LM1, 0, CANARY_RMAT, 'NNNN'],
      ['C', 'RTPS R13R21', scene_setup, OP_RTPS_SF1_LM1, 1, CANARY_RMAT, 'NNNN'],
      ['C', 'RTPS R22R23', scene_setup, OP_RTPS_SF1_LM1, 2, CANARY_RMAT, 'NNNN'],
      ['C', 'RTPS R31R32', scene_setup, OP_RTPS_SF1_LM1, 3, CANARY_RMAT, 'OXNN'],
      ['C', 'RTPS R33', scene_setup, OP_RTPS_SF1_LM1, 4, CANARY_RMAT, 'NNNN'],
      ['C', 'RTPS TRX', scene_setup, OP_RTPS_SF1_LM1, 5, CANARY_TR, 'NNNN'],
      ['C', 'RTPS TRY', scene_setup, OP_RTPS_SF1_LM1, 6, CANARY_TR, 'NNNN'],
      ['C', 'RTPS TRZ', scene_setup, OP_RTPS_SF1_LM1, 7, CANARY_TR, 'OONN'],
      ['C', 'RTPS OFX', scene_setup, OP_RTPS_SF1_LM1, 24, CANARY_OF, 'NNNN'],
      ['C', 'RTPS OFY', scene_setup, OP_RTPS_SF1_LM1, 25, CANARY_OF, 'NNNN'],
      ['C', 'RTPS H', scene_setup, OP_RTPS_SF1_LM1, 26, CANARY_H, 'NNNN'],
      ['C', 'RTPS DQA', scene_setup, OP_RTPS_SF1_LM1, 27, CANARY_DQA, 'NNNN'],
      ['C', 'RTPS DQB', scene_setup, OP_RTPS_SF1_LM1, 28, CANARY_DQB, 'NNNN'],
      ['D', 'RTPT VXY0', scene_setup, OP_RTPT_SF1_LM1, 0, CANARY_VXY, 'XNNN'],
      ['D', 'RTPT VZ0', scene_setup, OP_RTPT_SF1_LM1, 1, CANARY_VZ, 'NNNN'],
      ['D', 'RTPT VXY1', scene_setup, OP_RTPT_SF1_LM1, 2, CANARY_VXY, 'NNNN'],
      ['D', 'RTPT VZ1', scene_setup, OP_RTPT_SF1_LM1, 3, CANARY_VZ, 'NNNN'],
      ['D', 'RTPT VXY2', scene_setup, OP_RTPT_SF1_LM1, 4, CANARY_VXY, 'NNNN'],
      ['D', 'RTPT VZ2', scene_setup, OP_RTPT_SF1_LM1, 5, CANARY_VZ, 'NNNN'],
      ['C', 'RTPT R11R12', scene_setup, OP_RTPT_SF1_LM1, 0, CANARY_RMAT, 'XNNN'],
      ['C', 'RTPT R13R21', scene_setup, OP_RTPT_SF1_LM1, 1, CANARY_RMAT, 'NNNN'],
      ['C', 'RTPT R22R23', scene_setup, OP_RTPT_SF1_LM1, 2, CANARY_RMAT, 'NNNN'],
      ['C', 'RTPT R31R32', scene_setup, OP_RTPT_SF1_LM1, 3, CANARY_RMAT, 'X?NN'],
      ['C', 'RTPT R33', scene_setup, OP_RTPT_SF1_LM1, 4, CANARY_RMAT, 'NNNN'],
      ['C', 'RTPT TRX', scene_setup, OP_RTPT_SF1_LM1, 5, CANARY_TR, 'XNNN'],
      ['C', 'RTPT TRY', scene_setup, OP_RTPT_SF1_LM1, 6, CANARY_TR, 'NNNN'],
      ['C', 'RTPT TRZ', scene_setup, OP_RTPT_SF1_LM1, 7, CANARY_TR, 'X?NN'],
      ['C', 'RTPT OFX', scene_setup, OP_RTPT_SF1_LM1, 24, CANARY_OF, 'NNNN'],
      ['C', 'RTPT OFY', scene_setup, OP_RTPT_SF1_LM1, 25, CANARY_OF, 'NNNN'],
      ['C', 'RTPT H', scene_setup, OP_RTPT_SF1_LM1, 26, CANARY_H, 'NNNN'],
      ['C', 'RTPT DQA', scene_setup, OP_RTPT_SF1_LM1, 27, CANARY_DQA, 'NNNN'],
      ['C', 'RTPT DQB', scene_setup, OP_RTPT_SF1_LM1, 28, CANARY_DQB, 'NNNN'],
    ]);

  });

  describe('math (gwu-math.c, scenes of gte-latency-math.c)', () => {
    // Test scene for the math instructions.
    // SQR reads IR1/2/3 only.
    // OP reads R-matrix diagonal (R11, R22, R33 == control regs 0/2/4 low halves)
    //    and IR1/2/3.
    // NCLIP reads SXY0, SXY1, SXY2 (data regs 12, 13, 14).
    const scene_setup = () => {
      // R matrix - diagonal used by OP. Off-diagonal entries don't matter
      // for OP but we set them to 0 for cleanliness.
      gte.set(32 + 0, 0x00001000); // R11=0x1000 (R12 high half)
      gte.set(32 + 1, 0x00000000); // R13=0, R21=0
      gte.set(32 + 2, 0x00001000); // R22=0x1000
      gte.set(32 + 3, 0x00000000); // R31=0, R32=0
      gte.set(32 + 4, 0x1000); // R33=0x1000

      // IR1/2/3 - SQR/OP inputs. Distinct non-zero values so any change
      // is observable.
      gte.set(9, 0x0500); // IR1
      gte.set(10, 0x0600); // IR2
      gte.set(11, 0x0700); // IR3
      gte.set(8, 0x0800); // IR0 (not read by SQR/OP/NCLIP but kept stable)

      // SXY0/1/2 - NCLIP inputs (screen-space 16/16-packed).
      // Triangle in screen space, non-degenerate.
      gte.set(12, (50  << 16) | 100); // SXY0 = (100, 50)
      gte.set(13, (200 << 16) | 150); // SXY1 = (150, 200)
      gte.set(14, (250 << 16) | 80); // SXY2 = (80, 250)

      // Clear other state we read in comparison so it doesn't drift.
      gte.set(20, 0);
      gte.set(21, 0);
      gte.set(22, 0); // RGB FIFO
      gte.set(16, 0);
      gte.set(17, 0);
      gte.set(18, 0);
      gte.set(19, 0); // SZ FIFO
      gte.set(24, 0);
      gte.set(25, 0);
      gte.set(26, 0);
      gte.set(27, 0); // MAC0..3

      gte.set(32 + 31, 0);
    };

    const OP_SQR_SF1_LM1 = COP2_SQR(1, 1);
    const OP_OP_SF1_LM1 = COP2_OP_CP(1, 1); // OP collides with C macro names; cop2.h uses COP2_OP_CP
    const OP_NCLIP = COP2_NCLIP;

    const CANARY_IR = 0x0123; // small value
    const CANARY_RMAT = 0x07ff07ff;
    const CANARY_SXY = 0x12345678;

    cells([
      ['D', 'SQR IR1', scene_setup, OP_SQR_SF1_LM1, 9, CANARY_IR, 'OONN'],
      ['D', 'SQR IR2', scene_setup, OP_SQR_SF1_LM1, 10, CANARY_IR, 'ONNN'],
      ['D', 'SQR IR3', scene_setup, OP_SQR_SF1_LM1, 11, CANARY_IR, 'NNNN'],
      ['D', 'OP IR1', scene_setup, OP_OP_SF1_LM1, 9, CANARY_IR, 'NNNN'],
      ['D', 'OP IR2', scene_setup, OP_OP_SF1_LM1, 10, CANARY_IR, 'ONNN'],
      ['D', 'OP IR3', scene_setup, OP_OP_SF1_LM1, 11, CANARY_IR, 'XXNN'],
      ['C', 'OP R11R12', scene_setup, OP_OP_SF1_LM1, 0, CANARY_RMAT, 'XNNN'],
      ['C', 'OP R22R23', scene_setup, OP_OP_SF1_LM1, 2, CANARY_RMAT, 'XXNN'],
      ['C', 'OP R33', scene_setup, OP_OP_SF1_LM1, 4, CANARY_RMAT, 'XNNN'],
      ['D', 'NCLIP SXY0', scene_setup, OP_NCLIP, 12, CANARY_SXY, 'XXNN'],
      ['D', 'NCLIP SXY1', scene_setup, OP_NCLIP, 13, CANARY_SXY, 'XNNN'],
      ['D', 'NCLIP SXY2', scene_setup, OP_NCLIP, 14, CANARY_SXY, 'XXNN'],
    ]);

  });

  describe('dpc (gwu-dpc.c, scenes of gte-latency-dpc.c)', () => {
    // Shared scene for all DPC-family tests.
    // DPCS / DCPL / INTPL: read RGBC, FC, IR0, IR1/2/3.
    // DPCT: reads RGB FIFO (RGB0/1/2), FC, IR0.
    const scene_setup = () => {
      gte.set(6, 0x00808080); // RGBC
      gte.set(8, 0x0800); // IR0 = 0.5
      gte.set(9, 0x0500); // IR1
      gte.set(10, 0x0600); // IR2
      gte.set(11, 0x0700); // IR3

      // RGB FIFO entries for DPCT
      gte.set(20, 0x00808080); // RGB0
      gte.set(21, 0x00404040); // RGB1
      gte.set(22, 0x00202020); // RGB2

      // FC
      gte.set(32 + 21, 0x1000);
      gte.set(32 + 22, 0x1000);
      gte.set(32 + 23, 0x1000);

      // Other state
      gte.set(12, 0);
      gte.set(13, 0);
      gte.set(14, 0); // SXY FIFO
      gte.set(16, 0);
      gte.set(17, 0);
      gte.set(18, 0);
      gte.set(19, 0); // SZ FIFO
      gte.set(24, 0);
      gte.set(25, 0);
      gte.set(26, 0);
      gte.set(27, 0);

      gte.set(32 + 31, 0);
    };

    const OP_DPCS_SF1_LM1 = COP2_DPCS(1, 1);
    const OP_DPCT_SF1_LM1 = COP2_DPCT(1, 1);
    const OP_DCPL_SF1_LM1 = COP2_DCPL(1, 1);
    const OP_INTPL_SF1_LM1 = COP2_INTPL(1, 1);

    const CANARY_RGBC = 0x00404040;
    const CANARY_IR0 = 0x0400; // smaller than baseline 0x800
    const CANARY_IR = 0x0123;
    const CANARY_FC = 0x00010000;
    const CANARY_RGBFIFO = 0x00f0f0f0;

    cells([
      ['D', 'DPCS RGBC', scene_setup, OP_DPCS_SF1_LM1, 6, CANARY_RGBC, 'XXNN'],
      ['D', 'DPCS IR0', scene_setup, OP_DPCS_SF1_LM1, 8, CANARY_IR0, 'NNNN'],
      ['C', 'DPCS RFC', scene_setup, OP_DPCS_SF1_LM1, 21, CANARY_FC, 'OONN'],
      ['C', 'DPCS GFC', scene_setup, OP_DPCS_SF1_LM1, 22, CANARY_FC, 'ONNN'],
      ['C', 'DPCS BFC', scene_setup, OP_DPCS_SF1_LM1, 23, CANARY_FC, 'NNNN'],
      ['D', 'DPCT RGB0', scene_setup, OP_DPCT_SF1_LM1, 20, CANARY_RGBFIFO, '??NN'],
      ['D', 'DPCT RGB1', scene_setup, OP_DPCT_SF1_LM1, 21, CANARY_RGBFIFO, '??NN'],
      ['D', 'DPCT RGB2', scene_setup, OP_DPCT_SF1_LM1, 22, CANARY_RGBFIFO, 'NNNN'],
      ['D', 'DPCT IR0', scene_setup, OP_DPCT_SF1_LM1, 8, CANARY_IR0, 'NNNN'],
      ['C', 'DPCT RFC', scene_setup, OP_DPCT_SF1_LM1, 21, CANARY_FC, 'XXNN'],
      ['C', 'DPCT GFC', scene_setup, OP_DPCT_SF1_LM1, 22, CANARY_FC, 'XNNN'],
      ['C', 'DPCT BFC', scene_setup, OP_DPCT_SF1_LM1, 23, CANARY_FC, 'NNNN'],
      ['D', 'DCPL RGBC', scene_setup, OP_DCPL_SF1_LM1, 6, CANARY_RGBC, 'XXNN'],
      ['D', 'DCPL IR1', scene_setup, OP_DCPL_SF1_LM1, 9, CANARY_IR, 'OXNN'],
      ['D', 'DCPL IR2', scene_setup, OP_DCPL_SF1_LM1, 10, CANARY_IR, 'XNNN'],
      ['D', 'DCPL IR3', scene_setup, OP_DCPL_SF1_LM1, 11, CANARY_IR, 'NNNN'],
      ['D', 'DCPL IR0', scene_setup, OP_DCPL_SF1_LM1, 8, CANARY_IR0, 'NNNN'],
      ['C', 'DCPL RFC', scene_setup, OP_DCPL_SF1_LM1, 21, CANARY_FC, 'OONN'],
      ['C', 'DCPL GFC', scene_setup, OP_DCPL_SF1_LM1, 22, CANARY_FC, 'ONNN'],
      ['C', 'DCPL BFC', scene_setup, OP_DCPL_SF1_LM1, 23, CANARY_FC, 'NNNN'],
      ['D', 'INTPL IR1', scene_setup, OP_INTPL_SF1_LM1, 9, CANARY_IR, 'O?NN'],
      ['D', 'INTPL IR2', scene_setup, OP_INTPL_SF1_LM1, 10, CANARY_IR, 'XNNN'],
      ['D', 'INTPL IR3', scene_setup, OP_INTPL_SF1_LM1, 11, CANARY_IR, 'NNNN'],
      ['D', 'INTPL IR0', scene_setup, OP_INTPL_SF1_LM1, 8, CANARY_IR0, 'NNNN'],
      ['C', 'INTPL RFC', scene_setup, OP_INTPL_SF1_LM1, 21, CANARY_FC, 'O?NN'],
      ['C', 'INTPL GFC', scene_setup, OP_INTPL_SF1_LM1, 22, CANARY_FC, 'ONNN'],
      ['C', 'INTPL BFC', scene_setup, OP_INTPL_SF1_LM1, 23, CANARY_FC, 'NNNN'],
    ]);

  });

  describe('color (gwu-color.c, scenes of gte-latency-color.c)', () => {
    // CC and CDP read: LCM, BK, IR1/2/3, RGBC. CDP additionally reads FC, IR0.
    const scene_setup = () => {
      // LCM = identity diagonal
      gte.set(32 + 16, 0x00001000);
      gte.set(32 + 17, 0x00000000);
      gte.set(32 + 18, 0x00001000);
      gte.set(32 + 19, 0x00000000);
      gte.set(32 + 20, 0x1000);

      gte.set(32 + 13, 0);
      gte.set(32 + 14, 0);
      gte.set(32 + 15, 0); // BK
      gte.set(32 + 21, 0x1000);
      gte.set(32 + 22, 0x1000);
      gte.set(32 + 23, 0x1000); // FC

      gte.set(6, 0x00808080); // RGBC
      gte.set(8, 0x0800); // IR0
      gte.set(9, 0x0500); // IR1
      gte.set(10, 0x0600); // IR2
      gte.set(11, 0x0700); // IR3

      // FIFOs cleared.
      gte.set(12, 0);
      gte.set(13, 0);
      gte.set(14, 0);
      gte.set(16, 0);
      gte.set(17, 0);
      gte.set(18, 0);
      gte.set(19, 0);
      gte.set(20, 0);
      gte.set(21, 0);
      gte.set(22, 0);
      gte.set(24, 0);
      gte.set(25, 0);
      gte.set(26, 0);
      gte.set(27, 0);

      gte.set(32 + 31, 0);
    };

    const OP_CC_SF1_LM1 = COP2_CC(1, 1);
    const OP_CDP_SF1_LM1 = COP2_CDP(1, 1);

    const CANARY_RGBC = 0x00404040;
    const CANARY_IR0 = 0x0400;
    const CANARY_IR = 0x0123;
    const CANARY_LMAT = 0x07ff07ff;
    const CANARY_BK = 0x00010000;
    const CANARY_FC = 0x00010000;

    cells([
      ['D', 'CC RGBC', scene_setup, OP_CC_SF1_LM1, 6, CANARY_RGBC, 'NNNN'],
      ['D', 'CC IR1', scene_setup, OP_CC_SF1_LM1, 9, CANARY_IR, 'OONN'],
      ['D', 'CC IR2', scene_setup, OP_CC_SF1_LM1, 10, CANARY_IR, 'NNNN'],
      ['D', 'CC IR3', scene_setup, OP_CC_SF1_LM1, 11, CANARY_IR, 'NNNN'],
      ['C', 'CC LR1LR2', scene_setup, OP_CC_SF1_LM1, 16, CANARY_LMAT, 'OXNN'],
      ['C', 'CC LR3LG1', scene_setup, OP_CC_SF1_LM1, 17, CANARY_LMAT, 'XNNN'],
      ['C', 'CC LG2LG3', scene_setup, OP_CC_SF1_LM1, 18, CANARY_LMAT, 'NNNN'],
      ['C', 'CC LB1LB2', scene_setup, OP_CC_SF1_LM1, 19, CANARY_LMAT, 'NNNN'],
      ['C', 'CC LB3', scene_setup, OP_CC_SF1_LM1, 20, CANARY_LMAT, 'NNNN'],
      ['C', 'CC RBK', scene_setup, OP_CC_SF1_LM1, 13, CANARY_BK, 'OONN'],
      ['C', 'CC GBK', scene_setup, OP_CC_SF1_LM1, 14, CANARY_BK, 'ONNN'],
      ['C', 'CC BBK', scene_setup, OP_CC_SF1_LM1, 15, CANARY_BK, 'NNNN'],
      ['D', 'CDP RGBC', scene_setup, OP_CDP_SF1_LM1, 6, CANARY_RGBC, 'NNNN'],
      ['D', 'CDP IR0', scene_setup, OP_CDP_SF1_LM1, 8, CANARY_IR0, 'NNNN'],
      ['D', 'CDP IR1', scene_setup, OP_CDP_SF1_LM1, 9, CANARY_IR, 'OONN'],
      ['D', 'CDP IR2', scene_setup, OP_CDP_SF1_LM1, 10, CANARY_IR, 'NNNN'],
      ['D', 'CDP IR3', scene_setup, OP_CDP_SF1_LM1, 11, CANARY_IR, 'NNNN'],
      ['C', 'CDP LR1LR2', scene_setup, OP_CDP_SF1_LM1, 16, CANARY_LMAT, 'OXNN'],
      ['C', 'CDP LR3LG1', scene_setup, OP_CDP_SF1_LM1, 17, CANARY_LMAT, 'XNNN'],
      ['C', 'CDP LG2LG3', scene_setup, OP_CDP_SF1_LM1, 18, CANARY_LMAT, 'NNNN'],
      ['C', 'CDP LB1LB2', scene_setup, OP_CDP_SF1_LM1, 19, CANARY_LMAT, 'NNNN'],
      ['C', 'CDP LB3', scene_setup, OP_CDP_SF1_LM1, 20, CANARY_LMAT, 'NNNN'],
      ['C', 'CDP RBK', scene_setup, OP_CDP_SF1_LM1, 13, CANARY_BK, 'OONN'],
      ['C', 'CDP GBK', scene_setup, OP_CDP_SF1_LM1, 14, CANARY_BK, 'ONNN'],
      ['C', 'CDP BBK', scene_setup, OP_CDP_SF1_LM1, 15, CANARY_BK, 'NNNN'],
      ['C', 'CDP RFC', scene_setup, OP_CDP_SF1_LM1, 21, CANARY_FC, 'NNNN'],
      ['C', 'CDP GFC', scene_setup, OP_CDP_SF1_LM1, 22, CANARY_FC, 'NNNN'],
      ['C', 'CDP BFC', scene_setup, OP_CDP_SF1_LM1, 23, CANARY_FC, 'NNNN'],
    ]);

  });

  describe('mvmva (gwu-mvmva.c, scenes of gte-latency-mvmva.c)', () => {
    // Common scene: all matrices identity-diagonal, all CVs non-zero, V0 and
    // IR populated with non-axis-aligned values so every matrix entry counts.
    const scene_setup = () => {
      // Rotation matrix R = identity diagonal
      gte.set(32 + 0, 0x00001000);
      gte.set(32 + 1, 0x00000000);
      gte.set(32 + 2, 0x00001000);
      gte.set(32 + 3, 0x00000000);
      gte.set(32 + 4, 0x1000);

      // Translation
      gte.set(32 + 5, 100);
      gte.set(32 + 6, 200);
      gte.set(32 + 7, 0x4000);

      // Light matrix LL = identity diagonal
      gte.set(32 + 8, 0x00001000);
      gte.set(32 + 9, 0x00000000);
      gte.set(32 + 10, 0x00001000);
      gte.set(32 + 11, 0x00000000);
      gte.set(32 + 12, 0x1000);

      // BK
      gte.set(32 + 13, 0x800);
      gte.set(32 + 14, 0x800);
      gte.set(32 + 15, 0x800);

      // Color matrix LC = identity diagonal
      gte.set(32 + 16, 0x00001000);
      gte.set(32 + 17, 0x00000000);
      gte.set(32 + 18, 0x00001000);
      gte.set(32 + 19, 0x00000000);
      gte.set(32 + 20, 0x1000);

      // FC
      gte.set(32 + 21, 0x1000);
      gte.set(32 + 22, 0x1000);
      gte.set(32 + 23, 0x1000);

      // V0 (used by RT and LL variants)
      gte.set(0, (0x0800 << 16) | 0x0600);
      gte.set(1, 0x00000A00);

      // IR (used by LC variant)
      gte.set(8, 0x0800); // IR0
      gte.set(9, 0x0500);
      gte.set(10, 0x0600);
      gte.set(11, 0x0700);

      // Other state cleared.
      gte.set(2, 0);
      gte.set(3, 0);
      gte.set(4, 0);
      gte.set(5, 0);
      gte.set(6, 0x00808080);
      gte.set(12, 0);
      gte.set(13, 0);
      gte.set(14, 0);
      gte.set(16, 0);
      gte.set(17, 0);
      gte.set(18, 0);
      gte.set(19, 0);
      gte.set(20, 0);
      gte.set(21, 0);
      gte.set(22, 0);
      gte.set(24, 0);
      gte.set(25, 0);
      gte.set(26, 0);
      gte.set(27, 0);

      gte.set(32 + 31, 0);
    };

    const OP_MVMVA_RT_V0_TR = COP2_MVMVA(1, COP2_MX_RT, COP2_V_V0, COP2_CV_TR, 1);
    const OP_MVMVA_LL_V0_BK = COP2_MVMVA(1, COP2_MX_LL, COP2_V_V0, COP2_CV_BK, 1);
    const OP_MVMVA_LC_IR_BK = COP2_MVMVA(1, COP2_MX_LC, COP2_V_IR, COP2_CV_BK, 1);

    const CANARY_VXY = 0x05000400;
    const CANARY_VZ = 0x00000400;
    const CANARY_IR = 0x0123;
    const CANARY_MAT = 0x07ff07ff;
    const CANARY_TR = 0x00007fff;
    const CANARY_BK = 0x00010000;

    const OP_MVMVA_RT_V0_NONE = COP2_MVMVA(1, COP2_MX_RT, COP2_V_V0, COP2_CV_NONE, 0);

    cells([
      ['D', 'MVMVA(RT,V0,TR) VXY0', scene_setup, OP_MVMVA_RT_V0_TR, 0, CANARY_VXY, 'XXNN'],
      ['D', 'MVMVA(RT,V0,TR) VZ0', scene_setup, OP_MVMVA_RT_V0_TR, 1, CANARY_VZ, 'NNNN'],
      ['C', 'MVMVA(RT,V0,TR) R11R12', scene_setup, OP_MVMVA_RT_V0_TR, 0, CANARY_MAT, 'OXNN'],
      ['C', 'MVMVA(RT,V0,TR) R13R21', scene_setup, OP_MVMVA_RT_V0_TR, 1, CANARY_MAT, 'XNNN'],
      ['C', 'MVMVA(RT,V0,TR) R22R23', scene_setup, OP_MVMVA_RT_V0_TR, 2, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(RT,V0,TR) R31R32', scene_setup, OP_MVMVA_RT_V0_TR, 3, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(RT,V0,TR) R33', scene_setup, OP_MVMVA_RT_V0_TR, 4, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(RT,V0,TR) TRX', scene_setup, OP_MVMVA_RT_V0_TR, 5, CANARY_TR, 'OONN'],
      ['C', 'MVMVA(RT,V0,TR) TRY', scene_setup, OP_MVMVA_RT_V0_TR, 6, CANARY_TR, 'ONNN'],
      ['C', 'MVMVA(RT,V0,TR) TRZ', scene_setup, OP_MVMVA_RT_V0_TR, 7, CANARY_TR, 'NNNN'],
      ['D', 'MVMVA(LL,V0,BK) VXY0', scene_setup, OP_MVMVA_LL_V0_BK, 0, CANARY_VXY, 'XXNN'],
      ['D', 'MVMVA(LL,V0,BK) VZ0', scene_setup, OP_MVMVA_LL_V0_BK, 1, CANARY_VZ, 'NNNN'],
      ['C', 'MVMVA(LL,V0,BK) L11L12', scene_setup, OP_MVMVA_LL_V0_BK, 8, CANARY_MAT, 'OXNN'],
      ['C', 'MVMVA(LL,V0,BK) L13L21', scene_setup, OP_MVMVA_LL_V0_BK, 9, CANARY_MAT, 'XNNN'],
      ['C', 'MVMVA(LL,V0,BK) L22L23', scene_setup, OP_MVMVA_LL_V0_BK, 10, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(LL,V0,BK) L31L32', scene_setup, OP_MVMVA_LL_V0_BK, 11, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(LL,V0,BK) L33', scene_setup, OP_MVMVA_LL_V0_BK, 12, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(LL,V0,BK) RBK', scene_setup, OP_MVMVA_LL_V0_BK, 13, CANARY_BK, 'OONN'],
      ['C', 'MVMVA(LL,V0,BK) GBK', scene_setup, OP_MVMVA_LL_V0_BK, 14, CANARY_BK, 'ONNN'],
      ['C', 'MVMVA(LL,V0,BK) BBK', scene_setup, OP_MVMVA_LL_V0_BK, 15, CANARY_BK, 'NNNN'],
      ['D', 'MVMVA(LC,IR,BK) IR1', scene_setup, OP_MVMVA_LC_IR_BK, 9, CANARY_IR, 'O?NN'],
      ['D', 'MVMVA(LC,IR,BK) IR2', scene_setup, OP_MVMVA_LC_IR_BK, 10, CANARY_IR, 'NNNN'],
      ['D', 'MVMVA(LC,IR,BK) IR3', scene_setup, OP_MVMVA_LC_IR_BK, 11, CANARY_IR, 'NNNN'],
      ['C', 'MVMVA(LC,IR,BK) LR1LR2', scene_setup, OP_MVMVA_LC_IR_BK, 16, CANARY_MAT, 'OXNN'],
      ['C', 'MVMVA(LC,IR,BK) LR3LG1', scene_setup, OP_MVMVA_LC_IR_BK, 17, CANARY_MAT, 'XNNN'],
      ['C', 'MVMVA(LC,IR,BK) LG2LG3', scene_setup, OP_MVMVA_LC_IR_BK, 18, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(LC,IR,BK) LB1LB2', scene_setup, OP_MVMVA_LC_IR_BK, 19, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(LC,IR,BK) LB3', scene_setup, OP_MVMVA_LC_IR_BK, 20, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(LC,IR,BK) RBK', scene_setup, OP_MVMVA_LC_IR_BK, 13, CANARY_BK, 'O?NN'],
      ['C', 'MVMVA(LC,IR,BK) GBK', scene_setup, OP_MVMVA_LC_IR_BK, 14, CANARY_BK, 'ONNN'],
      ['C', 'MVMVA(LC,IR,BK) BBK', scene_setup, OP_MVMVA_LC_IR_BK, 15, CANARY_BK, 'NNNN'],
      ['D', 'MVMVA(RT,V0,NONE,lm0) VXY0', scene_setup, OP_MVMVA_RT_V0_NONE, 0, CANARY_VXY, 'XXNN'],
      ['D', 'MVMVA(RT,V0,NONE,lm0) VZ0', scene_setup, OP_MVMVA_RT_V0_NONE, 1, CANARY_VZ, 'NNNN'],
      ['C', 'MVMVA(RT,V0,NONE,lm0) R11R12', scene_setup, OP_MVMVA_RT_V0_NONE, 0, CANARY_MAT, 'OXNN'],
      ['C', 'MVMVA(RT,V0,NONE,lm0) R13R21', scene_setup, OP_MVMVA_RT_V0_NONE, 1, CANARY_MAT, 'XNNN'],
      ['C', 'MVMVA(RT,V0,NONE,lm0) R22R23', scene_setup, OP_MVMVA_RT_V0_NONE, 2, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(RT,V0,NONE,lm0) R31R32', scene_setup, OP_MVMVA_RT_V0_NONE, 3, CANARY_MAT, 'NNNN'],
      ['C', 'MVMVA(RT,V0,NONE,lm0) R33', scene_setup, OP_MVMVA_RT_V0_NONE, 4, CANARY_MAT, 'NNNN'],
    ]);

  });

  describe('misc (gwu-misc.c, scenes of gte-latency-misc.c)', () => {
    // AVSZ3/AVSZ4: average of SZ FIFO entries weighted by ZSF3/ZSF4.
    // GPF/GPL: blend MAC1/2/3 (or zero) with IR1/2/3 weighted by IR0.
    const scene_setup = () => {
      gte.set(32 + 29, 0x0400); // ZSF3 = 0x400 (1/4 in 1.12)
      gte.set(32 + 30, 0x0400); // ZSF4

      // SZ FIFO (4-deep). AVSZ3 sums SZ1+SZ2+SZ3, AVSZ4 sums SZ0+SZ1+SZ2+SZ3.
      gte.set(16, 100); // SZ0
      gte.set(17, 200); // SZ1
      gte.set(18, 300); // SZ2
      gte.set(19, 400); // SZ3

      // For GPF/GPL: IR0 + IR1/2/3, MAC1/2/3 (read by GPL).
      gte.set(8, 0x0800); // IR0 = 0.5
      gte.set(9, 0x0500); // IR1
      gte.set(10, 0x0600); // IR2
      gte.set(11, 0x0700); // IR3
      gte.set(25, 0x4000); // MAC1
      gte.set(26, 0x5000); // MAC2
      gte.set(27, 0x6000); // MAC3
      gte.set(24, 0); // MAC0

      // FIFOs cleared (RGB unused, SXY unused).
      gte.set(20, 0);
      gte.set(21, 0);
      gte.set(22, 0);
      gte.set(12, 0);
      gte.set(13, 0);
      gte.set(14, 0);
      gte.set(6, 0x00808080); // RGBC

      gte.set(32 + 31, 0);
    };

    const OP_AVSZ3 = COP2_AVSZ3;
    const OP_AVSZ4 = COP2_AVSZ4;
    const OP_GPF_SF1_LM1 = COP2_GPF(1, 1);
    const OP_GPL_SF1_LM1 = COP2_GPL(1, 1);

    const CANARY_SZ = 0x0fff;
    const CANARY_ZSF = 0x0123;
    const CANARY_IR0 = 0x0400;
    const CANARY_IR = 0x0123;
    const CANARY_MAC = 0x12345678;

    cells([
      ['D', 'AVSZ3 SZ1', scene_setup, OP_AVSZ3, 17, CANARY_SZ, 'OONN'],
      ['D', 'AVSZ3 SZ2', scene_setup, OP_AVSZ3, 18, CANARY_SZ, 'ONNN'],
      ['D', 'AVSZ3 SZ3', scene_setup, OP_AVSZ3, 19, CANARY_SZ, 'NNNN'],
      ['C', 'AVSZ3 ZSF3', scene_setup, OP_AVSZ3, 29, CANARY_ZSF, 'XXNN'],
      ['D', 'AVSZ4 SZ0', scene_setup, OP_AVSZ4, 16, CANARY_SZ, 'NNNN'],
      ['D', 'AVSZ4 SZ1', scene_setup, OP_AVSZ4, 17, CANARY_SZ, 'OONN'],
      ['D', 'AVSZ4 SZ2', scene_setup, OP_AVSZ4, 18, CANARY_SZ, 'ONNN'],
      ['D', 'AVSZ4 SZ3', scene_setup, OP_AVSZ4, 19, CANARY_SZ, 'NNNN'],
      ['C', 'AVSZ4 ZSF4', scene_setup, OP_AVSZ4, 30, CANARY_ZSF, 'XXNN'],
      ['D', 'GPF IR0', scene_setup, OP_GPF_SF1_LM1, 8, CANARY_IR0, 'XXNN'],
      ['D', 'GPF IR1', scene_setup, OP_GPF_SF1_LM1, 9, CANARY_IR, 'OONN'],
      ['D', 'GPF IR2', scene_setup, OP_GPF_SF1_LM1, 10, CANARY_IR, 'ONNN'],
      ['D', 'GPF IR3', scene_setup, OP_GPF_SF1_LM1, 11, CANARY_IR, 'NNNN'],
      ['D', 'GPL IR0', scene_setup, OP_GPL_SF1_LM1, 8, CANARY_IR0, 'XXNN'],
      ['D', 'GPL IR1', scene_setup, OP_GPL_SF1_LM1, 9, CANARY_IR, 'O?NN'],
      ['D', 'GPL IR2', scene_setup, OP_GPL_SF1_LM1, 10, CANARY_IR, 'ONNN'],
      ['D', 'GPL IR3', scene_setup, OP_GPL_SF1_LM1, 11, CANARY_IR, 'NNNN'],
      ['D', 'GPL MAC1', scene_setup, OP_GPL_SF1_LM1, 25, CANARY_MAC, 'OONN'],
      ['D', 'GPL MAC2', scene_setup, OP_GPL_SF1_LM1, 26, CANARY_MAC, 'ONNN'],
      ['D', 'GPL MAC3', scene_setup, OP_GPL_SF1_LM1, 27, CANARY_MAC, 'NNNN'],
    ]);

  });

})
