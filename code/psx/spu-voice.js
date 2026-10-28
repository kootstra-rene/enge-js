mdlr('enge:psx:spu-voice', ({ include }) => {


  let id = 0;
  // ADSR: the phase (0 off, 1 attack, 2 decay, 3 sustain, 4 release) and
  // the level (ENVX, 0..7FFFh)
  let adsrLevel = 0;
  let adsrState = 0;
  let pitchModulationEnabled = false;

  let pitchStep = 0;
  // the position in the block: sample index in bits 12 and up, the
  // interpolation index in bits 4-11
  let pitchCounter = 0;
  let repeatAddress = 0;
  let blockAddress = 0;
  let currentBlock = -1;  // the block being played, for IRQ address matches
  let started = false;    // keyed on at least once: the voice reads SPU RAM
  let startup = 0;        // samples of header fetches left after a key-on
  let ignoreLoop = false; // the CPU wrote the repeat address while playing
  // the decoded block, after the last three samples of the one before (for
  // the interpolation); its flags; the decoder's two previous samples
  const samples = new Int16Array(3 + 28);
  let blockFlags = 0;
  let hasSamples = false;
  let s0 = 0;
  let s1 = 0;
  // the current volumes (VOLX, signed 16 bit); set directly, or swept
  let volumeLeft = 0;
  let volumeRight = 0;

  let regs = new Uint16Array(16);

  const gauss = [
    -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1,
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0001,
    0x0001, 0x0001, 0x0001, 0x0002, 0x0002, 0x0002, 0x0003, 0x0003,
    0x0003, 0x0004, 0x0004, 0x0005, 0x0005, 0x0006, 0x0007, 0x0007,
    0x0008, 0x0009, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E,
    0x000F, 0x0010, 0x0011, 0x0012, 0x0013, 0x0015, 0x0016, 0x0018,
    0x0019, 0x001B, 0x001C, 0x001E, 0x0020, 0x0021, 0x0023, 0x0025,
    0x0027, 0x0029, 0x002C, 0x002E, 0x0030, 0x0033, 0x0035, 0x0038,
    0x003A, 0x003D, 0x0040, 0x0043, 0x0046, 0x0049, 0x004D, 0x0050,
    0x0054, 0x0057, 0x005B, 0x005F, 0x0063, 0x0067, 0x006B, 0x006F,
    0x0074, 0x0078, 0x007D, 0x0082, 0x0087, 0x008C, 0x0091, 0x0096,
    0x009C, 0x00A1, 0x00A7, 0x00AD, 0x00B3, 0x00BA, 0x00C0, 0x00C7,
    0x00CD, 0x00D4, 0x00DB, 0x00E3, 0x00EA, 0x00F2, 0x00FA, 0x0101,
    0x010A, 0x0112, 0x011B, 0x0123, 0x012C, 0x0135, 0x013F, 0x0148,
    0x0152, 0x015C, 0x0166, 0x0171, 0x017B, 0x0186, 0x0191, 0x019C,
    0x01A8, 0x01B4, 0x01C0, 0x01CC, 0x01D9, 0x01E5, 0x01F2, 0x0200,
    0x020D, 0x021B, 0x0229, 0x0237, 0x0246, 0x0255, 0x0264, 0x0273,
    0x0283, 0x0293, 0x02A3, 0x02B4, 0x02C4, 0x02D6, 0x02E7, 0x02F9,
    0x030B, 0x031D, 0x0330, 0x0343, 0x0356, 0x036A, 0x037E, 0x0392,
    0x03A7, 0x03BC, 0x03D1, 0x03E7, 0x03FC, 0x0413, 0x042A, 0x0441,
    0x0458, 0x0470, 0x0488, 0x04A0, 0x04B9, 0x04D2, 0x04EC, 0x0506,
    0x0520, 0x053B, 0x0556, 0x0572, 0x058E, 0x05AA, 0x05C7, 0x05E4,
    0x0601, 0x061F, 0x063E, 0x065C, 0x067C, 0x069B, 0x06BB, 0x06DC,
    0x06FD, 0x071E, 0x0740, 0x0762, 0x0784, 0x07A7, 0x07CB, 0x07EF,
    0x0813, 0x0838, 0x085D, 0x0883, 0x08A9, 0x08D0, 0x08F7, 0x091E,
    0x0946, 0x096F, 0x0998, 0x09C1, 0x09EB, 0x0A16, 0x0A40, 0x0A6C,
    0x0A98, 0x0AC4, 0x0AF1, 0x0B1E, 0x0B4C, 0x0B7A, 0x0BA9, 0x0BD8,
    0x0C07, 0x0C38, 0x0C68, 0x0C99, 0x0CCB, 0x0CFD, 0x0D30, 0x0D63,
    0x0D97, 0x0DCB, 0x0E00, 0x0E35, 0x0E6B, 0x0EA1, 0x0ED7, 0x0F0F,
    0x0F46, 0x0F7F, 0x0FB7, 0x0FF1, 0x102A, 0x1065, 0x109F, 0x10DB,
    0x1116, 0x1153, 0x118F, 0x11CD, 0x120B, 0x1249, 0x1288, 0x12C7,
    0x1307, 0x1347, 0x1388, 0x13C9, 0x140B, 0x144D, 0x1490, 0x14D4,
    0x1517, 0x155C, 0x15A0, 0x15E6, 0x162C, 0x1672, 0x16B9, 0x1700,
    0x1747, 0x1790, 0x17D8, 0x1821, 0x186B, 0x18B5, 0x1900, 0x194B,
    0x1996, 0x19E2, 0x1A2E, 0x1A7B, 0x1AC8, 0x1B16, 0x1B64, 0x1BB3,
    0x1C02, 0x1C51, 0x1CA1, 0x1CF1, 0x1D42, 0x1D93, 0x1DE5, 0x1E37,
    0x1E89, 0x1EDC, 0x1F2F, 0x1F82, 0x1FD6, 0x202A, 0x207F, 0x20D4,
    0x2129, 0x217F, 0x21D5, 0x222C, 0x2282, 0x22DA, 0x2331, 0x2389,
    0x23E1, 0x2439, 0x2492, 0x24EB, 0x2545, 0x259E, 0x25F8, 0x2653,
    0x26AD, 0x2708, 0x2763, 0x27BE, 0x281A, 0x2876, 0x28D2, 0x292E,
    0x298B, 0x29E7, 0x2A44, 0x2AA1, 0x2AFF, 0x2B5C, 0x2BBA, 0x2C18,
    0x2C76, 0x2CD4, 0x2D33, 0x2D91, 0x2DF0, 0x2E4F, 0x2EAE, 0x2F0D,
    0x2F6C, 0x2FCC, 0x302B, 0x308B, 0x30EA, 0x314A, 0x31AA, 0x3209,
    0x3269, 0x32C9, 0x3329, 0x3389, 0x33E9, 0x3449, 0x34A9, 0x3509,
    0x3569, 0x35C9, 0x3629, 0x3689, 0x36E8, 0x3748, 0x37A8, 0x3807,
    0x3867, 0x38C6, 0x3926, 0x3985, 0x39E4, 0x3A43, 0x3AA2, 0x3B00,
    0x3B5F, 0x3BBD, 0x3C1B, 0x3C79, 0x3CD7, 0x3D35, 0x3D92, 0x3DEF,
    0x3E4C, 0x3EA9, 0x3F05, 0x3F62, 0x3FBD, 0x4019, 0x4074, 0x40D0,
    0x412A, 0x4185, 0x41DF, 0x4239, 0x4292, 0x42EB, 0x4344, 0x439C,
    0x43F4, 0x444C, 0x44A3, 0x44FA, 0x4550, 0x45A6, 0x45FC, 0x4651,
    0x46A6, 0x46FA, 0x474E, 0x47A1, 0x47F4, 0x4846, 0x4898, 0x48E9,
    0x493A, 0x498A, 0x49D9, 0x4A29, 0x4A77, 0x4AC5, 0x4B13, 0x4B5F,
    0x4BAC, 0x4BF7, 0x4C42, 0x4C8D, 0x4CD7, 0x4D20, 0x4D68, 0x4DB0,
    0x4DF7, 0x4E3E, 0x4E84, 0x4EC9, 0x4F0E, 0x4F52, 0x4F95, 0x4FD7,
    0x5019, 0x505A, 0x509A, 0x50DA, 0x5118, 0x5156, 0x5194, 0x51D0,
    0x520C, 0x5247, 0x5281, 0x52BA, 0x52F3, 0x532A, 0x5361, 0x5397,
    0x53CC, 0x5401, 0x5434, 0x5467, 0x5499, 0x54CA, 0x54FA, 0x5529,
    0x5558, 0x5585, 0x55B2, 0x55DE, 0x5609, 0x5632, 0x565B, 0x5684,
    0x56AB, 0x56D1, 0x56F6, 0x571B, 0x573E, 0x5761, 0x5782, 0x57A3,
    0x57C3, 0x57E2, 0x57FF, 0x581C, 0x5838, 0x5853, 0x586D, 0x5886,
    0x589E, 0x58B5, 0x58CB, 0x58E0, 0x58F4, 0x5907, 0x5919, 0x592A,
    0x593A, 0x5949, 0x5958, 0x5965, 0x5971, 0x597C, 0x5986, 0x598F,
    0x5997, 0x599E, 0x59A4, 0x59A9, 0x59AD, 0x59B0, 0x59B2, 0x59B3
  ];

  // A volume envelope, as the ADSR and the volume sweeps use it (after
  // psx-spx and DuckStation). `rate` is the 7-bit shift:step value; a tick
  // is due every 1 << max(0, shift - 11) samples and moves the level by
  // step << max(0, 11 - shift), the step being 7 - (rate & 3) up or
  // -(8 - (rate & 3)) down. Exponential decrease scales the step by the
  // level; exponential increase slows down above 6000h. A rate with every
  // bit of `mask` set never ticks.
  const envelope = () => {
    const e = { rate: 0, decreasing: false, exponential: false, invert: false, step: 0, increment: 0, counter: 0, stepped: false };
    e.reset = (rate, mask, decreasing, exponential, invert = false) => {
      e.rate = rate;
      e.decreasing = decreasing;
      e.exponential = exponential;
      e.invert = invert;
      e.counter = 0;
      e.increment = 0x8000;
      const base = 7 - (rate & 3);
      e.step = ((decreasing !== invert) || (invert && exponential)) ? ~base : base;
      if (rate < 44) {
        e.step <<= (11 - (rate >> 2));
      } else if (rate >= 48) {
        e.increment >>= ((rate >> 2) - 11);
        if ((rate & mask) !== mask) e.increment = Math.max(e.increment, 1);
      }
    };
    // one sample: the new level
    e.tick = level => {
      let increment = e.increment;
      let step = e.step;
      if (e.exponential) {
        if (e.decreasing) {
          step = (step * level) >> 15;
        } else if (level >= 0x6000) {
          if (e.rate < 40) {
            step >>= 2;
          } else if (e.rate >= 44) {
            increment >>= 2;
          } else {
            step >>= 1;
            increment >>= 1;
          }
        }
      }
      e.counter += increment;
      e.stepped = (e.counter & 0x8000) !== 0;
      if (!e.stepped) return level;
      e.counter = 0;
      const next = level + step;
      if (!e.decreasing) return Math.max(-0x8000, Math.min(0x7fff, next));
      if (e.invert) return Math.max(-0x7fff, Math.min(0, next));
      return Math.max(0, next);
    };
    return e;
  };

  const adsr = envelope();
  const sweepLeft = envelope(), sweepRight = envelope();
  let sweepingLeft = false, sweepingRight = false;

  const adsrRegister = () => (regs[0x8] | (regs[0xa] << 16)) >>> 0;

  // enter an ADSR phase: its envelope and the level that ends it
  const adsrPhase = phase => {
    const r = adsrRegister();
    adsrState = phase;
    switch (phase) {
      case 1: // attack
        adsr.reset((r >>> 8) & 0x7f, 0x7f, false, (r & 0x8000) !== 0);
        break;
      case 2: // decay
        adsr.reset(((r >>> 4) & 0xf) << 2, 0x1f << 2, true, true);
        break;
      case 3: // sustain
        adsr.reset((r >>> 22) & 0x7f, 0x7f, (r & 0x40000000) !== 0, (r & 0x80000000) !== 0);
        break;
      case 4: // release
        adsr.reset(((r >>> 16) & 0x1f) << 2, 0x1f << 2, true, (r & 0x200000) !== 0);
        break;
    }
  };

  // One sample of the envelope: the level as a volume. A phase ends on the
  // step that reaches its end: attack at 7FFFh, decay once the level's top
  // four bits are at or below the sustain level, release at 0.
  const mixADSR = () => {
    adsrLevel = adsr.tick(adsrLevel);
    if (adsr.stepped) {
      switch (adsrState) {
        case 1: if (adsrLevel >= 0x7fff) adsrPhase(2); break;
        case 2: if ((adsrLevel >> 11) <= (regs[0x8] & 0xf)) adsrPhase(3); break;
        case 4: if (adsrLevel <= 0) adsrState = 0; break;
      }
    }
    regs[0x0c] = adsrLevel;
    return adsrLevel / 0x8000;
  };

  const startAdsrAttack = () => {
    adsrLevel = 0;
    adsrPhase(1);
  };
  const startAdsrRelease = () => {
    adsrPhase(4);
  };

  // a voice volume register: fixed (bits 0-14, times two) or a sweep from
  // the current volume
  const setVolume = (data, current, sweep) => {
    if (!(data & 0x8000)) return { level: ((data & 0x7fff) << 17) >> 16, sweeping: false };
    sweep.reset(data & 0x7f, 0x7f, (data & 0x2000) !== 0, (data & 0x4000) !== 0, (data & 0x1000) !== 0);
    return { level: current, sweeping: sweep.increment > 0 };
  };

  // the ADPCM prediction filters
  const FILTER_POS = [0, 60, 115, 98, 122];
  const FILTER_NEG = [0, 0, -52, -55, -60];

  // decode the block at blockAddress into samples[3..30]
  const decodeBlock = (ram) => {
    currentBlock = blockAddress;
    const shiftFilter = ram[blockAddress + 0];
    blockFlags = ram[blockAddress + 1];

    const shiftValue = shiftFilter & 0x0f;
    const shift = shiftValue > 12 ? 9 : shiftValue;
    // filters 5-7 decode as filter 0 (measured)
    const filter = (shiftFilter >>> 4) > 4 ? 0 : shiftFilter >>> 4;
    const k0 = FILTER_POS[filter], k1 = FILTER_NEG[filter];

    samples[0] = samples[28];
    samples[1] = samples[29];
    samples[2] = samples[30];
    for (let i = 0; i < 28; ++i) {
      const data = ram[blockAddress + 2 + (i >> 1)];
      const nibble = ((data >> ((i & 1) << 2)) & 0xf) << 12;
      let value = (((nibble << 16) >> 16) >> shift) + ((s0 * k0) >> 6) + ((s1 * k1) >> 6);
      value = Math.max(-0x8000, Math.min(0x7fff, value));
      s1 = s0; s0 = value;
      samples[3 + i] = value;
    }

    if ((blockFlags & 4) === 4 && !ignoreLoop) {
      repeatAddress = blockAddress;
    }
    hasSamples = true;
  };

  // past the end of a block: the next one, or the repeat address after an
  // end flag (ENDX latches; without the repeat flag the voice is muted)
  const nextBlock = () => {
    hasSamples = false;
    blockAddress = (blockAddress + 16) & 0x7ffff;
    if (blockFlags & 1) {
      blockAddress = repeatAddress;
      spu.ENDX |= (1 << id);
      if (!(blockFlags & 2)) {
        adsrState = 0;
        adsrLevel = 0;
        regs[0x0c] = 0;
      }
    }
  };

  // the 4-point gaussian interpolation of the decoded samples
  const interpolate = () => {
    const i = (pitchCounter >>> 4) & 0xff;
    const n = 3 + (pitchCounter >>> 12);
    return (gauss[0x0ff - i] * samples[n - 3] + gauss[0x1ff - i] * samples[n - 2] +
      gauss[0x100 + i] * samples[n - 1] + gauss[i] * samples[n]) >> 15;
  };

  const voice = {
    reverb: 0,
    capture: 0,
    // the enveloped sample before the voice volume: the capture buffers and
    // the next voice's pitch modulation take it
    lastVolume: 0,

    setId(voiceId) {
      id = voiceId;
      if (voiceId === 1) voice.capture = 0x0800;
      if (voiceId === 3) voice.capture = 0x0c00;
      return voice;
    },

    // One sample. Returns whether the voice sounds (audio holds its left
    // and right output, -1..1).
    advance(ram, audio, previousVoiceOutput = 0) {
      voice.lastVolume = 0;

      // Once keyed on, a voice keeps reading SPU RAM, also after it ended or
      // was keyed off and its envelope reached 0: its address still moves,
      // ENDX still latches and the IRQ address still matches. Only a voice
      // never keyed on is skipped.
      if (!started) return 0;

      // After a key-on the voice fetches the first block's header for three
      // samples, taking its loop start whatever the CPU wrote, and starts on
      // the fourth.
      if (startup) {
        --startup;
        if (startup < 3 && (ram[blockAddress + 1] & 4)) repeatAddress = blockAddress;
        return 0;
      }

      // the position moves by the pitch before the sample is taken
      // PMON scales the pitch by the previous voice's enveloped sample,
      // centered around a factor of 1.0
      let step = pitchStep;
      if (pitchModulationEnabled && id > 0) {
        const factor = Math.max(-0x8000, Math.min(0x7fff, previousVoiceOutput)) + 0x8000;
        step = ((step * factor) >> 15) & 0xffff;
      }
      if (!hasSamples) decodeBlock(ram);
      pitchCounter += Math.min(step, 0x4000);
      if ((pitchCounter >>> 12) >= 28) {
        pitchCounter -= 28 << 12;
        nextBlock();
        decodeBlock(ram);
      }
      // the IRQ address matches while the voice plays the block holding it
      spu.checkIrq(voice);

      const sample = interpolate();
      if (adsrState) mixADSR();
      const enveloped = (sample * adsrLevel) >> 15;
      voice.lastVolume = enveloped;

      audio[0] = ((enveloped * volumeLeft) >> 15) / 0x8000;
      audio[1] = ((enveloped * volumeRight) >> 15) / 0x8000;
      if (sweepingLeft) volumeLeft = sweepLeft.tick(volumeLeft);
      if (sweepingRight) volumeRight = sweepRight.tick(volumeRight);

      return adsrState;
    },

    // VOLX: the current left or right volume
    volx(right) {
      return (right ? volumeRight : volumeLeft) & 0xffff;
    },

    checkIrq(offset) {
      return (currentBlock <= offset) && (offset < (currentBlock + 16));
    },

    keyOn() {
      startup = 4;
      ignoreLoop = false;
      adsrLevel = 0;
      regs[0x0c] = 0;
      s0 = 0;
      s1 = 0;
      samples.fill(0);
      hasSamples = false;
      // measured: the first block plays from its fourth sample on
      pitchCounter = 3 << 12;
      blockAddress = regs[0x6] << 3;
      currentBlock = -1;
      started = true;
      startAdsrAttack();
    },

    echoOn(enabled) {
      // todo: reverb
      voice.reverb = enabled;
    },

    modOn(enabled) {
      pitchModulationEnabled = enabled;
    },

    noiseOn() {
      // todo: noise
    },

    keyOff() {
      startAdsrRelease();
    },

    rd16(addr) {
      if ((addr & 15) === 0xe) return (repeatAddress >>> 3) & 0xffff;
      return regs[addr & 15];
    },

    wr16(addr, data) {
      regs[addr & 15] = data;
      switch (addr % 16) {
        case 0x0: {
          const v = setVolume(data, volumeLeft, sweepLeft);
          volumeLeft = v.level;
          sweepingLeft = v.sweeping;
          break;
        }
        case 0x2: {
          const v = setVolume(data, volumeRight, sweepRight);
          volumeRight = v.level;
          sweepingRight = v.sweeping;
          break;
        }
        case 0x4:
          pitchStep = Math.min(data, 0x4000);
          break;
        // case 0x6:
        //   blockAddress = data << 3;
        //   break;
        case 0x8:
        case 0xa:
          // a new rate applies to the phase in progress
          if (adsrState) adsrPhase(adsrState);
          break;
        // case 0xc:
        //   adsrLevel = data << 16;
        //   break;
        case 0xe:
          repeatAddress = data << 3;
          if (started && adsrState) ignoreLoop = true;
          break;
      }
    }
  }

  return { voice };

})
