mdlr('enge:psx:test-spu', ({ include }) => {

  // SPU helpers for the specs, on a test machine: the shared helpers of the
  // nugget SPU tests (tests/spu/spu.c), with the same names. DMA goes through
  // the emulated DMA controller, the busy-wait loops run as MIPS code and the
  // polling loops wait in emulated time.

  const { goldens } = include('enge:psx:spu-golden-data');

  const SPU_UPLOAD_ADDR = 0x1080;
  const SPU_ONSET_SKIP = 15;

  // the ADPCM samples of spu.c, each looping back to start (filter 0, shift 0)
  const samples = {
    kAdpcmSilent: [
      0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ],
    kAdpcmSine: [
      0x00, 0x06, 0x10, 0x43, 0x76, 0x77, 0x77, 0x46, 0x13, 0xe0, 0xbc, 0x89, 0x88, 0x88, 0xb9, 0xec,
      0x00, 0x00, 0x10, 0x43, 0x76, 0x77, 0x77, 0x46, 0x13, 0xe0, 0xbc, 0x89, 0x88, 0x88, 0xb9, 0xec,
      0x00, 0x00, 0x10, 0x43, 0x76, 0x77, 0x77, 0x46, 0x13, 0xe0, 0xbc, 0x89, 0x88, 0x88, 0xb9, 0xec,
      0x00, 0x03, 0x10, 0x43, 0x76, 0x77, 0x77, 0x46, 0x13, 0xe0, 0xbc, 0x89, 0x88, 0x88, 0xb9, 0xec,
    ],
    // a sine sampled at seven points: decoded value period 7 instead of 28
    kAdpcmSine7: [
      0x00, 0x06, 0x60, 0x37, 0x9d, 0x0a, 0x76, 0xd3, 0xa9, 0x60, 0x37, 0x9d, 0x0a, 0x76, 0xd3, 0xa9,
      0x00, 0x00, 0x60, 0x37, 0x9d, 0x0a, 0x76, 0xd3, 0xa9, 0x60, 0x37, 0x9d, 0x0a, 0x76, 0xd3, 0xa9,
      0x00, 0x00, 0x60, 0x37, 0x9d, 0x0a, 0x76, 0xd3, 0xa9, 0x60, 0x37, 0x9d, 0x0a, 0x76, 0xd3, 0xa9,
      0x00, 0x03, 0x60, 0x37, 0x9d, 0x0a, 0x76, 0xd3, 0xa9, 0x60, 0x37, 0x9d, 0x0a, 0x76, 0xd3, 0xa9,
    ],
    kAdpcmTriangle: [
      0x00, 0x06, 0x10, 0x32, 0x54, 0x76, 0x56, 0x34, 0x12, 0xe0, 0xcd, 0xab, 0x89, 0xa9, 0xcb, 0xed,
      0x00, 0x00, 0x10, 0x32, 0x54, 0x76, 0x56, 0x34, 0x12, 0xe0, 0xcd, 0xab, 0x89, 0xa9, 0xcb, 0xed,
      0x00, 0x00, 0x10, 0x32, 0x54, 0x76, 0x56, 0x34, 0x12, 0xe0, 0xcd, 0xab, 0x89, 0xa9, 0xcb, 0xed,
      0x00, 0x03, 0x10, 0x32, 0x54, 0x76, 0x56, 0x34, 0x12, 0xe0, 0xcd, 0xab, 0x89, 0xa9, 0xcb, 0xed,
    ],
    kAdpcmSquare: [
      0x00, 0x06, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88,
      0x00, 0x00, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88,
      0x00, 0x00, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88,
      0x00, 0x03, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88,
    ],
    kAdpcmSine394Hz: [
      0x00, 0x06, 0x00, 0x10, 0x21, 0x32, 0x33, 0x44, 0x54, 0x55, 0x66, 0x76, 0x77, 0x77, 0x77, 0x77,
      0x00, 0x00, 0x77, 0x77, 0x77, 0x77, 0x77, 0x66, 0x56, 0x55, 0x44, 0x34, 0x33, 0x22, 0x11, 0x00,
      0x00, 0x00, 0xf0, 0xef, 0xde, 0xcd, 0xcc, 0xbb, 0xab, 0xaa, 0x99, 0x89, 0x88, 0x88, 0x88, 0x88,
      0x00, 0x03, 0x88, 0x88, 0x88, 0x88, 0x88, 0x99, 0xa9, 0xaa, 0xbb, 0xcb, 0xcc, 0xdd, 0xee, 0xff,
    ],
    kAdpcmSine5512Hz: [
      0x00, 0x06, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57,
      0x00, 0x00, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8,
      0x00, 0x00, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57,
      0x00, 0x03, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8, 0x50, 0x57, 0xa0, 0xa8,
    ],
  };

  // a golden capture: { magic, length, warmup, period, samples (Int16Array) }
  const golden = name => {
    const bytes = Uint8Array.from(atob(goldens[name]), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const length = view.getUint32(4, true);
    return {
      name,
      magic: view.getUint32(0, true), length, warmup: view.getUint32(8, true), period: view.getUint32(12, true),
      samples: new Int16Array(bytes.buffer.slice(length, length + ((bytes.length - length) & ~1))),
    };
  };

  const spuHelpers = (m, hw) => {
    // spu_busy_wait: 3 cycles per loop, on the CPU
    const busy = m.asm(0x80017000, `
      spu_busy_wait:
            beqz  $a0, 2f
            nop
      1:    addiu $a0, $a0, -1
            bnez  $a0, 1b
            nop
      2:    jr    $ra
            nop
      volatile_loop:
            blez  $a0, 2f
            nop
      1:    lw    $t0, 0($sp)
            addiu $a0, -1
            sw    $t0, 0($sp)
            bgtz  $a0, 1b
            nop
      2:    jr    $ra
            nop
    `).labels;

    const s = {
      SPU_UPLOAD_ADDR, SPU_ONSET_SKIP, ...samples, golden,

      // the statics of spu.c
      s_upload: hw.alloc(Uint8Array, 128),
      s_capture: hw.alloc(Int16Array, 512),
      s_readback: hw.alloc(Uint8Array, 4096),
      s_reverb_work: hw.alloc(Uint8Array, 0x3000),

      spu_busy_wait: cycles => { const n = Math.trunc(cycles / 3); if (n) m.call(busy.spu_busy_wait, n); },
      // for (volatile int i = 0; i < n; i++);
      volatile_loop: n => m.call(busy.volatile_loop, n),
      // a polling loop of at most `polls` reads; one read is a few cycles
      poll: (polls, done) => { for (let i = 0; i < polls; ++i) { if (done()) return true; m.idle(4); } return done(); },
      // an unbounded polling loop, bounded here by `cycles`
      wait: (done, cycles = 33868800) => m.idleUntil(done, cycles, 8) >= 0,

      spu_dma_sync(spuByteAddr, cpuAddr, bytes, isRead) {
        const tsa = (spuByteAddr >>> 3) & 0xffff;
        const modeBits = isRead ? 0x0030 : 0x0020;
        const delay = isRead ? 0x22000000 : 0x20000000;
        const chcr = isRead ? 0x01000200 : 0x01000201;
        hw.SPU_RAM_DTA = tsa;
        s.poll(0xf01, () => (hw.SPU_RAM_DTA & 0xffff) === tsa);
        hw.SPU_CTRL = (hw.SPU_CTRL & ~0x0030) | modeBits;
        s.volatile_loop(60);
        s.poll(0xf01, () => (hw.SPU_STATUS & 0x30) === modeBits);
        hw.SPU_DELAY = (hw.SPU_DELAY & 0xf0ffffff) | delay;
        const blocks = (bytes >>> 6) + ((bytes & 0x3f) ? 1 : 0);
        hw.DMA_CTRL[hw.DMA_SPU].MADR = cpuAddr & 0x1fffffff;
        hw.DMA_CTRL[hw.DMA_SPU].BCR = (blocks << 16) | 0x10;
        hw.DMA_CTRL[hw.DMA_SPU].CHCR = chcr;
        s.wait(() => (hw.DMA_CTRL[hw.DMA_SPU].CHCR & 0x01000000) === 0);
        // a write has landed once SPUSTAT bit 7 sets
        if (!isRead) s.poll(65536, () => (hw.SPU_STATUS & 0x0080) !== 0);
        hw.SPU_CTRL = hw.SPU_CTRL & ~0x0030;
        s.volatile_loop(60);
      },
      // src / dst: a RAM buffer (hw.ram, hw.alloc), or any other typed array
      // or array of bytes, which goes through a RAM bounce buffer
      spu_write_sync(spuAddr, src, bytes) {
        if (src.address === undefined) {
          const data = src.buffer ? new Uint8Array(src.buffer, src.byteOffset, src.byteLength) : Uint8Array.from(src);
          const bounce = s.bounce(bytes);
          bounce.set(data.subarray(0, Math.min(bytes, data.length)));
          src = bounce;
        }
        s.spu_dma_sync(spuAddr, hw.addressOf(src), bytes, 0);
      },
      spu_read_sync(spuAddr, dst, bytes) {
        if (dst.address !== undefined) return s.spu_dma_sync(spuAddr, hw.addressOf(dst), bytes, 1);
        const bounce = s.bounce(bytes);
        s.spu_dma_sync(spuAddr, hw.addressOf(bounce), bytes, 1);
        if (dst.buffer) {
          const out = new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength);
          out.set(bounce.subarray(0, Math.min(bytes, out.length)));
        } else {
          for (let i = 0; i < Math.min(bytes, dst.length); ++i) dst[i] = bounce[i];
        }
      },
      bounce: (() => { let buffer = null; return bytes => { if (!buffer || buffer.length < bytes) buffer = hw.alloc(Uint8Array, Math.max(bytes, 0x4000)); return buffer; }; })(),

      spu_wait_status_bit11_flip() {
        s.wait(() => (hw.SPU_STATUS & 0x0800) !== 0);
        s.wait(() => (hw.SPU_STATUS & 0x0800) === 0);
      },

      muteSpu() {
        hw.SPU_REVERB_RIGHT = 0;
        hw.SPU_REVERB_LEFT = 0;
        hw.SPU_VOL_MAIN_RIGHT = 0;
        hw.SPU_VOL_MAIN_LEFT = 0;
      },

      spu_reset_quiet() {
        hw.DPCR = hw.DPCR | 0x000b0000;
        hw.SPU_CTRL = 0;
        hw.SPU_VOL_MAIN_LEFT = 0; hw.SPU_VOL_MAIN_RIGHT = 0;
        hw.SPU_REVERB_LEFT = 0; hw.SPU_REVERB_RIGHT = 0;
        hw.SPU_KEY_OFF_LOW = 0xffff; hw.SPU_KEY_OFF_HIGH = 0xffff;
        hw.SPU_PITCH_MOD_LOW = 0; hw.SPU_PITCH_MOD_HIGH = 0;
        hw.SPU_NOISE_EN_LOW = 0; hw.SPU_NOISE_EN_HIGH = 0;
        hw.SPU_REVERB_EN_LOW = 0; hw.SPU_REVERB_EN_HIGH = 0;
        // the reverb work area at the top of SPU RAM, away from the tests
        hw.SPU_REVERB_ADDR = 0xffff;
        hw.SPU_RAM_DTC = 4;
        hw.SPU_CTRL = 0x8000;
      },

      // voice 1 with the envelope at peak from the first sample, so the
      // capture mirror is the raw decoded waveform
      spu_voice1_keyon(spuAddr, pitch) {
        hw.SPU_VOICES[1].sampleRate = pitch;
        hw.SPU_VOICES[1].sampleStartAddr = spuAddr >>> 3;
        hw.SPU_VOICES[1].sampleRepeatAddr = spuAddr >>> 3;
        hw.SPU_VOICES[1].adsrLo = 0x000f;
        hw.SPU_VOICES[1].adsrHi = 0x1fc0;
        hw.SPU_KEY_OFF_LOW = 0; hw.SPU_KEY_OFF_HIGH = 0;
        hw.SPU_KEY_ON_LOW = 1 << 1;
      },

      spu_voice1_capture_is_silent: () => s.s_capture.every(v => v === 0),

      // A voice 1 capture synchronised on SPUSTAT bit 11: key off and drain,
      // wait for the capture to start, key on, wait for it to complete, read
      // the capture ring by DMA.
      run_voice1_with_sample(sample64, pitch) {
        s.spu_reset_quiet();
        for (let i = 0; i < 64; ++i) s.s_upload[i] = sample64[i];
        for (let i = 64; i < 128; ++i) s.s_upload[i] = 0xaa;
        s.spu_write_sync(SPU_UPLOAD_ADDR, s.s_upload, 128);
        hw.SPU_CTRL = 0x8000 | 0x4000;
        hw.SPU_VOL_MAIN_LEFT = 0x3fff; hw.SPU_VOL_MAIN_RIGHT = 0x3fff;
        hw.SPU_KEY_OFF_LOW = 0xffff; hw.SPU_KEY_OFF_HIGH = 0xffff;
        s.spu_busy_wait(800000);
        s.spu_wait_status_bit11_flip();
        s.spu_voice1_keyon(SPU_UPLOAD_ADDR, pitch);
        s.spu_wait_status_bit11_flip();
        s.spu_read_sync(0x0800, s.s_capture, 1024);
        for (let retry = 0; retry < 4 && s.spu_voice1_capture_is_silent(); ++retry) {
          s.spu_wait_status_bit11_flip();
          s.spu_read_sync(0x0800, s.s_capture, 1024);
        }
        hw.SPU_KEY_OFF_LOW = 0xffff; hw.SPU_KEY_OFF_HIGH = 0xffff;
        s.muteSpu();
      },

      // Compare a capture with a golden, tolerating the capture-start jitter:
      // every one of the 512 ring offsets is tried, nearest to the sync point
      // first; the warmup and key-on onset are left out; past the golden the
      // capture has to repeat with the golden's period. 0 when it matches,
      // else the first sample that does not, plus 1.
      spu_compare_golden(name, cap = s.s_capture) {
        const h = golden(name);
        const g = h.samples;
        const a = cap;
        const warmupS = h.warmup >> 1, periodS = h.period >> 1, keptS = warmupS + periodS;
        const startS = Math.max(warmupS, SPU_ONSET_SKIP);
        if (h.magic !== 0x544d4350) return 1;
        if (keptS <= 0 || keptS > 512) return 1;
        let bestS = 0, bestBad = Infinity;
        for (let k = 0; k < 512; ++k) {
          const sh = (k & 1) ? -((k + 1) >> 1) : (k >> 1);
          let bad = 0;
          for (let i = startS; i < keptS; ++i) if (a[(sh + i) & 511] !== g[i]) bad++;
          if (bad < bestBad) { bestBad = bad; bestS = sh; }
        }
        for (let i = startS; i < keptS; ++i) {
          if (a[(bestS + i) & 511] !== g[i]) return i + 1;
        }
        for (let i = keptS; i < 512; ++i) {
          if (a[(bestS + i) & 511] !== a[(bestS + i - periodS) & 511]) return i + 1;
        }
        return 0;
      },
    };
    return s;
  };

  return { spuHelpers, samples, golden, SPU_UPLOAD_ADDR };
})
