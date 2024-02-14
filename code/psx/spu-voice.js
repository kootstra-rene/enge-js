mdlr('enge:psx:spu-voice', m => {

  let BLOCKSIZE = (28 * 0x1000) >>> 0;

  let id = 0;
  let adsrLevel = 0;
  let adsrState = 0;
  let adsrAttackMode = 0;
  let adsrAttackRate = 0;
  let adsrDecayRate = 0;
  let adsrSustainMode = 0;
  let adsrSustainRate = 0;
  let adsrSustainLevel = 0;
  let adsrSustainDirection = 0;
  let adsrReleaseMode = 0;
  let adsrReleaseRate = 0;
  let sweepLeft = [];
  let sweepRight = [];

  let pitchStep = 0;
  let pitchCounter = BLOCKSIZE;
  let repeatAddress = 0;
  let blockAddress = 0;
  let buffer = new Float32Array(28);
  let s0 = 0.0;
  let s1 = 0.0;
  let volumeLeft = 0.0;
  let volumeRight = 0.0;

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

  const adsrStep = (direction, mode, rate, level = adsrLevel) => {
    const table = direction ? envelopeExponentialDecrease : envelopeExponentialIncrease;
    const offset = mode ? table[level >>> 28] : 0;
    const step = envelopStep[rate + offset];
    return direction ? -step : step;
  }

  const mixADSR = () => {
    switch (adsrState) {
      case 0x0:
        adsrLevel = 0.0;
      case 0x1:
        adsrLevel += adsrStep(0, adsrAttackMode, adsrAttackRate);
        if (adsrLevel >= 0x7FFFFFFF) {
          adsrState = 2;
        }
        break;
      case 0x2:
        adsrLevel += adsrStep(1, 1, adsrDecayRate);
        if (((adsrLevel >>> 27) & 15) <= adsrSustainLevel) {
          adsrState = 3;
        }
        break;
      case 0x3:
        adsrLevel += adsrStep(adsrSustainDirection, adsrSustainMode, adsrSustainRate);
        break;
      case 0x4:
        adsrLevel += adsrStep(1, adsrReleaseMode, adsrReleaseRate);
        if (adsrLevel <= 0) {
          adsrState = 0;
        }
        break;
    }

    if (adsrLevel > 0x7FFFFFFF) {
      adsrLevel = 0x7FFFFFFF;
    }
    if (adsrLevel < 0) {
      adsrLevel = 0;
    }

    return (regs[0x0c] = adsrLevel >>> 16) / 0x8000;
  }

  const startAdsrAttack = () => {
    adsrState = 1;
    adsrLevel = 0;
  }
  const startAdsrRelease = () => {
    adsrState = 4;
  }

  const decodeBlock = (ram) => {
    const shiftFilter = ram[blockAddress + 0];
    const flags = ram[blockAddress + 1];

    const shift = (shiftFilter & 0x0f) >>> 0;
    const filter = (shiftFilter & 0xf0) >>> 3;

    const k0 = xa2flt[filter + 0];
    const k1 = xa2flt[filter + 1];

    let sample = -1;
    for (let offset = 2; offset < 16; ++offset) {
      let data = ram[blockAddress + offset];
      let index = ((shift << 8) + data) << 1;
      let value;

      value = (s0 * k0) + (s1 * k1) + xa2pcm[index + 0];
      s1 = s0; s0 = buffer[++sample] = value;
      value = (s0 * k0) + (s1 * k1) + xa2pcm[index + 1];
      s1 = s0; s0 = buffer[++sample] = value;
    }

    if ((flags & 4) === 4) {
      repeatAddress = blockAddress;
    }

    blockAddress += 16;

    if ((flags & 1) === 1) {
      blockAddress = repeatAddress;
      spu.ENDX |= (1 << id);
      if ((flags & 2) === 0) {
        startAdsrRelease();
        adsrLevel = 0;
      }
    }

  }

  let $s1, $s2, $s3, $s4;

  const voice = {
    reverb: 0,
    capture: 0,

    setId(voiceId) {
      id = voiceId;
      if (voiceId === 1) voice.capture = 0x0800;
      if (voiceId === 3) voice.capture = 0x0c00;
      return voice;
    },

    advance(ram, audio) {
      if (!adsrState) return adsrState; // note: this is an optimisation that behave differently then the hardware does.

      pitchCounter += pitchStep;

      if (pitchCounter >= BLOCKSIZE) {
        pitchCounter -= BLOCKSIZE;

        decodeBlock(ram);
        spu.checkIrq(voice);
      }

      const sample = buffer[pitchCounter >>> 12];
      const adsrVolume = mixADSR();

      $s1 = sample * adsrVolume;
      const i = (pitchCounter >>> 3) & 0xff;

      let out = ((gauss[255 - i] * $s4));
      out = out + ((gauss[511 - i] * $s3));
      out = out + ((gauss[256 + i] * $s2));
      out = out + ((gauss[i] * $s1));

      let s = out / 0x8000;
      // if (out) console.log(out);

      audio[0] = (s * volumeLeft * mixSweep(sweepLeft))
      audio[1] = (s * volumeRight * mixSweep(sweepRight));

      $s4 = $s3;
      $s3 = $s2;
      $s2 = $s1;

      return adsrState;
    },

    checkIrq(offset) {
      return (blockAddress <= offset) && (offset < (blockAddress + 16));
    },

    keyOn() {
      s0 = 0.0;
      s1 = 0.0;
      $s1 = 0, $s2 = 0, $s3 = 0, $s4 = 0;
      pitchCounter = BLOCKSIZE;
      blockAddress = regs[0x6] << 3;
      repeatAddress = regs[0xe] << 3;
      startAdsrAttack();
    },

    echoOn(enabled) {
      // todo: reverb
      voice.reverb = enabled;
    },

    modOn() {
      // todo: pitch modulation
    },

    noiseOn() {
      // todo: noise
    },

    keyOff() {
      startAdsrRelease();
    },

    rd16(addr) {
      return regs[addr & 15];
    },

    wr16(addr, data) {
      regs[addr & 15] = data;
      switch (addr % 16) {
        case 0x0:
          if (data & 0x8000) {
            sweepLeft = getEnvelope(data);
          }
          else {
            sweepLeft = [];
            volumeLeft = spu.getVolume(data);
          }
          break;
        case 0x2:
          if (data & 0x8000) {
            sweepRight = getEnvelope(data);
          }
          else {
            sweepRight = [];
            volumeRight = spu.getVolume(data);
          }
          break;
        case 0x4:
          pitchStep = Math.min(data, 0x4000);
          break;
        // case 0x6:
        //   blockAddress = data << 3;
        //   break;
        case 0x8:
          adsrAttackMode = (data >>> 15) & 1
          adsrAttackRate = ((data >>> 8) & 127);
          adsrDecayRate = ((data >>> 4) & 15) << 3;
          adsrSustainLevel = 1 + (data & 15);
          break;
        case 0xa:
          adsrSustainMode = (data >>> 15) & 1;
          adsrSustainDirection = (data >>> 14) & 1;
          adsrSustainRate = (data >>> 6) & 127;
          adsrReleaseMode = (data >>> 5) & 1;
          adsrReleaseRate = (data & 31) << 2;
          break;
        // case 0xc:
        //   adsrLevel = data << 16;
        //   break;
        case 0xe:
          repeatAddress = data << 3;
          break;
      }
    }
  }

  const envelopStep = [];

  const envelopeExponentialIncrease = [0, 0, 0, 0, 0, 0, 8, 8];
  const envelopeExponentialDecrease = [12, 8, 6, 4, 3, 2, 1, 0];

  const max = (a, b) => a > b ? a : b;

  const getEnvelope = (data) => {
    const mode = (data & (1 << 14)) ? 1 : 0;
    const direction = (data & (1 << 13)) ? 1 : 0;
    const rate = (data >> 0) & 127;

    return [mode, direction, rate, adsrLevel];
  }

  const mixSweep = (sweep) => {
    const { mode, direction, rate, level } = sweep;

    if (mode === undefined) return 1.0;

    sweep[3] += adsrStep(direction, mode, rate, level);

    return (sweep[3] >>> 16) / 0x8000;
  }

  for (let i = 0; i < 140; ++i) {
    const step = i & 3;
    const shift = i >> 2;

    const $cycles = 1 << max(0, shift - 11);
    const $step = (7 - step) << max(0, 11 - shift);

    envelopStep[i] = (($step / $cycles * 0x10000) >>> 0);
  }

  return { voice };

})