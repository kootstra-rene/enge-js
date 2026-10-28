mdlr('[test]enge:psx:gte-latency', ({ include, test }) => {

  const { describe, it, expect, before } = test;

  // Ported from the nugget GTE input-register latency tests
  // (https://github.com/pcsx-redux/nugget, tests/gte-latency*, MIT). On the
  // console each probe sweeps the number of instructions between a GTE
  // command and a write to one of its inputs, and prints where the write
  // stops affecting the result; what the tests assert, and what is ported
  // here, is the sanity check of every probe: the canary value written
  // before the command changes the result, compared with the same canary
  // written after the command has finished. Each source file is its own
  // ps-exe there, so each describe gets a fresh GTE.

  let gte;

  const u32 = v => v >>> 0;
  const s32 = v => v | 0;

  // common/hardware/cop2.h: command encoding
  const COP2_OP = (fake, sf, mx, v, cv, lm, fn) =>
    ((fake << 20) | (sf << 19) | (mx << 17) | (v << 15) | (cv << 13) | (lm << 10) | fn) >>> 0;
  const COP2_MX_RT = 0, COP2_MX_LL = 1, COP2_MX_LC = 2;
  const COP2_V_V0 = 0, COP2_V_IR = 3;
  const COP2_CV_TR = 0, COP2_CV_BK = 1;
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

  // gte-latency-common.h: the full output state of a probe
  const read_full_state = () => ({
    rgb0: u32(gte.get(20)), rgb1: u32(gte.get(21)), rgb2: u32(gte.get(22)),
    mac0: s32(gte.get(24)), mac1: s32(gte.get(25)), mac2: s32(gte.get(26)), mac3: s32(gte.get(27)),
    ir0: s32(gte.get(8)), ir1: s32(gte.get(9)), ir2: s32(gte.get(10)), ir3: s32(gte.get(11)),
    sxy0: u32(gte.get(12)), sxy1: u32(gte.get(13)), sxy2: u32(gte.get(14)),
    sz0: u32(gte.get(16)), sz1: u32(gte.get(17)), sz2: u32(gte.get(18)), sz3: u32(gte.get(19)),
    flag: u32(gte.get(32 + 31)),
  });

  // MAKE_DATA_TEST / MAKE_CTRL_TEST: the canary written after the command
  // (baseline) and before it (sanity_pre) must give different results.
  const DATA = 0, CTRL = 32;
  const probe = (name, setup, op, kind, reg, canary, label) => {
    it(`${name}: a ${label} write before the command changes the result`, async () => {
      setup();
      gte.command(op);
      gte.set(kind + reg, canary);
      const baseline = read_full_state();
      setup();
      gte.set(kind + reg, canary);
      gte.command(op);
      const sanity_pre = read_full_state();
      expect(JSON.stringify(baseline) !== JSON.stringify(sanity_pre)).to.be.true;
    });
  };

  describe('lighting, triple and single (NCCT, NCCS, NCDT, NCDS, NCT, NCS) (gte-latency.c)', () => {

    before(async () => { ({ gte } = include('enge:psx:gte')); });

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

    const scene_setup_ncdt = () => {
      scene_setup();
      gte.set(32 + 21, 0x1000); // RFC = 0x1000
      gte.set(32 + 22, 0x1000); // GFC
      gte.set(32 + 23, 0x1000); // BFC
      gte.set(8, 0x0800); // IR0 = 0.5 in 1.12
    };

    const OP_NCCT_SF1_LM1 = COP2_NCCT(1, 1);
    const OP_NCCS_SF1_LM1 = COP2_NCCS(1, 1);
    const OP_NCDT_SF1_LM1 = COP2_NCDT(1, 1);
    const OP_NCDS_SF1_LM1 = COP2_NCDS(1, 1);
    const OP_NCT_SF1_LM1 = COP2_NCT(1, 1);
    const OP_NCS_SF1_LM1 = COP2_NCS(1, 1);
    const CANARY_VXY = 0x40004000; // VX=0x4000, VY=0x4000
    const CANARY_VZ = 0x00000100;
    const CANARY_RGBC = 0x00404040; // R=G=B=0x40 (half intensity)
    const CANARY_LMAT = 0x00000800; // 0.5 in matrix entry (vs identity 1.0=0x1000)
    const CANARY_BK = 0x00010000; // BK = 65536 (16.0)
    const CANARY_FC = 0x00010000; // FC = 65536

    // Smoke test: verify the test scene gives the math we expect.

    it('ncct_scene_smoke', async () => {
      scene_setup();
      gte.command(COP2_NCCT(1, 1));
      const r = read_full_state();
      expect(u32(r.rgb0)).to.eql(0x00800000);
      expect(u32(r.rgb1)).to.eql(0x00000080);
      expect(u32(r.rgb2)).to.eql(0x00008000);
      expect(s32(r.mac1)).to.eql(0);
      expect(s32(r.mac2)).to.eql(0x800);
      expect(s32(r.mac3)).to.eql(0);
    });

    // NCCT: vertex registers (data 0..5)
    probe('ncct_vxy0', scene_setup, OP_NCCT_SF1_LM1, DATA, 0, CANARY_VXY, 'NCCT VXY0');
    probe('ncct_vz0', scene_setup, OP_NCCT_SF1_LM1, DATA, 1, CANARY_VZ, 'NCCT VZ0');
    probe('ncct_vxy1', scene_setup, OP_NCCT_SF1_LM1, DATA, 2, CANARY_VXY, 'NCCT VXY1');
    probe('ncct_vz1', scene_setup, OP_NCCT_SF1_LM1, DATA, 3, CANARY_VZ, 'NCCT VZ1');
    probe('ncct_vxy2', scene_setup, OP_NCCT_SF1_LM1, DATA, 4, CANARY_VXY, 'NCCT VXY2');
    probe('ncct_vz2', scene_setup, OP_NCCT_SF1_LM1, DATA, 5, CANARY_VZ, 'NCCT VZ2');
    probe('ncct_rgbc', scene_setup, OP_NCCT_SF1_LM1, DATA, 6, CANARY_RGBC, 'NCCT RGBC');

    // NCCT: light matrix (control 8..12) - the "input" rows that NCCT reads
    probe('ncct_l11l12', scene_setup, OP_NCCT_SF1_LM1, CTRL, 8, CANARY_LMAT, 'NCCT L11L12');
    probe('ncct_l13l21', scene_setup, OP_NCCT_SF1_LM1, CTRL, 9, CANARY_LMAT, 'NCCT L13L21');
    probe('ncct_l22l23', scene_setup, OP_NCCT_SF1_LM1, CTRL, 10, CANARY_LMAT, 'NCCT L22L23');
    probe('ncct_l31l32', scene_setup, OP_NCCT_SF1_LM1, CTRL, 11, CANARY_LMAT, 'NCCT L31L32');
    probe('ncct_l33', scene_setup, OP_NCCT_SF1_LM1, CTRL, 12, CANARY_LMAT, 'NCCT L33');

    // NCCT: light color matrix (control 16..20)
    probe('ncct_lr1lr2', scene_setup, OP_NCCT_SF1_LM1, CTRL, 16, CANARY_LMAT, 'NCCT LR1LR2');
    probe('ncct_lr3lg1', scene_setup, OP_NCCT_SF1_LM1, CTRL, 17, CANARY_LMAT, 'NCCT LR3LG1');
    probe('ncct_lg2lg3', scene_setup, OP_NCCT_SF1_LM1, CTRL, 18, CANARY_LMAT, 'NCCT LG2LG3');
    probe('ncct_lb1lb2', scene_setup, OP_NCCT_SF1_LM1, CTRL, 19, CANARY_LMAT, 'NCCT LB1LB2');
    probe('ncct_lb3', scene_setup, OP_NCCT_SF1_LM1, CTRL, 20, CANARY_LMAT, 'NCCT LB3');

    // NCCT: background color (control 13..15)
    probe('ncct_rbk', scene_setup, OP_NCCT_SF1_LM1, CTRL, 13, CANARY_BK, 'NCCT RBK');
    probe('ncct_gbk', scene_setup, OP_NCCT_SF1_LM1, CTRL, 14, CANARY_BK, 'NCCT GBK');
    probe('ncct_bbk', scene_setup, OP_NCCT_SF1_LM1, CTRL, 15, CANARY_BK, 'NCCT BBK');

    // NCT (Normal Color Triple): same vertex/matrix inputs as NCCT but no
    // per-vertex color tint (no RGBC stage). 30 cycles, 3 sub-passes.
    probe('nct_vxy0', scene_setup, OP_NCT_SF1_LM1, DATA, 0, CANARY_VXY, 'NCT VXY0');
    probe('nct_vz0', scene_setup, OP_NCT_SF1_LM1, DATA, 1, CANARY_VZ, 'NCT VZ0');
    probe('nct_vxy1', scene_setup, OP_NCT_SF1_LM1, DATA, 2, CANARY_VXY, 'NCT VXY1');
    probe('nct_vz1', scene_setup, OP_NCT_SF1_LM1, DATA, 3, CANARY_VZ, 'NCT VZ1');
    probe('nct_vxy2', scene_setup, OP_NCT_SF1_LM1, DATA, 4, CANARY_VXY, 'NCT VXY2');
    probe('nct_vz2', scene_setup, OP_NCT_SF1_LM1, DATA, 5, CANARY_VZ, 'NCT VZ2');
    probe('nct_l11l12', scene_setup, OP_NCT_SF1_LM1, CTRL, 8, CANARY_LMAT, 'NCT L11L12');
    probe('nct_l13l21', scene_setup, OP_NCT_SF1_LM1, CTRL, 9, CANARY_LMAT, 'NCT L13L21');
    probe('nct_l22l23', scene_setup, OP_NCT_SF1_LM1, CTRL, 10, CANARY_LMAT, 'NCT L22L23');
    probe('nct_l31l32', scene_setup, OP_NCT_SF1_LM1, CTRL, 11, CANARY_LMAT, 'NCT L31L32');
    probe('nct_l33', scene_setup, OP_NCT_SF1_LM1, CTRL, 12, CANARY_LMAT, 'NCT L33');
    probe('nct_lr1lr2', scene_setup, OP_NCT_SF1_LM1, CTRL, 16, CANARY_LMAT, 'NCT LR1LR2');
    probe('nct_lr3lg1', scene_setup, OP_NCT_SF1_LM1, CTRL, 17, CANARY_LMAT, 'NCT LR3LG1');
    probe('nct_lg2lg3', scene_setup, OP_NCT_SF1_LM1, CTRL, 18, CANARY_LMAT, 'NCT LG2LG3');
    probe('nct_lb1lb2', scene_setup, OP_NCT_SF1_LM1, CTRL, 19, CANARY_LMAT, 'NCT LB1LB2');
    probe('nct_lb3', scene_setup, OP_NCT_SF1_LM1, CTRL, 20, CANARY_LMAT, 'NCT LB3');
    probe('nct_rbk', scene_setup, OP_NCT_SF1_LM1, CTRL, 13, CANARY_BK, 'NCT RBK');
    probe('nct_gbk', scene_setup, OP_NCT_SF1_LM1, CTRL, 14, CANARY_BK, 'NCT GBK');
    probe('nct_bbk', scene_setup, OP_NCT_SF1_LM1, CTRL, 15, CANARY_BK, 'NCT BBK');

    // NCDT (Normal Color Depth-cue Triple): adds a depth-cue stage on top of
    // the NCC pipeline, blending the lit color toward FC by IR0. 44 cycles.
    //
    // Scene tweaks via scene_setup_ncdt(): set IR0 to 0x800 (mid blend, 0.5
    // in 1.12), set FC to a non-zero value so depth-cue output differs from
    // the lit color path. RGBC stays the same.

    probe('ncdt_vxy0', scene_setup_ncdt, OP_NCDT_SF1_LM1, DATA, 0, CANARY_VXY, 'NCDT VXY0');
    probe('ncdt_vz0', scene_setup_ncdt, OP_NCDT_SF1_LM1, DATA, 1, CANARY_VZ, 'NCDT VZ0');
    probe('ncdt_vxy1', scene_setup_ncdt, OP_NCDT_SF1_LM1, DATA, 2, CANARY_VXY, 'NCDT VXY1');
    probe('ncdt_vz1', scene_setup_ncdt, OP_NCDT_SF1_LM1, DATA, 3, CANARY_VZ, 'NCDT VZ1');
    probe('ncdt_vxy2', scene_setup_ncdt, OP_NCDT_SF1_LM1, DATA, 4, CANARY_VXY, 'NCDT VXY2');
    probe('ncdt_vz2', scene_setup_ncdt, OP_NCDT_SF1_LM1, DATA, 5, CANARY_VZ, 'NCDT VZ2');
    probe('ncdt_rgbc', scene_setup_ncdt, OP_NCDT_SF1_LM1, DATA, 6, CANARY_RGBC, 'NCDT RGBC');
    probe('ncdt_l11l12', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 8, CANARY_LMAT, 'NCDT L11L12');
    probe('ncdt_l13l21', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 9, CANARY_LMAT, 'NCDT L13L21');
    probe('ncdt_l22l23', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 10, CANARY_LMAT, 'NCDT L22L23');
    probe('ncdt_l31l32', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 11, CANARY_LMAT, 'NCDT L31L32');
    probe('ncdt_l33', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 12, CANARY_LMAT, 'NCDT L33');
    probe('ncdt_lr1lr2', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 16, CANARY_LMAT, 'NCDT LR1LR2');
    probe('ncdt_lr3lg1', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 17, CANARY_LMAT, 'NCDT LR3LG1');
    probe('ncdt_lg2lg3', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 18, CANARY_LMAT, 'NCDT LG2LG3');
    probe('ncdt_lb1lb2', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 19, CANARY_LMAT, 'NCDT LB1LB2');
    probe('ncdt_lb3', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 20, CANARY_LMAT, 'NCDT LB3');
    probe('ncdt_rbk', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 13, CANARY_BK, 'NCDT RBK');
    probe('ncdt_gbk', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 14, CANARY_BK, 'NCDT GBK');
    probe('ncdt_bbk', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 15, CANARY_BK, 'NCDT BBK');
    probe('ncdt_rfc', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 21, CANARY_FC, 'NCDT RFC');
    probe('ncdt_gfc', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 22, CANARY_FC, 'NCDT GFC');
    probe('ncdt_bfc', scene_setup_ncdt, OP_NCDT_SF1_LM1, CTRL, 23, CANARY_FC, 'NCDT BFC');

  });

  describe('single-vertex lighting (NCS, NCCS, NCDS) (gte-latency-singles.c)', () => {

    before(async () => { ({ gte } = include('enge:psx:gte')); });

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
    const CANARY_VXY = 0x05000400; // VX=0x400, VY=0x500 (vs 0x600/0x800)
    const CANARY_VZ = 0x00000400; // VZ=0x400 (vs 0xA00)
    const CANARY_RGBC = 0x00404040;
    const CANARY_LMAT = 0x07ff07ff; // both halves 0x7ff (off-diagonal 0 -> 0x7ff,
    const CANARY_BK = 0x00010000;
    const CANARY_FC = 0x00010000;

    // NCS (Normal Color Single): lighting only, no per-vertex color tint.
    // 14 cycles. Reads V0, LLM, LCM, BK.
    probe('ncs_vxy0', scene_setup, OP_NCS_SF1_LM1, DATA, 0, CANARY_VXY, 'NCS VXY0');
    probe('ncs_vz0', scene_setup, OP_NCS_SF1_LM1, DATA, 1, CANARY_VZ, 'NCS VZ0');
    probe('ncs_l11l12', scene_setup, OP_NCS_SF1_LM1, CTRL, 8, CANARY_LMAT, 'NCS L11L12');
    probe('ncs_l13l21', scene_setup, OP_NCS_SF1_LM1, CTRL, 9, CANARY_LMAT, 'NCS L13L21');
    probe('ncs_l22l23', scene_setup, OP_NCS_SF1_LM1, CTRL, 10, CANARY_LMAT, 'NCS L22L23');
    probe('ncs_l31l32', scene_setup, OP_NCS_SF1_LM1, CTRL, 11, CANARY_LMAT, 'NCS L31L32');
    probe('ncs_l33', scene_setup, OP_NCS_SF1_LM1, CTRL, 12, CANARY_LMAT, 'NCS L33');
    probe('ncs_lr1lr2', scene_setup, OP_NCS_SF1_LM1, CTRL, 16, CANARY_LMAT, 'NCS LR1LR2');
    probe('ncs_lr3lg1', scene_setup, OP_NCS_SF1_LM1, CTRL, 17, CANARY_LMAT, 'NCS LR3LG1');
    probe('ncs_lg2lg3', scene_setup, OP_NCS_SF1_LM1, CTRL, 18, CANARY_LMAT, 'NCS LG2LG3');
    probe('ncs_lb1lb2', scene_setup, OP_NCS_SF1_LM1, CTRL, 19, CANARY_LMAT, 'NCS LB1LB2');
    probe('ncs_lb3', scene_setup, OP_NCS_SF1_LM1, CTRL, 20, CANARY_LMAT, 'NCS LB3');
    probe('ncs_rbk', scene_setup, OP_NCS_SF1_LM1, CTRL, 13, CANARY_BK, 'NCS RBK');
    probe('ncs_gbk', scene_setup, OP_NCS_SF1_LM1, CTRL, 14, CANARY_BK, 'NCS GBK');
    probe('ncs_bbk', scene_setup, OP_NCS_SF1_LM1, CTRL, 15, CANARY_BK, 'NCS BBK');

    // NCCS (Normal Color Color Single): lighting + per-vertex RGBC tint.
    // 17 cycles. Adds RGBC to NCS's input set.
    probe('nccs_vxy0', scene_setup, OP_NCCS_SF1_LM1, DATA, 0, CANARY_VXY, 'NCCS VXY0');
    probe('nccs_vz0', scene_setup, OP_NCCS_SF1_LM1, DATA, 1, CANARY_VZ, 'NCCS VZ0');
    probe('nccs_rgbc', scene_setup, OP_NCCS_SF1_LM1, DATA, 6, CANARY_RGBC, 'NCCS RGBC');
    probe('nccs_l11l12', scene_setup, OP_NCCS_SF1_LM1, CTRL, 8, CANARY_LMAT, 'NCCS L11L12');
    probe('nccs_l13l21', scene_setup, OP_NCCS_SF1_LM1, CTRL, 9, CANARY_LMAT, 'NCCS L13L21');
    probe('nccs_l22l23', scene_setup, OP_NCCS_SF1_LM1, CTRL, 10, CANARY_LMAT, 'NCCS L22L23');
    probe('nccs_l31l32', scene_setup, OP_NCCS_SF1_LM1, CTRL, 11, CANARY_LMAT, 'NCCS L31L32');
    probe('nccs_l33', scene_setup, OP_NCCS_SF1_LM1, CTRL, 12, CANARY_LMAT, 'NCCS L33');
    probe('nccs_lr1lr2', scene_setup, OP_NCCS_SF1_LM1, CTRL, 16, CANARY_LMAT, 'NCCS LR1LR2');
    probe('nccs_lr3lg1', scene_setup, OP_NCCS_SF1_LM1, CTRL, 17, CANARY_LMAT, 'NCCS LR3LG1');
    probe('nccs_lg2lg3', scene_setup, OP_NCCS_SF1_LM1, CTRL, 18, CANARY_LMAT, 'NCCS LG2LG3');
    probe('nccs_lb1lb2', scene_setup, OP_NCCS_SF1_LM1, CTRL, 19, CANARY_LMAT, 'NCCS LB1LB2');
    probe('nccs_lb3', scene_setup, OP_NCCS_SF1_LM1, CTRL, 20, CANARY_LMAT, 'NCCS LB3');
    probe('nccs_rbk', scene_setup, OP_NCCS_SF1_LM1, CTRL, 13, CANARY_BK, 'NCCS RBK');
    probe('nccs_gbk', scene_setup, OP_NCCS_SF1_LM1, CTRL, 14, CANARY_BK, 'NCCS GBK');
    probe('nccs_bbk', scene_setup, OP_NCCS_SF1_LM1, CTRL, 15, CANARY_BK, 'NCCS BBK');

    // NCDS (Normal Color Depth-cue Single): lighting + RGBC + depth cue.
    // 19 cycles. Adds FC to NCCS's input set.
    probe('ncds_vxy0', scene_setup, OP_NCDS_SF1_LM1, DATA, 0, CANARY_VXY, 'NCDS VXY0');
    probe('ncds_vz0', scene_setup, OP_NCDS_SF1_LM1, DATA, 1, CANARY_VZ, 'NCDS VZ0');
    probe('ncds_rgbc', scene_setup, OP_NCDS_SF1_LM1, DATA, 6, CANARY_RGBC, 'NCDS RGBC');
    probe('ncds_l11l12', scene_setup, OP_NCDS_SF1_LM1, CTRL, 8, CANARY_LMAT, 'NCDS L11L12');
    probe('ncds_l13l21', scene_setup, OP_NCDS_SF1_LM1, CTRL, 9, CANARY_LMAT, 'NCDS L13L21');
    probe('ncds_l22l23', scene_setup, OP_NCDS_SF1_LM1, CTRL, 10, CANARY_LMAT, 'NCDS L22L23');
    probe('ncds_l31l32', scene_setup, OP_NCDS_SF1_LM1, CTRL, 11, CANARY_LMAT, 'NCDS L31L32');
    probe('ncds_l33', scene_setup, OP_NCDS_SF1_LM1, CTRL, 12, CANARY_LMAT, 'NCDS L33');
    probe('ncds_lr1lr2', scene_setup, OP_NCDS_SF1_LM1, CTRL, 16, CANARY_LMAT, 'NCDS LR1LR2');
    probe('ncds_lr3lg1', scene_setup, OP_NCDS_SF1_LM1, CTRL, 17, CANARY_LMAT, 'NCDS LR3LG1');
    probe('ncds_lg2lg3', scene_setup, OP_NCDS_SF1_LM1, CTRL, 18, CANARY_LMAT, 'NCDS LG2LG3');
    probe('ncds_lb1lb2', scene_setup, OP_NCDS_SF1_LM1, CTRL, 19, CANARY_LMAT, 'NCDS LB1LB2');
    probe('ncds_lb3', scene_setup, OP_NCDS_SF1_LM1, CTRL, 20, CANARY_LMAT, 'NCDS LB3');
    probe('ncds_rbk', scene_setup, OP_NCDS_SF1_LM1, CTRL, 13, CANARY_BK, 'NCDS RBK');
    probe('ncds_gbk', scene_setup, OP_NCDS_SF1_LM1, CTRL, 14, CANARY_BK, 'NCDS GBK');
    probe('ncds_bbk', scene_setup, OP_NCDS_SF1_LM1, CTRL, 15, CANARY_BK, 'NCDS BBK');
    probe('ncds_rfc', scene_setup, OP_NCDS_SF1_LM1, CTRL, 21, CANARY_FC, 'NCDS RFC');
    probe('ncds_gfc', scene_setup, OP_NCDS_SF1_LM1, CTRL, 22, CANARY_FC, 'NCDS GFC');
    probe('ncds_bfc', scene_setup, OP_NCDS_SF1_LM1, CTRL, 23, CANARY_FC, 'NCDS BFC');

  });

  describe('perspective (RTPS, RTPT) (gte-latency-perspective.c)', () => {

    before(async () => { ({ gte } = include('enge:psx:gte')); });

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

    // RTPS (single-vertex perspective transform): V0 only, 15 cycles.
    probe('rtps_vxy0', scene_setup, OP_RTPS_SF1_LM1, DATA, 0, CANARY_VXY, 'RTPS VXY0');
    probe('rtps_vz0', scene_setup, OP_RTPS_SF1_LM1, DATA, 1, CANARY_VZ, 'RTPS VZ0');
    probe('rtps_r11r12', scene_setup, OP_RTPS_SF1_LM1, CTRL, 0, CANARY_RMAT, 'RTPS R11R12');
    probe('rtps_r13r21', scene_setup, OP_RTPS_SF1_LM1, CTRL, 1, CANARY_RMAT, 'RTPS R13R21');
    probe('rtps_r22r23', scene_setup, OP_RTPS_SF1_LM1, CTRL, 2, CANARY_RMAT, 'RTPS R22R23');
    probe('rtps_r31r32', scene_setup, OP_RTPS_SF1_LM1, CTRL, 3, CANARY_RMAT, 'RTPS R31R32');
    probe('rtps_r33', scene_setup, OP_RTPS_SF1_LM1, CTRL, 4, CANARY_RMAT, 'RTPS R33');
    probe('rtps_trx', scene_setup, OP_RTPS_SF1_LM1, CTRL, 5, CANARY_TR, 'RTPS TRX');
    probe('rtps_try', scene_setup, OP_RTPS_SF1_LM1, CTRL, 6, CANARY_TR, 'RTPS TRY');
    probe('rtps_trz', scene_setup, OP_RTPS_SF1_LM1, CTRL, 7, CANARY_TR, 'RTPS TRZ');
    probe('rtps_ofx', scene_setup, OP_RTPS_SF1_LM1, CTRL, 24, CANARY_OF, 'RTPS OFX');
    probe('rtps_ofy', scene_setup, OP_RTPS_SF1_LM1, CTRL, 25, CANARY_OF, 'RTPS OFY');
    probe('rtps_h', scene_setup, OP_RTPS_SF1_LM1, CTRL, 26, CANARY_H, 'RTPS H');
    probe('rtps_dqa', scene_setup, OP_RTPS_SF1_LM1, CTRL, 27, CANARY_DQA, 'RTPS DQA');
    probe('rtps_dqb', scene_setup, OP_RTPS_SF1_LM1, CTRL, 28, CANARY_DQB, 'RTPS DQB');

    // RTPT (triple-vertex perspective transform): V0, V1, V2; 23 cycles.
    // Inputs identical to RTPS plus V1, V2.
    probe('rtpt_vxy0', scene_setup, OP_RTPT_SF1_LM1, DATA, 0, CANARY_VXY, 'RTPT VXY0');
    probe('rtpt_vz0', scene_setup, OP_RTPT_SF1_LM1, DATA, 1, CANARY_VZ, 'RTPT VZ0');
    probe('rtpt_vxy1', scene_setup, OP_RTPT_SF1_LM1, DATA, 2, CANARY_VXY, 'RTPT VXY1');
    probe('rtpt_vz1', scene_setup, OP_RTPT_SF1_LM1, DATA, 3, CANARY_VZ, 'RTPT VZ1');
    probe('rtpt_vxy2', scene_setup, OP_RTPT_SF1_LM1, DATA, 4, CANARY_VXY, 'RTPT VXY2');
    probe('rtpt_vz2', scene_setup, OP_RTPT_SF1_LM1, DATA, 5, CANARY_VZ, 'RTPT VZ2');
    probe('rtpt_r11r12', scene_setup, OP_RTPT_SF1_LM1, CTRL, 0, CANARY_RMAT, 'RTPT R11R12');
    probe('rtpt_r13r21', scene_setup, OP_RTPT_SF1_LM1, CTRL, 1, CANARY_RMAT, 'RTPT R13R21');
    probe('rtpt_r22r23', scene_setup, OP_RTPT_SF1_LM1, CTRL, 2, CANARY_RMAT, 'RTPT R22R23');
    probe('rtpt_r31r32', scene_setup, OP_RTPT_SF1_LM1, CTRL, 3, CANARY_RMAT, 'RTPT R31R32');
    probe('rtpt_r33', scene_setup, OP_RTPT_SF1_LM1, CTRL, 4, CANARY_RMAT, 'RTPT R33');
    probe('rtpt_trx', scene_setup, OP_RTPT_SF1_LM1, CTRL, 5, CANARY_TR, 'RTPT TRX');
    probe('rtpt_try', scene_setup, OP_RTPT_SF1_LM1, CTRL, 6, CANARY_TR, 'RTPT TRY');
    probe('rtpt_trz', scene_setup, OP_RTPT_SF1_LM1, CTRL, 7, CANARY_TR, 'RTPT TRZ');
    probe('rtpt_ofx', scene_setup, OP_RTPT_SF1_LM1, CTRL, 24, CANARY_OF, 'RTPT OFX');
    probe('rtpt_ofy', scene_setup, OP_RTPT_SF1_LM1, CTRL, 25, CANARY_OF, 'RTPT OFY');
    probe('rtpt_h', scene_setup, OP_RTPT_SF1_LM1, CTRL, 26, CANARY_H, 'RTPT H');
    probe('rtpt_dqa', scene_setup, OP_RTPT_SF1_LM1, CTRL, 27, CANARY_DQA, 'RTPT DQA');
    probe('rtpt_dqb', scene_setup, OP_RTPT_SF1_LM1, CTRL, 28, CANARY_DQB, 'RTPT DQB');

  });

  describe('color (CC, CDP) (gte-latency-color.c)', () => {

    before(async () => { ({ gte } = include('enge:psx:gte')); });

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

    // CC (Color Color): tints RGBC by lit color (LCM*IR + BK -> mult by RGB).
    // 11 cycles. Reads LCM, BK, IR1/2/3, RGBC.
    probe('cc_rgbc', scene_setup, OP_CC_SF1_LM1, DATA, 6, CANARY_RGBC, 'CC RGBC');
    probe('cc_ir1', scene_setup, OP_CC_SF1_LM1, DATA, 9, CANARY_IR, 'CC IR1');
    probe('cc_ir2', scene_setup, OP_CC_SF1_LM1, DATA, 10, CANARY_IR, 'CC IR2');
    probe('cc_ir3', scene_setup, OP_CC_SF1_LM1, DATA, 11, CANARY_IR, 'CC IR3');
    probe('cc_lr1lr2', scene_setup, OP_CC_SF1_LM1, CTRL, 16, CANARY_LMAT, 'CC LR1LR2');
    probe('cc_lr3lg1', scene_setup, OP_CC_SF1_LM1, CTRL, 17, CANARY_LMAT, 'CC LR3LG1');
    probe('cc_lg2lg3', scene_setup, OP_CC_SF1_LM1, CTRL, 18, CANARY_LMAT, 'CC LG2LG3');
    probe('cc_lb1lb2', scene_setup, OP_CC_SF1_LM1, CTRL, 19, CANARY_LMAT, 'CC LB1LB2');
    probe('cc_lb3', scene_setup, OP_CC_SF1_LM1, CTRL, 20, CANARY_LMAT, 'CC LB3');
    probe('cc_rbk', scene_setup, OP_CC_SF1_LM1, CTRL, 13, CANARY_BK, 'CC RBK');
    probe('cc_gbk', scene_setup, OP_CC_SF1_LM1, CTRL, 14, CANARY_BK, 'CC GBK');
    probe('cc_bbk', scene_setup, OP_CC_SF1_LM1, CTRL, 15, CANARY_BK, 'CC BBK');

    // CDP (Color Depth-cue Pass): CC's color stage + depth-cue toward FC.
    // 13 cycles. Reads LCM, BK, IR0/1/2/3, RGBC, FC.
    probe('cdp_rgbc', scene_setup, OP_CDP_SF1_LM1, DATA, 6, CANARY_RGBC, 'CDP RGBC');
    probe('cdp_ir0', scene_setup, OP_CDP_SF1_LM1, DATA, 8, CANARY_IR0, 'CDP IR0');
    probe('cdp_ir1', scene_setup, OP_CDP_SF1_LM1, DATA, 9, CANARY_IR, 'CDP IR1');
    probe('cdp_ir2', scene_setup, OP_CDP_SF1_LM1, DATA, 10, CANARY_IR, 'CDP IR2');
    probe('cdp_ir3', scene_setup, OP_CDP_SF1_LM1, DATA, 11, CANARY_IR, 'CDP IR3');
    probe('cdp_lr1lr2', scene_setup, OP_CDP_SF1_LM1, CTRL, 16, CANARY_LMAT, 'CDP LR1LR2');
    probe('cdp_lr3lg1', scene_setup, OP_CDP_SF1_LM1, CTRL, 17, CANARY_LMAT, 'CDP LR3LG1');
    probe('cdp_lg2lg3', scene_setup, OP_CDP_SF1_LM1, CTRL, 18, CANARY_LMAT, 'CDP LG2LG3');
    probe('cdp_lb1lb2', scene_setup, OP_CDP_SF1_LM1, CTRL, 19, CANARY_LMAT, 'CDP LB1LB2');
    probe('cdp_lb3', scene_setup, OP_CDP_SF1_LM1, CTRL, 20, CANARY_LMAT, 'CDP LB3');
    probe('cdp_rbk', scene_setup, OP_CDP_SF1_LM1, CTRL, 13, CANARY_BK, 'CDP RBK');
    probe('cdp_gbk', scene_setup, OP_CDP_SF1_LM1, CTRL, 14, CANARY_BK, 'CDP GBK');
    probe('cdp_bbk', scene_setup, OP_CDP_SF1_LM1, CTRL, 15, CANARY_BK, 'CDP BBK');
    probe('cdp_rfc', scene_setup, OP_CDP_SF1_LM1, CTRL, 21, CANARY_FC, 'CDP RFC');
    probe('cdp_gfc', scene_setup, OP_CDP_SF1_LM1, CTRL, 22, CANARY_FC, 'CDP GFC');
    probe('cdp_bfc', scene_setup, OP_CDP_SF1_LM1, CTRL, 23, CANARY_FC, 'CDP BFC');

  });

  describe('depth cueing (DPCS, DPCT, DCPL, INTPL) (gte-latency-dpc.c)', () => {

    before(async () => { ({ gte } = include('enge:psx:gte')); });

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

    // DPCS (Depth-Cue color Single): blend RGBC toward FC by IR0. 8 cycles.
    probe('dpcs_rgbc', scene_setup, OP_DPCS_SF1_LM1, DATA, 6, CANARY_RGBC, 'DPCS RGBC');
    probe('dpcs_ir0', scene_setup, OP_DPCS_SF1_LM1, DATA, 8, CANARY_IR0, 'DPCS IR0');
    probe('dpcs_rfc', scene_setup, OP_DPCS_SF1_LM1, CTRL, 21, CANARY_FC, 'DPCS RFC');
    probe('dpcs_gfc', scene_setup, OP_DPCS_SF1_LM1, CTRL, 22, CANARY_FC, 'DPCS GFC');
    probe('dpcs_bfc', scene_setup, OP_DPCS_SF1_LM1, CTRL, 23, CANARY_FC, 'DPCS BFC');

    // DPCT (Depth-Cue Triple): blends three FIFO entries toward FC. 17 cycles.
    // Reads RGB0/1/2, FC, IR0.
    probe('dpct_rgb0', scene_setup, OP_DPCT_SF1_LM1, DATA, 20, CANARY_RGBFIFO, 'DPCT RGB0');
    probe('dpct_rgb1', scene_setup, OP_DPCT_SF1_LM1, DATA, 21, CANARY_RGBFIFO, 'DPCT RGB1');
    probe('dpct_rgb2', scene_setup, OP_DPCT_SF1_LM1, DATA, 22, CANARY_RGBFIFO, 'DPCT RGB2');
    probe('dpct_ir0', scene_setup, OP_DPCT_SF1_LM1, DATA, 8, CANARY_IR0, 'DPCT IR0');
    probe('dpct_rfc', scene_setup, OP_DPCT_SF1_LM1, CTRL, 21, CANARY_FC, 'DPCT RFC');
    probe('dpct_gfc', scene_setup, OP_DPCT_SF1_LM1, CTRL, 22, CANARY_FC, 'DPCT GFC');
    probe('dpct_bfc', scene_setup, OP_DPCT_SF1_LM1, CTRL, 23, CANARY_FC, 'DPCT BFC');

    // DCPL (Depth-Cue color from Light): like DPCS but reads from IR.
    // 8 cycles. Reads RGBC, IR1/2/3, IR0, FC.
    probe('dcpl_rgbc', scene_setup, OP_DCPL_SF1_LM1, DATA, 6, CANARY_RGBC, 'DCPL RGBC');
    probe('dcpl_ir1', scene_setup, OP_DCPL_SF1_LM1, DATA, 9, CANARY_IR, 'DCPL IR1');
    probe('dcpl_ir2', scene_setup, OP_DCPL_SF1_LM1, DATA, 10, CANARY_IR, 'DCPL IR2');
    probe('dcpl_ir3', scene_setup, OP_DCPL_SF1_LM1, DATA, 11, CANARY_IR, 'DCPL IR3');
    probe('dcpl_ir0', scene_setup, OP_DCPL_SF1_LM1, DATA, 8, CANARY_IR0, 'DCPL IR0');
    probe('dcpl_rfc', scene_setup, OP_DCPL_SF1_LM1, CTRL, 21, CANARY_FC, 'DCPL RFC');
    probe('dcpl_gfc', scene_setup, OP_DCPL_SF1_LM1, CTRL, 22, CANARY_FC, 'DCPL GFC');
    probe('dcpl_bfc', scene_setup, OP_DCPL_SF1_LM1, CTRL, 23, CANARY_FC, 'DCPL BFC');

    // INTPL (Interpolate IR toward FC by IR0): 8 cycles.
    // Reads IR1/2/3, IR0, FC.
    probe('intpl_ir1', scene_setup, OP_INTPL_SF1_LM1, DATA, 9, CANARY_IR, 'INTPL IR1');
    probe('intpl_ir2', scene_setup, OP_INTPL_SF1_LM1, DATA, 10, CANARY_IR, 'INTPL IR2');
    probe('intpl_ir3', scene_setup, OP_INTPL_SF1_LM1, DATA, 11, CANARY_IR, 'INTPL IR3');
    probe('intpl_ir0', scene_setup, OP_INTPL_SF1_LM1, DATA, 8, CANARY_IR0, 'INTPL IR0');
    probe('intpl_rfc', scene_setup, OP_INTPL_SF1_LM1, CTRL, 21, CANARY_FC, 'INTPL RFC');
    probe('intpl_gfc', scene_setup, OP_INTPL_SF1_LM1, CTRL, 22, CANARY_FC, 'INTPL GFC');
    probe('intpl_bfc', scene_setup, OP_INTPL_SF1_LM1, CTRL, 23, CANARY_FC, 'INTPL BFC');

  });

  describe('math (SQR, OP, NCLIP) (gte-latency-math.c)', () => {

    before(async () => { ({ gte } = include('enge:psx:gte')); });

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

    // SQR (Square): IR1/2/3 squared. 5 cycles.
    probe('sqr_ir1', scene_setup, OP_SQR_SF1_LM1, DATA, 9, CANARY_IR, 'SQR IR1');
    probe('sqr_ir2', scene_setup, OP_SQR_SF1_LM1, DATA, 10, CANARY_IR, 'SQR IR2');
    probe('sqr_ir3', scene_setup, OP_SQR_SF1_LM1, DATA, 11, CANARY_IR, 'SQR IR3');

    // OP (cross product of R diagonal and IR): 6 cycles.
    // Reads R11, R22, R33 (low halves of R11R12, R22R23, and R33) and IR1/2/3.
    probe('op_ir1', scene_setup, OP_OP_SF1_LM1, DATA, 9, CANARY_IR, 'OP IR1');
    probe('op_ir2', scene_setup, OP_OP_SF1_LM1, DATA, 10, CANARY_IR, 'OP IR2');
    probe('op_ir3', scene_setup, OP_OP_SF1_LM1, DATA, 11, CANARY_IR, 'OP IR3');
    probe('op_r11r12', scene_setup, OP_OP_SF1_LM1, CTRL, 0, CANARY_RMAT, 'OP R11R12');
    probe('op_r22r23', scene_setup, OP_OP_SF1_LM1, CTRL, 2, CANARY_RMAT, 'OP R22R23');
    probe('op_r33', scene_setup, OP_OP_SF1_LM1, CTRL, 4, CANARY_RMAT, 'OP R33');

    // NCLIP (normal clip - signed area of screen-space triangle): 8 cycles.
    // Reads SXY0, SXY1, SXY2 (data regs 12, 13, 14).
    probe('nclip_sxy0', scene_setup, OP_NCLIP, DATA, 12, CANARY_SXY, 'NCLIP SXY0');
    probe('nclip_sxy1', scene_setup, OP_NCLIP, DATA, 13, CANARY_SXY, 'NCLIP SXY1');
    probe('nclip_sxy2', scene_setup, OP_NCLIP, DATA, 14, CANARY_SXY, 'NCLIP SXY2');

  });

  describe('misc (AVSZ3, AVSZ4, GPF, GPL) (gte-latency-misc.c)', () => {

    before(async () => { ({ gte } = include('enge:psx:gte')); });

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

    // AVSZ3 (Average of 3 Z values): MAC0 = ZSF3 * (SZ1+SZ2+SZ3). 5 cycles.
    probe('avsz3_sz1', scene_setup, OP_AVSZ3, DATA, 17, CANARY_SZ, 'AVSZ3 SZ1');
    probe('avsz3_sz2', scene_setup, OP_AVSZ3, DATA, 18, CANARY_SZ, 'AVSZ3 SZ2');
    probe('avsz3_sz3', scene_setup, OP_AVSZ3, DATA, 19, CANARY_SZ, 'AVSZ3 SZ3');
    probe('avsz3_zsf3', scene_setup, OP_AVSZ3, CTRL, 29, CANARY_ZSF, 'AVSZ3 ZSF3');

    // AVSZ4: MAC0 = ZSF4 * (SZ0+SZ1+SZ2+SZ3). 6 cycles.
    probe('avsz4_sz0', scene_setup, OP_AVSZ4, DATA, 16, CANARY_SZ, 'AVSZ4 SZ0');
    probe('avsz4_sz1', scene_setup, OP_AVSZ4, DATA, 17, CANARY_SZ, 'AVSZ4 SZ1');
    probe('avsz4_sz2', scene_setup, OP_AVSZ4, DATA, 18, CANARY_SZ, 'AVSZ4 SZ2');
    probe('avsz4_sz3', scene_setup, OP_AVSZ4, DATA, 19, CANARY_SZ, 'AVSZ4 SZ3');
    probe('avsz4_zsf4', scene_setup, OP_AVSZ4, CTRL, 30, CANARY_ZSF, 'AVSZ4 ZSF4');

    // GPF (General Purpose Full): MAC = IR0 * IR. 5 cycles.
    probe('gpf_ir0', scene_setup, OP_GPF_SF1_LM1, DATA, 8, CANARY_IR0, 'GPF IR0');
    probe('gpf_ir1', scene_setup, OP_GPF_SF1_LM1, DATA, 9, CANARY_IR, 'GPF IR1');
    probe('gpf_ir2', scene_setup, OP_GPF_SF1_LM1, DATA, 10, CANARY_IR, 'GPF IR2');
    probe('gpf_ir3', scene_setup, OP_GPF_SF1_LM1, DATA, 11, CANARY_IR, 'GPF IR3');

    // GPL (General Purpose Long): MAC += IR0 * IR. 5 cycles.
    // Reads MAC1/2/3 in addition to IR.
    probe('gpl_ir0', scene_setup, OP_GPL_SF1_LM1, DATA, 8, CANARY_IR0, 'GPL IR0');
    probe('gpl_ir1', scene_setup, OP_GPL_SF1_LM1, DATA, 9, CANARY_IR, 'GPL IR1');
    probe('gpl_ir2', scene_setup, OP_GPL_SF1_LM1, DATA, 10, CANARY_IR, 'GPL IR2');
    probe('gpl_ir3', scene_setup, OP_GPL_SF1_LM1, DATA, 11, CANARY_IR, 'GPL IR3');
    probe('gpl_mac1', scene_setup, OP_GPL_SF1_LM1, DATA, 25, CANARY_MAC, 'GPL MAC1');
    probe('gpl_mac2', scene_setup, OP_GPL_SF1_LM1, DATA, 26, CANARY_MAC, 'GPL MAC2');
    probe('gpl_mac3', scene_setup, OP_GPL_SF1_LM1, DATA, 27, CANARY_MAC, 'GPL MAC3');

  });

  describe('MVMVA (gte-latency-mvmva.c)', () => {

    before(async () => { ({ gte } = include('enge:psx:gte')); });

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

    // MVMVA(RT, V0, TR): rotation transform. 8 cycles.
    // Reads R-matrix, V0, TR.
    probe('mvmva_rt_v0_tr_vxy0', scene_setup, OP_MVMVA_RT_V0_TR, DATA, 0, CANARY_VXY, 'MVMVA(RT,V0,TR) VXY0');
    probe('mvmva_rt_v0_tr_vz0', scene_setup, OP_MVMVA_RT_V0_TR, DATA, 1, CANARY_VZ, 'MVMVA(RT,V0,TR) VZ0');
    probe('mvmva_rt_v0_tr_r11r12', scene_setup, OP_MVMVA_RT_V0_TR, CTRL, 0, CANARY_MAT, 'MVMVA(RT,V0,TR) R11R12');
    probe('mvmva_rt_v0_tr_r13r21', scene_setup, OP_MVMVA_RT_V0_TR, CTRL, 1, CANARY_MAT, 'MVMVA(RT,V0,TR) R13R21');
    probe('mvmva_rt_v0_tr_r22r23', scene_setup, OP_MVMVA_RT_V0_TR, CTRL, 2, CANARY_MAT, 'MVMVA(RT,V0,TR) R22R23');
    probe('mvmva_rt_v0_tr_r31r32', scene_setup, OP_MVMVA_RT_V0_TR, CTRL, 3, CANARY_MAT, 'MVMVA(RT,V0,TR) R31R32');
    probe('mvmva_rt_v0_tr_r33', scene_setup, OP_MVMVA_RT_V0_TR, CTRL, 4, CANARY_MAT, 'MVMVA(RT,V0,TR) R33');
    probe('mvmva_rt_v0_tr_trx', scene_setup, OP_MVMVA_RT_V0_TR, CTRL, 5, CANARY_TR, 'MVMVA(RT,V0,TR) TRX');
    probe('mvmva_rt_v0_tr_try', scene_setup, OP_MVMVA_RT_V0_TR, CTRL, 6, CANARY_TR, 'MVMVA(RT,V0,TR) TRY');
    probe('mvmva_rt_v0_tr_trz', scene_setup, OP_MVMVA_RT_V0_TR, CTRL, 7, CANARY_TR, 'MVMVA(RT,V0,TR) TRZ');

    // MVMVA(LL, V0, BK): light pass. 8 cycles. Reads L-matrix, V0, BK.
    probe('mvmva_ll_v0_bk_vxy0', scene_setup, OP_MVMVA_LL_V0_BK, DATA, 0, CANARY_VXY, 'MVMVA(LL,V0,BK) VXY0');
    probe('mvmva_ll_v0_bk_vz0', scene_setup, OP_MVMVA_LL_V0_BK, DATA, 1, CANARY_VZ, 'MVMVA(LL,V0,BK) VZ0');
    probe('mvmva_ll_v0_bk_l11l12', scene_setup, OP_MVMVA_LL_V0_BK, CTRL, 8, CANARY_MAT, 'MVMVA(LL,V0,BK) L11L12');
    probe('mvmva_ll_v0_bk_l13l21', scene_setup, OP_MVMVA_LL_V0_BK, CTRL, 9, CANARY_MAT, 'MVMVA(LL,V0,BK) L13L21');
    probe('mvmva_ll_v0_bk_l22l23', scene_setup, OP_MVMVA_LL_V0_BK, CTRL, 10, CANARY_MAT, 'MVMVA(LL,V0,BK) L22L23');
    probe('mvmva_ll_v0_bk_l31l32', scene_setup, OP_MVMVA_LL_V0_BK, CTRL, 11, CANARY_MAT, 'MVMVA(LL,V0,BK) L31L32');
    probe('mvmva_ll_v0_bk_l33', scene_setup, OP_MVMVA_LL_V0_BK, CTRL, 12, CANARY_MAT, 'MVMVA(LL,V0,BK) L33');
    probe('mvmva_ll_v0_bk_rbk', scene_setup, OP_MVMVA_LL_V0_BK, CTRL, 13, CANARY_BK, 'MVMVA(LL,V0,BK) RBK');
    probe('mvmva_ll_v0_bk_gbk', scene_setup, OP_MVMVA_LL_V0_BK, CTRL, 14, CANARY_BK, 'MVMVA(LL,V0,BK) GBK');
    probe('mvmva_ll_v0_bk_bbk', scene_setup, OP_MVMVA_LL_V0_BK, CTRL, 15, CANARY_BK, 'MVMVA(LL,V0,BK) BBK');

    // MVMVA(LC, IR, BK): color matrix pass. 8 cycles. Reads LC-matrix, IR, BK.
    probe('mvmva_lc_ir_bk_ir1', scene_setup, OP_MVMVA_LC_IR_BK, DATA, 9, CANARY_IR, 'MVMVA(LC,IR,BK) IR1');
    probe('mvmva_lc_ir_bk_ir2', scene_setup, OP_MVMVA_LC_IR_BK, DATA, 10, CANARY_IR, 'MVMVA(LC,IR,BK) IR2');
    probe('mvmva_lc_ir_bk_ir3', scene_setup, OP_MVMVA_LC_IR_BK, DATA, 11, CANARY_IR, 'MVMVA(LC,IR,BK) IR3');
    probe('mvmva_lc_ir_bk_lr1lr2', scene_setup, OP_MVMVA_LC_IR_BK, CTRL, 16, CANARY_MAT, 'MVMVA(LC,IR,BK) LR1LR2');
    probe('mvmva_lc_ir_bk_lr3lg1', scene_setup, OP_MVMVA_LC_IR_BK, CTRL, 17, CANARY_MAT, 'MVMVA(LC,IR,BK) LR3LG1');
    probe('mvmva_lc_ir_bk_lg2lg3', scene_setup, OP_MVMVA_LC_IR_BK, CTRL, 18, CANARY_MAT, 'MVMVA(LC,IR,BK) LG2LG3');
    probe('mvmva_lc_ir_bk_lb1lb2', scene_setup, OP_MVMVA_LC_IR_BK, CTRL, 19, CANARY_MAT, 'MVMVA(LC,IR,BK) LB1LB2');
    probe('mvmva_lc_ir_bk_lb3', scene_setup, OP_MVMVA_LC_IR_BK, CTRL, 20, CANARY_MAT, 'MVMVA(LC,IR,BK) LB3');
    probe('mvmva_lc_ir_bk_rbk', scene_setup, OP_MVMVA_LC_IR_BK, CTRL, 13, CANARY_BK, 'MVMVA(LC,IR,BK) RBK');
    probe('mvmva_lc_ir_bk_gbk', scene_setup, OP_MVMVA_LC_IR_BK, CTRL, 14, CANARY_BK, 'MVMVA(LC,IR,BK) GBK');
    probe('mvmva_lc_ir_bk_bbk', scene_setup, OP_MVMVA_LC_IR_BK, CTRL, 15, CANARY_BK, 'MVMVA(LC,IR,BK) BBK');

  });


})
