mdlr('[test]enge:psx:spu-voices', ({ include, test }) => {

  const { describe, it, xit, expect, after } = test;

  // Ported from the nugget SPU voice tests (https://github.com/pcsx-redux/
  // nugget, tests/spu-endx, spu-endmute, spu-endredirect, spu-irqrefire,
  // spu-offvoice, spu-volsweep and spu-konlatch, MIT), verified on real
  // hardware. Each was a program of its own, so each case boots a machine
  // of its own. The checks are the programs' FAIL lines: a case passes when
  // it collects none.
  //
  // spu-envx, spu-capring, spu-revread, spu-revstream and spu-wide-writes
  // print observations and give no verdict, so there is nothing to port.

  const { createMachine } = include('enge:psx:test-machine');
  const { hardware } = include('enge:psx:test-hw');
  const { spuHelpers } = include('enge:psx:test-spu');

  const hex = (v, n = 4) => (v >>> 0).toString(16).padStart(n, '0');

  let m, hw, s;
  const boot = () => {
    m?.dispose();
    m = createMachine();
    hw = hardware(m);
    s = spuHelpers(m, hw);
    hw.IMASK = 0;
    hw.IREG = 0;
  };
  after(async () => { m?.dispose(); });

  // A polling loop of at most `limit` reads: the number of the read that saw
  // `done`, or 0. A read with its loop is taken as `cycles` CPU cycles.
  const poll = (limit, done, cycles = 8) => {
    const per = Math.max(1, 16 / cycles);
    for (let i = 0; i < limit; i += per) {
      if (done()) return i + 1;
      m.idle(16);
    }
    return 0;
  };

  // spu_dma_write of the voice tests: block mode DMA4 from a RAM copy of
  // `data`, with the C program's bounded waits
  const spu_dma_write = (spuByteAddr, data) => {
    const bytes = data.length;
    const src = hw.alloc(Uint8Array, bytes);
    src.set(data);
    const tsa = (spuByteAddr >>> 3) & 0xffff;
    hw.SPU_RAM_DTA = tsa;
    poll(0xf01, () => (hw.SPU_RAM_DTA & 0xffff) === tsa);
    hw.SPU_CTRL = (hw.SPU_CTRL & ~0x0030) | 0x0020;
    s.volatile_loop(60);
    poll(0xf01, () => (hw.SPU_STATUS & 0x30) === 0x0020);
    hw.SPU_DELAY = (hw.SPU_DELAY & 0xf0ffffff) | 0x20000000;
    const blocks = (bytes >>> 6) + ((bytes & 0x3f) ? 1 : 0);
    hw.DMA_CTRL[hw.DMA_SPU].MADR = src.address & 0x1fffffff;
    hw.DMA_CTRL[hw.DMA_SPU].BCR = (blocks << 16) | 0x10;
    hw.DMA_CTRL[hw.DMA_SPU].CHCR = 0x01000201;
    poll(0x100000, () => (hw.DMA_CTRL[hw.DMA_SPU].CHCR & 0x01000000) === 0);
    hw.SPU_CTRL = hw.SPU_CTRL & ~0x0030;
    s.volatile_loop(60);
    return (hw.DMA_CTRL[hw.DMA_SPU].CHCR & 0x01000000) === 0;
  };

  // the start of most of the programs: SPU off, RAM transfers set up, voices
  // keyed off, SPU on
  const spu_init = () => {
    hw.DPCR = hw.DPCR | 0x000b0000;
    hw.SPU_CTRL = 0;
    s.volatile_loop(60);
    hw.SPU_RAM_DTC = 4;
    s.volatile_loop(60);
    hw.SPU_VOL_MAIN_LEFT = 0;
    hw.SPU_VOL_MAIN_RIGHT = 0;
    hw.SPU_KEY_OFF_LOW = 0xffff;
    hw.SPU_KEY_OFF_HIGH = 0xffff;
    hw.SPU_IRQ_ADDR = 0;
    s.volatile_loop(60);
    hw.SPU_CTRL = 0x8000;
    s.volatile_loop(60);
  };

  const kSineBody = [0x10, 0x43, 0x76, 0x77, 0x77, 0x46, 0x13, 0xe0, 0xbc, 0x89, 0x88, 0x88, 0xb9, 0xec];

  // eight blocks of a constant nibble (block + 1), looping block 7 to block 0
  const irqSample = () => {
    const sample = new Uint8Array(128);
    for (let block = 0; block < 8; block++) {
      const p = block * 16;
      sample[p + 1] = block === 0 ? 0x06 : block === 7 ? 0x03 : 0x00;
      const nybble = (block + 1) & 7;
      sample.fill(nybble | (nybble << 4), p + 2, p + 16);
    }
    return sample;
  };

  const SPU_CTRL_ENABLE = 0x8000, SPU_CTRL_UNMUTE = 0x4000, SPU_CTRL_IRQ_ENABLE = 0x0040;
  const SPU_STATUS_IRQ_FLAG = 0x0040;

  const irq_arm = byteAddr => {
    hw.SPU_IRQ_ADDR = byteAddr >>> 3;
    hw.SPU_CTRL = (hw.SPU_CTRL & ~0x0030) | SPU_CTRL_ENABLE | SPU_CTRL_UNMUTE | SPU_CTRL_IRQ_ENABLE;
    s.volatile_loop(120);
  };
  const irq_poll = limit => poll(limit, () => (hw.SPU_STATUS & SPU_STATUS_IRQ_FLAG) !== 0);
  const irq_ack = () => {
    hw.SPU_CTRL = hw.SPU_CTRL & ~SPU_CTRL_IRQ_ENABLE;
    return poll(100000, () => (hw.SPU_STATUS & SPU_STATUS_IRQ_FLAG) === 0) ? 1 : 0;
  };

  describe('ENDX clears on key-on and latches at the end block (spu-endx)', () => {

    // Voice 1 and voice 0 play to their end block and latch ENDX; keying
    // voice 1 on again clears its bit, and only its bit, until it reaches the
    // end block again.
    const endx = oneShot => {
      boot();
      const failures = [];
      hw.DPCR = hw.DPCR | 0x000b0000;
      hw.SPU_CTRL = 0;
      s.volatile_loop(60);
      hw.SPU_RAM_DTC = 4;
      s.volatile_loop(60);
      hw.SPU_VOL_MAIN_LEFT = 0;
      hw.SPU_VOL_MAIN_RIGHT = 0;
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.volatile_loop(60);
      hw.SPU_CTRL = 0x8000;
      s.volatile_loop(60);

      const upload = new Uint8Array(128).fill(0xaa);
      upload.set(s.kAdpcmSine);
      if (oneShot) upload[3 * 16 + 1] = 0x01; // end without repeat
      if (!spu_dma_write(0x1080, upload)) return ['the sample upload never finished'];

      for (const v of [1, 0]) {
        const voice = hw.SPU_VOICES[v];
        voice.sampleStartAddr = 0x1080 >> 3;
        voice.sampleRate = 0x1000;
        voice.adsrLo = 0x000f;
        voice.adsrHi = 0x80ff;
        voice.volumeLeft = 0x3fff;
        voice.volumeRight = 0x3fff;
      }
      hw.SPU_CTRL = 0x8000 | 0x4000;
      s.volatile_loop(60);
      hw.SPU_KEY_ON_LOW = (1 << 1) | (1 << 0);
      hw.SPU_KEY_ON_HIGH = 0;

      // phase 1: both latch
      for (let spins = 0; spins < 20000 && (hw.SPU_ENDX_LOW & 3) !== 3; spins++) s.volatile_loop(20000);
      const latched = (hw.SPU_ENDX_LOW & 3) === 3;

      // phase 2: key voice 1 on again from a known-set state
      hw.SPU_KEY_ON_LOW = 1 << 1;
      hw.SPU_KEY_ON_HIGH = 0;
      const endxWindow = [];
      for (let i = 0; i < 16; i++) {
        endxWindow.push(hw.SPU_ENDX_LOW & 0xffff);
        s.volatile_loop(20);
      }

      // and it latches again
      for (let spins = 0; spins < 20000 && !(hw.SPU_ENDX_LOW & 2); spins++) s.volatile_loop(20000);
      const relatched = (hw.SPU_ENDX_LOW & 2) !== 0;

      if (!latched) failures.push('the bit never latched, so nothing below is meaningful');
      if (!endxWindow.some(v => !(v & 2))) failures.push('key-on did not clear voice 1 within the sampled window');
      const lost = endxWindow.findIndex(v => !(v & 1));
      if (lost >= 0) failures.push(`voice 0 lost its bit at sample ${lost}; key-on wiped more than the keyed voice`);
      if (!relatched) failures.push('voice 1 never re-latched after the second key-on');
      return failures;
    };

    it('looping sample', async () => {
      expect(endx(false)).to.eql([]);
    });

    it('one-shot sample (ONESHOT=true)', async () => {
      expect(endx(true)).to.eql([]);
    });

  });

  describe('an end block without repeat mutes the voice (spu-endmute)', () => {

    // Voice 1 plays sixteen blocks ending without repeat, voice 3 the same
    // sixteen blocks looping. Sampled on SPUSTAT bit 11, voice 1 reads its
    // peak, then 0 from a toggle that depends on the pitch, and stays there;
    // voice 3 stays at its peak.
    const ONESHOT_ADDR = 0x1080, LOOP_ADDR = 0x1180, BLOCKS = 16, READS = 20;

    let ready = false;
    const setup = () => {
      if (ready) return;
      boot();
      hw.DPCR = hw.DPCR | 0x000b0000;
      hw.SPU_CTRL = 0;
      s.volatile_loop(60);
      hw.SPU_RAM_DTC = 4;
      s.volatile_loop(60);
      hw.SPU_VOL_MAIN_LEFT = 0;
      hw.SPU_VOL_MAIN_RIGHT = 0;
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      s.volatile_loop(60);
      const upload = new Uint8Array(2 * BLOCKS * 16);
      for (let b = 0; b < 2 * BLOCKS; b++) upload.set(kSineBody, b * 16 + 2);
      upload[(BLOCKS - 1) * 16 + 1] = 0x01;     // one-shot: end, no repeat
      upload[BLOCKS * 16 + 1] = 0x04;           // looping control: loop start
      upload[(2 * BLOCKS - 1) * 16 + 1] = 0x03; // looping control: end and repeat
      hw.SPU_CTRL = 0x8000;
      s.volatile_loop(60);
      spu_dma_write(ONESHOT_ADDR, upload);
      hw.SPU_CTRL = 0x8000 | 0x4000;
      s.volatile_loop(60);
      ready = true;
    };

    // a change of SPUSTAT bit 11 (one sample), bounded
    const spu_toggle = () => {
      const start = hw.SPU_STATUS & 0x0800;
      return poll(2000000, () => (hw.SPU_STATUS & 0x0800) !== start) !== 0;
    };

    const voice_setup = (v, addr, pitch) => {
      const voice = hw.SPU_VOICES[v];
      voice.sampleStartAddr = addr >> 3;
      voice.sampleRepeatAddr = addr >> 3;
      voice.sampleRate = pitch;
      voice.adsrLo = 0x000f;
      voice.adsrHi = 0x80ff; // release shift 31: release alone never reaches 0 here
      voice.volumeLeft = 0;
      voice.volumeRight = 0;
    };

    const run_case = (pitch, switchAt, newPitch, lo, hi) => {
      setup();
      voice_setup(1, ONESHOT_ADDR, pitch);
      voice_setup(3, LOOP_ADDR, pitch);
      if (!spu_toggle()) return ['SPUSTAT bit 11 stopped moving'];
      hw.SPU_KEY_ON_LOW = (1 << 1) | (1 << 3);
      hw.SPU_KEY_ON_HIGH = 0;
      const v1 = [], v3 = [];
      for (let i = 0; i < READS; i++) {
        if (!spu_toggle()) return ['SPUSTAT bit 11 stopped moving'];
        if (switchAt && i < switchAt) {
          v1.push(0xffff);
          v3.push(0xffff);
          if (i === switchAt - 1) hw.SPU_VOICES[1].sampleRate = newPitch;
          continue;
        }
        v1.push(hw.SPU_VOICES[1].currentVolume);
        v3.push(hw.SPU_VOICES[3].currentVolume);
      }
      const failures = [];
      let firstZero = -1, peakSeen = false;
      for (let i = 0; i < READS; i++) {
        if (v1[i] === 0xffff) continue;
        if (v1[i] === 0x7fff && firstZero < 0) peakSeen = true;
        if (v1[i] === 0 && firstZero < 0) firstZero = i + 1;
        if (firstZero >= 0 && v1[i] !== 0) {
          failures.push(`voice 1 left zero again at toggle ${i + 1}`);
          break;
        }
      }
      const left = v3.findIndex(v => v !== 0xffff && v !== 0x7fff);
      if (left >= 0) failures.push(`looping control left its peak at toggle ${left + 1}`);
      if (!peakSeen) failures.push('voice 1 never read its peak before ending');
      if (firstZero < lo || firstZero > hi) failures.push(`voice 1 first read 0 at toggle ${firstZero}, expected ${lo}..${hi}`);
      return failures;
    };

    it('A: pitch 0400h', async () => {
      expect(run_case(0x0400, 0, 0, 6, 9)).to.eql([]);
    });

    it('B: pitch 0200h, then 1000h from toggle 4', async () => {
      expect(run_case(0x0200, 4, 0x1000, 6, 7)).to.eql([]);
    });

  });

  describe('a repeat address written while playing redirects the end block (spu-endredirect)', () => {

    // Voice 1 plays a sixteen block sample at 2000h; once it plays, its
    // repeat address is pointed at a loop at 1000h with the IRQ address in
    // it. With end+repeat the voice jumps there and the IRQ fires; with end
    // alone it is muted, and the IRQ still fires: the jump happens anyway.
    const LOOP_ADDR = 0x1000, LOOP_BLOCKS = 4, ONESHOT_ADDR = 0x2000, ONESHOT_BLOCKS = 16;
    const IRQ_BYTE_ADDR = LOOP_ADDR + 2 * 16;
    const PITCH = 0x0400, IRQ_POLL_LIMIT = 4000000, ENVX_POLL_LIMIT = 4000000;

    const irq_disable = () => {
      hw.SPU_CTRL = hw.SPU_CTRL & ~SPU_CTRL_IRQ_ENABLE;
      poll(100000, () => (hw.SPU_STATUS & SPU_STATUS_IRQ_FLAG) === 0);
    };

    let ready = false;
    const setup = () => {
      if (ready) return true;
      boot();
      spu_init();
      for (let v = 0; v < 24; v++) hw.SPU_VOICES[v].sampleRate = 0;
      const loop = new Uint8Array(LOOP_BLOCKS * 16);
      loop[1] = 0x04;
      loop[(LOOP_BLOCKS - 1) * 16 + 1] = 0x03;
      if (!spu_dma_write(LOOP_ADDR, loop)) return false;
      hw.SPU_CTRL = SPU_CTRL_ENABLE | SPU_CTRL_UNMUTE;
      s.volatile_loop(60);
      return ready = true;
    };

    const run_case = (endFlags, expectMute) => {
      if (!setup()) return ['the loop upload never finished'];
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      irq_disable();
      s.volatile_loop(200000);
      const oneshot = new Uint8Array(ONESHOT_BLOCKS * 16);
      for (let block = 0; block < ONESHOT_BLOCKS; block++) {
        oneshot[block * 16 + 1] = block === ONESHOT_BLOCKS - 1 ? endFlags : 0x00;
        oneshot.fill(0x37, block * 16 + 2, block * 16 + 16);
      }
      if (!spu_dma_write(ONESHOT_ADDR, oneshot)) return ['the one-shot upload never finished'];
      const voice = hw.SPU_VOICES[1];
      voice.sampleStartAddr = ONESHOT_ADDR >> 3;
      voice.sampleRate = PITCH;
      voice.adsrLo = 0x000f;
      voice.adsrHi = 0x80ff;
      voice.volumeLeft = 0;
      voice.volumeRight = 0;
      irq_arm(IRQ_BYTE_ADDR);
      hw.SPU_KEY_ON_LOW = 1 << 1;
      hw.SPU_KEY_ON_HIGH = 0;
      poll(ENVX_POLL_LIMIT, () => voice.currentVolume !== 0, 4);
      const envxPlaying = voice.currentVolume;
      voice.sampleRepeatAddr = LOOP_ADDR >> 3;
      const polls = irq_poll(IRQ_POLL_LIMIT);
      s.volatile_loop(200000);
      const envxAfter = voice.currentVolume;
      const endx = hw.SPU_ENDX_LOW;
      irq_disable();

      if (envxPlaying === 0) return ['voice 1 never started, nothing below means anything'];
      const failures = [];
      if (!(endx & 2)) failures.push('ENDX never latched, the voice did not reach its end block');
      if (expectMute && envxAfter !== 0) failures.push(`ENVX=${hex(envxAfter)} after an end block without repeat, expected 0`);
      if (!expectMute && envxAfter === 0) failures.push('ENVX fell to 0 after an end block with repeat');
      if (polls === 0) failures.push(`no IRQ at ${hex(IRQ_BYTE_ADDR)}, inside the loop the repeat address points to`);
      return failures;
    };

    it('A: end+repeat (control)', async () => {
      expect(run_case(0x03, false)).to.eql([]);
    });

    it('B: end without repeat', async () => {
      expect(run_case(0x01, true)).to.eql([]);
    });

  });

  describe('the SPU IRQ fires once per arming (spu-irqrefire)', () => {

    // A match raises IRQ9 once and sets SPUSTAT bit 6; while the flag is
    // set, nothing raises IRQ9 again: not further passes over the address,
    // not rewriting SPUCNT bit 6 as 1, not writes to SPUSTAT. Writing bit 6
    // as 0 acknowledges, and enabling again fires on a later pass.
    const SPU_IRQ_BYTE_ADDR = 0x1080 + 4 * 16;
    const IRQ9 = 0x0200, IRQ_POLL_LIMIT = 4000000, WINDOW = 3000000, MIN_FLIPS = 8;

    it('refire rules', async () => {
      boot();
      const failures = [];
      const check = (ok, what) => { if (!ok) failures.push(what); };

      // WINDOW reads of IREG and SPUSTAT, about 12 cycles each
      const watch = () => {
        let edges = 0, flips = 0, last = hw.SPU_STATUS & 0x0800;
        m.idleUntil(() => {
          if (hw.IREG & IRQ9) {
            edges++;
            hw.IREG = ~IRQ9;
          }
          const b = hw.SPU_STATUS & 0x0800;
          if (b !== last) {
            flips++;
            last = b;
          }
          return false;
        }, WINDOW * 12, 16);
        return { edges, flips, statEnd: hw.SPU_STATUS & 0xffff };
      };
      const check_window = (name, w, flagExpected) => {
        check(w.edges === 0, `${name}: IRQ9 raised again inside the window`);
        check(w.flips >= MIN_FLIPS, `${name}: SPUSTAT bit 11 barely moved`);
        check(((w.statEnd & SPU_STATUS_IRQ_FLAG) !== 0) === flagExpected, `${name}: SPUSTAT.6 at the end of the window`);
      };

      spu_init();
      spu_dma_write(0x1080, irqSample());
      const voice = hw.SPU_VOICES[1];
      voice.sampleStartAddr = 0x1080 >> 3;
      voice.sampleRate = 0x1000;
      voice.adsrLo = 0x000f;
      voice.adsrHi = 0x0000;
      voice.volumeLeft = 0;
      voice.volumeRight = 0;
      hw.SPU_CTRL = SPU_CTRL_ENABLE | SPU_CTRL_UNMUTE;
      s.volatile_loop(60);

      hw.IREG = ~IRQ9;
      irq_arm(SPU_IRQ_BYTE_ADDR);
      hw.SPU_KEY_ON_LOW = 1 << 1;
      hw.SPU_KEY_ON_HIGH = 0;
      const pollsA = irq_poll(IRQ_POLL_LIMIT);
      s.volatile_loop(200);
      check(pollsA !== 0, 'IRQA never matched');
      check((hw.IREG & IRQ9) !== 0, 'the first match did not raise IRQ9');
      check((hw.SPU_CTRL & SPU_CTRL_IRQ_ENABLE) !== 0, 'the first match cleared SPUCNT.6');

      hw.IREG = ~IRQ9;
      check_window('flag-set-enabled', watch(), true);
      hw.SPU_CTRL = hw.SPU_CTRL | SPU_CTRL_IRQ_ENABLE;
      check_window('rewrite-enable-1', watch(), true);
      for (const value of [0x0000, 0xffff]) {
        hw.IREG = ~IRQ9;
        const before = hw.SPU_STATUS & 0xffff;
        hw.SPU_STATUS = value;
        const w = watch();
        check_window(`after-stat-${hex(value)}`, w, true);
        check((w.statEnd & 0xf7ff) === (before & 0xf7ff), `writing SPUSTAT ${hex(value)} changed a bit other than 11`);
      }

      hw.SPU_CTRL = hw.SPU_CTRL & ~SPU_CTRL_IRQ_ENABLE;
      s.volatile_loop(200);
      check((hw.SPU_STATUS & SPU_STATUS_IRQ_FLAG) === 0, 'writing SPUCNT.6=0 did not clear SPUSTAT.6');
      hw.IREG = ~IRQ9;
      check_window('disabled', watch(), false);

      hw.IREG = ~IRQ9;
      hw.SPU_CTRL = hw.SPU_CTRL | SPU_CTRL_IRQ_ENABLE;
      const pollsE = irq_poll(IRQ_POLL_LIMIT);
      s.volatile_loop(200);
      check(pollsE !== 0, 're-enabling did not fire on a later pass');
      check((hw.IREG & IRQ9) !== 0, 'the re-enabled match did not raise IRQ9');
      check((hw.SPU_CTRL & SPU_CTRL_IRQ_ENABLE) !== 0, 'the re-enabled match cleared SPUCNT.6');
      hw.IREG = ~IRQ9;
      check_window('after-rearm', watch(), true);

      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      hw.SPU_CTRL = 0;
      expect(failures).to.eql([]);
    });

  });

  describe('a keyed-off voice keeps reading SPU RAM (spu-offvoice)', () => {

    // The IRQ address matches the read pointer of a playing voice, and still
    // matches once the voice is keyed off and silent: a voice in release at
    // ENVX 0 keeps decoding.
    const SPU_IRQ_BYTE_ADDR = 0x1080 + 4 * 16;
    const IRQ_POLL_LIMIT = 4000000, ENVX_POLL_LIMIT = 4000000;

    it('IRQ from a silent voice', async () => {
      boot();
      spu_init();
      if (!spu_dma_write(0x1080, irqSample())) return expect('the sample upload never finished').to.eql(null);
      const voice = hw.SPU_VOICES[1];
      voice.sampleStartAddr = 0x1080 >> 3;
      voice.sampleRate = 0x1000;
      voice.adsrLo = 0x000f;
      voice.adsrHi = 0x0000;
      voice.volumeLeft = 0x3fff;
      voice.volumeRight = 0x3fff;
      hw.SPU_CTRL = SPU_CTRL_ENABLE | SPU_CTRL_UNMUTE;
      s.volatile_loop(60);

      irq_arm(SPU_IRQ_BYTE_ADDR);
      hw.SPU_KEY_ON_LOW = 1 << 1;
      hw.SPU_KEY_ON_HIGH = 0;
      const pollsOn = irq_poll(IRQ_POLL_LIMIT);
      const ctrlAtFire = hw.SPU_CTRL & 0xffff;
      const ackCleared = irq_ack();
      const statusAfterAck = hw.SPU_STATUS & 0xffff;

      hw.SPU_KEY_OFF_LOW = 1 << 1;
      hw.SPU_KEY_OFF_HIGH = 0;
      poll(ENVX_POLL_LIMIT, () => voice.currentVolume === 0, 4);
      s.volatile_loop(200000);
      const envxAfterOff = voice.currentVolume;
      const endxWhilePlaying = hw.SPU_ENDX_LOW & 0xffff;
      irq_arm(SPU_IRQ_BYTE_ADDR);
      const pollsOff = irq_poll(IRQ_POLL_LIMIT);
      irq_ack();
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0xffff;
      hw.SPU_CTRL = 0;

      const failures = [];
      if (!(endxWhilePlaying & 2)) failures.push('ENDX never latched for voice 1 while it played');
      if (!pollsOn) {
        failures.push('SPUSTAT.6 never set for a playing voice crossing IRQA');
      } else {
        if (!(ctrlAtFire & SPU_CTRL_IRQ_ENABLE)) failures.push('SPUCNT.6 cleared after the match');
        if (!ackCleared) failures.push(`writing SPUCNT.6=0 did not acknowledge; SPUSTAT.6 stayed set at ${hex(statusAfterAck)}`);
      }
      if (envxAfterOff !== 0) failures.push(`the voice never went silent after key-off (ENVX=${hex(envxAfterOff)})`);
      else if (!pollsOff) failures.push('a keyed-off voice stopped reading SPU RAM: no IRQA match');
      expect(failures).to.eql([]);
    });

  });

  describe('voice volume sweeps (spu-volsweep)', () => {

    // VOLXL of voice 1, one read per SPUSTAT bit 11 tick, after switching the
    // left volume from a direct value to a sweep; within 16 of the traces
    // measured on silicon. The right volume stays direct as a control, and
    // VOLX reads twice the direct value.
    const SWEEP = (exp, dec, neg, shift, step) =>
      0x8000 | ((exp ? 1 : 0) << 14) | ((dec ? 1 : 0) << 13) | ((neg ? 1 : 0) << 12) | ((shift & 31) << 2) | (step & 3);
    const HOLD_AT_PEAK = 0x000f | (0x3 << 22) | (0x0 << 24) | 0; // ATTACK(0,0,0) | DECAY(0) | SUSTAIN(3,0,15,0,0)
    const TRACE_LEN = 40, RIGHT_CTRL = 0x1111, TOLERANCE = 16;

    const ramp = (from, step, n = TRACE_LEN) => Array.from({ length: n }, (_, i) => from + step * i);
    const fill = (v, n = TRACE_LEN) => new Array(n).fill(v);
    const cases = [
      ['direct', 0x1234, 0x1234, 1, fill(0x2468)],
      ['lin_inc_s12_t0', 0, SWEEP(0, 0, 0, 12, 0), 1, [0x06f9, 0x0df9, 0x1500, 0x1bf9, 0x22f9, 0x2a00, 0x30f9, 0x37f9, 0x3f00, 0x45f9, 0x4cf9, 0x53f9, 0x5af9, 0x61f9, 0x68f9, 0x6ff9, 0x7700, 0x7df9, ...fill(0x7fff, 22)]],
      ['lin_inc_s13_t3', 0, SWEEP(0, 0, 0, 13, 3), 1, ramp(0x0200, 0x0200)],
      ['lin_inc_s16_t0', 0, SWEEP(0, 0, 0, 16, 0), 8, [...ramp(0x0380, 0x0380, 36), ...fill(0x7fff, 4)]],
      ['lin_dec_s12_t0', 0x3fff, SWEEP(0, 1, 0, 12, 0), 1, [0x77fe, 0x6ffe, 0x6806, 0x6006, 0x57fe, 0x5006, 0x4806, 0x3ffe, 0x3806, 0x3006, 0x27fe, 0x2006, 0x1806, 0x1006, 0x0806, 0x0006, ...fill(0, 24)]],
      ['exp_inc_s12_t0', 0, SWEEP(1, 0, 0, 12, 0), 1, [0x06f9, 0x0df9, 0x1500, 0x1bf9, 0x22f9, 0x2a00, 0x30f9, 0x37f9, 0x3f00, 0x45f9, 0x4cf9, 0x5400, 0x5af9, 0x607f, 0x623f, 0x63ff, 0x65bf, 0x677f, 0x693f, 0x6aff, 0x6cbf, 0x6e7f, 0x703f, 0x71ff, 0x73bf, 0x757f, 0x773f, 0x78ff, 0x7abf, 0x7c7f, 0x7e3f, ...fill(0x7fff, 9)]],
      ['exp_dec_s12_t0', 0x3fff, SWEEP(1, 1, 0, 12, 0), 1, [0x77fe, 0x6ffe, 0x6905, 0x6205, 0x5bbb, 0x55bb, 0x4fc6, 0x4ac6, 0x45c6, 0x40c1, 0x3c9e, 0x389e, 0x349a, 0x309e, 0x2d76, 0x2a73, 0x2776, 0x2476, 0x2173, 0x1ef9, 0x1cf9, 0x1af7, 0x18f9, 0x16f9, 0x14f7, 0x12f9, 0x10f9, 0x0f7b, 0x0e7c, 0x0d7c, 0x0c7c, 0x0b7c, 0x0a7c, 0x097c, 0x087c, 0x077b, 0x067c, 0x057c, 0x047b, 0x037c]],
      ['lin_inc_s04_t0', 0, SWEEP(0, 0, 0, 4, 0), 1, fill(0x7fff)],
      ['neg_start_ctrl', 0x6000, 0x6000, 1, fill(0xc000)],
      ['lin_inc_s12_ph1_neg', 0x6000, SWEEP(0, 0, 1, 12, 0), 1, [0xb808, 0xb008, 0xa800, 0xa008, 0x9808, 0x9000, 0x8808, 0x8008, ...fill(0x8000, 32)]],
      ['lin_inc_s12_ph0_neg', 0x6000, SWEEP(0, 0, 0, 12, 0), 1, [0xc700, 0xcdf9, 0xd4f9, 0xdc00, 0xe2f9, 0xe9f9, 0xf0f9, 0xf7f9, 0xfef9, 0x05f9, 0x0cf9, 0x1400, 0x1af9, 0x21f9, 0x2900, 0x2ff9, 0x36f9, 0x3e00, 0x44f9, 0x4bf9, 0x5300, 0x59f9, 0x60f9, 0x6800, 0x6ef9, 0x75f9, 0x7d00, ...fill(0x7fff, 13)]],
      ['lin_dec_s12_ph1_neg', 0x6000, SWEEP(0, 1, 1, 12, 0), 1, [0xc700, 0xcdf9, 0xd4f9, 0xdbf9, 0xe2f9, 0xe9f9, 0xf100, 0xf7f9, 0xfef9, ...fill(0, 31)]],
      ['exp_dec_s12_ph1_neg', 0x6000, SWEEP(1, 1, 1, 12, 0), 1, [0xc2fe, 0xc5fe, 0xc901, 0xcbfe, 0xcefe, 0xd155, 0xd355, 0xd555, 0xd755, 0xd955, 0xdb57, 0xdd55, 0xdf55, 0xe0ac, 0xe1ab, 0xe2ab, 0xe3ac, 0xe4ab, 0xe5ab, 0xe6ac, 0xe7ab, 0xe8ab, 0xe9ac, 0xeaab, 0xebab, 0xecac, 0xedab, 0xeeab, 0xefac, ...fill(0xf001, 11)]],
      ['lin_inc_s12_ph1_pos', 0x1000, SWEEP(0, 0, 1, 12, 0), 1, [0x1800, 0x1000, 0x0808, 0x0008, 0xf808, 0xf008, 0xe808, 0xe008, 0xd808, 0xd000, 0xc808, 0xc008, 0xb800, 0xb008, 0xa808, 0xa000, 0x9808, 0x9008, 0x8800, 0x8008, ...fill(0x8000, 20)]],
    ];

    const spu_tick = () =>
      s.wait(() => (hw.SPU_STATUS & 0x0800) !== 0, 2000000 * 8) && s.wait(() => (hw.SPU_STATUS & 0x0800) === 0, 2000000 * 8);

    let ready = false;
    const setup = () => {
      if (ready) return;
      boot();
      hw.SPU_CTRL = 0;
      s.volatile_loop(60);
      hw.SPU_RAM_DTC = 4;
      s.volatile_loop(60);
      hw.DPCR = hw.DPCR | 0x000b0000;
      hw.SPU_VOL_MAIN_LEFT = 0; hw.SPU_VOL_MAIN_RIGHT = 0;
      hw.SPU_REVERB_LEFT = 0; hw.SPU_REVERB_RIGHT = 0;
      hw.SPU_PITCH_MOD_LOW = 0; hw.SPU_PITCH_MOD_HIGH = 0;
      hw.SPU_NOISE_EN_LOW = 0; hw.SPU_NOISE_EN_HIGH = 0;
      hw.SPU_REVERB_EN_LOW = 0; hw.SPU_REVERB_EN_HIGH = 0;
      hw.SPU_REVERB_ADDR = 0xffff;
      hw.SPU_KEY_OFF_LOW = 0xffff; hw.SPU_KEY_OFF_HIGH = 0xffff;
      hw.SPU_CTRL = 0x8000;
      const upload = new Uint8Array(128).fill(0xaa);
      upload.set(s.kAdpcmSine);
      upload[3 * 16 + 1] = 0x03;
      spu_dma_write(0x1080, upload);
      hw.SPU_CTRL = 0x8000 | 0x4000;
      const voice = hw.SPU_VOICES[1];
      voice.sampleStartAddr = 0x1080 >> 3;
      voice.sampleRepeatAddr = 0x1080 >> 3;
      voice.sampleRate = 0x1000;
      voice.volumeLeft = 0;
      voice.volumeRight = 0;
      voice.adsrLo = HOLD_AT_PEAK & 0xffff;
      voice.adsrHi = HOLD_AT_PEAK >>> 16;
      hw.SPU_KEY_OFF_LOW = 0; hw.SPU_KEY_OFF_HIGH = 0;
      hw.SPU_KEY_ON_LOW = 1 << 1; hw.SPU_KEY_ON_HIGH = 0;
      spu_tick();
      ready = true;
    };

    // the cases run in order on one voice, as on hardware
    for (const [tag, startDirect, sweep, stride, golden] of cases) {
      it(tag, async () => {
        setup();
        const voice = hw.SPU_VOICES[1];
        voice.volumeLeft = startDirect;
        voice.volumeRight = RIGHT_CTRL;
        let stalled = 0;
        for (let i = 0; i < 3; i++) stalled += spu_tick() ? 0 : 1;
        voice.volumeLeft = sweep;
        const trace = [];
        for (let i = 0; i < TRACE_LEN; i++) {
          for (let k = 0; k < stride; k++) stalled += spu_tick() ? 0 : 1;
          trace.push(hw.VOLXL(1));
        }
        const failures = [];
        const bad = trace.findIndex((v, i) => Math.abs(v - ((golden[i] << 16) >> 16)) > TOLERANCE);
        if ((hw.VOLXR(1) & 0xffff) !== RIGHT_CTRL * 2) failures.push(`VOLXR control moved to ${hex(hw.VOLXR(1) & 0xffff)}`);
        if (stalled) failures.push(`SPUSTAT bit 11 stopped moving ${stalled} times`);
        if (bad >= 0) failures.push(`sample ${bad} reads ${hex(trace[bad] & 0xffff)}, expected ${hex(golden[bad])}`);
        expect(failures).to.eql([]);
      });
    }

  });

  describe('key-on latches and the repeat address (spu-konlatch)', () => {

    // Timed with root counter 2 on sysclock/8 (96 ticks a sample). After a
    // key-on the voice fetches block headers and sets the repeat address
    // from loop-start flags: a write right after key-on is overridden, one
    // after the attack holds, and exactly three header fetches rewrite it.
    // The attack starts four samples after ENDX clears, which happens one to
    // three samples after the key-on, on a two-sample grid.
    const VOICE = 1, VOICE_BIT = 1 << VOICE;
    const SAMPLE_ADDR = 0x2000, MARKER_ADDR = 0x3000;
    const SAMPLE_LSAX = SAMPLE_ADDR >> 3, BLOCK8_LSAX = (SAMPLE_ADDR + 8 * 16) >> 3, MARKER_LSAX = MARKER_ADDR >> 3;
    const IMAGE_SIZE = MARKER_ADDR + 64 - SAMPLE_ADDR;
    const TICKS = 96, POLL_LIMIT = 2000000, NONE = 0xffff;
    const WRITE_NONE = 0, WRITE_AFTER_KON = 1, WRITE_AFTER_ATTACK = 2, WRITE_FETCHES = 3;

    const now = () => hw.COUNTERS[2].value & 0xffff;
    const wait_ticks = ticks => {
      while (ticks) {
        const n = ticks > 0x4000 ? 0x4000 : ticks;
        const origin = now();
        if (!poll(POLL_LIMIT, () => ((now() - origin) & 0xffff) >= n)) return false;
        ticks -= n;
      }
      return true;
    };
    const wait_edge = () => {
      if (!poll(POLL_LIMIT, () => (hw.SPU_STATUS & 0x0800) !== 0)) return null;
      if (!poll(POLL_LIMIT, () => (hw.SPU_STATUS & 0x0800) === 0)) return null;
      return now();
    };

    const dma = (data, read) => {
      const mode = read ? 0x30 : 0x20;
      hw.SPU_CTRL = 0xc000;
      if (!wait_ticks(4 * TICKS)) return false;
      hw.SPU_RAM_DTA = SAMPLE_ADDR >> 3;
      if (!wait_ticks(TICKS)) return false;
      hw.SPU_CTRL = 0xc000 | mode;
      if (!poll(POLL_LIMIT, () => (hw.SPU_STATUS & 0x30) === mode)) return false;
      hw.SPU_DELAY = (hw.SPU_DELAY & 0xf0ffffff) | (read ? 0x22000000 : 0x20000000);
      hw.DMA_CTRL[hw.DMA_SPU].MADR = data.address & 0x1fffffff;
      hw.DMA_CTRL[hw.DMA_SPU].BCR = ((IMAGE_SIZE / 64) << 16) | 0x10;
      hw.DMA_CTRL[hw.DMA_SPU].CHCR = read ? 0x01000200 : 0x01000201;
      if (!poll(POLL_LIMIT, () => (hw.DMA_CTRL[hw.DMA_SPU].CHCR & 0x01000000) === 0)) return false;
      if (!wait_ticks(128 * TICKS)) return false;
      hw.SPU_CTRL = 0xc000;
      return wait_ticks(4 * TICKS);
    };

    const upload = () => {
      const image = hw.alloc(Uint8Array, IMAGE_SIZE);
      const readback = hw.alloc(Uint8Array, IMAGE_SIZE);
      for (let block = 0; block < 16; block++) {
        const p = block * 16;
        image[p + 1] = (block === 0 || block === 8) ? 0x04 : block === 15 ? 0x03 : 0x00;
        image.fill(0x11, p + 2, p + 16);
      }
      const marker = MARKER_ADDR - SAMPLE_ADDR;
      image[marker + 1] = 0x03;
      image.fill(0x11, marker + 2, marker + 16);
      if (!dma(image, 0) || !dma(readback, 1)) return false;
      return image.every((v, i) => readback[i] === v);
    };

    const trial = (phase, mode) => {
      const voice = hw.SPU_VOICES[VOICE];
      hw.SPU_KEY_OFF_LOW = VOICE_BIT;
      voice.adsrHi = 0x0000;
      if (!wait_ticks(32 * TICKS)) return null;
      if (voice.currentVolume !== 0) return null;
      hw.SPU_KEY_OFF_LOW = 0;
      voice.sampleRate = 0x4000;
      voice.sampleStartAddr = SAMPLE_ADDR >> 3;
      voice.adsrLo = 0x000f;
      voice.adsrHi = 0x1fc0;
      hw.SPU_KEY_ON_LOW = VOICE_BIT;
      if (!wait_ticks(160 * TICKS)) return null;
      hw.SPU_KEY_OFF_LOW = VOICE_BIT;
      voice.adsrHi = 0x0000;
      if (!wait_ticks(32 * TICKS)) return null;
      if (!(hw.SPU_ENDX_LOW & VOICE_BIT) || voice.currentVolume !== 0) return null;
      hw.SPU_KEY_OFF_LOW = 0;
      voice.sampleRate = 0x1000;
      voice.adsrHi = 0x1fc0;
      voice.sampleRepeatAddr = MARKER_LSAX;
      const t = {};
      t.edge = wait_edge();
      if (t.edge === null || !wait_ticks(phase * TICKS)) return null;
      hw.SPU_KEY_ON_LOW = VOICE_BIT;
      t.kon = now();
      if (mode === WRITE_AFTER_KON || mode === WRITE_FETCHES) voice.sampleRepeatAddr = MARKER_LSAX;
      t.endxClear = t.attack = NONE;
      t.fetches = 0;
      let wrote = mode !== WRITE_AFTER_ATTACK;
      for (let i = 0; i < POLL_LIMIT; i++) {
        const elapsed = (now() - t.kon) & 0xffff;
        if (t.endxClear === NONE && !(hw.SPU_ENDX_LOW & VOICE_BIT)) t.endxClear = elapsed;
        if (t.attack === NONE && voice.currentVolume !== 0) {
          t.attack = elapsed;
          if (!wrote) {
            voice.sampleRepeatAddr = MARKER_LSAX;
            wrote = true;
          }
        }
        if (mode === WRITE_FETCHES && voice.sampleRepeatAddr === SAMPLE_LSAX) {
          t.fetches++;
          voice.sampleRepeatAddr = MARKER_LSAX;
        }
        if (elapsed >= 16 * TICKS) break;
        m.idle(16);
      }
      if (!wait_ticks(320 * TICKS)) return null;
      t.finalLsax = voice.sampleRepeatAddr;
      return t.endxClear !== NONE && t.attack !== NONE ? t : null;
    };

    const near = (value, target, tolerance) => value !== NONE && value + tolerance >= target && value <= target + tolerance;

    it('repeat address latching and key-on timing', async () => {
      boot();
      const failures = [];
      const check = (ok, what) => { if (!ok) failures.push(what); };
      hw.COUNTERS[2].mode = 0x0200;
      hw.DPCR = hw.DPCR | 0x000b0000;
      hw.SPU_CTRL = 0;
      hw.SPU_VOL_MAIN_LEFT = 0; hw.SPU_VOL_MAIN_RIGHT = 0;
      hw.SPU_REVERB_LEFT = 0; hw.SPU_REVERB_RIGHT = 0;
      hw.SPU_PITCH_MOD_LOW = 0; hw.SPU_PITCH_MOD_HIGH = 0;
      hw.SPU_NOISE_EN_LOW = 0; hw.SPU_NOISE_EN_HIGH = 0;
      hw.SPU_REVERB_EN_LOW = 0; hw.SPU_REVERB_EN_HIGH = 0;
      hw.SPU_RAM_DTC = 4;
      hw.SPU_CTRL = 0xc000;
      for (let v = 0; v < 24; v++) {
        if (v === VOICE) continue;
        hw.SPU_VOICES[v].sampleRate = 0;
        hw.SPU_VOICES[v].sampleStartAddr = MARKER_ADDR >> 3;
      }
      let ok = upload();
      check(ok, 'SPU RAM upload readback');
      let early, late, fetch, phase0, phase1;
      if (ok) {
        ok = !!(early = trial(0, WRITE_AFTER_KON)) && !!(late = trial(0, WRITE_AFTER_ATTACK)) &&
          !!(fetch = trial(0, WRITE_FETCHES)) && !!(phase0 = trial(0, WRITE_NONE)) && !!(phase1 = trial(1, WRITE_NONE));
        check(ok, 'a bounded wait or a trial precondition failed');
      }
      if (ok) {
        check(early.finalLsax === BLOCK8_LSAX, 'write right after key-on held against loop-start');
        check(late.finalLsax === MARKER_LSAX, 'write after the attack was replaced by loop-start');
        check(fetch.fetches === 3, `header fetches after key-on are ${fetch.fetches}, not three`);
        check(fetch.finalLsax === MARKER_LSAX, 'rewrite after the third fetch did not hold');
        check(near((phase0.attack - phase0.endxClear) & 0xffff, 4 * TICKS, 24), 'phase 0 attack is not 4 samples after ENDX');
        check(near((phase1.attack - phase1.endxClear) & 0xffff, 4 * TICKS, 24), 'phase 1 attack is not 4 samples after ENDX');
        check(phase0.endxClear >= TICKS && phase0.endxClear <= 13 * TICKS / 4, 'phase 0 key-on service latency');
        check(phase1.endxClear >= TICKS && phase1.endxClear <= 13 * TICKS / 4, 'phase 1 key-on service latency');
        const service0 = (((phase0.kon - phase0.edge) & 0xffff) + phase0.endxClear) & 0xffff;
        const service1 = (((phase1.kon - phase1.edge) & 0xffff) + phase1.endxClear) & 0xffff;
        const moved = ((service1 - service0) << 16) >> 16;
        check((moved >= -24 && moved <= 24) || near(moved & 0xffff, 2 * TICKS, 24), 'key-on service is not on a two-sample grid');
      }
      hw.SPU_KEY_OFF_LOW = 0xffff;
      hw.SPU_KEY_OFF_HIGH = 0x00ff;
      hw.SPU_CTRL = 0;
      hw.COUNTERS[2].mode = 0;
      expect(failures).to.eql([]);
    });

  });

})
