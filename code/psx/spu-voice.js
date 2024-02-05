mdlr('enge:psx:spu-voice', m => {

  const BLOCKSIZE = (28 * 0x1000) >>> 0;

  // ADSR
  const rateTable = new Uint32Array(160);

  (table => {
    let r, rs, rd;

    table.fill(0);

    r = 3; rs = 1; rd = 0;

    for (let i = 32; i < 160; ++i) {
      if (r < 0x7FFFFFFF) {
        r += rs;
        rd++;
        if (rd === 5) {
          rd = 1;
          rs *= 2;
        }
      }
      if (r > 0x7FFFFFFF) r = 0x7FFFFFFF;

      table[i] = r;
    }
  })(rateTable);

  let id = 0;
  let adsrLevel = 0;
  let adsrState = 0;
  let adsrAttackMode = 0;
  let adsrAttackRate = 0;
  let adsrDecayMode = 0;
  let adsrDecayRate = 0;
  let adsrSustainMode = 0;
  let adsrSustainRate = 0;
  let adsrSustainLevel = 0;
  let adsrSustainDirection = 0;
  let adsrLinearSustainRate = 0;
  let adsrReleaseMode = 0;
  let adsrReleaseRate = 0;
  let adsrLinearReleaseRate = 0;

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

  const adsrExponentialRateOffset = [
    0 + 32,
    4 + 32,
    6 + 32,
    8 + 32,
    9 + 32,
    10 + 32,
    11 + 32,
    12 + 32,
  ];

  const adsrAttack = () => {
    if (adsrAttackMode) {
      // exponential attack
      if (adsrLevel < 0x60000000) {
        adsrLevel += rateTable[adsrAttackRate - 0x10 + 32];
      }
      else {
        adsrLevel += rateTable[adsrAttackRate - 0x18 + 32];
      }
    }
    else {
      // linear attack
      adsrLevel += rateTable[adsrAttackRate - 0x10 + 32];
    }
    if (adsrLevel >= 0x7FFFFFFF) {
      adsrState = 2; // decay
    }
  }

  const adsrDecay = () => {
    if (adsrDecayMode) {
      const offset = adsrExponentialRateOffset[(adsrLevel >> 29) & 0x7] - 0x18;
      adsrLevel -= rateTable[adsrDecayRate + offset];
    }
    if (((adsrLevel >> 28) & 0xF) <= adsrSustainLevel) {
      adsrState = 3; // sustain
    }
  }

  const adsrSustain = () => {
    if (!adsrSustainMode) {
      adsrLevel += adsrLinearSustainRate;
      return;
    }

    if (adsrSustainDirection == 0) {
      if (adsrLevel < 0x60000000)
        adsrLevel += rateTable[adsrSustainRate - 0x10 + 32];

      else
        adsrLevel += rateTable[adsrSustainRate - 0x18 + 32];
    }
    else {
      const offset = adsrExponentialRateOffset[(adsrLevel >> 29) & 0x7] - 0x1B;
      adsrLevel -= rateTable[adsrSustainRate + offset];
    }
  }

  const adsrRelease = () => {
    if (!adsrReleaseMode) {
      adsrLevel -= adsrLinearReleaseRate;
    }
    else {
      const offset = adsrExponentialRateOffset[(adsrLevel >> 29) & 0x7] - 0x18;
      adsrLevel -= rateTable[adsrReleaseRate + offset];
    }
  }

  const mixADSR = () => {
    switch (adsrState) {
      case 0x0:
        return 0.0;
      case 0x1:
        adsrAttack();
        break;
      case 0x2:
        adsrDecay();
        break;
      case 0x3:
        adsrSustain();
        break;
      case 0x4:
        adsrRelease();
        break;
    }

    if (adsrLevel > 0x7FFFFFFF) adsrLevel = 0x7FFFFFFF;
    if (adsrLevel < 0) {
      if (adsrState === 4) {
        if (id !== 1 && id !== 3) {
          adsrState = 0;
        }
      }
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

    let sample = 0;
    let value;
    for (let offset = 2; offset < 16; ++offset) {
      let data = ram[blockAddress + offset];
      let index = ((shift << 8) + data) << 1;

      buffer[sample++] = value = (s0 * k0) + (s1 * k1) + xa2pcm[index + 0];
      s1 = s0; s0 = value;
      buffer[sample++] = value = (s0 * k0) + (s1 * k1) + xa2pcm[index + 1];
      s1 = s0; s0 = value;
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

  const voice = {
    capture :0,

    setId(voiceId) {
      id = voiceId;
      if (voiceId === 1) voice.capture = 0x0800;
      if (voiceId === 3) voice.capture = 0x0c00;
      return voice;
    },

    advance(ram, audio) {
      if (!adsrState) return adsrState;

      pitchCounter += pitchStep;

      if (pitchCounter >= BLOCKSIZE) {
        pitchCounter -= BLOCKSIZE;

        decodeBlock(ram);
        spu.checkIrq(voice);
      }

      const sample = buffer[pitchCounter >>> 12];
      const adsrVolume = mixADSR();

      audio[0] = (sample * adsrVolume * volumeLeft)
      audio[1] = (sample * adsrVolume * volumeRight);

      return adsrState;
    },

    checkIrq(offset) {
      return (blockAddress <= offset) && (offset < (blockAddress + 16));
    },

    keyOn() {
      s0 = 0.0;
      s1 = 0.0;
      pitchCounter = BLOCKSIZE;
      blockAddress = regs[0x6] << 3;
      repeatAddress = regs[0x0e] << 3;
      startAdsrAttack();
    },

    echoOn() {
      // todo: reverb
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
          volumeLeft = spu.getVolume(data);
          break;
        case 0x2:
          volumeRight = spu.getVolume(data);
          break;
        case 0x4:
          pitchStep = Math.min(data, 0x4000);
          break;
        // case 0x6:
        //   blockAddress = data << 3;
        //   break;
        case 0x8:
          adsrAttackMode = (data & 0x8000) >>> 15;
          adsrAttackRate = (((data & 0x7F00) >>> 8) ^ 0x7F);
          adsrDecayMode = 1;
          adsrDecayRate = (((data & 0x00F0) >>> 4) ^ 0x1F) << 2;
          adsrSustainLevel = (data & 0x000F) >>> 0;
          break;
        case 0xa:
          adsrSustainMode = (data & 0x8000) >>> 15;
          adsrSustainDirection = (data & 0x4000) >>> 14;
          adsrSustainRate = (((data & 0x1FC0) >>> 6) ^ 0x7F);
          adsrReleaseMode = (data & 0x0020) >>> 5;
          adsrReleaseRate = (((data & 0x001F) >>> 0) ^ 0x1F) << 2;
          adsrLinearReleaseRate = rateTable[adsrReleaseRate - 0x0C + 32];
          if (adsrSustainDirection == 0) {
            adsrLinearSustainRate = rateTable[adsrSustainRate - 0x10 + 32];
          }
          else {
            adsrLinearSustainRate = -rateTable[adsrSustainRate - 0x0F + 32];
          }
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

  return { voice };

})