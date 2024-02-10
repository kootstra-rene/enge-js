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

  const adsrStep = (direction, mode, rate, level = adsrLevel) => {
    const table = direction ? envelopeExponentialDecrease : envelopeExponentialIncrease;
    const offset = mode ? table[level >>> 28] : 0;
    const step = envelopStep[rate + offset];
    return direction ? -step : step;
  }

  const adsrAttack = () => {
    adsrLevel += adsrStep(0, adsrAttackMode, adsrAttackRate);

    if (adsrLevel >= 0x7FFFFFFF) {
      adsrState = 2; // decay
    }
  }

  const adsrDecay = () => {
    adsrLevel += adsrStep(1, 1, adsrDecayRate);

    if (((adsrLevel >>> 27) & 15) <= adsrSustainLevel) {
      adsrState = 3; // sustain
    }
  }

  const adsrSustain = () => {
    adsrLevel += adsrStep(adsrSustainDirection, adsrSustainMode, adsrSustainRate);
  }

  const adsrRelease = () => {
    adsrLevel += adsrStep(1, adsrReleaseMode, adsrReleaseRate);
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

    if (adsrLevel > 0x7FFFFFFF) {
      adsrLevel = 0x7FFFFFFF;
    }
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

  const voice = {
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

      audio[0] = (sample * adsrVolume * volumeLeft * mixSweep(sweepLeft))
      audio[1] = (sample * adsrVolume * volumeRight * mixSweep(sweepRight));

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
      repeatAddress = regs[0xe] << 3;
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
          adsrReleaseRate = (data & 32) << 2;
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

  const getEnvelope = (data) => {
    const mode = (data & (1 << 14)) ? 1 : 0;
    const direction = (data & (1 << 13)) ? 1 : 0;
    const rate = (data >> 0) & 127;

    return [mode, direction, rate, adsrLevel];
  }

  const mixSweep = (sweep) => {
    const { mode, direction, rate, level} = sweep;

    if (mode === undefined) return 1.0;

    sweep[3] += adsrStep(direction, mode, rate, level);

    return (sweep[3] >>> 16) / 0x8000;
  }

  for (let i = 0; i < 140; ++i) {
    const step = i & 3;
    const shift = i >> 2;

    const $cycles = 1 << Math.max(0, shift - 11);
    const $step = (8 - step) << Math.max(0, 11 - shift);

    envelopStep[i] = (($step / $cycles * 0x10000) >>> 0);
  }

  return { voice };

})