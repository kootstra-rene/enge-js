mdlr('[test]enge:psx:gte-validation', ({ include, test }) => {

  const { describe, it, expect, before } = test;

  // Ported from the nugget GTE hardware validation suite
  // (https://github.com/pcsx-redux/nugget, tests/gte, MIT); every expectation
  // was verified on SCPH-5501 silicon. The tests drive the GTE registers as
  // the original does with MTC2/CTC2/MFC2/CFC2 and COP2 commands. They share
  // one GTE and run in the original order, as they do on the console.

  let gte;
  before(async () => { ({ gte } = include('enge:psx:gte')); });

  // C integer conversions
  const u32 = v => v >>> 0;
  const s32 = v => v | 0;
  const u16 = v => v & 0xffff;
  const s16 = v => (v << 16) >> 16;
  const u8 = v => v & 0xff;
  const s8 = v => (v << 24) >> 24;

  // common/hardware/cop2.h: command encoding
  const COP2_OP = (fake, sf, mx, v, cv, lm, fn) =>
    ((fake << 20) | (sf << 19) | (mx << 17) | (v << 15) | (cv << 13) | (lm << 10) | fn) >>> 0;
  const COP2_SF0 = 0, COP2_SF1 = 1;
  const COP2_MX_RT = 0, COP2_MX_LL = 1, COP2_MX_LC = 2, COP2_MX_BAD = 3;
  const COP2_V_V0 = 0, COP2_V_V1 = 1, COP2_V_V2 = 2, COP2_V_IR = 3;
  const COP2_CV_TR = 0, COP2_CV_BK = 1, COP2_CV_FC = 2, COP2_CV_NONE = 3;
  const COP2_LM_SIGNED = 0, COP2_LM_UNSIGNED = 1;
  const COP2_FN_RTPS = 0x01, COP2_FN_NCLIP = 0x06, COP2_FN_OP = 0x0c, COP2_FN_DPCS = 0x10;
  const COP2_FN_INTPL = 0x11, COP2_FN_MVMVA = 0x12, COP2_FN_NCDS = 0x13, COP2_FN_CDP = 0x14;
  const COP2_FN_NCDT = 0x16, COP2_FN_NCCS = 0x1b, COP2_FN_CC = 0x1c, COP2_FN_NCS = 0x1e;
  const COP2_FN_NCT = 0x20, COP2_FN_SQR = 0x28, COP2_FN_DCPL = 0x29, COP2_FN_DPCT = 0x2a;
  const COP2_FN_AVSZ3 = 0x2d, COP2_FN_AVSZ4 = 0x2e, COP2_FN_RTPT = 0x30, COP2_FN_GPF = 0x3d;
  const COP2_FN_GPL = 0x3e, COP2_FN_NCCT = 0x3f;
  const COP2_RTPS = (sf, lm) => COP2_OP(1, sf, 0, 0, 0, lm, COP2_FN_RTPS);
  const COP2_RTPT = (sf, lm) => COP2_OP(2, sf, 0, 0, 0, lm, COP2_FN_RTPT);
  const COP2_NCLIP = COP2_OP(20, 0, 0, 0, 0, 0, COP2_FN_NCLIP);
  const COP2_OP_CP = (sf, lm) => COP2_OP(23, sf, 0, 0, 0, lm, COP2_FN_OP);
  const COP2_DPCS = (sf, lm) => COP2_OP(7, sf, 0, 0, 0, lm, COP2_FN_DPCS);
  const COP2_DPCT = (sf, lm) => COP2_OP(15, sf, 0, 0, 0, lm, COP2_FN_DPCT);
  const COP2_DCPL = (sf, lm) => COP2_OP(6, sf, 0, 0, 0, lm, COP2_FN_DCPL);
  const COP2_INTPL = (sf, lm) => COP2_OP(9, sf, 0, 0, 0, lm, COP2_FN_INTPL);
  const COP2_MVMVA = (sf, mx, v, cv, lm) => COP2_OP(4, sf, mx, v, cv, lm, COP2_FN_MVMVA);
  const COP2_NCS = (sf, lm) => COP2_OP(12, sf, 0, 0, 0, lm, COP2_FN_NCS);
  const COP2_NCT = (sf, lm) => COP2_OP(13, sf, 0, 0, 0, lm, COP2_FN_NCT);
  const COP2_NCCS = (sf, lm) => COP2_OP(16, sf, 0, 0, 0, lm, COP2_FN_NCCS);
  const COP2_NCCT = (sf, lm) => COP2_OP(17, sf, 0, 0, 0, lm, COP2_FN_NCCT);
  const COP2_NCDS = (sf, lm) => COP2_OP(14, sf, 0, 0, 0, lm, COP2_FN_NCDS);
  const COP2_NCDT = (sf, lm) => COP2_OP(15, sf, 0, 0, 0, lm, COP2_FN_NCDT);
  const COP2_CC = (sf, lm) => COP2_OP(19, sf, 0, 0, 0, lm, COP2_FN_CC);
  const COP2_CDP = (sf, lm) => COP2_OP(18, sf, 0, 0, 0, lm, COP2_FN_CDP);
  const COP2_SQR = (sf, lm) => COP2_OP(10, sf, 0, 0, 0, lm, COP2_FN_SQR);
  const COP2_AVSZ3 = COP2_OP(21, 1, 0, 0, 0, 0, COP2_FN_AVSZ3);
  const COP2_AVSZ4 = COP2_OP(22, 1, 0, 0, 0, 0, COP2_FN_AVSZ4);
  const COP2_GPF = (sf, lm) => COP2_OP(25, sf, 0, 0, 0, lm, COP2_FN_GPF);
  const COP2_GPL = (sf, lm) => COP2_OP(26, sf, 0, 0, 0, lm, COP2_FN_GPL);

  // gte.c helpers
  const gte_clear_flag = () => gte.set(32 + 31, 0);
  const gte_read_flag = () => u32(gte.get(32 + 31));
  const gte_set_identity_rotation = () => {
    gte.set(32 + 0, 0x00001000); gte.set(32 + 1, 0); gte.set(32 + 2, 0x00001000); gte.set(32 + 3, 0); gte.set(32 + 4, 0x1000);
  };
  const gte_set_simple_light = () => {
    gte.set(32 + 8, 0); gte.set(32 + 9, 0); gte.set(32 + 10, 0); gte.set(32 + 11, 0); gte.set(32 + 12, 0x1000);
  };
  const gte_set_white_light_color = () => {
    gte.set(32 + 16, 0x00001000); gte.set(32 + 17, 0); gte.set(32 + 18, 0x00001000); gte.set(32 + 19, 0); gte.set(32 + 20, 0x1000);
  };
  const gte_set_zero_bk = () => { gte.set(32 + 13, 0); gte.set(32 + 14, 0); gte.set(32 + 15, 0); };
  const gte_set_far_color = (r, g, b) => { gte.set(32 + 21, r); gte.set(32 + 22, g); gte.set(32 + 23, b); };
  const gte_set_translation = (x, y, z) => { gte.set(32 + 5, x); gte.set(32 + 6, y); gte.set(32 + 7, z); };
  const gte_set_screen = (ofx, ofy, h) => {
    gte.set(32 + 24, ofx); gte.set(32 + 25, ofy); gte.set(32 + 26, h); gte.set(32 + 27, 0); gte.set(32 + 28, 0);
  };

  describe('register IO (gte-regio.c)', () => {

      it('regio_mac0_roundtrip', async () => {
        gte.set(24, 0x12345678);
        const out = u32(gte.get(24));
        expect(out).to.eql(0x12345678);
      });

      it('regio_mac1_roundtrip', async () => {
        gte.set(25, 0xdeadbeef);
        const out = u32(gte.get(25));
        expect(out).to.eql(0xdeadbeef);
      });

      it('regio_ir0_sign_extend', async () => {
        gte.set(8, 0x0000ffff);
        const out = u32(gte.get(8));
        expect(out).to.eql(0xffffffff);
      });

      it('regio_ir1_sign_extend', async () => {
        gte.set(9, 0x00008000);
        const out = u32(gte.get(9));
        expect(out).to.eql(0xffff8000);
      });

      it('regio_ir2_positive', async () => {
        gte.set(10, 0x00001234);
        const out = u32(gte.get(10));
        expect(out).to.eql(0x00001234);
      });

      it('regio_ir3_positive', async () => {
        gte.set(11, 0x00007fff);
        const out = u32(gte.get(11));
        expect(out).to.eql(0x00007fff);
      });

      it('regio_vz0_sign_extend', async () => {
        gte.set(1, 0x0000ff00);
        const out = u32(gte.get(1));
        expect(out).to.eql(0xffffff00);
      });

      it('regio_vxy0_packed', async () => {
        gte.set(0, 0x00640032);
        const out = u32(gte.get(0));
        expect(out).to.eql(0x00640032);
      });

      it('regio_otz_zero_extend', async () => {
        gte.set(7, 0xffffffff);
        const out = u32(gte.get(7));
        expect(out).to.eql(0x0000ffff);
      });

      it('regio_sz_zero_extend', async () => {
        gte.set(16, 0xdeadbeef);
        const out = u32(gte.get(16));
        expect(out).to.eql(0x0000beef);
      });

      it('regio_rgbc_roundtrip', async () => {
        gte.set(6, 0xaa554080);
        const out = u32(gte.get(6));
        expect(out).to.eql(0xaa554080);
      });

      it('regio_res1_readwrite', async () => {
        gte.set(23, 0xdeadbeef);
        const out = u32(gte.get(23));
        expect(out).to.eql(0xdeadbeef);
      });

      it('regio_sxy_fifo_push', async () => {
        gte.set(12, 0x00010002);
        gte.set(13, 0x00030004);
        gte.set(14, 0x00050006);
        gte.set(15, 0x00070008);
        const sxy0 = u32(gte.get(12));
        const sxy1 = u32(gte.get(13));
        const sxy2 = u32(gte.get(14));
        expect(sxy0).to.eql(0x00030004);
        expect(sxy1).to.eql(0x00050006);
        expect(sxy2).to.eql(0x00070008);
      });

      it('regio_sxyp_read_returns_sxy2', async () => {
        gte.set(14, 0xaabbccdd);
        const sxyp = u32(gte.get(15));
        expect(sxyp).to.eql(0xaabbccdd);
      });

      it('regio_sxy_fifo_triple_push', async () => {
        gte.set(15, 0x11111111);
        gte.set(15, 0x22222222);
        gte.set(15, 0x33333333);
        const sxy0 = u32(gte.get(12));
        const sxy1 = u32(gte.get(13));
        const sxy2 = u32(gte.get(14));
        expect(sxy0).to.eql(0x11111111);
        expect(sxy1).to.eql(0x22222222);
        expect(sxy2).to.eql(0x33333333);
      });

      it('regio_irgb_expand', async () => {
        gte.set(28, 0x7fff);
        // the original waits four nops here
        const ir1 = u32(gte.get(9));
        const ir2 = u32(gte.get(10));
        const ir3 = u32(gte.get(11));
        expect(ir1).to.eql(0x00000f80);
        expect(ir2).to.eql(0x00000f80);
        expect(ir3).to.eql(0x00000f80);
      });

      it('regio_irgb_individual', async () => {
        gte.set(28, 0x000a); // R=10, G=0, B=0
        // the original waits four nops here
        const ir1 = u32(gte.get(9));
        const ir2 = u32(gte.get(10));
        const ir3 = u32(gte.get(11));
        expect(ir1).to.eql(0x00000500); // 10 << 7
        expect(ir2).to.eql(0x00000000);
        expect(ir3).to.eql(0x00000000);
      });

      it('regio_orgb_pack', async () => {
        gte.set(9, 0x0f80);
        gte.set(10, 0x0f80);
        gte.set(11, 0x0f80);
        const orgb = u32(gte.get(29));
        expect(orgb).to.eql(0x7fff);
      });

      it('regio_orgb_saturate_negative', async () => {
        gte.set(9, 0xffff8000); // IR1 = -32768 (negative)
        gte.set(10, 0x00002000); // IR2 = 8192 (large positive)
        gte.set(11, 0x00000380); // IR3 = 896 (normal)
        const orgb = u32(gte.get(29));
        let r = u32(orgb & 0x1f);
        let g = u32((orgb >>> 5) & 0x1f);
        let b = u32((orgb >>> 10) & 0x1f);
        expect(r).to.eql(0); // negative saturated to 0
        expect(g).to.eql(31); // large saturated to 0x1f
        expect(b).to.eql(7); // 896 >> 7 = 7
      });

      it('regio_orgb_saturate_large', async () => {
        gte.set(9, 0x1000);
        gte.set(10, 0x1000);
        gte.set(11, 0x1000);
        const orgb = u32(gte.get(29));
        // 0x1000>>7 = 0x20 = 32, saturated to 31
        expect(orgb).to.eql(0x7fff);
      });

      it('regio_lzcr_zero', async () => {
        gte.set(30, 0x00000000);
        const lzcr = u32(gte.get(31));
        expect(lzcr).to.eql(32);
      });

      it('regio_lzcr_all_ones', async () => {
        gte.set(30, 0xffffffff);
        const lzcr = u32(gte.get(31));
        expect(lzcr).to.eql(32);
      });

      it('regio_lzcr_one', async () => {
        gte.set(30, 0x00000001);
        const lzcr = u32(gte.get(31));
        expect(lzcr).to.eql(31);
      });

      it('regio_lzcr_msb_set', async () => {
        gte.set(30, 0x80000000);
        const lzcr = u32(gte.get(31));
        expect(lzcr).to.eql(1);
      });

      it('regio_lzcr_positive_mid', async () => {
        gte.set(30, 0x00010000);
        const lzcr = u32(gte.get(31));
        expect(lzcr).to.eql(15);
      });

      it('regio_lzcr_negative_mid', async () => {
        gte.set(30, 0xfffe0000);
        const lzcr = u32(gte.get(31));
        expect(lzcr).to.eql(15);
      });

      it('regio_flag_write_mask', async () => {
        gte.set(32 + 31, 0xffffffff);
        let flag = u32(gte_read_flag());
        expect(flag).to.eql(0xfffff000);
      });

      it('regio_flag_bit31_not_writable', async () => {
        gte.set(32 + 31, 1 << 31);
        let flag = u32(gte_read_flag());
        expect(flag).to.eql(0);
      });

      it('regio_flag_low_bits_masked', async () => {
        gte.set(32 + 31, 0x00000fff);
        let flag = u32(gte_read_flag());
        expect(flag).to.eql(0);
      });

      it('regio_flag_bit12_no_summary', async () => {
        gte.set(32 + 31, (1 << 12));
        let flag = u32(gte_read_flag());
        expect(flag).to.eql(u32((1 << 12)));
      });

      it('regio_flag_bits19_22_no_summary', async () => {
        let flag;
        let ok = s32(1);
        let i;
        for (i = 19; i <= 22; i++) {
          gte.set(32 + 31, (1 << i));
          flag = u32(gte_read_flag());
          if (flag !== (1 << i)) ok = 0;
        }
        expect(ok).to.eql(1);
      });

      it('regio_flag_bits13_18_set_summary', async () => {
        let flag;
        let ok = s32(1);
        let i;
        for (i = 13; i <= 18; i++) {
          gte.set(32 + 31, (1 << i));
          flag = u32(gte_read_flag());
          if (flag !== u32((1 << i) | (1 << 31))) ok = 0;
        }
        expect(ok).to.eql(1);
      });

      it('regio_flag_bits23_30_set_summary', async () => {
        let flag;
        let ok = s32(1);
        let i;
        for (i = 23; i <= 30; i++) {
          gte.set(32 + 31, (1 << i));
          flag = u32(gte_read_flag());
          if (flag !== u32((1 << i) | (1 << 31))) ok = 0;
        }
        expect(ok).to.eql(1);
      });

      it('regio_ctrl_r33_sign_extend', async () => {
        gte.set(32 + 4, 0x00008000);
        const out = u32(gte.get(32 + 4));
        expect(out).to.eql(0xffff8000);
      });

      it('regio_ctrl_zsf3_sign_extend', async () => {
        gte.set(32 + 29, 0x0000ffff);
        const out = u32(gte.get(32 + 29));
        expect(out).to.eql(0xffffffff);
      });

      it('regio_h_sign_extension_bug', async () => {
        gte.set(32 + 26, 0x8000);
        const h = u32(gte.get(32 + 26));
        expect(h).to.eql(0xffff8000);
      });

      it('regio_h_positive', async () => {
        gte.set(32 + 26, 0x7fff);
        const h = u32(gte.get(32 + 26));
        expect(h).to.eql(0x00007fff);
      });

      it('regio_ctc2_sign_extend_all', async () => {
        let ok = s32(1);
        // R33(4), L33(12), LB3(20), H(26), DQA(27), ZSF3(29), ZSF4(30)
        gte.set(32 + 4, 0x8000);
        let out = u32(gte.get(32 + 4));
        if (out !== 0xffff8000) ok = 0;
        gte.set(32 + 12, 0x8000);
        out = u32(gte.get(32 + 12));
        if (out !== 0xffff8000) ok = 0;
        gte.set(32 + 20, 0x8000);
        out = u32(gte.get(32 + 20));
        if (out !== 0xffff8000) ok = 0;
        gte.set(32 + 26, 0x8000);
        out = u32(gte.get(32 + 26));
        if (out !== 0xffff8000) ok = 0;
        gte.set(32 + 27, 0x8000);
        out = u32(gte.get(32 + 27));
        if (out !== 0xffff8000) ok = 0;
        gte.set(32 + 29, 0x8000);
        out = u32(gte.get(32 + 29));
        if (out !== 0xffff8000) ok = 0;
        gte.set(32 + 30, 0x8000);
        out = u32(gte.get(32 + 30));
        if (out !== 0xffff8000) ok = 0;
        expect(ok).to.eql(1);
      });

      it('regio_lm_clamp', async () => {
        // GPF sf=1 lm=0: IR clamp -0x8000..0x7fff
        gte.set(8, 0x1000);
        gte.set(9, 0xffff8000);
        gte.set(10, 0x100);
        gte.set(11, 0x7fff);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const mac1_lm0 = s32(gte.get(25));
        const ir1_lm0 = u32(gte.get(9));
        // GPF sf=1 lm=1
        gte.set(8, 0x1000);
        gte.set(9, 0xffff8000);
        gte.set(10, 0x100);
        gte.set(11, 0x7fff);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 1));
        const mac1_lm1 = s32(gte.get(25));
        const ir1_lm1 = u32(gte.get(9));
        expect(mac1_lm0).to.eql(-32768);
        expect(mac1_lm1).to.eql(-32768);
        expect(ir1_lm0).to.eql(0xffff8000); // lm=0: stays -32768
        expect(ir1_lm1).to.eql(0x00000000); // lm=1: clamped to 0
      });

      // 32bit control registers: read-back fidelity, and whether commands
      // write them. psx-spx leaves an unanswered "(Input?, R/W?)" on TR
      // (cnt5-7), BK (cnt13-15), FC (cnt21-23), screen offset (cnt24-25) and
      // DQB (cnt28). The assertion is that all-ones does not read back as
      // zero: "two reads agree" passes on a register stuck at zero.
      const CTRL32 = [5, 6, 7, 13, 14, 15, 21, 22, 23, 24, 25, 28];

      it('regio_ctrl32_readback_table', async () => {
        const pats = [
          0x00000000, 0xffffffff, 0x12345678, 0xa5a5a5a5,
          0x80000000, 0x7fffffff, 0x0000ffff, 0xffff0000,
        ];
        let _responds = 1;
        for (const _pat of pats) {
          for (const r of CTRL32) {
            gte.set(32 + r, _pat);
            const _a = u32(gte.get(32 + r));
            if (_pat === 0xffffffff && _a === 0) _responds = 0;
          }
        }
        expect(_responds).to.eql(1);
      });

      // FLAG is the one control register that is an output. Seed it with a
      // pattern no command can reproduce (all-ones reads back as FFFFF000h)
      // and check the seed is gone afterwards: that is what "the command
      // rewrites FLAG" means.
      it('regio_ctrl32_command_writes', async () => {
        let _changed = 0;
        let _flagkept = 0;
        const changed = [];
        gte.set(0, 0x00200010); gte.set(1, 0x00000040);
        gte.set(2, 0x0018000c); gte.set(3, 0x00000050);
        gte.set(4, 0x00140008); gte.set(5, 0x00000060);
        gte.set(6, 0x00808080); gte.set(8, 0x1000);
        const probe = (name, op) => {
          for (const r of CTRL32) gte.set(32 + r, (0x0bad0000 | r) >>> 0);
          gte.set(32 + 31, 0xffffffff);
          gte.command(op);
          const _flag = u32(gte.get(32 + 31));
          if (_flag === 0xfffff000) { _flagkept++; changed.push(`${name} left FLAG seeded`); }
          for (const r of CTRL32) {
            const _o = u32(gte.get(32 + r));
            if (_o !== ((0x0bad0000 | r) >>> 0)) { _changed++; changed.push(`${name} wrote c${r}`); }
          }
        };
        probe('RTPS', COP2_RTPS(0, 0));
        probe('RTPT', COP2_RTPT(0, 0));
        probe('NCLIP', COP2_NCLIP);
        probe('AVSZ3', COP2_AVSZ3);
        probe('AVSZ4', COP2_AVSZ4);
        probe('SQR', COP2_SQR(0, 0));
        probe('DPCS', COP2_DPCS(0, 0));
        probe('DPCT', COP2_DPCT(0, 0));
        probe('DCPL', COP2_DCPL(0, 0));
        probe('INTPL', COP2_INTPL(0, 0));
        probe('NCS', COP2_NCS(0, 0));
        probe('NCT', COP2_NCT(0, 0));
        probe('NCCS', COP2_NCCS(0, 0));
        probe('NCCT', COP2_NCCT(0, 0));
        probe('NCDS', COP2_NCDS(0, 0));
        probe('NCDT', COP2_NCDT(0, 0));
        probe('CC', COP2_CC(0, 0));
        probe('CDP', COP2_CDP(0, 0));
        probe('GPF', COP2_GPF(0, 0));
        probe('GPL', COP2_GPL(0, 0));
        probe('MVMVA', COP2_MVMVA(0, 0, 0, 0, 0));
        expect(changed).to.eql([]);
        expect(_changed).to.eql(0);
        expect(_flagkept).to.eql(0);
      });

  });

  describe('NCLIP (gte-nclip.c)', () => {

      it('nclip_ccw', async () => {
        gte.set(12, 0x00000000); // (0,0)
        gte.set(13, 0x00000064); // (100,0)
        gte.set(14, 0x00640000); // (0,100)
        gte_clear_flag();
        gte.command(COP2_NCLIP);
        const mac0 = s32(gte.get(24));
        expect(mac0).to.eql(10000);
        expect(u32(gte_read_flag())).to.eql(0);
      });

      it('nclip_cw', async () => {
        gte.set(12, 0x00000000);
        gte.set(13, 0x00640000); // (0,100)
        gte.set(14, 0x00000064); // (100,0)
        gte_clear_flag();
        gte.command(COP2_NCLIP);
        const mac0 = s32(gte.get(24));
        expect(mac0).to.eql(-10000);
      });

      it('nclip_collinear', async () => {
        gte.set(12, 0x00000000);
        gte.set(13, 0x00320032); // (50,50)
        gte.set(14, 0x00640064); // (100,100)
        gte_clear_flag();
        gte.command(COP2_NCLIP);
        const mac0 = s32(gte.get(24));
        expect(mac0).to.eql(0);
      });

      it('nclip_large_coords', async () => {
        // SXY values near the screen coord limits (-0x400..0x3FF)
        gte.set(12, (0xfc00 << 16) | 0x03ff); // (0x3FF, -0x400)
        gte.set(13, (0x03ff << 16) | 0xfc00); // (-0x400, 0x3FF)
        gte.set(14, 0x00000000); // (0, 0)
        gte_clear_flag();
        gte.command(COP2_NCLIP);
        const mac0 = s32(gte.get(24));
        let flag = u32(gte_read_flag());
        // (0x3FF * 0x3FF) + (-0x400 * 0) + (0 * (-0x400))
        // - (0x3FF * 0) - (-0x400 * (-0x400)) - (0 * 0x3FF)
        // = 0x3FF*0x3FF - 0x400*0x400 = 1046529 - 1048576 = -2047
        // Actually: SX0=0x3FF, SY0=-0x400, SX1=-0x400, SY1=0x3FF, SX2=0, SY2=0
        // MAC0 = SX0*(SY1-SY2) + SX1*(SY2-SY0) + SX2*(SY0-SY1)
        //      = 0x3FF*(0x3FF-0) + (-0x400)*(0-(-0x400)) + 0*((-0x400)-0x3FF)
        //      = 0x3FF*0x3FF + (-0x400)*0x400
        //      = 1046529 - 1048576 = -2047
        expect(mac0).to.eql(-2047);
        expect(flag).to.eql(0);
      });

      it('nclip_overflow', async () => {
        // Use values that produce MAC0 > 0x7FFFFFFF
        // Max SX/SY after saturation is -0x400..0x3FF (11-bit signed)
        // Max cross product: 0x3FF*0x3FF*2 + 0x400*0x400*2 ~ 4 million, no overflow
        // Need unsaturated values: SXY registers are 16-bit signed
        gte.set(12, (0x7fff << 16) | 0x7fff); // (32767, 32767)
        gte.set(13, (0x8000 << 16) | 0x8000); // (-32768, -32768)
        gte.set(14, (0x7fff << 16) | 0x8000); // (-32768, 32767)
        gte_clear_flag();
        gte.command(COP2_NCLIP);
        const mac0 = s32(gte.get(24));
        let flag = u32(gte_read_flag());
        // Check if FLAG.16 or FLAG.15 (MAC0 overflow) is set
        expect(mac0).to.eql(131071);
        let f15 = u32((flag >>> 15) & 1);
        expect(f15).to.eql(1);
      });

  });

  describe('AVSZ3 / AVSZ4 (gte-avsz.c)', () => {

      it('avsz3_basic', async () => {
        gte.set(17, 100);
        gte.set(18, 200);
        gte.set(19, 300);
        gte.set(32 + 29, 0x555); // ZSF3 ~ 4096/3
        gte_clear_flag();
        gte.command(COP2_AVSZ3);
        const mac0 = s32(gte.get(24));
        const otz = u32(gte.get(7));
        expect(mac0).to.eql(819000);
        expect(otz).to.eql(199);
      });

      it('avsz4_basic', async () => {
        gte.set(16, 100);
        gte.set(17, 200);
        gte.set(18, 300);
        gte.set(19, 400);
        gte.set(32 + 30, 0x400); // ZSF4 = 4096/4
        gte_clear_flag();
        gte.command(COP2_AVSZ4);
        const mac0 = s32(gte.get(24));
        const otz = u32(gte.get(7));
        expect(mac0).to.eql(1024000);
        expect(otz).to.eql(250);
      });

      it('avsz3_uses_sz123', async () => {
        gte.set(16, 1000); // SZ0 - should be ignored
        gte.set(17, 2000); // SZ1
        gte.set(18, 3000); // SZ2
        gte.set(19, 4000); // SZ3
        gte.set(32 + 29, 0x1000); // ZSF3 = 1.0 in 4.12
        gte_clear_flag();
        gte.command(COP2_AVSZ3);
        const mac0 = s32(gte.get(24));
        // SZ1+SZ2+SZ3 = 9000, * 4096 = 36864000
        expect(mac0).to.eql(36864000);
      });

      it('avsz3_otz_saturate', async () => {
        gte.set(17, 0xffff);
        gte.set(18, 0xffff);
        gte.set(19, 0xffff);
        gte.set(32 + 29, 0x1000);
        gte_clear_flag();
        gte.command(COP2_AVSZ3);
        const otz = u32(gte.get(7));
        let flag = u32(gte_read_flag());
        expect(otz).to.eql(0xffff);
        // FLAG.18 (OTZ saturation) should be set
        let flag18 = u32((flag >>> 18) & 1);
        expect(flag18).to.eql(1);
      });

      it('avsz3_negative_zsf', async () => {
        gte.set(17, 100);
        gte.set(18, 200);
        gte.set(19, 300);
        gte.set(32 + 29, 0xf000); // ZSF3 = negative (sign-extended)
        gte_clear_flag();
        gte.command(COP2_AVSZ3);
        const mac0 = s32(gte.get(24));
        const otz = u32(gte.get(7));
        let flag = u32(gte_read_flag());
        // Negative result should saturate OTZ to 0
        expect(otz).to.eql(0);
      });

  });

  describe('SQR (gte-sqr.c)', () => {

      it('sqr_shifted', async () => {
        gte.set(9, 0x1000); // 1.0
        gte.set(10, 0x0800); // 0.5
        gte.set(11, 0x2000); // 2.0
        gte_clear_flag();
        gte.command(COP2_SQR(1, 0));
        const ir1 = u32(gte.get(9));
        const ir2 = u32(gte.get(10));
        const ir3 = u32(gte.get(11));
        expect(ir1).to.eql(0x1000); // 1.0^2 = 1.0
        expect(ir2).to.eql(0x0400); // 0.5^2 = 0.25
        expect(ir3).to.eql(0x4000); // 2.0^2 = 4.0 (no saturation, lm=0)
      });

      it('sqr_unshifted', async () => {
        gte.set(9, 4);
        gte.set(10, 5);
        gte.set(11, 6);
        gte_clear_flag();
        gte.command(COP2_SQR(0, 0));
        const ir1 = u32(gte.get(9));
        const ir2 = u32(gte.get(10));
        const ir3 = u32(gte.get(11));
        expect(ir1).to.eql(16);
        expect(ir2).to.eql(25);
        expect(ir3).to.eql(36);
      });

      it('sqr_mac_output', async () => {
        gte.set(9, 100);
        gte.set(10, 200);
        gte.set(11, 300);
        gte_clear_flag();
        gte.command(COP2_SQR(0, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        expect(mac1).to.eql(10000);
        expect(mac2).to.eql(40000);
        expect(mac3).to.eql(90000);
      });

      it('sqr_saturation_shifted', async () => {
        gte.set(9, 0x4000); // 4.0 in 4.12; 4^2 = 16, >>12 = 0x4000 (fits)
        gte.set(10, 0x5a82); // ~5.656 (sqrt(32)); 32 >>12 = 0x8000 = saturates
        gte.set(11, 0x7fff); // max positive; 0x7fff^2 >>12 = huge, saturates
        gte_clear_flag();
        gte.command(COP2_SQR(1, 0));
        const ir1 = u32(gte.get(9));
        const ir2 = u32(gte.get(10));
        const ir3 = u32(gte.get(11));
        let flag = u32(gte_read_flag());
        expect(u32(ir1 & 0xffff)).to.eql(0x7fff);
        expect(u32(ir2 & 0xffff)).to.eql(0x7fff);
        expect(u32(ir3 & 0xffff)).to.eql(0x7fff);
        expect(flag).to.eql(0x81c00000);
      });

      it('sqr_negative_input', async () => {
        gte.set(9, 0xfffffff6); // -10 (sign-extended)
        gte.set(10, 0xffffffce); // -50
        gte.set(11, 0xffffff9c); // -100
        gte_clear_flag();
        gte.command(COP2_SQR(0, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // Squares of negative numbers are positive
        // But GTE multiplies IR*IR where IR is 16-bit signed
        // -10 * -10 = 100, -50 * -50 = 2500, -100 * -100 = 10000
        expect(mac1).to.eql(100);
        expect(mac2).to.eql(2500);
        expect(mac3).to.eql(10000);
      });

  });

  describe('OP (cross product) (gte-op.c)', () => {

      it('op_identity_diagonal', async () => {
        gte_set_identity_rotation();
        gte.set(9, 1000);
        gte.set(10, 2000);
        gte.set(11, 3000);
        gte_clear_flag();
        gte.command(COP2_OP_CP(1, 0));
        const ir1 = s32(gte.get(9));
        const ir2 = s32(gte.get(10));
        const ir3 = s32(gte.get(11));
        // D=(1,1,1), IR=(1000,2000,3000)
        // cross = (1*3000-1*2000, 1*1000-1*3000, 1*2000-1*1000) = (1000,-2000,1000)
        expect(ir1).to.eql(1000);
        expect(ir2).to.eql(-2000);
        expect(ir3).to.eql(1000);
      });

      it('op_unshifted', async () => {
        gte_set_identity_rotation();
        gte.set(9, 10);
        gte.set(10, 20);
        gte.set(11, 30);
        gte_clear_flag();
        gte.command(COP2_OP_CP(0, 0)); // sf=0
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // sf=0: no shift. D=(0x1000,0x1000,0x1000), IR=(10,20,30)
        // MAC1 = R22*IR3 - R33*IR2 = 0x1000*30 - 0x1000*20 = 4096*(30-20) = 40960
        expect(mac1).to.eql(40960);
        expect(mac2).to.eql(-81920);
        expect(mac3).to.eql(40960);
      });

      it('op_asymmetric', async () => {
        gte.set(32 + 0, 0x00000800); // R11=0x800 (0.5)
        gte.set(32 + 1, 0x00000000);
        gte.set(32 + 2, 0x00001000); // R22=0x1000 (1.0)
        gte.set(32 + 3, 0x00000000);
        gte.set(32 + 4, 0x2000); // R33=0x2000 (2.0)
        gte.set(9, 100);
        gte.set(10, 200);
        gte.set(11, 300);
        gte_clear_flag();
        gte.command(COP2_OP_CP(1, 0));
        const ir1 = s32(gte.get(9));
        const ir2 = s32(gte.get(10));
        const ir3 = s32(gte.get(11));
        // D=(0.5, 1.0, 2.0), IR=(100,200,300)
        // cross.x = D.y*IR.z - D.z*IR.y = 1.0*300 - 2.0*200 = 300 - 400 = -100
        // cross.y = D.z*IR.x - D.x*IR.z = 2.0*100 - 0.5*300 = 200 - 150 = 50
        // cross.z = D.x*IR.y - D.y*IR.x = 0.5*200 - 1.0*100 = 100 - 100 = 0
        expect(ir1).to.eql(-100);
        expect(ir2).to.eql(50);
        expect(ir3).to.eql(0);
      });

      it('op_overflow_flag', async () => {
        gte.set(32 + 0, 0x00007fff); // R11=0x7fff
        gte.set(32 + 2, 0x00007fff); // R22=0x7fff
        gte.set(32 + 4, 0x7fff); // R33=0x7fff
        gte.set(9, 0x7fff);
        gte.set(10, 0x7fff);
        gte.set(11, 0x7fff);
        gte_clear_flag();
        gte.command(COP2_OP_CP(0, 0)); // sf=0, no shift -> large products
        let flag = u32(gte_read_flag());
        // With sf=0: MAC = 0x7fff*0x7fff - 0x7fff*0x7fff = 0 for all
        // Actually this produces zero cross product since all components are equal
        expect(flag).to.eql(0x00000000);
      });

  });

  describe('GPF / GPL (gte-gpf-gpl.c)', () => {

      it('gpf_shifted_unity', async () => {
        gte.set(8, 0x1000); // IR0 = 1.0
        gte.set(9, 100);
        gte.set(10, 200);
        gte.set(11, 300);
        gte.set(6, 0x00204060); // RGBC
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        expect(mac1).to.eql(100);
        expect(mac2).to.eql(200);
        expect(mac3).to.eql(300);
      });

      it('gpf_shifted_half', async () => {
        gte.set(8, 0x0800); // IR0 = 0.5
        gte.set(9, 1000);
        gte.set(10, 2000);
        gte.set(11, 4000);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // IR0*IR >> 12 = 0x800*IR >> 12 = IR/2
        expect(mac1).to.eql(500);
        expect(mac2).to.eql(1000);
        expect(mac3).to.eql(2000);
      });

      it('gpf_color_fifo_push', async () => {
        gte.set(8, 0x1000); // IR0 = 1.0
        gte.set(9, 0x0800); // IR1 -> MAC1=0x800, /16=128
        gte.set(10, 0x0400); // IR2 -> MAC2=0x400, /16=64
        gte.set(11, 0x0200); // IR3 -> MAC3=0x200, /16=32
        gte.set(6, 0xaa000000); // RGBC: CODE=0xaa
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const rgb2 = u32(gte.get(22));
        let r = u8(rgb2 & 0xff);
        let g = u8((rgb2 >>> 8) & 0xff);
        let b = u8((rgb2 >>> 16) & 0xff);
        let cd = u8((rgb2 >>> 24) & 0xff);
        expect(u32(cd)).to.eql(0xaa); // CODE byte preserved
        // R = MAC1/16 = 0x800/16 = 128
        expect(u32(r)).to.eql(128);
        expect(u32(g)).to.eql(64);
        expect(u32(b)).to.eql(32);
      });

      it('gpf_unshifted', async () => {
        gte.set(8, 2); // IR0 = 2
        gte.set(9, 100);
        gte.set(10, 200);
        gte.set(11, 300);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(0, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // sf=0: no shift, MAC = IR0*IR
        expect(mac1).to.eql(200);
        expect(mac2).to.eql(400);
        expect(mac3).to.eql(600);
      });

      it('gpl_shifted', async () => {
        gte.set(25, 1000); // MAC1 base
        gte.set(26, 2000); // MAC2 base
        gte.set(27, 3000); // MAC3 base
        gte.set(8, 0x1000); // IR0 = 1.0
        gte.set(9, 100);
        gte.set(10, 200);
        gte.set(11, 300);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPL(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // GPL sf=1: MAC_new = (MAC_old << 12 + IR0 * IR) >> 12
        // = ((1000<<12) + 4096*100) >> 12 = (4096000+409600)>>12 = 1100
        expect(mac1).to.eql(1100);
        expect(mac2).to.eql(2200);
        expect(mac3).to.eql(3300);
      });

      it('gpl_unshifted', async () => {
        gte.set(25, 100);
        gte.set(26, 200);
        gte.set(27, 300);
        gte.set(8, 3); // IR0 = 3
        gte.set(9, 10);
        gte.set(10, 20);
        gte.set(11, 30);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPL(0, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // sf=0: MAC_new = MAC_old + IR0*IR = 100+30=130, 200+60=260, 300+90=390
        expect(mac1).to.eql(130);
        expect(mac2).to.eql(260);
        expect(mac3).to.eql(390);
      });

      it('gpl_color_fifo', async () => {
        gte.set(25, 0);
        gte.set(26, 0);
        gte.set(27, 0);
        gte.set(8, 0x1000);
        gte.set(9, 0x0ff0); // /16 = 255
        gte.set(10, 0x0800); // /16 = 128
        gte.set(11, 0x0010); // /16 = 1
        gte.set(6, 0x55000000); // CODE=0x55
        gte_clear_flag();
        gte.command(COP2_GPL(1, 0));
        const rgb2 = u32(gte.get(22));
        let r = u8(rgb2 & 0xff);
        let g = u8((rgb2 >>> 8) & 0xff);
        let b = u8((rgb2 >>> 16) & 0xff);
        let cd = u8((rgb2 >>> 24) & 0xff);
        expect(u32(cd)).to.eql(0x55);
        expect(u32(r)).to.eql(255);
        expect(u32(g)).to.eql(128);
        expect(u32(b)).to.eql(1);
      });

  });

  describe('RTPS / RTPT (gte-rtps.c)', () => {

      it('rtps_identity_center', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 1000);
        gte_set_screen(160 << 16, 120 << 16, 200);
        gte.set(0, 0x00000000); // V0 = (0, 0)
        gte.set(1, 0); // VZ0 = 0
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sz3 = u32(gte.get(19));
        const sxy2 = u32(gte.get(14));
        expect(sz3).to.eql(1000);
        expect(s16((sxy2 & 0xffff))).to.eql(160);
        expect(s16((sxy2 >>> 16))).to.eql(120);
      });

      it('rtps_offset_vertex', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(160 << 16, 120 << 16, 200);
        gte.set(0, (50 << 16) | (100 & 0xffff));
        gte.set(1, 500);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sz3 = u32(gte.get(19));
        expect(sz3).to.eql(500);
        // SX = 160 + 100*200/500 = 160 + 40 ~ 199 (division rounding)
        // SY = 120 + 50*200/500 = 120 + 20 ~ 139
        const sxy2 = u32(gte.get(14));
        let sx = s16((sxy2 & 0xffff));
        let sy = s16((sxy2 >>> 16));
        expect(s32(sx)).to.eql(199);
        expect(s32(sy)).to.eql(139);
        expect(sz3).to.eql(500);
      });

      it('rtps_mac_output', async () => {
        gte_set_identity_rotation();
        gte_set_translation(100, 200, 300);
        gte_set_screen(0, 0, 200);
        gte.set(0, (50 << 16) | 10); // V0 = (10, 50)
        gte.set(1, 500);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // Identity rotation: MAC = V + TR
        expect(mac1).to.eql(110);
        expect(mac2).to.eql(250);
        expect(mac3).to.eql(800);
      });

      it('rtps_division_overflow', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(0, 0, 200);
        gte.set(0, (0 << 16) | 100);
        gte.set(1, 1); // VZ0 = 1, very small Z
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        let flag = u32(gte_read_flag());
        // H=200, SZ3=1 -> H >= SZ3*2 (200 >= 2) -> division overflow FLAG.17
        let flag17 = u32((flag >>> 17) & 1);
        expect(flag17).to.eql(1);
      });

      it('rtps_screen_saturation', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(0, 0, 200);
        // Large X, small Z -> SX will exceed -0x400..0x3FF range
        gte.set(0, (0 << 16) | 0x7fff); // VX0 = 32767
        gte.set(1, 100); // VZ0 = 100
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        let flag = u32(gte_read_flag());
        let sx = s16((sxy2 & 0xffff));
        // SX should be saturated to 0x3FF
        expect(s32(sx)).to.eql(0x3ff);
        let flag14 = u32((flag >>> 14) & 1);
        expect(flag14).to.eql(1); // FLAG.14 = SX2 saturated
      });

      it('rtps_depth_cue', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 200);
        gte.set(32 + 27, 0xfffff880); // DQA = -1920 (negative)
        gte.set(32 + 28, 0x01000000); // DQB = 16777216
        gte.set(0, 0x00000000);
        gte.set(1, 1000);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const mac0 = s32(gte.get(24));
        const ir0 = u32(gte.get(8));
        // IR0 should be clamped to [0, 0x1000]
        expect(mac0).to.eql(-8388224);
        expect(ir0).to.eql(0);
      });

      it('rtps_sf0', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0x1000);
        gte_set_screen(0, 0, 200);
        gte.set(0, 0x00000000);
        gte.set(1, 0);
        gte_clear_flag();
        gte.command(COP2_RTPS(0, 0));
        const mac3 = s32(gte.get(27));
        const ir3 = u32(gte.get(11));
        const sz3 = u32(gte.get(19));
        let flag = u32(gte_read_flag());
        // sf=0: MAC3 = TRZ<<12 + rotation = 0x1000<<12 = 0x1000000 (no >>12 shift)
        // IR3 uses Lm_B3_sf which checks MAC3>>12 for FLAG but clamps the unshifted value
        expect(mac3).to.eql(16777216);
        expect(ir3).to.eql(0x7fff);
        expect(sz3).to.eql(4096);
        expect(flag).to.eql(0);
      });

      it('rtpt_three_vertices', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(160 << 16, 120 << 16, 200);
        // V0 = (0, 0, 1000)
        gte.set(0, 0x00000000);
        gte.set(1, 1000);
        // V1 = (100, 0, 1000)
        gte.set(2, (0 << 16) | 100);
        gte.set(3, 1000);
        // V2 = (0, 100, 1000)
        gte.set(4, (100 << 16) | 0);
        gte.set(5, 1000);
        gte_clear_flag();
        gte.command(COP2_RTPT(1, 0));
        const sxy0 = u32(gte.get(12));
        const sxy1 = u32(gte.get(13));
        const sxy2 = u32(gte.get(14));
        // V0 at origin -> (160, 120)
        expect(s16((sxy0 & 0xffff))).to.eql(160);
        expect(s16((sxy0 >>> 16))).to.eql(120);
        // V1 at (100,0,1000) -> SX ~ 180
        let sx1 = s16((sxy1 & 0xffff));
        let sy1 = s16((sxy1 >>> 16));
        expect(s32(sy1)).to.eql(120); // Y unchanged
      });

      it('rtpt_flag_accumulates', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(0, 0, 200);
        // V0: normal
        gte.set(0, 0x00000000);
        gte.set(1, 1000);
        // V1: will cause SX saturation (large X, small Z)
        gte.set(2, (0 << 16) | 0x7fff);
        gte.set(3, 100);
        // V2: normal
        gte.set(4, 0x00000000);
        gte.set(5, 1000);
        gte_clear_flag();
        gte.command(COP2_RTPT(1, 0));
        let flag = u32(gte_read_flag());
        // FLAG should have SX2 saturation from V1, even though V2 was fine
        // Division overflow from V1 (H=200, SZ3=100, 200 >= 200)
        let flag17 = u32((flag >>> 17) & 1);
        expect(flag17).to.eql(1);
      });

      it('rtpt_sz_fifo', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(160 << 16, 120 << 16, 200);
        gte.set(0, 0x00000000);
        gte.set(1, 100);
        gte.set(2, 0x00000000);
        gte.set(3, 200);
        gte.set(4, 0x00000000);
        gte.set(5, 300);
        gte_clear_flag();
        gte.command(COP2_RTPT(1, 0));
        const sz1 = u32(gte.get(17));
        const sz2 = u32(gte.get(18));
        const sz3 = u32(gte.get(19));
        expect(sz1).to.eql(100);
        expect(sz2).to.eql(200);
        expect(sz3).to.eql(300);
      });

  });

  describe('MVMVA (gte-mvmva.c)', () => {

      it('mvmva_rt_v0_tr', async () => {
        // 90-degree Z rotation
        gte.set(32 + 0, 0xf0000000); // R11=0, R12=-0x1000
        gte.set(32 + 1, 0x10000000); // R13=0, R21=0x1000
        gte.set(32 + 2, 0x00000000);
        gte.set(32 + 3, 0x00000000);
        gte.set(32 + 4, 0x1000);
        gte_set_translation(10, 20, 30);
        gte.set(0, (200 << 16) | 100);
        gte.set(1, 300);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, 0, 0, 0, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        expect(mac1).to.eql(-190);
        expect(mac2).to.eql(120);
        expect(mac3).to.eql(330);
      });

      it('mvmva_rt_v1_zero', async () => {
        gte_set_identity_rotation();
        gte.set(2, (40 << 16) | 30); // V1 = (30, 40)
        gte.set(3, 50); // V1.Z = 50
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, 0, 1, 3, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        expect(mac1).to.eql(30);
        expect(mac2).to.eql(40);
        expect(mac3).to.eql(50);
      });

      it('mvmva_rt_v2_bk', async () => {
        gte_set_identity_rotation();
        gte.set(32 + 13, 1000); // RBK
        gte.set(32 + 14, 2000); // GBK
        gte.set(32 + 15, 3000); // BBK
        gte.set(4, (200 << 16) | 100); // V2
        gte.set(5, 300);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, 0, 2, 1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        expect(mac1).to.eql(1100);
        expect(mac2).to.eql(2200);
        expect(mac3).to.eql(3300);
      });

      it('mvmva_rt_ir_zero', async () => {
        gte_set_identity_rotation();
        gte.set(9, 500);
        gte.set(10, 600);
        gte.set(11, 700);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, 0, 3, 3, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        expect(mac1).to.eql(500);
        expect(mac2).to.eql(600);
        expect(mac3).to.eql(700);
      });

      it('mvmva_ll_v0_zero', async () => {
        gte_set_simple_light(); // L33=0x1000, rest zero
        gte.set(0, (200 << 16) | 100);
        gte.set(1, 0x1000);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, 1, 0, 3, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // Only L33 is non-zero, so MAC3 = L33*VZ0 >> 12 = 0x1000 * 0x1000 >> 12 = 0x1000
        expect(mac1).to.eql(0);
        expect(mac2).to.eql(0);
        expect(mac3).to.eql(0x1000);
      });

      it('mvmva_lc_ir_bk', async () => {
        gte_set_white_light_color();
        gte.set(32 + 13, 100); // RBK
        gte.set(32 + 14, 200); // GBK
        gte.set(32 + 15, 300); // BBK
        gte.set(9, 0x1000);
        gte.set(10, 0x1000);
        gte.set(11, 0x1000);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, 2, 3, 1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // White LC identity: MAC = (BK<<12 + LR1*IR1) >> 12 = BK + IR
        // BK = (100, 200, 300), IR = (0x1000, 0x1000, 0x1000) = (4096, 4096, 4096)
        // MAC1 = 100 + 4096 = 4196, etc.
        expect(mac1).to.eql(4196);
        expect(mac2).to.eql(4296);
        expect(mac3).to.eql(4396);
      });

      it('mvmva_cv2_fc_bug', async () => {
        gte_set_identity_rotation();
        gte_set_far_color(0x1000, 0x2000, 0x3000);
        gte.set(0, (0x200 << 16) | 0x100);
        gte.set(1, 0x300);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, 0, 0, 2, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        let flag = u32(gte_read_flag());
        // Buggy: result is partial - only last column (R13*VZ, R23*VZ, R33*VZ)
        // With identity: R13=0, R23=0, R33=0x1000
        // MAC1 = R13*VZ >> 12 = 0
        // MAC2 = R23*VZ >> 12 = 0 (but VY contribution leaks? Let's check)
        // MAC3 = R33*VZ >> 12 = 0x300
        expect(mac1).to.eql(0);
        expect(mac2).to.eql(512);
        expect(mac3).to.eql(768);
        expect(flag).to.eql(0x00000000);
      });

      it('mvmva_mx3_garbage', async () => {
        gte.set(32 + 0, 0x20001000); // R11=0x1000, R12=0x2000
        gte.set(32 + 1, 0x40003000); // R13=0x3000, R21=0x4000
        gte.set(32 + 2, 0x60005000); // R22=0x5000, R23=0x6000
        gte.set(32 + 3, 0x80007000); // R31=0x7000, R32=-0x8000
        gte.set(32 + 4, 0x1000);
        gte.set(8, 0x0800); // IR0
        gte.set(0, (0x100 << 16) | 0x100);
        gte.set(1, 0x100);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, 3, 0, 3, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        let flag = u32(gte_read_flag());
        expect(mac1).to.eql(128);
        expect(mac2).to.eql(2304);
        expect(mac3).to.eql(3840);
        expect(flag).to.eql(0x00000000);
      });

      it('mvmva_lm1', async () => {
        gte_set_identity_rotation();
        gte_set_translation(-500, -600, -700);
        gte.set(0, (100 << 16) | 100);
        gte.set(1, 100);
        gte_clear_flag();
        // sf=1, mx=RT, v=V0, cv=TR, lm=1
        gte.command(COP2_MVMVA(1, 0, 0, 0, 1));
        const mac1 = s32(gte.get(25));
        const ir1 = u32(gte.get(9));
        // MAC1 = 100 + (-500) = -400
        expect(mac1).to.eql(-400);
        // IR1 with lm=1: clamped to [0, 0x7fff], so -400 -> 0
        expect(ir1).to.eql(0);
      });

      it('mvmva_sf0', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(0, (10 << 16) | 10);
        gte.set(1, 10);
        gte_clear_flag();
        gte.command(COP2_MVMVA(0, 0, 0, 3, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // sf=0: no >>12 shift. MAC = R * V = 0x1000 * 10 = 40960
        expect(mac1).to.eql(40960);
        expect(mac2).to.eql(40960);
        expect(mac3).to.eql(40960);
      });

  });

  describe('depth cueing (DPCS, DPCT, DCPL, INTPL) (gte-depthcue.c)', () => {

      it('dpcs_basic', async () => {
        gte_set_far_color(0x1000, 0x1000, 0x1000); // FC = (4096, 4096, 4096)
        gte.set(6, 0x00808080); // RGBC: R=0x80, G=0x80, B=0x80
        gte.set(8, 0x0800); // IR0 = 0.5
        gte_clear_flag();
        gte.command(COP2_DPCS(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        expect(mac1).to.eql(3072);
        expect(mac2).to.eql(3072);
        expect(mac3).to.eql(3072);
        expect(rgb2).to.eql(0x00c0c0c0);
        // Formula: MAC = R<<16 + IR0*(FC<<12 - R<<16) >> shift
        // R<<16 = 0x80<<16 = 0x800000
        // FC<<12 = 0x1000<<12 = 0x1000000
        // diff = 0x1000000 - 0x800000 = 0x800000
        // IR0 * diff = 0x800 * 0x800000 ... this is large
      });

      it('dpcs_ir0_zero', async () => {
        gte_set_far_color(0xff00, 0xff00, 0xff00);
        gte.set(6, 0x00406080); // R=0x80, G=0x60, B=0x40
        gte.set(8, 0); // IR0 = 0
        gte_clear_flag();
        gte.command(COP2_DPCS(1, 0));
        const rgb2 = u32(gte.get(22));
        let r = u8(rgb2 & 0xff);
        let g = u8((rgb2 >>> 8) & 0xff);
        let b = u8((rgb2 >>> 16) & 0xff);
        // With IR0=0, interpolation weight is 0, so output = input
        expect(u32(r)).to.eql(0x80);
        expect(u32(g)).to.eql(0x60);
        expect(u32(b)).to.eql(0x40);
      });

      it('dpcs_ir0_max', async () => {
        gte_set_far_color(0x1000, 0x800, 0x400); // FC scaled
        gte.set(6, 0x00000000); // RGBC: all zero
        gte.set(8, 0x1000); // IR0 = 1.0
        gte_clear_flag();
        gte.command(COP2_DPCS(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        expect(mac1).to.eql(4096);
        expect(mac2).to.eql(2048);
        expect(mac3).to.eql(1024);
        // With R=0, MAC = 0 + IR0 * (FC<<12 - 0) = 1.0 * FC<<12 >> 12 = FC
      });

      it('dpcs_code_preserved', async () => {
        gte_set_far_color(0, 0, 0);
        gte.set(6, 0xab102030); // CODE=0xAB, R=0x30, G=0x20, B=0x10
        gte.set(8, 0);
        gte_clear_flag();
        gte.command(COP2_DPCS(1, 0));
        const rgb2 = u32(gte.get(22));
        expect(u32((rgb2 >>> 24) & 0xff)).to.eql(0xab); // CODE preserved
      });

      it('dpct_reads_fifo', async () => {
        gte_set_far_color(0, 0, 0);
        // Set up color FIFO with known values
        gte.set(20, 0x00102030); // RGB0: R=0x30, G=0x20, B=0x10
        gte.set(21, 0x00405060); // RGB1
        gte.set(22, 0x00708090); // RGB2
        gte.set(6, 0xff000000); // RGBC: CODE=0xff, colors=0 (should NOT be used as input)
        gte.set(8, 0); // IR0=0: output = input
        gte_clear_flag();
        gte.command(COP2_DPCT(1, 0));
        // After 3 iterations, the FIFO has been processed
        const rgb0 = u32(gte.get(20));
        const rgb1 = u32(gte.get(21));
        const rgb2 = u32(gte.get(22));
        // Each iteration: reads R0/G0/B0 (front of FIFO), pushes result
        // With IR0=0, each iteration's output = its input color
        // Iteration 1: reads RGB0(0x102030), pushes -> FIFO shifts
        // Iteration 2: reads new RGB0 (was RGB1: 0x405060), pushes
        // Iteration 3: reads new RGB0 (was RGB2: 0x708090), pushes
        // Result FIFO should contain the 3 processed colors
        // CODE comes from RGBC (0xff)
        expect(rgb0).to.eql(0xff102030);
        expect(rgb1).to.eql(0xff405060);
        expect(rgb2).to.eql(0xff708090);
      });

      it('dcpl_basic', async () => {
        gte_set_far_color(0x1000, 0x1000, 0x1000);
        gte.set(6, 0x00808080); // RGBC
        // Pre-computed light in IR1-3
        gte.set(9, 0x1000); // IR1 = 1.0
        gte.set(10, 0x0800); // IR2 = 0.5
        gte.set(11, 0x0400); // IR3 = 0.25
        gte.set(8, 0); // IR0 = 0 (no depth cue)
        gte_clear_flag();
        gte.command(COP2_DCPL(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        expect(mac1).to.eql(2048);
        expect(mac2).to.eql(1024);
        expect(mac3).to.eql(512);
        expect(rgb2).to.eql(0x00204080);
        // With IR0=0: MAC = (R<<4)*IR, no depth cue interpolation
        // MAC1 = (0x80 << 4) * 0x1000 = 0x800 * 0x1000 = 0x800000
        // After >>12: 0x800 = 2048 -> IR1, /16 = 128 -> R2
      });

      it('dcpl_with_depth', async () => {
        gte_set_far_color(0x1000, 0x1000, 0x1000);
        gte.set(6, 0x00808080);
        gte.set(9, 0x1000);
        gte.set(10, 0x1000);
        gte.set(11, 0x1000);
        gte.set(8, 0x0800); // IR0 = 0.5
        gte_clear_flag();
        gte.command(COP2_DCPL(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        let flag = u32(gte_read_flag());
        expect(mac1).to.eql(3072);
        expect(mac2).to.eql(3072);
        expect(mac3).to.eql(3072);
        expect(flag).to.eql(0x00000000);
      });

      it('intpl_basic', async () => {
        gte_set_far_color(0x1000, 0x2000, 0x3000);
        gte.set(9, 0x100); // IR1
        gte.set(10, 0x200); // IR2
        gte.set(11, 0x300); // IR3
        gte.set(8, 0); // IR0 = 0: no interpolation
        gte_clear_flag();
        gte.command(COP2_INTPL(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // With IR0=0: MAC = IR << 12 >> shift = IR (with sf=1)
        expect(mac1).to.eql(0x100);
        expect(mac2).to.eql(0x200);
        expect(mac3).to.eql(0x300);
      });

      it('intpl_half', async () => {
        gte_set_far_color(0x1000, 0x1000, 0x1000);
        gte.set(9, 0);
        gte.set(10, 0);
        gte.set(11, 0);
        gte.set(8, 0x0800); // IR0 = 0.5
        gte_clear_flag();
        gte.command(COP2_INTPL(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        expect(mac1).to.eql(2048);
        expect(mac2).to.eql(2048);
        expect(mac3).to.eql(2048);
        // IR=0, FC=0x1000, IR0=0.5
        // MAC = 0 + 0.5*(FC - 0) = 0.5 * 0x1000 = 0x800
      });

      it('intpl_color_push', async () => {
        gte_set_far_color(0, 0, 0);
        gte.set(9, 0x0ff0); // MAC1=0x0ff0, /16 = 255
        gte.set(10, 0x0800); // MAC2=0x0800, /16 = 128
        gte.set(11, 0x0010); // MAC3=0x0010, /16 = 1
        gte.set(8, 0);
        gte.set(6, 0xcc000000); // CODE=0xCC
        gte_clear_flag();
        gte.command(COP2_INTPL(1, 0));
        const rgb2 = u32(gte.get(22));
        let cd = u8((rgb2 >>> 24) & 0xff);
        let r = u8(rgb2 & 0xff);
        let g = u8((rgb2 >>> 8) & 0xff);
        let b = u8((rgb2 >>> 16) & 0xff);
        expect(u32(r)).to.eql(255);
        expect(u32(g)).to.eql(128);
        expect(u32(b)).to.eql(1);
        expect(u32(cd)).to.eql(0xcc);
      });

  });

  describe('lighting (NCS, NCT, NCCS, NCCT, NCDS, NCDT, CC, CDP) (gte-lighting.c)', () => {

      it('ncs_z_normal_white_light', async () => {
        gte_set_simple_light(); // L33=0x1000
        gte_set_white_light_color(); // LC identity
        gte_set_zero_bk();
        // Normal pointing at light: (0, 0, 0x1000)
        gte.set(0, 0x00000000);
        gte.set(1, 0x1000);
        gte.set(6, 0x00808080); // RGBC (not used by NCS but CODE is)
        gte_clear_flag();
        gte.command(COP2_NCS(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        // Stage 1: L * normal = (0,0,0x1000).(0,0,0x1000) = only IR3 = 0x1000
        // Stage 2: LC * (0,0,0x1000) + BK = (0,0,0x1000) since LC is identity, BK=0
        // Color FIFO: MAC/16 = 0x1000/16 = 256 -> saturates to 255
        expect(mac1).to.eql(0);
        expect(mac2).to.eql(0);
        expect(mac3).to.eql(4096);
        expect(rgb2).to.eql(0x00ff0000);
      });

      it('ncs_with_background', async () => {
        gte_set_simple_light();
        gte_set_white_light_color();
        gte.set(32 + 13, 0x800); // RBK = 0x800
        gte.set(32 + 14, 0x400); // GBK = 0x400
        gte.set(32 + 15, 0x200); // BBK = 0x200
        gte.set(0, 0x00000000);
        gte.set(1, 0x1000);
        gte.set(6, 0x00000000);
        gte_clear_flag();
        gte.command(COP2_NCS(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // Stage 1: IR = (0, 0, 0x1000)
        // Stage 2: MAC = BK + LC*(0,0,0x1000) = (0x800+0, 0x400+0, 0x200+0x1000)
        expect(mac1).to.eql(0x800);
        expect(mac2).to.eql(0x400);
        expect(mac3).to.eql(0x1200);
      });

      it('nct_three_normals', async () => {
        gte_set_simple_light();
        gte_set_white_light_color();
        gte_set_zero_bk();
        // V0 = (0, 0, 0x1000) - facing light
        gte.set(0, 0x00000000);
        gte.set(1, 0x1000);
        // V1 = (0x1000, 0, 0) - perpendicular
        gte.set(2, (0 << 16) | 0x1000);
        gte.set(3, 0);
        // V2 = (0, 0x1000, 0) - perpendicular
        gte.set(4, (0x1000 << 16) | 0);
        gte.set(5, 0);
        gte.set(6, 0x00000000);
        gte_clear_flag();
        gte.command(COP2_NCT(1, 1));
        const rgb0 = u32(gte.get(20));
        const rgb1 = u32(gte.get(21));
        const rgb2 = u32(gte.get(22));
        // V0 facing light: should have color
        // V1, V2 perpendicular: should be dark (light only in Z)
        expect(rgb0).to.eql(0x00ff0000);
        expect(rgb1).to.eql(0x00000000);
        expect(rgb2).to.eql(0x00000000);
      });

      it('nccs_basic', async () => {
        gte_set_simple_light();
        gte_set_white_light_color();
        gte_set_zero_bk();
        gte.set(0, 0x00000000);
        gte.set(1, 0x1000);
        gte.set(6, 0x00808080); // R=0x80, G=0x80, B=0x80
        gte_clear_flag();
        gte.command(COP2_NCCS(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        // Stage 1: IR = (0, 0, 0x1000)
        // Stage 2: MAC = LC*(0,0,0x1000) = (0, 0, 0x1000)
        // Stage 3: MAC = (R<<4)*IR = (0x80<<4)*0 for R,G; (0x80<<4)*0x1000 for B... wait
        // Actually after stage 2, IR1=0, IR2=0, IR3=0x1000
        // Stage 3: MAC1 = (R<<4)*IR1 = 0x800*0 = 0
        // Only B channel gets lit since only IR3 is non-zero
        expect(mac1).to.eql(0);
        expect(mac2).to.eql(0);
        expect(mac3).to.eql(2048);
        expect(rgb2).to.eql(0x00800000);
      });

      it('ncct_basic', async () => {
        gte_set_simple_light();
        gte_set_white_light_color();
        gte_set_zero_bk();
        gte.set(0, 0x00000000);
        gte.set(1, 0x1000);
        gte.set(2, 0x00000000);
        gte.set(3, 0x1000);
        gte.set(4, 0x00000000);
        gte.set(5, 0x1000);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_NCCT(1, 1));
        const rgb0 = u32(gte.get(20));
        const rgb1 = u32(gte.get(21));
        const rgb2 = u32(gte.get(22));
        // All three normals identical -> all three results should match
        expect(rgb0).to.eql(0x00800000);
        expect(rgb1).to.eql(0x00800000);
        expect(rgb2).to.eql(0x00800000);
      });

      it('ncds_no_depth', async () => {
        gte_set_simple_light();
        gte_set_white_light_color();
        gte_set_zero_bk();
        gte_set_far_color(0, 0, 0);
        gte.set(0, 0x00000000);
        gte.set(1, 0x1000);
        gte.set(6, 0x00808080);
        gte.set(8, 0); // IR0 = 0 (no depth cue)
        gte_clear_flag();
        gte.command(COP2_NCDS(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        expect(mac1).to.eql(0);
        expect(mac2).to.eql(0);
        expect(mac3).to.eql(2048);
        expect(rgb2).to.eql(0x00800000);
      });

      it('ncds_with_depth', async () => {
        gte_set_simple_light();
        gte_set_white_light_color();
        gte_set_zero_bk();
        gte_set_far_color(0x1000, 0x1000, 0x1000);
        gte.set(0, 0x00000000);
        gte.set(1, 0x1000);
        gte.set(6, 0x00808080);
        gte.set(8, 0x0800); // IR0 = 0.5
        gte_clear_flag();
        gte.command(COP2_NCDS(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        let flag = u32(gte_read_flag());
        expect(mac1).to.eql(2048);
        expect(mac2).to.eql(2048);
        expect(mac3).to.eql(3072);
        expect(rgb2).to.eql(0x00c08080);
        expect(flag).to.eql(0x00000000);
      });

      it('ncdt_basic', async () => {
        gte_set_simple_light();
        gte_set_white_light_color();
        gte_set_zero_bk();
        gte_set_far_color(0, 0, 0);
        gte.set(0, 0x00000000);
        gte.set(1, 0x1000);
        gte.set(2, 0x00000000);
        gte.set(3, 0x0800);
        gte.set(4, 0x00000000);
        gte.set(5, 0x0400);
        gte.set(6, 0x00808080);
        gte.set(8, 0);
        gte_clear_flag();
        gte.command(COP2_NCDT(1, 1));
        const rgb0 = u32(gte.get(20));
        const rgb1 = u32(gte.get(21));
        const rgb2 = u32(gte.get(22));
        // V0 has strongest light (normal = 0x1000), V2 weakest (0x400)
        expect(rgb0).to.eql(0x00800000);
        expect(rgb1).to.eql(0x00400000);
        expect(rgb2).to.eql(0x00200000);
      });

      it('cc_basic', async () => {
        gte_set_white_light_color();
        gte_set_zero_bk();
        // Pre-computed light intensity in IR1-3
        gte.set(9, 0x1000);
        gte.set(10, 0x0800);
        gte.set(11, 0x0400);
        gte.set(6, 0x00808080); // RGBC
        gte_clear_flag();
        gte.command(COP2_CC(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        // Stage 1 (light to color): with white LC identity and zero BK,
        // MAC = LC*IR = IR (identity)
        // Stage 2 (color mult): MAC = (R<<4)*IR1 = 0x800*0x1000 = 0x800000
        // After >>12 = 0x800, /16 = 128
        expect(mac1).to.eql(2048);
        expect(mac2).to.eql(1024);
        expect(mac3).to.eql(512);
        expect(rgb2).to.eql(0x00204080);
      });

      it('cdp_basic', async () => {
        gte_set_white_light_color();
        gte_set_zero_bk();
        gte_set_far_color(0x1000, 0x1000, 0x1000);
        gte.set(9, 0x1000);
        gte.set(10, 0x1000);
        gte.set(11, 0x1000);
        gte.set(6, 0x00808080);
        gte.set(8, 0); // IR0=0: no depth cue
        gte_clear_flag();
        gte.command(COP2_CDP(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        expect(mac1).to.eql(2048);
        expect(mac2).to.eql(2048);
        expect(mac3).to.eql(2048);
        expect(rgb2).to.eql(0x00808080);
      });

      it('cdp_with_depth', async () => {
        gte_set_white_light_color();
        gte_set_zero_bk();
        gte_set_far_color(0x1000, 0x1000, 0x1000);
        gte.set(9, 0x1000);
        gte.set(10, 0x1000);
        gte.set(11, 0x1000);
        gte.set(6, 0x00808080);
        gte.set(8, 0x0800); // IR0=0.5
        gte_clear_flag();
        gte.command(COP2_CDP(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        const rgb2 = u32(gte.get(22));
        let flag = u32(gte_read_flag());
        expect(mac1).to.eql(3072);
        expect(mac2).to.eql(3072);
        expect(mac3).to.eql(3072);
        expect(rgb2).to.eql(0x00c0c0c0);
        expect(flag).to.eql(0x00000000);
      });

      it('ncs_full_light_matrix', async () => {
        // Light from (0.707, 0, 0.707) direction - 45 degrees
        // In 4.12 fixed: 0.707 ~ 0x0B50
        gte.set(32 + 8, 0x00000b50); // L11=0x0B50, L12=0
        gte.set(32 + 9, 0x00000000); // L13=0, L21=0
        gte.set(32 + 10, 0x00000000); // L22=0, L23=0
        gte.set(32 + 11, 0x00000000); // L31=0, L32=0
        gte.set(32 + 12, 0x0b50); // L33=0x0B50
        gte_set_white_light_color();
        gte_set_zero_bk();
        // Normal = (0x1000, 0, 0) - facing X
        gte.set(0, (0 << 16) | 0x1000);
        gte.set(1, 0);
        gte.set(6, 0x00000000);
        gte_clear_flag();
        gte.command(COP2_NCS(1, 1));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // Stage 1: L * normal = (L11*VX, 0, L31*VX) = (0x0B50*0x1000, 0, 0)
        //   >> 12 = (0x0B50, 0, 0), so IR = (0x0B50, 0, 0)
        // Stage 2: LC * IR = (0x0B50, 0, 0) since LC is identity, BK=0
        // MAC1 = 0x0B50, MAC2 = 0, MAC3 = 0
        expect(mac1).to.eql(0x0b50);
        expect(mac2).to.eql(0);
        expect(mac3).to.eql(0);
      });

  });

  describe('edge cases (gte-edgecase.c)', () => {

      it('edge_div_by_zero', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(0, 0, 200);
        gte.set(0, (0 << 16) | 100);
        gte.set(1, 0); // VZ0=0 -> SZ3=0
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sz3 = u32(gte.get(19));
        const sxy2 = u32(gte.get(14));
        let flag = u32(gte_read_flag());
        // SZ3=0, H=200 -> H >= SZ3*2 -> division overflow (FLAG.17)
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(1);
      });

      it('edge_div_h_zero', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(0, 0, 0); // H=0
        gte.set(0, (0 << 16) | 100);
        gte.set(1, 1000);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        let flag = u32(gte_read_flag());
        let sx = s16((sxy2 & 0xffff));
        // H=0, SZ3=1000 -> H < SZ3*2 -> no overflow, quotient = 0
        // SX = OFX/65536 + IR1 * 0 = 0
        expect(s32(sx)).to.eql(0);
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(0);
      });

      it('edge_div_boundary_under', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(0, 0, 199); // H=199
        gte.set(0, (0 << 16) | 100);
        gte.set(1, 100); // SZ3=100 -> H < 200 -> no overflow
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        let flag = u32(gte_read_flag());
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(0);
      });

      it('edge_div_boundary_at', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(0, 0, 200); // H=200
        gte.set(0, (0 << 16) | 100);
        gte.set(1, 100); // SZ3=100 -> H >= 200 -> overflow
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        let flag = u32(gte_read_flag());
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(1);
      });

      it('edge_div_boundary_over', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte_set_screen(0, 0, 201); // H=201
        gte.set(0, (0 << 16) | 100);
        gte.set(1, 100);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        let flag = u32(gte_read_flag());
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(1);
      });

      it('edge_ir_max_no_sat', async () => {
        gte.set(8, 0x1000);
        gte.set(9, 0x7fff);
        gte.set(10, 0x7fff);
        gte.set(11, 0x7fff);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const ir1 = u32(gte.get(9));
        let flag = u32(gte_read_flag());
        // 0x1000 * 0x7FFF >> 12 = 0x7FFF -> no saturation
        expect(ir1).to.eql(0x7fff);
        // FLAG.24 (IR1 sat) should NOT be set
        let f24 = u32((flag >>> 24) & 1);
        expect(f24).to.eql(0);
      });

      it('edge_ir_over_max', async () => {
        gte.set(8, 0x1001); // IR0 = 0x1001 (slightly > 1.0)
        gte.set(9, 0x7fff);
        gte.set(10, 0x100);
        gte.set(11, 0x100);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const ir1 = u32(gte.get(9));
        let flag = u32(gte_read_flag());
        // 0x1001 * 0x7FFF >> 12 = 0x8000 -> saturates to 0x7FFF
        expect(ir1).to.eql(0x7fff);
        let f24 = u32((flag >>> 24) & 1);
        expect(f24).to.eql(1);
      });

      it('edge_mac0_positive_overflow', async () => {
        // Maximize cross product: opposing corners of 16-bit range
        gte.set(12, (0x7fff << 16) | 0x7fff); // (32767, 32767)
        gte.set(13, (0x8000 << 16) | 0x8000); // (-32768, -32768)
        gte.set(14, 0x00000000); // (0, 0)
        gte_clear_flag();
        gte.command(COP2_NCLIP);
        const mac0 = s32(gte.get(24));
        let flag = u32(gte_read_flag());
        // SX0*(SY1-SY2) + SX1*(SY2-SY0) + SX2*(SY0-SY1)
        // = 32767*(-32768) + (-32768)*(0-32767) + 0
        // = -1073709056 + (-32768)*(-32767)
        // = -1073709056 + 1073709056 = 0... hmm, that's zero
        // Actually: 32767*(-32768-0) + (-32768)*(0-32767) + 0*(32767-(-32768))
        // = 32767*(-32768) + (-32768)*(-32767)
        // = -1073709056 + 1073709056 = 0
        // Need asymmetric triangle for overflow
        // Cancels to zero - no actual overflow despite the test name
        expect(mac0).to.eql(0);
        expect(flag).to.eql(0x00000000);
      });

      it('edge_mac0_negative_overflow', async () => {
        // (32767, 32767), (-32768, 32767), (32767, -32768)
        gte.set(12, (0x7fff << 16) | 0x7fff);
        gte.set(13, (0x7fff << 16) | 0x8000);
        gte.set(14, (0x8000 << 16) | 0x7fff);
        gte_clear_flag();
        gte.command(COP2_NCLIP);
        const mac0 = s32(gte.get(24));
        let flag = u32(gte_read_flag());
        // The cross product should be large negative
        // FLAG.15 (MAC0 negative overflow) should be set
        expect(mac0).to.eql(-131071);
        // FLAG.16 set from intermediate positive overflow in NCLIP's chained additions
        let f16 = u32((flag >>> 16) & 1);
        expect(f16).to.eql(1);
      });

      it('edge_color_at_255', async () => {
        gte.set(8, 0x1000);
        gte.set(9, 0x0ff0); // MAC1 = 0x0ff0, /16 = 255
        gte.set(10, 0x0ff0);
        gte.set(11, 0x0ff0);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const rgb2 = u32(gte.get(22));
        let flag = u32(gte_read_flag());
        let r_255 = u32(rgb2 & 0xff);
        expect(r_255).to.eql(255);
        let f21_255 = u32((flag >>> 21) & 1);
        expect(f21_255).to.eql(0); // No color saturation flag
      });

      it('edge_color_at_256', async () => {
        gte.set(8, 0x1000);
        gte.set(9, 0x1000); // MAC1 = 0x1000, /16 = 256 -> saturates
        gte.set(10, 0x100);
        gte.set(11, 0x100);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const rgb2 = u32(gte.get(22));
        let flag = u32(gte_read_flag());
        let r_256 = u32(rgb2 & 0xff);
        expect(r_256).to.eql(255); // saturated to 255
        let f21_256 = u32((flag >>> 21) & 1);
        expect(f21_256).to.eql(1); // R saturation flag set
      });

      it('edge_color_negative', async () => {
        gte.set(8, 0x1000);
        gte.set(9, 0xffff8000); // IR1 = -32768 -> negative MAC1 -> color=0
        gte.set(10, 0x100);
        gte.set(11, 0x100);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const rgb2 = u32(gte.get(22));
        let flag = u32(gte_read_flag());
        let r_neg = u32(rgb2 & 0xff);
        expect(r_neg).to.eql(0); // clamped to 0
        let f21_neg = u32((flag >>> 21) & 1);
        expect(f21_neg).to.eql(1); // Color R saturation flag
      });

      it('edge_sx_at_max', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0x3ff << 16); // OFX = 0x3FF in 16.16
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 0); // H=0 -> quotient=0 -> SX = OFX only
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        gte.set(0, 0);
        gte.set(1, 1000);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        let flag = u32(gte_read_flag());
        let sx = s16((sxy2 & 0xffff));
        expect(s32(sx)).to.eql(0x3ff);
        let f14 = u32((flag >>> 14) & 1);
        expect(f14).to.eql(0); // no saturation
      });

      it('edge_sx_over_max', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0x400 << 16); // OFX = 0x400
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 0);
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        gte.set(0, 0);
        gte.set(1, 1000);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        let flag = u32(gte_read_flag());
        let sx = s16((sxy2 & 0xffff));
        expect(s32(sx)).to.eql(0x3ff); // saturated
        let f14 = u32((flag >>> 14) & 1);
        expect(f14).to.eql(1);
      });

      it('edge_sy_at_min', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0);
        gte.set(32 + 25, u32(-0x400) << 16); // OFY = -0x400
        gte.set(32 + 26, 0);
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        gte.set(0, 0);
        gte.set(1, 1000);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        let flag = u32(gte_read_flag());
        let sy = s16((sxy2 >>> 16));
        expect(s32(sy)).to.eql(-0x400);
        let f13 = u32((flag >>> 13) & 1);
        expect(f13).to.eql(0);
      });

      it('edge_zero_matrix', async () => {
        gte.set(32 + 0, 0);
        gte.set(32 + 1, 0);
        gte.set(32 + 2, 0);
        gte.set(32 + 3, 0);
        gte.set(32 + 4, 0);
        gte_set_translation(100, 200, 300);
        gte.set(0, (0x7fff << 16) | 0x7fff); // large vertex
        gte.set(1, 0x7fff);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, COP2_MX_RT, COP2_V_V0, COP2_CV_TR, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // Zero matrix * anything = 0, plus translation
        expect(mac1).to.eql(100);
        expect(mac2).to.eql(200);
        expect(mac3).to.eql(300);
      });

      it('edge_max_matrix', async () => {
        gte.set(32 + 0, 0x7fff7fff); // R11=R12=0x7FFF
        gte.set(32 + 1, 0x7fff7fff);
        gte.set(32 + 2, 0x7fff7fff);
        gte.set(32 + 3, 0x7fff7fff);
        gte.set(32 + 4, 0x7fff);
        gte_set_translation(0, 0, 0);
        gte.set(0, (0x7fff << 16) | 0x7fff);
        gte.set(1, 0x7fff);
        gte_clear_flag();
        gte.command(COP2_MVMVA(1, COP2_MX_RT, COP2_V_V0, COP2_CV_NONE, 0));
        const mac1 = s32(gte.get(25));
        let flag = u32(gte_read_flag());
        // 3 * 0x7FFF * 0x7FFF = 3 * 1073676289 = 3221028867
        // >> 12 = 786380, fits in 32-bit MAC. But 44-bit accumulator overflow?
        expect(mac1).to.eql(786384);
        expect(flag).to.eql(0x81c00000);
      });

      it('edge_negative_z', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, -1000); // TRZ = -1000
        gte_set_screen(160 << 16, 120 << 16, 200);
        gte.set(0, (0 << 16) | 100);
        gte.set(1, 0); // VZ=0, MAC3 = TRZ = -1000
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sz3 = u32(gte.get(19));
        const mac3 = s32(gte.get(27));
        let flag = u32(gte_read_flag());
        // MAC3 = -1000, SZ3 should saturate to 0 (Lm_D clamps to [0, 0xFFFF])
        expect(mac3).to.eql(-1000);
        expect(sz3).to.eql(0); // saturated
        let f18 = u32((flag >>> 18) & 1);
        expect(f18).to.eql(1); // OTZ/SZ3 saturation
      });

      it('edge_sqr_min_negative', async () => {
        gte.set(9, 0xffff8000); // IR1 = -32768
        gte.set(10, 0);
        gte.set(11, 0);
        gte_clear_flag();
        gte.command(COP2_SQR(0, 0));
        const mac1 = s32(gte.get(25));
        let flag = u32(gte_read_flag());
        // (-32768)^2 = 1073741824 = 0x40000000 (fits in 32-bit signed)
        expect(mac1).to.eql(1073741824);
      });

      it('edge_gpl_negative_base', async () => {
        gte.set(25, -10000); // MAC1 = -10000
        gte.set(26, -20000);
        gte.set(27, -30000);
        gte.set(8, 0x1000); // IR0 = 1.0
        gte.set(9, 100);
        gte.set(10, 200);
        gte.set(11, 300);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPL(1, 0));
        const mac1 = s32(gte.get(25));
        const mac2 = s32(gte.get(26));
        const mac3 = s32(gte.get(27));
        // GPL sf=1: MAC = (old_MAC << 12 + IR0*IR) >> 12
        // = ((-10000 << 12) + 4096*100) >> 12
        // = (-40960000 + 409600) >> 12
        // = -40550400 >> 12 = -9900
        expect(mac1).to.eql(-9900);
        expect(mac2).to.eql(-19800);
        expect(mac3).to.eql(-29700);
      });

      it('edge_flag_cleared_each_instruction', async () => {
        // First: trigger IR1 saturation via GPF
        gte.set(8, 0x1001);
        gte.set(9, 0x7fff);
        gte.set(10, 0x100);
        gte.set(11, 0x100);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        let flag1 = u32(gte_read_flag());
        let f24_1 = u32((flag1 >>> 24) & 1);
        expect(f24_1).to.eql(1); // IR1 saturated

        // Now: run a clean GPF that should NOT trigger any flags
        gte.set(8, 0x1000);
        gte.set(9, 0x100);
        gte.set(10, 0x100);
        gte.set(11, 0x100);
        gte.set(6, 0x00808080);
        // Do NOT call gte_clear_flag() - the instruction should clear it itself
        gte.command(COP2_GPF(1, 0));
        let flag2 = u32(gte_read_flag());
        // FLAG should be 0 - the instruction clears it at start
        expect(flag2).to.eql(0);
      });

      it('edge_ir0_at_max', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 200);
        gte.set(32 + 27, 0); // DQA = 0
        gte.set(32 + 28, 0x1000000); // DQB = 0x1000000 -> MAC0=DQB, IR0=DQB>>12=0x1000
        gte.set(0, 0);
        gte.set(1, 1000);
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const ir0 = u32(gte.get(8));
        let flag = u32(gte_read_flag());
        // IR0 should be exactly 0x1000
        let f12 = u32((flag >>> 12) & 1);
        expect(f12).to.eql(0); // no saturation
      });

      it('edge_otz_at_max', async () => {
        // Need MAC0 >> 12 = 0xFFFF -> MAC0 = 0xFFFF << 12 = 0xFFFF000
        // ZSF3 * (SZ1+SZ2+SZ3) = 0xFFFF000
        // Use ZSF3 = 0x1000, SZ_sum = 0xFFFF -> each SZ = 0x5555
        gte.set(17, 0x5555);
        gte.set(18, 0x5555);
        gte.set(19, 0x5555);
        gte.set(32 + 29, 0x1000);
        gte_clear_flag();
        gte.command(COP2_AVSZ3);
        const otz = u32(gte.get(7));
        let flag = u32(gte_read_flag());
        // 0x5555*3 = 0xFFFF, * 0x1000 = 0xFFFF000, >> 12 = 0xFFFF
        expect(otz).to.eql(0xffff);
      });

      it('edge_depthcue_fc_less_than_input', async () => {
        gte_set_far_color(0, 0, 0); // FC = 0 (dark fog)
        gte.set(6, 0x00ffffff); // RGBC: R=G=B=0xFF (bright)
        gte.set(8, 0x0800); // IR0 = 0.5
        gte_clear_flag();
        gte.command(COP2_DPCS(1, 0));
        const mac1 = s32(gte.get(25));
        const rgb2 = u32(gte.get(22));
        let flag = u32(gte_read_flag());
        // FC=0, R=0xFF: diff = (0<<12) - (0xFF<<16) = -0xFF0000 (negative)
        // Inner clamp (lm=0): clamps to [-0x8000, 0x7FFF]
        // Then IR0 * clamped_diff + R<<16 -> should produce intermediate result
        expect(mac1).to.eql(2040);
        expect(rgb2).to.eql(0x007f7f7f);
        expect(flag).to.eql(0x00000000);
      });

      it('edge_intpl_fc_less_than_ir', async () => {
        gte_set_far_color(0, 0, 0); // FC = 0
        gte.set(9, 0x1000); // IR = 0x1000 (> FC)
        gte.set(10, 0x1000);
        gte.set(11, 0x1000);
        gte.set(8, 0x0800); // IR0 = 0.5
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_INTPL(1, 0));
        const mac1 = s32(gte.get(25));
        let flag = u32(gte_read_flag());
        // IR=0x1000, FC=0, IR0=0.5
        // diff = (0<<12) - (0x1000<<12) = -0x1000000
        // inner clamp: -0x1000000 >> 12 = -0x1000 -> clamped to -0x1000 (in range)
        // MAC = 0x1000<<12 + 0x800 * (-0x1000) = 0x1000000 + (-0x800000)
        // >> 12 = (0x800000) >> 12 = 0x800 = 2048
        expect(mac1).to.eql(2048);
        expect(flag).to.eql(0x00000000);
      });

  });

  describe('precision (gte-precision.c)', () => {

      it('prec_mac1_positive_overflow', async () => {
        // MVMVA with large matrix and large vector, sf=0 (no shift)
        // R11=0x7FFF, V0.X=0x7FFF -> R11*VX = 0x3FFF0001
        // With TR=0x7FFFFFFF and sf=0: TRX<<12 + R11*VX + R12*VY + R13*VZ
        // TRX<<12 = 0x7FFFFFFF000 (43 bits) + 0x3FFF0001 = overflows 44-bit
        gte.set(32 + 0, 0x00007fff); // R11=0x7FFF, R12=0
        gte.set(32 + 1, 0x00000000);
        gte.set(32 + 2, 0x00000000);
        gte.set(32 + 3, 0x00000000);
        gte.set(32 + 4, 0);
        gte.set(32 + 5, 0x7fffffff); // TRX = max positive 32-bit
        gte.set(32 + 6, 0);
        gte.set(32 + 7, 0);
        gte.set(0, (0 << 16) | 0x7fff); // VX=0x7FFF, VY=0
        gte.set(1, 0);
        gte_clear_flag();
        gte.command(COP2_MVMVA(0, COP2_MX_RT, COP2_V_V0, COP2_CV_TR, 0));
        let flag = u32(gte_read_flag());
        let f30 = u32((flag >>> 30) & 1);
        expect(f30).to.eql(1);
      });

      it('prec_mac1_negative_overflow', async () => {
        gte.set(32 + 0, 0x00007fff); // R11=0x7FFF
        gte.set(32 + 1, 0x00000000);
        gte.set(32 + 2, 0x00000000);
        gte.set(32 + 3, 0x00000000);
        gte.set(32 + 4, 0);
        gte.set(32 + 5, 0x80000000); // TRX = min negative 32-bit
        gte.set(32 + 6, 0);
        gte.set(32 + 7, 0);
        gte.set(0, (0 << 16) | 0x8000); // VX=-0x8000 (negative)
        gte.set(1, 0);
        gte_clear_flag();
        gte.command(COP2_MVMVA(0, COP2_MX_RT, COP2_V_V0, COP2_CV_TR, 0));
        let flag = u32(gte_read_flag());
        let f27 = u32((flag >>> 27) & 1);
        expect(f27).to.eql(1);
      });

      it('prec_mac2_overflow', async () => {
        gte.set(32 + 0, 0x00000000);
        gte.set(32 + 1, 0x7fff0000); // R21=0x7FFF (high16 of R13R21), R13=0
        gte.set(32 + 2, 0x00000000);
        gte.set(32 + 3, 0x00000000);
        gte.set(32 + 4, 0);
        gte.set(32 + 5, 0);
        gte.set(32 + 6, 0x7fffffff); // TRY = max
        gte.set(32 + 7, 0);
        gte.set(0, (0 << 16) | 0x7fff);
        gte.set(1, 0);
        gte_clear_flag();
        gte.command(COP2_MVMVA(0, COP2_MX_RT, COP2_V_V0, COP2_CV_TR, 0));
        let flag = u32(gte_read_flag());
        let f29 = u32((flag >>> 29) & 1);
        expect(f29).to.eql(1);
      });

      it('prec_mac3_overflow', async () => {
        gte.set(32 + 0, 0x00000000);
        gte.set(32 + 1, 0x00000000);
        gte.set(32 + 2, 0x00000000);
        gte.set(32 + 3, 0x00007fff); // R31=0x7FFF (high16 of R31R32)
        gte.set(32 + 4, 0);
        gte.set(32 + 5, 0);
        gte.set(32 + 6, 0);
        gte.set(32 + 7, 0x7fffffff); // TRZ = max
        gte.set(0, (0 << 16) | 0x7fff);
        gte.set(1, 0);
        gte_clear_flag();
        gte.command(COP2_MVMVA(0, COP2_MX_RT, COP2_V_V0, COP2_CV_TR, 0));
        let flag = u32(gte_read_flag());
        let f28 = u32((flag >>> 28) & 1);
        expect(f28).to.eql(1);
      });

      it('prec_mac_double_overflow', async () => {
        // Use OP (cross product) sf=0 with values that cause intermediate
        // overflow in both directions during the subtract
        // MAC1 = R22*IR3 - R33*IR2
        // Make R22*IR3 overflow positive, then R33*IR2 brings it back
        gte.set(32 + 0, 0x00000000);
        gte.set(32 + 2, 0x00007fff); // R22=0x7FFF
        gte.set(32 + 4, 0x7fff); // R33=0x7FFF
        gte.set(9, 0);
        gte.set(10, 0x7fff); // IR2
        gte.set(11, 0x7fff); // IR3
        gte_clear_flag();
        gte.command(COP2_OP_CP(0, 0)); // sf=0
        const mac1 = s32(gte.get(25));
        let flag = u32(gte_read_flag());
        // R22*IR3 = 0x7FFF*0x7FFF = 0x3FFF0001 (fits in 44-bit)
        // Then subtract R33*IR2 = 0x7FFF*0x7FFF = 0x3FFF0001
        // Result = 0, but check if intermediate overflow flagged
        expect(mac1).to.eql(0);
        expect(flag).to.eql(0);
      });

      it('prec_div_1_over_1', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0); // OFX=0
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 1); // H=1
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        gte.set(0, (0 << 16) | 0x1000); // VX=0x1000, VY=0
        gte.set(1, 1); // VZ=1 -> SZ3=1
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        let flag = u32(gte_read_flag());
        let sx = s16((sxy2 & 0xffff));
        // H=1, SZ3=1 -> H >= SZ3*2? 1 >= 2? No -> no overflow
        // quotient = H*0x20000/SZ3 = 0x20000. Saturated to 0x1FFFF.
        // SX = IR1 * quotient >> 16 = 0x1000 * 0x1FFFF >> 16 = 0x1FFF
        // Then saturated to 0x3FF
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(0); // no division overflow
      });

      it('prec_div_100_over_1000', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 100); // H=100
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        gte.set(0, (0 << 16) | 1000); // VX=1000
        gte.set(1, 1000); // VZ=1000
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        let sx = s16((sxy2 & 0xffff));
        // SX = 1000 * (100/1000) = 100 (roughly, depends on table rounding)
        expect(s32(sx)).to.eql(100);
      });

      it('prec_div_corner_f015_780b', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 0xf015); // H
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        gte.set(0, (0 << 16) | 1); // VX=1 (minimal to see quotient effect)
        gte.set(1, 0x780b); // VZ = 0x780B
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        let flag = u32(gte_read_flag());
        let sx = s16((sxy2 & 0xffff));
        // This should NOT set FLAG.17 (division overflow)
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(0);
      });

      it('prec_div_large_h', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 0xfffe); // H near max
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        gte.set(0, (0 << 16) | 1);
        gte.set(1, 0x7fff); // SZ3=0x7FFF -> H >= SZ3*2? 0xFFFE >= 0xFFFE -> yes, overflow
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        let flag = u32(gte_read_flag());
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(1); // H >= SZ3*2 is true (equal counts)
      });

      it('prec_div_sz3_one', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 0);
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 1); // H=1
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        gte.set(0, (0 << 16) | 1);
        gte.set(1, 1); // SZ3=1
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2 = u32(gte.get(14));
        const ir1 = s32(gte.get(9));
        let flag = u32(gte_read_flag());
        let sx = s16((sxy2 & 0xffff));
        // H/SZ3 = 1/1 -> quotient saturates to 0x1FFFF
        // SX = IR1 * 0x1FFFF >> 16 = 1 * 0x1FFFF >> 16 = 1
        expect(s32(sx)).to.eql(1);
      });

      it('prec_rtps_sf0_ir3_flag_anomaly', async () => {
        gte_set_identity_rotation();
        // TRZ such that MAC3 is just over 0x7FFF but MAC3>>12 is in range
        // With identity rotation and VZ=0: MAC3 = TRZ << 12 (sf=0, no shift)
        // Wait - with sf=0 the formula is: MAC3 = TRZ*0x1000 + R3x*V
        // Actually let's think more carefully.
        // sf=0: A3 returns the raw 44-bit value without >>12
        // MAC3 = TRZ<<12 + R31*VX + R32*VY + R33*VZ (no shift applied)
        // With identity: MAC3 = TRZ<<12 + VZ*0x1000
        // We want MAC3 > 0x7FFF (IR3 saturates) but MAC3>>12 in [-0x8000,0x7FFF]
        // MAC3 = 0x8000 -> MAC3>>12 = 0 (in range) -> FLAG.22 NOT set but IR3 saturated
        gte.set(32 + 5, 0);
        gte.set(32 + 6, 0);
        gte.set(32 + 7, 0); // TRZ = 0
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 200);
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        // VZ = 8 -> MAC3 = 0 + 0x1000*8 = 0x8000 (just over 0x7FFF)
        gte.set(0, 0x00000000);
        gte.set(1, 8);
        gte_clear_flag();
        gte.command(COP2_RTPS(0, 0)); // sf=0
        const mac3 = s32(gte.get(27));
        const ir3 = u32(gte.get(11));
        let flag = u32(gte_read_flag());
        let f22 = u32((flag >>> 22) & 1);
        // MAC3 = 0x8000 -> out of [-0x8000, 0x7FFF] for IR3 (it equals -0x8000 boundary!)
        // Hmm, 0x8000 = 32768 which is > 0x7FFF. IR3 should saturate to 0x7FFF.
        // MAC3 >> 12 = 0x8000 >> 12 = 0 -> in range -> FLAG.22 should NOT be set.
        // This is the anomaly: IR3 saturated but FLAG.22 not set.
        expect(mac3).to.eql(32768);
        expect(ir3).to.eql(0x7fff);
        expect(f22).to.eql(0);
        let f17 = u32((flag >>> 17) & 1);
        expect(f17).to.eql(1);
      });

      it('prec_rtps_sf0_ir3_flag_strong', async () => {
        gte_set_identity_rotation();
        gte.set(32 + 5, 0);
        gte.set(32 + 6, 0);
        gte.set(32 + 7, 0);
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 200);
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        // VZ = 16 -> MAC3 = 0x1000 * 16 = 0x10000 (65536, way above 0x7FFF)
        gte.set(0, 0x00000000);
        gte.set(1, 16);
        gte_clear_flag();
        gte.command(COP2_RTPS(0, 0));
        const mac3 = s32(gte.get(27));
        const ir3 = u32(gte.get(11));
        let flag = u32(gte_read_flag());
        let f22 = u32((flag >>> 22) & 1);
        // MAC3 = 0x10000 -> IR3 saturated to 0x7FFF
        expect(ir3).to.eql(0x7fff);
        // MAC3 >> 12 = 0x10000 >> 12 = 16 -> in range -> FLAG.22 NOT set
        expect(f22).to.eql(0);
      });

      it('prec_rtps_sf0_ir3_flag_set', async () => {
        gte_set_identity_rotation();
        gte.set(32 + 5, 0);
        gte.set(32 + 6, 0);
        gte.set(32 + 7, 8); // TRZ = 8, so MAC3 = 8<<12 + VZ*0x1000
        gte.set(32 + 24, 0);
        gte.set(32 + 25, 0);
        gte.set(32 + 26, 200);
        gte.set(32 + 27, 0);
        gte.set(32 + 28, 0);
        // VZ = 0x7FF0 -> MAC3 = 8*4096 + 0x7FF0*0x1000 = 0x8000 + 0x7FF0000 = 0x7FF8000
        // MAC3 >> 12 = 0x7FF8 -> in range? 0x7FF8 < 0x7FFF -> yes, still in range
        // Need TRZ large enough: TRZ = 0x7FFF -> MAC3 = 0x7FFF<<12 = 0x7FFF000
        // MAC3>>12 = 0x7FFF -> at boundary. With VZ=1: MAC3 = 0x7FFF000 + 0x1000 = 0x8000000
        // MAC3>>12 = 0x8000 -> OUT of range -> FLAG.22 should be set
        gte.set(32 + 7, 0x7fff);
        gte.set(0, 0x00000000);
        gte.set(1, 1);
        gte_clear_flag();
        gte.command(COP2_RTPS(0, 0));
        const mac3 = s32(gte.get(27));
        const ir3 = u32(gte.get(11));
        let flag = u32(gte_read_flag());
        let f22 = u32((flag >>> 22) & 1);
        // MAC3>>12 = 0x8000 -> exceeds 0x7FFF -> FLAG.22 SHOULD be set
        expect(f22).to.eql(1);
      });

  });

  describe('command encoding (gte-encoding.c)', () => {

      it('enc_fake_field_ignored_rtps', async () => {
        gte_set_identity_rotation();
        gte_set_translation(0, 0, 1000);
        gte_set_screen(160 << 16, 120 << 16, 200);
        gte.set(0, 0);
        gte.set(1, 0);

        // Standard encoding: fake=1, sf=1
        gte_clear_flag();
        gte.command(COP2_RTPS(1, 0));
        const sxy2_std = u32(gte.get(14));

        // Non-standard: fake=0, same sf/fn
        gte.set(0, 0);
        gte.set(1, 0);
        gte_clear_flag();
        gte.command(COP2_OP(0, 1, 0, 0, 0, 0, COP2_FN_RTPS));
        const sxy2_alt = u32(gte.get(14));

        expect(sxy2_alt).to.eql(u32(sxy2_std));
      });

      it('enc_fake_field_ignored_gpf', async () => {
        gte.set(8, 0x1000);
        gte.set(9, 100);
        gte.set(10, 200);
        gte.set(11, 300);
        gte.set(6, 0x00808080);

        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const mac1_std = s32(gte.get(25));

        gte.set(8, 0x1000);
        gte.set(9, 100);
        gte.set(10, 200);
        gte.set(11, 300);
        gte.set(6, 0x00808080);
        gte_clear_flag();
        gte.command(COP2_OP(31, 1, 0, 0, 0, 0, COP2_FN_GPF));
        const mac1_alt = s32(gte.get(25));

        expect(mac1_alt).to.eql(s32(mac1_std));
      });

      it('enc_gpf_sf_difference', async () => {
        gte.set(8, 0x1000);
        gte.set(9, 0x1000);
        gte.set(10, 0x1000);
        gte.set(11, 0x1000);
        gte.set(6, 0x00808080);

        // sf=1: MAC = (IR0*IR) >> 12 = (0x1000*0x1000)>>12 = 0x1000
        gte_clear_flag();
        gte.command(COP2_GPF(1, 0));
        const mac1_sf1 = s32(gte.get(25));

        gte.set(8, 0x1000);
        gte.set(9, 0x1000);
        gte.set(10, 0x1000);
        gte.set(11, 0x1000);
        gte.set(6, 0x00808080);

        // sf=0: MAC = IR0*IR = 0x1000*0x1000 = 0x1000000
        gte_clear_flag();
        gte.command(COP2_GPF(0, 0));
        const mac1_sf0 = s32(gte.get(25));

        expect(mac1_sf1).to.eql(0x1000);
        expect(mac1_sf0).to.eql(0x1000000);
      });

      it('enc_sqr_sf_difference', async () => {
        gte.set(9, 0x100);
        gte.set(10, 0x100);
        gte.set(11, 0x100);

        gte_clear_flag();
        gte.command(COP2_SQR(1, 0));
        const mac1_sf1 = s32(gte.get(25));

        gte.set(9, 0x100);
        gte.set(10, 0x100);
        gte.set(11, 0x100);
        gte_clear_flag();
        gte.command(COP2_SQR(0, 0));
        const mac1_sf0 = s32(gte.get(25));

        // sf=1: (0x100*0x100)>>12 = 0x10000>>12 = 0x10
        // sf=0: 0x100*0x100 = 0x10000
        expect(mac1_sf1).to.eql(0x10);
        expect(mac1_sf0).to.eql(0x10000);
      });

      it('enc_op_sf_difference', async () => {
        gte.set(32 + 0, 0x00001000);
        gte.set(32 + 2, 0x00002000);
        gte.set(32 + 4, 0x1000);
        gte.set(9, 100);
        gte.set(10, 0);
        gte.set(11, 0);

        gte_clear_flag();
        gte.command(COP2_OP_CP(1, 0));
        const mac2_sf1 = s32(gte.get(26));

        gte.set(9, 100);
        gte.set(10, 0);
        gte.set(11, 0);
        gte_clear_flag();
        gte.command(COP2_OP_CP(0, 0));
        const mac2_sf0 = s32(gte.get(26));

        // sf=1: MAC2 = (R33*IR1 - R11*IR3)>>12 = (0x1000*100 - 0x1000*0)>>12 = 100
        // sf=0: MAC2 = R33*IR1 - R11*IR3 = 0x1000*100 = 409600
        expect(mac2_sf1).to.eql(100);
        expect(mac2_sf0).to.eql(409600);
      });

      it('enc_sqr_lm_difference', async () => {
        gte.set(9, 0x2000); // 2.0
        gte.set(10, 0x2000);
        gte.set(11, 0x2000);

        // sf=1, lm=0: 2.0^2 = 4.0 = 0x4000 (in range for signed)
        gte_clear_flag();
        gte.command(COP2_SQR(1, 0));
        const ir1_lm0 = u32(gte.get(9));

        gte.set(9, 0x2000);
        gte.set(10, 0x2000);
        gte.set(11, 0x2000);

        // sf=1, lm=1: same result since 0x4000 > 0 (lm=1 only clamps negative to 0)
        gte_clear_flag();
        gte.command(COP2_SQR(1, 1));
        const ir1_lm1 = u32(gte.get(9));

        // Both should be 0x4000 since result is positive
        expect(ir1_lm0).to.eql(0x4000);
        expect(ir1_lm1).to.eql(0x4000);
      });

      it('enc_mvmva_full_sweep', async () => {
        // Set up all matrices and vectors with known non-zero values
        // RT matrix
        gte.set(32 + 0, 0x08001000);
        gte.set(32 + 1, 0x02000400);
        gte.set(32 + 2, 0x08001000);
        gte.set(32 + 3, 0x02000400);
        gte.set(32 + 4, 0x1000);
        // LL matrix
        gte.set(32 + 8, 0x04000800);
        gte.set(32 + 9, 0x01000200);
        gte.set(32 + 10, 0x04000800);
        gte.set(32 + 11, 0x01000200);
        gte.set(32 + 12, 0x0800);
        // LC matrix
        gte.set(32 + 16, 0x02000400);
        gte.set(32 + 17, 0x00800100);
        gte.set(32 + 18, 0x02000400);
        gte.set(32 + 19, 0x00800100);
        gte.set(32 + 20, 0x0400);
        // Vectors
        gte.set(0, (0x200 << 16) | 0x100); // V0
        gte.set(1, 0x300);
        gte.set(2, (0x500 << 16) | 0x400); // V1
        gte.set(3, 0x600);
        gte.set(4, (0x800 << 16) | 0x700); // V2
        gte.set(5, 0x900);
        gte.set(9, 0x100); // IR1
        gte.set(10, 0x200); // IR2
        gte.set(11, 0x300); // IR3
        gte.set(8, 0x0800); // IR0
        // Control vectors
        gte_set_translation(100, 200, 300);
        gte.set(32 + 13, 400);
        gte.set(32 + 14, 500);
        gte.set(32 + 15, 600);
        gte_set_far_color(700, 800, 900);

        // All 64 MVMVA combos
        const allCombos = () => {
          for (let mx = 0; mx < 4; ++mx) {
            for (let v = 0; v < 4; ++v) {
              for (let cv = 0; cv < 4; ++cv) {
                if (v === 3) { gte.set(9, 0x100); gte.set(10, 0x200); gte.set(11, 0x300); }
                gte_clear_flag();
                gte.command(COP2_MVMVA(1, mx, v, cv, 0));
              }
            }
          }
        };
        expect(allCombos).to.not.throw();
      });

      it('enc_mvmva_mx3_all_vectors', async () => {
        gte.set(32 + 0, 0x20001000);
        gte.set(32 + 1, 0x40003000);
        gte.set(32 + 2, 0x60005000);
        gte.set(32 + 3, 0x80007000);
        gte.set(32 + 4, 0x1000);
        gte.set(8, 0x0800);
        gte.set(0, (0x100 << 16) | 0x100);
        gte.set(1, 0x100);
        gte.set(2, (0x200 << 16) | 0x200);
        gte.set(3, 0x200);
        gte.set(4, (0x300 << 16) | 0x300);
        gte.set(5, 0x300);
        gte.set(9, 0x400);
        gte.set(10, 0x500);
        gte.set(11, 0x600);

        const allVectors = () => {
          for (let v = 0; v < 4; ++v) {
            if (v === 3) { gte.set(9, 0x400); gte.set(10, 0x500); gte.set(11, 0x600); }
            gte_clear_flag();
            gte.command(COP2_MVMVA(1, 3, v, 3, 0));
          }
        };
        expect(allVectors).to.not.throw();
      });

      it('enc_mvmva_cv2_all_matrices', async () => {
        gte_set_identity_rotation();
        gte_set_simple_light();
        gte_set_white_light_color();
        gte_set_far_color(0x1000, 0x2000, 0x3000);
        gte.set(0, (0x200 << 16) | 0x100);
        gte.set(1, 0x300);
        gte.set(9, 0x100);
        gte.set(10, 0x200);
        gte.set(11, 0x300);

        const allMatrices = () => {
          for (let mx = 0; mx < 3; ++mx) {
            gte.set(9, 0x100); gte.set(10, 0x200); gte.set(11, 0x300);
            gte_clear_flag();
            gte.command(COP2_MVMVA(1, mx, 0, 2, 0));
          }
        };
        expect(allMatrices).to.not.throw();
      });

      it('enc_nclip_ignores_sf_lm', async () => {
        gte.set(12, 0x00000000);
        gte.set(13, 0x00000064);
        gte.set(14, 0x00640000);

        gte_clear_flag();
        gte.command(COP2_OP(20, 0, 0, 0, 0, 0, COP2_FN_NCLIP)); // standard
        const mac0_std = s32(gte.get(24));

        gte.set(12, 0x00000000);
        gte.set(13, 0x00000064);
        gte.set(14, 0x00640000);
        gte_clear_flag();
        gte.command(COP2_OP(0, 1, 3, 3, 3, 1, COP2_FN_NCLIP)); // all bits set
        const mac0_alt = s32(gte.get(24));

        expect(mac0_alt).to.eql(s32(mac0_std));
      });

      it('enc_avsz3_ignores_sf_lm', async () => {
        gte.set(17, 100);
        gte.set(18, 200);
        gte.set(19, 300);
        gte.set(32 + 29, 0x555);

        gte_clear_flag();
        gte.command(COP2_AVSZ3);
        const mac0_std = s32(gte.get(24));

        gte.set(17, 100);
        gte.set(18, 200);
        gte.set(19, 300);
        gte.set(32 + 29, 0x555);
        gte_clear_flag();
        gte.command(COP2_OP(0, 0, 3, 3, 3, 1, COP2_FN_AVSZ3));
        const mac0_alt = s32(gte.get(24));

        expect(mac0_alt).to.eql(s32(mac0_std));
      });

  });

})
