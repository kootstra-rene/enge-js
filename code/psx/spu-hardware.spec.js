mdlr('[test]enge:psx:spu-hardware', ({ include, test }) => {

  const { describe, it, xit, expect, before, after } = test;

  // Ported from the nugget SPU tests (https://github.com/pcsx-redux/nugget,
  // tests/spu, MIT), verified on real hardware. Captures are compared with
  // the goldens recorded on silicon (enge:psx:spu-golden-data), envelopes
  // with the ENVX traces measured there.
  //
  // Left out, because they assert nothing on hardware either: spu-pitch-edge
  // and spu-reverb (no goldens recorded yet), spu-adsr-edge (every expected
  // value is still unset) and spu-modeaxes (prints captures for a diff).

  const { createMachine } = include('enge:psx:test-machine');
  const { hardware } = include('enge:psx:test-hw');
  const { spuHelpers } = include('enge:psx:test-spu');

  const u32 = v => v >>> 0;
  const s32 = v => v | 0;
  const u8 = v => v & 0xff;
  const hex = (v, n = 4) => '0x' + (v >>> 0).toString(16).padStart(n, '0');

  let m, hw, s;
  after(async () => { m?.dispose(); });

  // One machine for the suite, as the nugget suite runs in one boot.
  before(async () => {
    m = createMachine();
    hw = hardware(m);
    s = spuHelpers(m, hw);
    hw.IMASK = 0;
    hw.IREG = 0;
  });

  describe('SPU RAM transfers (spu-transfer)', () => {

    it('transfer_via_dma', async () => {
      let fail_count = s32(0);
      const addrs = [ 0x01040, 0x40000, 0x7fec0 ];
      const seeds = [ 0x11, 0x22, 0x33 ];

      for (let t = 0; t < 3; t++) {
        s.spu_reset_quiet();

        for (let i = 0; i < 256; i++) s.s_readback[i] = u8(seeds[t] ^ (i * 7));
        for (let i = 256; i < 320; i++) s.s_readback[i] = 0xaa;
        s.spu_write_sync(addrs[t], s.s_readback, 320);

        for (let i = 0; i < 256; i++) s.s_readback[i] = 0xCC;
        s.spu_read_sync(addrs[t], s.s_readback, 256);

        let local_fail = s32(0);
        for (let i = 0; i < 256; i++) {
          let expected = u8((seeds[t] ^ (i * 7)));
          if (s.s_readback[i] != expected) local_fail++;
        }
        fail_count = s32(fail_count + (local_fail));
      }
      expect(s32(0)).to.eql(s32(fail_count));
    });

    it('transfer_to_reserved_sdk_region', async () => {
      // PSY-Q SDK claims 0x1000-0x100F is reserved
      s.spu_reset_quiet();
      for (let i = 0; i < 128; i++) s.s_upload[i] = u8(0xa5 ^ i);
      s.spu_write_sync(0x1000, s.s_upload, 128);
      s.spu_busy_wait(500000);
      s.spu_read_sync(0x1000, s.s_readback, 0x80);

      let matches_reserved = s32(0);
      for (let i = 0; i < 0x10; i++) if (s.s_readback[i] == s.s_upload[i]) matches_reserved++;
      let matches_after = s32(0);
      for (let i = 0x10; i < 0x40; i++) if (s.s_readback[i] == s.s_upload[i]) matches_after++;
      expect(s32(16)).to.eql(s32(matches_reserved));
      expect(s32(48)).to.eql(s32(matches_after));
    });

    it('transfer_to_capture_region', async () => {
      s.spu_reset_quiet();
      s.spu_busy_wait(2000000);

      s.spu_read_sync(0x0000, s.s_readback, 0x1000);
      let nonzero_silenced = u32(0);
      for (let i = 0; i < 0x1000; i++) if (s.s_readback[i] != 0) nonzero_silenced++;
      expect(nonzero_silenced).to.eql(0);

      for (let i = 0; i < 0x1000; i++) s.s_readback[i] = u8(0x55 ^ (i & 0xff));
      s.spu_write_sync(0x0000, s.s_readback, 0x1000);
      s.spu_busy_wait(2000000);

      const s_phase3 = new Uint8Array(0x1000);
      s.spu_read_sync(0x0000, s_phase3, 0x1000);
      let matches = u32(0);
      for (let i = 0; i < 0x1000; i++) if (s_phase3[i] == u8(0x55 ^ (i & 0xff))) matches++;
      expect(u32(16) <= u32(matches)).to.be.true;
    });


  });

  // The voice 1 capture ring (SPU RAM 800h) is written after the voice
  // volume in enge (spu.js), where hardware writes the enveloped sample
  // before it: with the volume at 0, as here, the capture stays silent. Taken
  // before the volume, the waveforms have the golden's shape but not its
  // amplitude (a sine peaks at 16064 against 14278 on silicon).

  describe('ADPCM decoding (spu-adpcm)', () => {

    it('adpcm_decode_silent', async () => {
      s.run_voice1_with_sample(s.kAdpcmSilent, 0x1000);
      expect(s.spu_compare_golden('silent')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_decode_sinewave', async () => {
      s.run_voice1_with_sample(s.kAdpcmSine, 0x1000);
      expect(s.spu_compare_golden('sine')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_decode_sinewave_lowpitch', async () => {
      s.run_voice1_with_sample(s.kAdpcmSine394Hz, 0x1000);
      expect(s.spu_compare_golden('sine_low')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_decode_sinewave_highpitch', async () => {
      s.run_voice1_with_sample(s.kAdpcmSine5512Hz, 0x1000);
      expect(s.spu_compare_golden('sine_high')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_decode_tranglewave', async () => {
      s.run_voice1_with_sample(s.kAdpcmTriangle, 0x1000);
      expect(s.spu_compare_golden('triangle')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_decode_squarewave', async () => {
      s.run_voice1_with_sample(s.kAdpcmSquare, 0x1000);
      expect(s.spu_compare_golden('square')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_decode_with_loop', async () => {
      s.run_voice1_with_sample(s.kAdpcmTriangle, 0x1000);
      expect(s.spu_compare_golden('loop_t0')).to.eql(0);

      hw.SPU_CTRL = 0x8000 | 0x4000;
      hw.SPU_VOL_MAIN_LEFT = 0x3fff;
      hw.SPU_VOL_MAIN_RIGHT = 0x3fff;
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.spu_busy_wait(800000);
      s.spu_wait_status_bit11_flip();

      s.spu_voice1_keyon(s.SPU_UPLOAD_ADDR, 0x1000);
      s.spu_busy_wait(15000000); // ~440 ms, the 112-sample buffer lasts ~5 ms
      s.spu_wait_status_bit11_flip();
      s.spu_read_sync(0x0800, s.s_capture, 1024);
      expect(s.spu_compare_golden('loop_t1')).to.eql(0);

      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.muteSpu();
    });


  });

  describe('ADPCM decoder edge cases (spu-adpcm-edge)', () => {

    const kEdgeZero = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const kEdgePositive = [0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77];
    const kEdgeNegative = [0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88];
    const kEdgeAlternating = [0x78, 0x78, 0x78, 0x78, 0x78, 0x78, 0x78, 0x78, 0x78, 0x78, 0x78, 0x78, 0x78, 0x78];
    const kEdgeRamp = [0x10, 0x32, 0x54, 0x76, 0x56, 0x34, 0x12, 0xe0, 0xcd, 0xab, 0x89, 0xa9, 0xcb, 0xed];
    const kEdgeMixed = [0x17, 0xde, 0x9a, 0xbc, 0x45, 0x23, 0x01, 0xfe, 0xdc, 0xba, 0x98, 0x89, 0x67, 0x45];

    // the scalars measured on silicon
    const SPU_ADPCM_EDGE_EXPECTED_REPEAT_LOOP_START = 0x212;
    const SPU_ADPCM_EDGE_EXPECTED_REPEAT_END_MUTE = 0x210;
    const SPU_ADPCM_EDGE_EXPECTED_ENDX_END_MUTE = 0x1;
    const SPU_ADPCM_EDGE_EXPECTED_ENVX_END_MUTE = 0x0;
    const SPU_ADPCM_EDGE_EXPECTED_ENDX_END_REPEAT = 0x1;
    const SPU_ADPCM_EDGE_EXPECTED_ENVX_END_REPEAT = 0x3fff;

    const spu_adpcm_edge_block = (sample, block, header, flags, payload) => {
      const p = block * 16;
      sample[p] = header;
      sample[p + 1] = flags;
      for (let i = 0; i < 14; i++) sample[p + 2 + i] = payload[i];
    };

    const spu_adpcm_edge_expect_u32 = (name, expected, got) => {
      expect({ [name]: hex(got) }).to.eql({ [name]: hex(expected) });
    };

    // a capture with voice 1 left playing
    const spu_adpcm_edge_run_capture_keep_on = (sample64, pitch) => {
      s.spu_reset_quiet();
      for (let i = 0; i < 64; i++) s.s_upload[i] = sample64[i];
      for (let i = 64; i < 128; i++) s.s_upload[i] = 0xaa;
      s.spu_write_sync(s.SPU_UPLOAD_ADDR, s.s_upload, 128);
      hw.SPU_CTRL = 0x8000 | 0x4000;
      hw.SPU_VOL_MAIN_LEFT = 0x3fff;
      hw.SPU_VOL_MAIN_RIGHT = 0x3fff;
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.spu_busy_wait(800000);
      s.spu_wait_status_bit11_flip();
      s.spu_voice1_keyon(s.SPU_UPLOAD_ADDR, pitch);
      // the attack is instant, so ENVX leaves zero once the key-on is processed
      s.poll(100000, () => hw.SPU_VOICES[1].currentVolume !== 0);
      s.spu_wait_status_bit11_flip();
      s.spu_wait_status_bit11_flip();
      s.spu_read_sync(0x0800, s.s_capture, 1024);
    };

    const spu_adpcm_edge_stop = () => {
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.muteSpu();
    };

    for (const N of [0, 1, 2, 3, 4]) {
      // capture is written after the voice volume
      xit(`adpcm_edge_predictor_${N}`, async () => {
        const sample = new Uint8Array(64);
        spu_adpcm_edge_block(sample, 0, (N << 4) | 4, 0x04, kEdgeMixed);
        spu_adpcm_edge_block(sample, 1, (N << 4) | 4, 0x00, kEdgeRamp);
        spu_adpcm_edge_block(sample, 2, (N << 4) | 4, 0x00, kEdgeZero);
        spu_adpcm_edge_block(sample, 3, (N << 4) | 4, 0x03, kEdgeAlternating);
        s.run_voice1_with_sample(sample, 0x1000);
        expect(s.spu_compare_golden(`adpcm_edge_predictor_${N}`)).to.eql(0);
      });
    }

    // capture is written after the voice volume

    xit('adpcm_edge_shift_00_03', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x00, 0x04, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 1, 0x01, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 2, 0x02, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 3, 0x03, 0x03, kEdgeAlternating);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_shift_00_03')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_edge_shift_04_07', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x04, 0x04, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 1, 0x05, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 2, 0x06, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 3, 0x07, 0x03, kEdgeAlternating);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_shift_04_07')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_edge_shift_08_11', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x08, 0x04, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 1, 0x09, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 2, 0x0a, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 3, 0x0b, 0x03, kEdgeAlternating);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_shift_08_11')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_edge_shift_12_15', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x0c, 0x04, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 1, 0x0d, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 2, 0x0e, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 3, 0x0f, 0x03, kEdgeAlternating);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_shift_12_15')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_edge_state_carry', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x00, 0x04, kEdgePositive);
      spu_adpcm_edge_block(sample, 1, 0x44, 0x00, kEdgeZero);
      spu_adpcm_edge_block(sample, 2, 0x44, 0x00, kEdgeZero);
      spu_adpcm_edge_block(sample, 3, 0x44, 0x03, kEdgeZero);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_state_carry')).to.eql(0);
    });

    it('adpcm_edge_saturation_positive', async () => {
      const sample = new Uint8Array(64);
      for (let i = 0; i < 4; i++) spu_adpcm_edge_block(sample, i, 0x40, i == 0 ? 0x04 : (i == 3 ? 0x03 : 0x00), kEdgePositive);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_saturation_positive')).to.eql(0);
    });

    it('adpcm_edge_saturation_negative', async () => {
      const sample = new Uint8Array(64);
      for (let i = 0; i < 4; i++) spu_adpcm_edge_block(sample, i, 0x40, i == 0 ? 0x04 : (i == 3 ? 0x03 : 0x00), kEdgeNegative);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_saturation_negative')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_edge_flag_code2_ignored', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x04, 0x04, kEdgeRamp);
      spu_adpcm_edge_block(sample, 1, 0x04, 0x02, kEdgePositive);
      spu_adpcm_edge_block(sample, 2, 0x04, 0x00, kEdgeNegative);
      spu_adpcm_edge_block(sample, 3, 0x04, 0x03, kEdgeZero);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_flag_code2_ignored')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('adpcm_edge_flag_loop_start_latch', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x04, 0x00, kEdgePositive);
      spu_adpcm_edge_block(sample, 1, 0x04, 0x04, kEdgeRamp);
      spu_adpcm_edge_block(sample, 2, 0x04, 0x00, kEdgeNegative);
      spu_adpcm_edge_block(sample, 3, 0x04, 0x03, kEdgeZero);
      spu_adpcm_edge_run_capture_keep_on(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_flag_loop_start_latch')).to.eql(0);
      spu_adpcm_edge_expect_u32("repeat_loop_start",
              SPU_ADPCM_EDGE_EXPECTED_REPEAT_LOOP_START, hw.SPU_VOICES[1].sampleRepeatAddr);
      spu_adpcm_edge_stop();
    });

    it('adpcm_edge_flag_end_mute', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x04, 0x04, kEdgePositive);
      spu_adpcm_edge_block(sample, 1, 0x04, 0x01, kEdgeNegative);
      spu_adpcm_edge_block(sample, 2, 0x04, 0x00, kEdgePositive);
      spu_adpcm_edge_block(sample, 3, 0x04, 0x03, kEdgePositive);
      spu_adpcm_edge_run_capture_keep_on(sample, 0x1000);
      s.spu_busy_wait(800000);
      expect(s.spu_compare_golden('adpcm_edge_flag_end_mute')).to.eql(0);
      spu_adpcm_edge_expect_u32("repeat_end_mute",
              SPU_ADPCM_EDGE_EXPECTED_REPEAT_END_MUTE, hw.SPU_VOICES[1].sampleRepeatAddr);
      spu_adpcm_edge_expect_u32("endx_end_mute",
              SPU_ADPCM_EDGE_EXPECTED_ENDX_END_MUTE, (hw.SPU_ENDX_LOW >> 1) & 1);
      spu_adpcm_edge_expect_u32("envx_end_mute",
              SPU_ADPCM_EDGE_EXPECTED_ENVX_END_MUTE, hw.SPU_VOICES[1].currentVolume);
      spu_adpcm_edge_stop();
    });

    // capture is written after the voice volume

    xit('adpcm_edge_flag_end_repeat', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x04, 0x04, kEdgePositive);
      spu_adpcm_edge_block(sample, 1, 0x04, 0x03, kEdgeNegative);
      spu_adpcm_edge_block(sample, 2, 0x04, 0x00, kEdgePositive);
      spu_adpcm_edge_block(sample, 3, 0x04, 0x03, kEdgePositive);
      spu_adpcm_edge_run_capture_keep_on(sample, 0x1000);
      s.spu_busy_wait(800000);
      expect(s.spu_compare_golden('adpcm_edge_flag_end_repeat')).to.eql(0);
      spu_adpcm_edge_expect_u32("endx_end_repeat",
              SPU_ADPCM_EDGE_EXPECTED_ENDX_END_REPEAT, (hw.SPU_ENDX_LOW >> 1) & 1);
      spu_adpcm_edge_expect_u32("envx_end_repeat",
              SPU_ADPCM_EDGE_EXPECTED_ENVX_END_REPEAT, hw.SPU_VOICES[1].currentVolume);
      spu_adpcm_edge_stop();
    });

    // capture is written after the voice volume

    xit('adpcm_edge_invalid_predictor_5_7', async () => {
      const sample = new Uint8Array(64);
      spu_adpcm_edge_block(sample, 0, 0x54, 0x04, kEdgeMixed);
      spu_adpcm_edge_block(sample, 1, 0x64, 0x00, kEdgeRamp);
      spu_adpcm_edge_block(sample, 2, 0x74, 0x00, kEdgeAlternating);
      spu_adpcm_edge_block(sample, 3, 0xf4, 0x03, kEdgeZero);
      s.run_voice1_with_sample(sample, 0x1000);
      expect(s.spu_compare_golden('adpcm_edge_invalid_predictor_5_7')).to.eql(0);
    });


  });

  describe('voice capture (spu-capture)', () => {

    // capture is written after the voice volume

    xit('voice_sample_rates', async () => {
      s.run_voice1_with_sample(s.kAdpcmSine, 0x0800);
      expect(s.spu_compare_golden('sine_pitch_0800')).to.eql(0);
      s.run_voice1_with_sample(s.kAdpcmSine, 0x2000);
      expect(s.spu_compare_golden('sine_pitch_2000')).to.eql(0);
      s.run_voice1_with_sample(s.kAdpcmSine, 0x3000);
      expect(s.spu_compare_golden('sine_pitch_3000')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('voice_sample_rate_nondyadic', async () => {
      s.run_voice1_with_sample(s.kAdpcmSine, 0x1500);
      expect(s.spu_compare_golden('sine_pitch_1500')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('voice_sample_rate_swept_index', async () => {
      s.run_voice1_with_sample(s.kAdpcmSine, 0x1400);
      expect(s.spu_compare_golden('sine_pitch_1400')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('voice_sample_rate_swept_index_full', async () => {
      s.run_voice1_with_sample(s.kAdpcmSine7, 0x1300);
      expect(s.spu_compare_golden('sine7_pitch_1300')).to.eql(0);
    });

    // capture is written after the voice volume

    xit('voice_volume_does_not_affect_capture', async () => {
      hw.SPU_VOICES[1].volumeLeft = 0x3fff;
      hw.SPU_VOICES[1].volumeRight = 0x3fff;
      s.run_voice1_with_sample(s.kAdpcmTriangle, 0x1000);
      expect(s.spu_compare_golden('triangle')).to.eql(0);
      hw.SPU_VOICES[1].volumeLeft = 0;
      hw.SPU_VOICES[1].volumeRight = 0;
      s.run_voice1_with_sample(s.kAdpcmTriangle, 0x1000);
      expect(s.spu_compare_golden('triangle')).to.eql(0);
    });


  });

  describe('ADSR envelopes (spu-adsr)', () => {

    const ATTACK = (step, shift, exp) => u32(((step & 3) << 8) | ((shift & 31) << 10) | ((exp ? 1 : 0) << 15));
    const DECAY = shift => (shift & 15) << 4;
    const SUSTAIN = (step, shift, level, direction, exp) =>
      u32(((step & 3) << 22) | ((shift & 31) << 24) | (level & 15) | ((direction ? 1 : 0) << 30) | ((exp ? 1 : 0) << 31));
    const RELEASE = (shift, exp) => u32(((shift & 31) << 16) | ((exp ? 1 : 0) << 21));

    // the bounds measured on silicon (src/mips/tests/spu-envx), with an
    // order of magnitude to spare
    const ADSR_DRAIN_MAX_TICKS = 16;
    const ADSR_ONSET_MAX_SPINS = 2000000;

    // An ENVX trace, one sample per SPUSTAT bit 11 flip, from the moment the
    // envelope leaves 0.
    const spu_adsr_capture = (adsr, envx_out, n_samples) => {
      adsr = u32(adsr);
      // drain the previous key-on with the fastest release rate
      s.spu_reset_quiet();
      hw.SPU_CTRL = 0x8000 | 0x4000;
      hw.SPU_VOL_MAIN_LEFT = 0; hw.SPU_VOL_MAIN_RIGHT = 0;
      hw.SPU_VOICES[1].adsrHi = RELEASE(0, 0) >>> 16;
      hw.SPU_KEY_OFF_LOW = 0xffff; hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.spu_wait_status_bit11_flip();
      for (let drain = 0; hw.SPU_VOICES[1].currentVolume !== 0;) {
        if (++drain > ADSR_DRAIN_MAX_TICKS) break;
        s.spu_wait_status_bit11_flip();
      }

      // prepare the envelope, wait for a bit 11 flip, then fire the voice
      hw.SPU_VOICES[1].sampleRate = 0x1000;
      hw.SPU_VOICES[1].sampleStartAddr = s.SPU_UPLOAD_ADDR >> 3;
      hw.SPU_VOICES[1].sampleRepeatAddr = s.SPU_UPLOAD_ADDR >> 3;
      hw.SPU_VOICES[1].volumeLeft = 0;
      hw.SPU_VOICES[1].volumeRight = 0;
      s.spu_wait_status_bit11_flip();
      hw.SPU_VOICES[1].adsrLo = adsr & 0xffff;
      hw.SPU_VOICES[1].adsrHi = adsr >>> 16;
      hw.SPU_KEY_OFF_LOW = 0; hw.SPU_KEY_OFF_HIGH = 0;
      hw.SPU_KEY_ON_LOW = 1 << 1;

      // synchronise on ENVX leaving zero (a spin is a few cycles)
      m.idleUntil(() => hw.SPU_VOICES[1].currentVolume !== 0, 4 * ADSR_ONSET_MAX_SPINS, 4);

      envx_out[0] = hw.SPU_VOICES[1].currentVolume;
      for (let i = 1; i < n_samples; i++) {
        s.spu_wait_status_bit11_flip();
        envx_out[i] = hw.SPU_VOICES[1].currentVolume;
      }

      hw.SPU_KEY_OFF_LOW = 0xffff; hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.muteSpu();
    };

    const spu_adsr_capture_with_keyoff = (adsr, envx_out, n_samples, keyoff_at) => {
      spu_adsr_capture(adsr, envx_out, keyoff_at + 1);
      for (let i = keyoff_at + 1; i < n_samples; i++) {
        s.spu_wait_status_bit11_flip();
        envx_out[i] = hw.SPU_VOICES[1].currentVolume;
      }
    };

    // The key-on is serviced on a 2-sample grid whose phase against the
    // capture ring differs per boot, so a sample may be up to two samples of
    // envelope travel off, and at least two envelope increments.
    const ENVX_KON_GRID = 2;
    const ENVX_INCREMENT = 8;
    const ENVX_MARGIN = step => ENVX_KON_GRID * (step < ENVX_INCREMENT ? ENVX_INCREMENT : step);
    const ASSERT_ENVX_NEAR = (nominal, step, got) => {
      const margin = ENVX_MARGIN(step);
      const near = got + margin >= nominal && got <= nominal + margin;
      expect(hex(near ? nominal : got)).to.eql(hex(nominal));
    };

    // the first sample reads 2 where silicon reads 5

    xit('adsr_attack_linear_step', async () => {
      let i;
      const envx = new Uint16Array(0x40);

      let base = u32(DECAY(0) | SUSTAIN(3, 0x1f, 15, 0, 0) | RELEASE(0, 0));

      spu_adsr_capture(ATTACK(2, 12, 0) | base, envx, 4);
      expect(u32(envx[0])).to.eql(0x0005);
      ASSERT_ENVX_NEAR(0x04f1, 5, envx[1]);
      ASSERT_ENVX_NEAR(0x09f1, 5, envx[2]);
      ASSERT_ENVX_NEAR(0x0ef1, 5, envx[3]);

      spu_adsr_capture(ATTACK(3, 12, 0) | base, envx, 4);
      expect(u32(envx[0])).to.eql(0x0004);
      ASSERT_ENVX_NEAR(0x03f4, 4, envx[1]);
      ASSERT_ENVX_NEAR(0x07f4, 4, envx[2]);
      ASSERT_ENVX_NEAR(0x0bf4, 4, envx[3]);

      spu_adsr_capture(ATTACK(2, 24, 0) | base, envx, 48);
      for (i = 0; i < 17; i++) expect(u32(envx[i])).to.eql(0x0005);
      for (i = 17; i < 33; i++) expect(u32(envx[i])).to.eql(0x000a);
      for (i = 33; i < 48; i++) expect(u32(envx[i])).to.eql(0x000f);

      spu_adsr_capture(ATTACK(3, 24, 0) | base, envx, 48);
      for (i = 0; i < 17; i++) expect(u32(envx[i])).to.eql(0x0004);
      for (i = 17; i < 33; i++) expect(u32(envx[i])).to.eql(0x0008);
      for (i = 33; i < 48; i++) expect(u32(envx[i])).to.eql(0x000c);
    });

    // ENVX 0e00h where silicon reads 0dcfh

    xit('adsr_attack_linear_shift', async () => {
      let i;
      const envx = new Uint16Array(0x40);

      let base = u32(DECAY(0) | SUSTAIN(3, 0x1f, 15, 0, 0) | RELEASE(0, 0));

      spu_adsr_capture(ATTACK(0, 0, 0) | base, envx, 1);
      expect(u32(envx[0])).to.eql(0x3800);

      spu_adsr_capture(ATTACK(1, 0, 0) | base, envx, 1);
      expect(u32(envx[0])).to.eql(0x3000);

      spu_adsr_capture(ATTACK(0, 11, 0) | base, envx, 4);
      expect(u32(envx[0])).to.eql(0x0007);
      ASSERT_ENVX_NEAR(0x0dcf, 7, envx[1]);
      ASSERT_ENVX_NEAR(0x1bcf, 7, envx[2]);
      ASSERT_ENVX_NEAR(0x29cf, 7, envx[3]);

      spu_adsr_capture(ATTACK(1, 11, 0) | base, envx, 4);
      expect(u32(envx[0])).to.eql(0x0006);
      ASSERT_ENVX_NEAR(0x0bdc, 7, envx[1]);
      ASSERT_ENVX_NEAR(0x17d6, 7, envx[2]);
      ASSERT_ENVX_NEAR(0x23d6, 7, envx[3]);

      spu_adsr_capture(ATTACK(0, 12, 0) | base, envx, 32);
      expect(u32(envx[0])).to.eql(0x0007);
      ASSERT_ENVX_NEAR(0x06e4, 7, envx[1]);
      ASSERT_ENVX_NEAR(0x0de4, 7, envx[2]);
      ASSERT_ENVX_NEAR(0x14e4, 7, envx[3]);
      ASSERT_ENVX_NEAR(0x1be4, 7, envx[4]);
      ASSERT_ENVX_NEAR(0x22e4, 7, envx[5]);
      ASSERT_ENVX_NEAR(0x29e4, 7, envx[6]);
      ASSERT_ENVX_NEAR(0x30e4, 7, envx[7]);
      ASSERT_ENVX_NEAR(0x37e4, 7, envx[8]);
      ASSERT_ENVX_NEAR(0x3ee4, 7, envx[9]);
      ASSERT_ENVX_NEAR(0x45e4, 7, envx[10]);
      ASSERT_ENVX_NEAR(0x4ce4, 7, envx[11]);
      ASSERT_ENVX_NEAR(0x53e4, 7, envx[12]);
      ASSERT_ENVX_NEAR(0x5ae4, 7, envx[13]);
      ASSERT_ENVX_NEAR(0x61e4, 7, envx[14]);
      ASSERT_ENVX_NEAR(0x68e4, 7, envx[15]);
      ASSERT_ENVX_NEAR(0x6fe4, 7, envx[16]);
      ASSERT_ENVX_NEAR(0x76e4, 7, envx[17]);
      ASSERT_ENVX_NEAR(0x7de4, 7, envx[18]);

      spu_adsr_capture(ATTACK(1, 12, 0) | base, envx, 4);
      expect(u32(envx[0])).to.eql(0x0006);
      ASSERT_ENVX_NEAR(0x05ee, 6, envx[1]);
      ASSERT_ENVX_NEAR(0x0bee, 6, envx[2]);
      ASSERT_ENVX_NEAR(0x11ee, 6, envx[3]);

      spu_adsr_capture(ATTACK(0, 23, 0) | base, envx, 48);
      for (i = 0; i < 9; i++) expect(u32(envx[i])).to.eql(0x0007);
      for (i = 9; i < 17; i++) expect(u32(envx[i])).to.eql(0x000e);
      for (i = 17; i < 25; i++) expect(u32(envx[i])).to.eql(0x0015);
      for (i = 25; i < 33; i++) expect(u32(envx[i])).to.eql(0x001c);
      for (i = 33; i < 41; i++) expect(u32(envx[i])).to.eql(0x0023);
      for (i = 41; i < 48; i++) expect(u32(envx[i])).to.eql(0x002a);

      spu_adsr_capture(ATTACK(1, 23, 0) | base, envx, 48);
      for (i = 0; i < 9; i++) expect(u32(envx[i])).to.eql(0x0006);
      for (i = 9; i < 17; i++) expect(u32(envx[i])).to.eql(0x000c);
      for (i = 17; i < 25; i++) expect(u32(envx[i])).to.eql(0x0012);
      for (i = 25; i < 33; i++) expect(u32(envx[i])).to.eql(0x0018);
      for (i = 33; i < 41; i++) expect(u32(envx[i])).to.eql(0x001e);
      for (i = 41; i < 48; i++) expect(u32(envx[i])).to.eql(0x0024);

      spu_adsr_capture(ATTACK(0, 24, 0) | base, envx, 48);
      for (i = 0; i < 17; i++) expect(u32(envx[i])).to.eql(0x0007);
      for (i = 17; i < 33; i++) expect(u32(envx[i])).to.eql(0x000e);
      for (i = 33; i < 48; i++) expect(u32(envx[i])).to.eql(0x0015);

      spu_adsr_capture(ATTACK(1, 24, 0) | base, envx, 48);
      for (i = 0; i < 17; i++) expect(u32(envx[i])).to.eql(0x0006);
      for (i = 17; i < 33; i++) expect(u32(envx[i])).to.eql(0x000c);
      for (i = 33; i < 48; i++) expect(u32(envx[i])).to.eql(0x0012);
    });

    // the first sample reads 3 where silicon reads 7

    xit('adsr_attack_exponential', async () => {
      const envx = new Uint16Array(0x40);

      let base = u32(DECAY(0) | SUSTAIN(3, 0x1f, 15, 0, 0) | RELEASE(0, 0));

      spu_adsr_capture(ATTACK(0, 12, 1) | base, envx, 32);
      expect(u32(envx[0])).to.eql(0x0007);
      ASSERT_ENVX_NEAR(0x06e4, 7, envx[1]);
      ASSERT_ENVX_NEAR(0x0de4, 7, envx[2]);
      ASSERT_ENVX_NEAR(0x14e4, 7, envx[3]);
      ASSERT_ENVX_NEAR(0x1be4, 7, envx[4]);
      ASSERT_ENVX_NEAR(0x22e4, 7, envx[5]);
      ASSERT_ENVX_NEAR(0x29e4, 7, envx[6]);
      ASSERT_ENVX_NEAR(0x30e4, 7, envx[7]);
      ASSERT_ENVX_NEAR(0x37e4, 7, envx[8]);
      ASSERT_ENVX_NEAR(0x3ee4, 7, envx[9]);
      ASSERT_ENVX_NEAR(0x45e4, 7, envx[10]);
      ASSERT_ENVX_NEAR(0x4ce4, 7, envx[11]);
      ASSERT_ENVX_NEAR(0x53e4, 7, envx[12]);
      ASSERT_ENVX_NEAR(0x5ae4, 7, envx[13]);
      ASSERT_ENVX_NEAR(0x607f, 7, envx[14]);
      ASSERT_ENVX_NEAR(0x623f, 7, envx[15]);
      ASSERT_ENVX_NEAR(0x63ff, 7, envx[16]);
      ASSERT_ENVX_NEAR(0x65bf, 7, envx[17]);
      ASSERT_ENVX_NEAR(0x677f, 7, envx[18]);
      ASSERT_ENVX_NEAR(0x693f, 7, envx[19]);
      ASSERT_ENVX_NEAR(0x6aff, 7, envx[20]);
      ASSERT_ENVX_NEAR(0x6cbf, 7, envx[21]);
      ASSERT_ENVX_NEAR(0x6e7f, 7, envx[22]);
      ASSERT_ENVX_NEAR(0x703f, 7, envx[23]);
      ASSERT_ENVX_NEAR(0x71ff, 7, envx[24]);
      ASSERT_ENVX_NEAR(0x73bf, 7, envx[25]);
      ASSERT_ENVX_NEAR(0x757f, 7, envx[26]);
      ASSERT_ENVX_NEAR(0x773f, 7, envx[27]);
      ASSERT_ENVX_NEAR(0x78ff, 7, envx[28]);
      ASSERT_ENVX_NEAR(0x7abf, 7, envx[29]);
      ASSERT_ENVX_NEAR(0x7c7f, 7, envx[30]);
      ASSERT_ENVX_NEAR(0x7e3f, 7, envx[31]);
    });

    // ENVX 7ff9h where silicon reads 6370h

    xit('adsr_decay_shift', async () => {
      const envx = new Uint16Array(0x40);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(10) | SUSTAIN(0, 0, 0, 1, 0) | RELEASE(0, 1),
              envx, 16);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x6370, 12, envx[1]);
      ASSERT_ENVX_NEAR(0x4c95, 9, envx[2]);
      ASSERT_ENVX_NEAR(0x3ac6, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x2cef, 0x03, envx[4]);
      ASSERT_ENVX_NEAR(0x221c, 0x03, envx[5]);
      ASSERT_ENVX_NEAR(0x19b0, 0x02, envx[6]);
      ASSERT_ENVX_NEAR(0x1343, 0x02, envx[7]);
      ASSERT_ENVX_NEAR(0x0e2d, 0x01, envx[8]);
      ASSERT_ENVX_NEAR(0x0a2d, 0x01, envx[9]);
      for (let i = 10; i < 16; i++) expect(u32(envx[i])).to.eql(0x0000);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(12) | SUSTAIN(0, 0, 0, 1, 0) | RELEASE(0, 1),
              envx, 32);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x782b, 0x04, envx[1]);
      ASSERT_ENVX_NEAR(0x702b, 0x04, envx[2]);
      ASSERT_ENVX_NEAR(0x6925, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x6225, 0x04, envx[4]);
      ASSERT_ENVX_NEAR(0x5bd7, 0x03, envx[5]);
      ASSERT_ENVX_NEAR(0x55d7, 0x03, envx[6]);
      ASSERT_ENVX_NEAR(0x4fdd, 0x03, envx[7]);
      ASSERT_ENVX_NEAR(0x4add, 0x03, envx[8]);
      ASSERT_ENVX_NEAR(0x45dd, 0x03, envx[9]);
      ASSERT_ENVX_NEAR(0x40dd, 0x03, envx[10]);
      ASSERT_ENVX_NEAR(0x3cb1, 0x02, envx[11]);
      ASSERT_ENVX_NEAR(0x38b1, 0x02, envx[12]);
      ASSERT_ENVX_NEAR(0x34b1, 0x02, envx[13]);
      ASSERT_ENVX_NEAR(0x30b1, 0x02, envx[14]);
      ASSERT_ENVX_NEAR(0x2d84, 0x02, envx[15]);
      ASSERT_ENVX_NEAR(0x2a84, 0x02, envx[16]);
      ASSERT_ENVX_NEAR(0x2784, 0x02, envx[17]);
      ASSERT_ENVX_NEAR(0x2484, 0x02, envx[18]);
      ASSERT_ENVX_NEAR(0x2184, 0x02, envx[19]);
      ASSERT_ENVX_NEAR(0x1f03, 0x01, envx[20]);
      ASSERT_ENVX_NEAR(0x1d03, 0x01, envx[21]);
      ASSERT_ENVX_NEAR(0x1b03, 0x01, envx[22]);
      ASSERT_ENVX_NEAR(0x1903, 0x02, envx[23]);
      ASSERT_ENVX_NEAR(0x1703, 0x01, envx[24]);
      ASSERT_ENVX_NEAR(0x1503, 0x01, envx[25]);
      ASSERT_ENVX_NEAR(0x1303, 0x01, envx[26]);
      ASSERT_ENVX_NEAR(0x1103, 0x01, envx[27]);
      ASSERT_ENVX_NEAR(0x0f81, 0x01, envx[28]);
      ASSERT_ENVX_NEAR(0x0e81, 0x01, envx[29]);
      ASSERT_ENVX_NEAR(0x0d81, 0x01, envx[30]);
      ASSERT_ENVX_NEAR(0x0c81, 0x01, envx[31]);

      // SCPH-5501 samples read either these values or one envelope step (8)
      // higher, by the phase of the first capture; the band covers both. Same
      // for the sustain_down block in adsr_sustain_down_linear.
      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(14) | SUSTAIN(0, 0, 0, 1, 0) | RELEASE(0, 1),
              envx, 32);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x7e07, 0x02, envx[1]);
      ASSERT_ENVX_NEAR(0x7c07, 0x02, envx[2]);
      ASSERT_ENVX_NEAR(0x7807, 0x02, envx[4]);
      ASSERT_ENVX_NEAR(0x7407, 0x02, envx[6]);
      ASSERT_ENVX_NEAR(0x7007, 0x02, envx[8]);
      ASSERT_ENVX_NEAR(0x6906, 0x02, envx[12]);
      ASSERT_ENVX_NEAR(0x6206, 0x02, envx[16]);
      ASSERT_ENVX_NEAR(0x5bbc, 0x02, envx[20]);
      ASSERT_ENVX_NEAR(0x55ba, 0x02, envx[24]);
      ASSERT_ENVX_NEAR(0x4fc7, 0x02, envx[28]);
      ASSERT_ENVX_NEAR(0x4c05, 0x02, envx[31]);
    });

    // ENVX 7fbah where silicon holds the sustain level 07ffh

    xit('adsr_sustain_level', async () => {
      const envx = new Uint16Array(16);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(10) | SUSTAIN(3, 0x1f, 0, 1, 0) | RELEASE(0, 1),
              envx, 16);
      for (let i = 10; i < 16; i++) expect(u32(envx[i])).to.eql(0x07ff);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(10) | SUSTAIN(3, 0x1f, 7, 1, 0) | RELEASE(0, 1),
              envx, 16);
      for (let i = 3; i < 16; i++) expect(u32(envx[i])).to.eql(0x3ffa);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(10) | SUSTAIN(3, 0x1f, 11, 1, 0) | RELEASE(0, 1),
              envx, 16);
      for (let i = 2; i < 16; i++) expect(u32(envx[i])).to.eql(0x5ff6);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(10) | SUSTAIN(3, 0x1f, 14, 1, 0) | RELEASE(0, 1),
              envx, 16);
      for (let i = 1; i < 16; i++) expect(u32(envx[i])).to.eql(0x77ff);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(10) | SUSTAIN(3, 0x1f, 15, 1, 0) | RELEASE(0, 1),
              envx, 16);
      for (let i = 1; i < 16; i++) expect(u32(envx[i])).to.eql(0x7fef);
    });

    // ENVX 63abh where silicon reads 5b50h

    xit('adsr_sustain_up_linear', async () => {
      const envx = new Uint16Array(0x20);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 10, 15, 0, 0) | RELEASE(0, 1),
              envx, 8);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x5b50, 14, envx[1]);
      ASSERT_ENVX_NEAR(0x7750, 14, envx[2]);
      for (let i = 3; i < 8; i++) expect(u32(envx[i])).to.eql(0x7fff);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(3, 10, 15, 0, 0) | RELEASE(0, 1),
              envx, 8);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x4f9b, 0x04, envx[1]);
      ASSERT_ENVX_NEAR(0x5f9b, 0x04, envx[2]);
      ASSERT_ENVX_NEAR(0x6f9b, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x7f9b, 0x04, envx[4]);
      for (let i = 5; i < 8; i++) expect(u32(envx[i])).to.eql(0x7fff);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 12, 15, 0, 0) | RELEASE(0, 1),
              envx, 16);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x46d1, 0x04, envx[1]);
      ASSERT_ENVX_NEAR(0x4dd1, 0x04, envx[2]);
      ASSERT_ENVX_NEAR(0x54d1, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x5bd1, 0x04, envx[4]);
      ASSERT_ENVX_NEAR(0x62d1, 0x04, envx[5]);
      ASSERT_ENVX_NEAR(0x69d1, 0x04, envx[6]);
      ASSERT_ENVX_NEAR(0x70d1, 0x04, envx[7]);
      ASSERT_ENVX_NEAR(0x77d1, 0x04, envx[8]);
      ASSERT_ENVX_NEAR(0x7ed1, 0x04, envx[9]);
      for (let i = 10; i < 16; i++) expect(u32(envx[i])).to.eql(0x7fff);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 14, 15, 0, 0) | RELEASE(0, 1),
              envx, 32);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x41b8, 0x02, envx[1]);
      ASSERT_ENVX_NEAR(0x4378, 0x02, envx[2]);
      ASSERT_ENVX_NEAR(0x46f8, 0x02, envx[4]);
      ASSERT_ENVX_NEAR(0x4df8, 0x02, envx[8]);
      ASSERT_ENVX_NEAR(0x54f8, 0x02, envx[12]);
      ASSERT_ENVX_NEAR(0x5bf8, 0x02, envx[16]);
      ASSERT_ENVX_NEAR(0x62f8, 0x02, envx[20]);
      ASSERT_ENVX_NEAR(0x69f8, 0x02, envx[24]);
      ASSERT_ENVX_NEAR(0x70f8, 0x02, envx[28]);
      ASSERT_ENVX_NEAR(0x7638, 0x02, envx[31]);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 16, 15, 0, 0) | RELEASE(0, 1),
              envx, 32);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x4068, 0x02, envx[1]);
      ASSERT_ENVX_NEAR(0x4228, 0x02, envx[5]);
      ASSERT_ENVX_NEAR(0x4458, 0x02, envx[10]);
      ASSERT_ENVX_NEAR(0x4688, 0x02, envx[15]);
      ASSERT_ENVX_NEAR(0x48b8, 0x02, envx[20]);
      ASSERT_ENVX_NEAR(0x4ae8, 0x02, envx[25]);
      ASSERT_ENVX_NEAR(0x4d88, 0x02, envx[31]);
    });

    // ENVX 382fh where silicon reads 2c7ch

    xit('adsr_sustain_down_linear', async () => {
      const envx = new Uint16Array(0x20);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(3, 10, 15, 1, 0) | RELEASE(0, 1),
              envx, 8);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x2c7c, 10, envx[1]);
      ASSERT_ENVX_NEAR(0x187c, 10, envx[2]);
      ASSERT_ENVX_NEAR(0x047c, 10, envx[3]);
      for (let i = 4; i < 8; i++) expect(u32(envx[i])).to.eql(0x0000);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 12, 15, 1, 0) | RELEASE(0, 1),
              envx, 16);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x3833, 0x04, envx[1]);
      ASSERT_ENVX_NEAR(0x3033, 0x04, envx[2]);
      ASSERT_ENVX_NEAR(0x2833, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x2033, 0x04, envx[4]);
      ASSERT_ENVX_NEAR(0x1833, 0x04, envx[5]);
      ASSERT_ENVX_NEAR(0x1033, 0x04, envx[6]);
      ASSERT_ENVX_NEAR(0x0833, 0x04, envx[7]);
      ASSERT_ENVX_NEAR(0x0033, 0x04, envx[8]);
      for (let i = 9; i < 16; i++) expect(u32(envx[i])).to.eql(0x0000);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 14, 15, 1, 0) | RELEASE(0, 1),
              envx, 32);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x3e07, 0x02, envx[1]);
      ASSERT_ENVX_NEAR(0x3c07, 0x02, envx[2]);
      ASSERT_ENVX_NEAR(0x3807, 0x02, envx[4]);
      ASSERT_ENVX_NEAR(0x3007, 0x02, envx[8]);
      ASSERT_ENVX_NEAR(0x2807, 0x02, envx[12]);
      ASSERT_ENVX_NEAR(0x2007, 0x02, envx[16]);
      ASSERT_ENVX_NEAR(0x1807, 0x02, envx[20]);
      ASSERT_ENVX_NEAR(0x1007, 0x02, envx[24]);
      ASSERT_ENVX_NEAR(0x0807, 0x02, envx[28]);
      ASSERT_ENVX_NEAR(0x0207, 0x02, envx[31]);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 16, 15, 1, 0) | RELEASE(0, 1),
              envx, 32);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x3f85, 0x02, envx[1]);
      ASSERT_ENVX_NEAR(0x3e85, 0x02, envx[3]);
      ASSERT_ENVX_NEAR(0x3d05, 0x02, envx[6]);
      ASSERT_ENVX_NEAR(0x3b85, 0x02, envx[9]);
      ASSERT_ENVX_NEAR(0x3a05, 0x02, envx[12]);
      ASSERT_ENVX_NEAR(0x3885, 0x02, envx[15]);
      ASSERT_ENVX_NEAR(0x3705, 0x02, envx[18]);
      ASSERT_ENVX_NEAR(0x3585, 0x02, envx[21]);
      ASSERT_ENVX_NEAR(0x3405, 0x02, envx[24]);
      ASSERT_ENVX_NEAR(0x3285, 0x02, envx[27]);
      ASSERT_ENVX_NEAR(0x3105, 0x02, envx[30]);
    });

    // ENVX 4eeah where silicon reads 46d1h

    xit('adsr_sustain_up_exponential', async () => {
      const envx = new Uint16Array(0x20);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 12, 15, 0, 1) | RELEASE(0, 1),
              envx, 24);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x46d1, 0x04, envx[1]);
      ASSERT_ENVX_NEAR(0x4dd1, 0x04, envx[2]);
      ASSERT_ENVX_NEAR(0x54d1, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x5bd1, 0x04, envx[4]);
      ASSERT_ENVX_NEAR(0x60ba, 0x02, envx[5]);
      ASSERT_ENVX_NEAR(0x627a, 0x02, envx[6]);
      ASSERT_ENVX_NEAR(0x643a, 0x02, envx[7]);
      ASSERT_ENVX_NEAR(0x65fa, 0x02, envx[8]);
      ASSERT_ENVX_NEAR(0x67ba, 0x02, envx[9]);
      ASSERT_ENVX_NEAR(0x6cfa, 0x02, envx[12]);
      ASSERT_ENVX_NEAR(0x73fa, 0x02, envx[16]);
      ASSERT_ENVX_NEAR(0x7afa, 0x02, envx[20]);
      expect(u32(envx[23])).to.eql(0x7fff);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 14, 15, 0, 1) | RELEASE(0, 1),
              envx, 32);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x41b8, 0x02, envx[1]);
      ASSERT_ENVX_NEAR(0x4df8, 0x02, envx[8]);
      ASSERT_ENVX_NEAR(0x5bf8, 0x02, envx[16]);
      ASSERT_ENVX_NEAR(0x6051, 0x02, envx[19]);
      ASSERT_ENVX_NEAR(0x60c1, 0x02, envx[20]);
      ASSERT_ENVX_NEAR(0x6211, 0x02, envx[23]);
      ASSERT_ENVX_NEAR(0x6361, 0x02, envx[26]);
      ASSERT_ENVX_NEAR(0x6591, 0x02, envx[31]);
    });

    // ENVX 440bh where silicon reads 3c19h

    xit('adsr_sustain_down_exponential', async () => {
      const envx = new Uint16Array(0x20);

      spu_adsr_capture(
              ATTACK(0, 1, 0) | DECAY(0) | SUSTAIN(0, 12, 15, 1, 1) | RELEASE(0, 1),
              envx, 32);
      expect(u32(envx[0])).to.eql(0x1c00);
      // Multiplicative decrease — deltas shrink as EnvVol drops.
      ASSERT_ENVX_NEAR(0x3c19, 0x02, envx[1]);
      ASSERT_ENVX_NEAR(0x3819, 0x02, envx[2]);
      ASSERT_ENVX_NEAR(0x3419, 0x02, envx[3]);
      ASSERT_ENVX_NEAR(0x3019, 0x02, envx[4]);
      ASSERT_ENVX_NEAR(0x2d12, 0x02, envx[5]);
      ASSERT_ENVX_NEAR(0x2a12, 0x02, envx[6]);
      ASSERT_ENVX_NEAR(0x2712, 0x02, envx[7]);
      ASSERT_ENVX_NEAR(0x2412, 0x02, envx[8]);
      ASSERT_ENVX_NEAR(0x2112, 0x02, envx[9]);
      ASSERT_ENVX_NEAR(0x1eb7, 0x01, envx[10]);
      ASSERT_ENVX_NEAR(0x1ab7, 0x01, envx[12]);
      ASSERT_ENVX_NEAR(0x16b7, 0x01, envx[14]);
      ASSERT_ENVX_NEAR(0x12b7, 0x01, envx[16]);
      ASSERT_ENVX_NEAR(0x0f5b, 0x01, envx[18]);
      ASSERT_ENVX_NEAR(0x0c5b, 0x01, envx[21]);
      ASSERT_ENVX_NEAR(0x095b, 0x01, envx[24]);
      ASSERT_ENVX_NEAR(0x065b, 0x01, envx[27]);
      ASSERT_ENVX_NEAR(0x035b, 0x01, envx[30]);
    });

    // the attack peaks at 7fffh where silicon reads 7ff7h

    xit('adsr_release_linear', async () => {
      const envx = new Uint16Array(0x20);

      spu_adsr_capture_with_keyoff(
              ATTACK(0, 1, 0) | DECAY(15) |
              SUSTAIN(3, 0x1f, 15, 0, 0) | RELEASE(12, 0),
              envx, 24, 3);
      expect(u32(envx[0])).to.eql(0x1c00);
      expect(u32(envx[1])).to.eql(0x7ff7);
      expect(u32(envx[2])).to.eql(0x7ff7);
      expect(u32(envx[3])).to.eql(0x7ff7);
      ASSERT_ENVX_NEAR(0x77fb, 0x04, envx[4]);
      ASSERT_ENVX_NEAR(0x6ffb, 0x04, envx[5]);
      ASSERT_ENVX_NEAR(0x67fb, 0x04, envx[6]);
      ASSERT_ENVX_NEAR(0x5ffb, 0x04, envx[7]);
      ASSERT_ENVX_NEAR(0x57fb, 0x04, envx[8]);
      ASSERT_ENVX_NEAR(0x4ffb, 0x04, envx[9]);
      ASSERT_ENVX_NEAR(0x47fb, 0x04, envx[10]);
      ASSERT_ENVX_NEAR(0x3ffb, 0x04, envx[11]);
      ASSERT_ENVX_NEAR(0x37fb, 0x04, envx[12]);
      ASSERT_ENVX_NEAR(0x2ffb, 0x04, envx[13]);
      ASSERT_ENVX_NEAR(0x27fb, 0x04, envx[14]);
      ASSERT_ENVX_NEAR(0x1ffb, 0x04, envx[15]);
      ASSERT_ENVX_NEAR(0x17fb, 0x04, envx[16]);
      ASSERT_ENVX_NEAR(0x0ffb, 0x04, envx[17]);
      ASSERT_ENVX_NEAR(0x07fb, 0x04, envx[18]);
      for (let i = 19; i < 24; i++) expect(u32(envx[i])).to.eql(0x0000);

      spu_adsr_capture_with_keyoff(
              ATTACK(0, 1, 0) | DECAY(15) |
              SUSTAIN(3, 0x1f, 15, 0, 0) | RELEASE(14, 0),
              envx, 32, 3);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x7ffb, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x7dfb, 0x04, envx[4]);
      ASSERT_ENVX_NEAR(0x7bfb, 0x04, envx[5]);
      ASSERT_ENVX_NEAR(0x77fb, 0x04, envx[7]);
      ASSERT_ENVX_NEAR(0x6ffb, 0x04, envx[11]);
      ASSERT_ENVX_NEAR(0x67fb, 0x04, envx[15]);
      ASSERT_ENVX_NEAR(0x5ffb, 0x04, envx[19]);
      ASSERT_ENVX_NEAR(0x57fb, 0x04, envx[23]);
      ASSERT_ENVX_NEAR(0x4ffb, 0x04, envx[27]);
      ASSERT_ENVX_NEAR(0x47fb, 0x04, envx[31]);

      spu_adsr_capture_with_keyoff(
              ATTACK(0, 1, 0) | DECAY(15) |
              SUSTAIN(3, 0x1f, 15, 0, 0) | RELEASE(16, 0),
              envx, 16, 3);
      expect(u32(envx[0])).to.eql(0x1c00);
      ASSERT_ENVX_NEAR(0x7ffb, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x7f7b, 0x04, envx[4]);
      ASSERT_ENVX_NEAR(0x7efb, 0x04, envx[5]);
      ASSERT_ENVX_NEAR(0x7dfb, 0x04, envx[7]);
      ASSERT_ENVX_NEAR(0x7bfb, 0x04, envx[11]);
      ASSERT_ENVX_NEAR(0x79fb, 0x04, envx[15]);
    });

    // the attack peaks at 7fffh where silicon reads 7ff7h

    xit('adsr_release_exponential', async () => {
      const envx = new Uint16Array(0x20);

      spu_adsr_capture_with_keyoff(
              ATTACK(0, 1, 0) | DECAY(15) |
              SUSTAIN(3, 0x1f, 15, 0, 0) | RELEASE(12, 1),
              envx, 24, 2);
      expect(u32(envx[0])).to.eql(0x1c00);
      expect(u32(envx[1])).to.eql(0x7ff7);
      expect(u32(envx[2])).to.eql(0x7ff7);
      ASSERT_ENVX_NEAR(0x77fb, 0x04, envx[3]);
      ASSERT_ENVX_NEAR(0x6ffb, 0x04, envx[4]);
      ASSERT_ENVX_NEAR(0x68fb, 0x04, envx[5]);
      ASSERT_ENVX_NEAR(0x61fb, 0x04, envx[6]);
      ASSERT_ENVX_NEAR(0x5bb3, 0x03, envx[7]);
      ASSERT_ENVX_NEAR(0x55b3, 0x03, envx[8]);
      ASSERT_ENVX_NEAR(0x4fbf, 0x03, envx[9]);
      ASSERT_ENVX_NEAR(0x4abf, 0x03, envx[10]);
      ASSERT_ENVX_NEAR(0x45bf, 0x03, envx[11]);
      ASSERT_ENVX_NEAR(0x40bf, 0x03, envx[12]);
      ASSERT_ENVX_NEAR(0x3c99, 0x02, envx[13]);
      ASSERT_ENVX_NEAR(0x3899, 0x02, envx[14]);
      ASSERT_ENVX_NEAR(0x3499, 0x02, envx[15]);
      ASSERT_ENVX_NEAR(0x3099, 0x02, envx[16]);
      ASSERT_ENVX_NEAR(0x2d72, 0x02, envx[17]);
      ASSERT_ENVX_NEAR(0x2a72, 0x02, envx[18]);
      ASSERT_ENVX_NEAR(0x2772, 0x02, envx[19]);
      ASSERT_ENVX_NEAR(0x2472, 0x02, envx[20]);
      ASSERT_ENVX_NEAR(0x2172, 0x02, envx[21]);
      ASSERT_ENVX_NEAR(0x1ef7, 0x01, envx[22]);
      ASSERT_ENVX_NEAR(0x1cf7, 0x01, envx[23]);
    });


  });

  describe('IRQs from the voice read pointer (spu-irq)', () => {

    // Polled on SPUSTAT bit 6, with interrupts off. Pinned on silicon: an
    // ack re-arms at once, and a mid-block IRQ address fires on every one of
    // eight attempts as the sample loops through block 0. The poll counts and
    // the aligned capture vary from run to run on hardware and are not
    // asserted.

    const SPU_IRQ_TEST_ADDR = 0x2000;
    const SPU_IRQ_DUMMY_ADDR = 0x7000;
    const SPU_IRQ_POLL_TIMEOUT = 2000000;
    const SPU_IRQ_REARM_TIMEOUT = 6000000;

    const s_irqSample = new Uint8Array(128);
    for (let block = 0; block < 8; block++) {
      const p = block * 16;
      s_irqSample[p + 1] = block === 0 ? 0x06 : block === 7 ? 0x03 : 0x00;
      const nybble = (block + 1) & 7;
      s_irqSample.fill(nybble | (nybble << 4), p + 2, p + 16);
    }

    const spu_irq_arm = byteAddr => {
      hw.SPU_IRQ_ADDR = byteAddr >>> 3;
      hw.SPU_CTRL = (hw.SPU_CTRL & ~0x0030) | 0x8000 | 0x4000 | 0x0040;
      s.volatile_loop(120);
    };

    // a poll is a few cycles
    const pollStatus = (maxPolls, done) => {
      for (let i = 0; i < maxPolls; i += 4) {
        for (let j = 0; j < 4; j++) if (done()) return i + j + 1;
        m.idle(16);
      }
      return 0;
    };

    const spu_irq_ack_by_disable = () => {
      hw.SPU_CTRL = hw.SPU_CTRL & ~0x0040;
      return pollStatus(100000, () => (hw.SPU_STATUS & 0x0040) === 0) ? 1 : 0;
    };

    const spu_irq_poll_until = maxPolls => pollStatus(maxPolls, () => (hw.SPU_STATUS & 0x0040) !== 0);

    const spu_irq_quiet_unused_voices = () => {
      for (let v = 0; v < 24; v++) {
        const voice = hw.SPU_VOICES[v];
        voice.volumeLeft = 0;
        voice.volumeRight = 0;
        voice.sampleRate = 0x1000;
        voice.sampleStartAddr = SPU_IRQ_DUMMY_ADDR >> 3;
        voice.sampleRepeatAddr = SPU_IRQ_DUMMY_ADDR >> 3;
        voice.adsrLo = 0x000f;
        voice.adsrHi = 0x1fc0;
      }
      hw.SPU_KEY_OFF_LOW = 0;
      hw.SPU_KEY_OFF_HIGH = 0;
      hw.SPU_KEY_ON_LOW = 0xffff;
      hw.SPU_KEY_ON_HIGH = 0x00ff;
      s.spu_busy_wait(200000);
    };

    const spu_irq_prepare = () => {
      s.spu_reset_quiet();
      s.spu_write_sync(SPU_IRQ_DUMMY_ADDR, s.kAdpcmSilent, 64);
      s.spu_write_sync(SPU_IRQ_TEST_ADDR, s_irqSample, 128);
      hw.SPU_CTRL = 0x8000 | 0x4000;
      hw.SPU_VOL_MAIN_LEFT = 0;
      hw.SPU_VOL_MAIN_RIGHT = 0;
      spu_irq_quiet_unused_voices();
      spu_irq_ack_by_disable();
    };

    const spu_irq_start_voice1 = () => {
      hw.SPU_VOICES[1].volumeLeft = 0;
      hw.SPU_VOICES[1].volumeRight = 0;
      s.spu_voice1_keyon(SPU_IRQ_TEST_ADDR, 0x1000);
    };

    const stop = () => {
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.muteSpu();
    };
    it('irq_voice_read_pointer_block_aligned', async () => {
      spu_irq_prepare();
      s.spu_wait_status_bit11_flip();
      spu_irq_arm(SPU_IRQ_TEST_ADDR + 16);
      spu_irq_start_voice1();
      const polls = spu_irq_poll_until(SPU_IRQ_POLL_TIMEOUT);
      const ackCleared = spu_irq_ack_by_disable();
      const statusAfterAck = hw.SPU_STATUS;
      stop();
      expect({ fired: polls !== 0, ackCleared, flagAfterAck: statusAfterAck & 0x0040 })
        .to.eql({ fired: true, ackCleared: 1, flagAfterAck: 0 });
    });
    it('irq_voice_read_pointer_ack_rearms', async () => {
      spu_irq_prepare();
      s.spu_wait_status_bit11_flip();
      spu_irq_arm(SPU_IRQ_TEST_ADDR + 16);
      spu_irq_start_voice1();
      const firstPolls = spu_irq_poll_until(SPU_IRQ_POLL_TIMEOUT);
      const firstAckCleared = spu_irq_ack_by_disable();

      spu_irq_arm(SPU_IRQ_TEST_ADDR + 16);
      const secondPolls = spu_irq_poll_until(SPU_IRQ_REARM_TIMEOUT);
      const secondAckCleared = spu_irq_ack_by_disable();
      stop();

      expect({ firstFired: firstPolls !== 0, firstAckCleared, secondFired: secondPolls !== 0, secondAckCleared, secondPolls })
        .to.eql({ firstFired: true, firstAckCleared: 1, secondFired: true, secondAckCleared: 1, secondPolls: 1 });
    });

    it('irq_voice_read_pointer_mid_block_probe', async () => {
      let hits = 0;
      spu_irq_prepare();
      s.spu_wait_status_bit11_flip();
      spu_irq_arm(SPU_IRQ_TEST_ADDR + 8);
      spu_irq_start_voice1();
      for (let attempt = 0; attempt < 8; attempt++) {
        if (!spu_irq_poll_until(SPU_IRQ_REARM_TIMEOUT)) break;
        hits++;
        spu_irq_ack_by_disable();
        spu_irq_arm(SPU_IRQ_TEST_ADDR + 8);
      }
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      spu_irq_ack_by_disable();
      s.muteSpu();
      expect(hits).to.eql(8);
    });

  });

})
