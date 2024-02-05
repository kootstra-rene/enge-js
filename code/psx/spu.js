mdlr('enge:psx:spu', m => {

  const frameCount = (1.0 * 44100) >> 1;

  const SAMPLES_PER_EVENT = 16; // ~0.4ms

  const memory = new Uint8Array(512 * 1024);
  const voices = new Array(24);
  const view = new DataView(memory.buffer);

  const init = () => {
    const context = new AudioContext();
    const buffer = context.createBuffer(2, frameCount, context.sampleRate);
    const source = context.createBufferSource();

    left = buffer.getChannelData(0);
    left.fill(0);
    right = buffer.getChannelData(1);
    right.fill(0)

    source.playbackRate.value = 44100 / context.sampleRate;
    source.buffer = buffer;
    source.loop = true;
    source.connect(context.destination);
    source.start();
  }

  const setReverbRegister = (addr, data) => {
    // todo: implement reverb later
  };

  psx.addEvent(0, (self, clock) => {
    psx.updateEvent(self, (PSX_SPEED / 44100 * SAMPLES_PER_EVENT));
    if (!left || !right) return;

    SPUSTAT &= ~(0x003F);
    SPUSTAT |= (SPUSTATm & 0x003F);

    for (let tt = SAMPLES_PER_EVENT; tt > 0; --tt) {
      ++totalSamples;

      let l = 0, r = 0;

      const captureIndex = (totalSamples % 0x200) << 1;
      spu.checkIrq();

      let audio = [0.0, 0.0];
      for (let voice of voices) {
        if (!voice.advance(memory, audio)) continue;

        l += audio[0];
        r += audio[1];

        if (voice.capture) {
          // todo: verify cacpture left or right channel
          const mono = (audio[0] * 0x8000) >> 0;
          view.setInt16(voice.capture + captureIndex, mono, true);
        }
      }

      var cdxa = [0.0, 0.0];
      cdr.nextpcm(cdxa);

      let cdSampleL = (cdxa[0] * cdVolumeLeft);
      let cdSampleR = (cdxa[1] * cdVolumeRight);
      {
        const mono = (cdSampleL * 0x8000) >>> 0;
        view.setInt16(0x0000 + captureIndex, mono, true);
      }
      {
        const mono = (cdSampleR * 0x8000) >>> 0;
        view.setInt16(0x0400 + captureIndex, mono, true);
      }
      l += cdSampleL;
      r += cdSampleR;

      l = (l * mainVolumeLeft);
      r = (r * mainVolumeRight);

      left[writeIndex] = l;//Math.max(Math.min(l, 1.0), -1.0);
      right[writeIndex] = r;//Math.max(Math.min(r, 1.0), -1.0);
      writeIndex = (writeIndex + 1) % frameCount;

      if (captureIndex === 0x000) {
        SPUSTAT &= ~0x0800;
      }
      if (captureIndex === 0x200) {
        SPUSTAT |= 0x0800;
      }
    }
  });

  let left = null;
  let right = null;
  let ramOffset = 0;
  let irqOffset = 0;
  let writeIndex = (44100 * 0.125) >> 0;
  let totalSamples = 0;

  let SPUCNT = 0x0000;
  let SPUSTAT = 0x0000;
  let SPUSTATm = 0x0000;

  let mainVolumeLeft = 0.0;
  let mainVolumeRight = 0.0;
  let reverbVolumeLeft = 0.0;
  let reverbVolumeRight = 0.0;
  let cdVolumeLeft = 0.0;
  let cdVolumeRight = 0.0;
  let extVolumeLeft = 0.0;
  let extVolumeRight = 0.0;

  let reverbOffset = 0;

  let spu = {
    ENDX: 0x00ffffff,

    silence: () => {
      if (left && right) {
        for (var i = 0; i < frameCount; ++i) {
          left[i] = right[i] = 0.0;
        }
      }
    },

    getVolume: data => {
      // if (data & 0x8000) return 0.75; // no sweep yet
      return ((data << 17) >> 16) / 0x8000;
    },

    getInt16: addr => {
      switch (addr) {
        case 0x1daa: return SPUCNT;
        case 0x1dae: return (SPUSTAT & ~0x3f) | (SPUCNT & 0x3f);
        case 0x1d9c: return spu.ENDX;
        default:
          if ((addr >= 0x1c00) && (addr < 0x1d80)) {
            const id = (addr - 0x1c00) >> 4;
            return voices[id].rd16(addr & 0xf);
          }
          return map16[((0x01800000 + addr) & 0x01ffffff) >>> 1];
      }
    },

    setInt16: (addr, data) => {
      data &= 0xffff;

      switch (addr) {
        case 0x1d80: mainVolumeLeft = spu.getVolume(data);
          break;
        case 0x1d82: mainVolumeRight = spu.getVolume(data);
          break;
        case 0x1d84: reverbVolumeLeft = spu.getVolume(data);
          break;
        case 0x1d86: reverbVolumeRight = spu.getVolume(data);
          break;
        case 0x1d88: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[i].keyOn()
          spu.ENDX &= ~(1 << i);
        }
          break
        case 0x1d8a: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[16 + i].keyOn()
          spu.ENDX &= ~(1 << (16 + i));
        }
          break
        case 0x1d8c: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[i].keyOff()
        }
          break
        case 0x1d8e: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[16 + i].keyOff()
        }
          break
        case 0x1d90: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[i].modOn()
        }
          break
        case 0x1d92: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[16 + i].modOn()
        }
          break
        case 0x1d94: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[i].noiseOn()
        }
          break
        case 0x1d96: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[16 + i].noiseOn()
        }
          break
        case 0x1d98: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[i].echoOn()
        }
          break
        case 0x1d9a: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          voices[16 + i].echoOn()
        }
          break
        case 0x1d9c:  // readonly Voice 0..15 on/off
          break
        case 0x1d9e:  // readonly Voice 16..23 on/off
          break
        case 0x1da0:  // ??? Legend of Dragoon
          break
        case 0x1da2: reverbOffset = data << 3;
          break
        case 0x1da4: irqOffset = data << 3;
          break
        case 0x1da6: ramOffset = data << 3;
          break
        case 0x1da8: memory[ramOffset + 0] = (data >> 0) & 0xff;
          memory[ramOffset + 1] = (data >> 8) & 0xff;
          ramOffset += 2;
          spu.checkIrq();
          break
        case 0x1dac: break
        case 0x1daa: SPUCNT = data;
          if ((!left || !right) && SPUCNT & 0x8000) {
            init();
          }
          if (SPUCNT & (1 << 6)) {
            SPUSTAT &= ~(0x0040);
          }
          // todo: delayed application of bits 0-5
          SPUSTATm = (SPUCNT & 0x003F);
          break
        case 0x1dae:  // SPUSTAT (read-only)
          break
        case 0x1db0: cdVolumeLeft = data / 0x8000;
          break
        case 0x1db2: cdVolumeRight = data / 0x8000;
          break
        case 0x1db4: extVolumeLeft = data / 0x8000;
          break
        case 0x1db6: extVolumeRight = data / 0x8000;
          break
        case 0x1db8:  // ??? Legend of Dragoon
          break
        case 0x1dba:  // ??? Legend of Dragoon 
          break
        case 0x1dbc:  // ??? Legend of Dragoon 
          break
        case 0x1dbe:  // ??? Legend of Dragoon 
          break
        default:
          if ((addr >= 0x1c00) && (addr < 0x1d80)) {
            const id = ((addr - 0x1c00) / 16) | 0;
            const voice = voices[id];

            voice.wr16(addr & 0xf, data);
            break;
          }
          if ((addr >= 0x1dc0) && (addr < 0x1e00)) {
            setReverbRegister(addr, data);
            break;
          }
          abort(hex(addr, 4));
      }
    },

    dmaTransferMode0200: (addr, blck) => {
      if (!(addr & 0x007fffff)) return 0x10;

      var transferSize = ((blck >> 16) * (blck & 0xFFFF) * 4) >>> 0;
      clearCodeCache(addr, transferSize);

      while (transferSize > 0) {
        var data = 0;
        data |= (memory[ramOffset + 0] >>> 0) << 0;
        data |= (memory[ramOffset + 1] >>> 0) << 8;
        map16[(addr & 0x001fffff) >>> 1] = data;
        ramOffset += 2;
        transferSize -= 2;
        addr += 2;
      }

      return (blck >> 16) * (blck & 0xFFFF);
    },

    dmaTransferMode0201: (addr, blck) => {
      if (!(addr & 0x007fffff)) return 0x10;
      var transferSize = ((blck >> 16) * (blck & 0xFFFF) * 4) >>> 0;

      while (transferSize > 0) {
        const data = map16[(addr & 0x001fffff) >>> 1];
        memory[ramOffset + 0] = (data >> 0) & 0xff;
        memory[ramOffset + 1] = (data >> 8) & 0xff;
        spu.checkIrq();
        ramOffset += 2;
        transferSize -= 2;
        addr += 2;
      }

      return (blck >> 16) * (blck & 0xFFFF);
    },

    checkIrq: voice => {
      if ((SPUCNT & 0x8040) !== 0x8040) return;

      const captureIndex = (totalSamples % 0x200) << 1;

      let irq = false;
      if (voice !== undefined) {
        irq = voice.checkIrq(irqOffset);
      }
      else {
        if (ramOffset === irqOffset) {
          irq = true;
        }
        if (captureIndex === irqOffset) {
          irq = true;
        }
      }

      if (irq) {
        cpu.istat |= 0x200;
        SPUSTAT |= 0x0040;
      }
    }
  }

  //- init
  for (let i = 0; i < 24; ++i) {
    // mdlr does not cache compiled modules, so this works perfectly
    const { voice } = m.require('enge:psx:spu-voice');
    voices[i] = voice.setId(i);
  }

  //- lookup tables
  const xa2flt = new Float32Array(16 * 2);
  xa2flt.fill(0.0);

  xa2flt[2] = 60 / 64; xa2flt[3] = 0 / 64; //- [K0:+0.953125][K1:+0.000000]
  xa2flt[4] = 115 / 64; xa2flt[5] = -52 / 64; //- [K0:+1.796875][K1:-0.812500]
  xa2flt[6] = 98 / 64; xa2flt[7] = -55 / 64; //- [K0:+1.531250][K1:-0.859375]
  xa2flt[8] = 122 / 64; xa2flt[9] = -60 / 64; //- [K0:+1.906250][K1:-0.937500]

  const xa2pcm = new Float32Array(16 * 256 * 2);

  const factor = 32768.0;

  for (let shift = 0; shift < 16; ++shift) {
    for (let index = 0; index < 256; ++index) {
      const offset = ((shift << 8) + index) << 1;

      var sample = (index & 0xF0) << 8;
      if (sample & 0x8000) { sample |= 0xFFFF0000 };
      xa2pcm[offset + 1] = (sample >> shift) / factor;

      var sample = (index & 0x0F) << 12;
      if (sample & 0x8000) { sample |= 0xFFFF0000 };
      xa2pcm[offset + 0] = (sample >> shift) / factor;
    }
  }

  return { spu, xa2flt, xa2pcm };

})