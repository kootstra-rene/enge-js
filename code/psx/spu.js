mdlr('enge:psx:spu', m => {

  const reverb = m.require('enge:psx:spu-reverb');

  const frameCount = (1.0 * 44100) >> 1;

  const memory = new Uint8Array(512 * 1024);
  const voices = new Array(24);
  const view = new DataView(memory.buffer);

  const regs = new Map;

  const init = () => {
    const context = new AudioContext();
    const gainNode = context.createGain();
    const buffer = context.createBuffer(2, frameCount, context.sampleRate);
    const source = context.createBufferSource();

    left = buffer.getChannelData(0);
    left.fill(0);
    right = buffer.getChannelData(1);
    right.fill(0)

    source.playbackRate.value = 44100 / context.sampleRate;
    source.buffer = buffer;
    source.loop = true;
    source.connect(gainNode);
    gainNode.connect(context.destination);
    source.start();

    spu.setVolume = (volume) => gainNode.gain.setValueAtTime(volume, context.currentTime);

    spu.setVolume(0.75);
  }



  psx.addEvent(0, (self) => {
    psx.updateEvent(self, 768); // 1 sample
    if (!left || !right) return;

    SPUSTAT &= ~(0x003F);
    SPUSTAT |= (SPUSTATm & 0x003F);

    ++totalSamples;

    let l = 0, r = 0;

    const captureIndex = (totalSamples % 0x200) << 1;
    spu.checkIrq();

    let audio = [0.0, 0.0];
    let reverbLeft = 0.0, reverbRight = 0.0;
    for (let voice of voices) {
      if (!voice.advance(memory, audio)) continue;

      l += audio[0];
      r += audio[1];

      if (voice.reverb) {
        reverbLeft += audio[0];
        reverbRight += audio[1];
      }
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

    if (SPUCNT & 0x04) {
      reverbLeft += cdSampleL;
      reverbRight += cdSampleR;
    }
    if (SPUCNT & 0x80) {
      const [rl, rr] = reverb.advance(totalSamples, reverbLeft, reverbRight, view);
      l += rl;
      r += rr;
    }

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
  let cdVolumeLeft = 0.0;
  let cdVolumeRight = 0.0;
  let extVolumeLeft = 0.0;
  let extVolumeRight = 0.0;

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
      return Math.abs((data << 17) >> 16) / 0x8000;
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
          if ((addr >= 0x1dc0) && (addr < 0x1e00)) {
            return reverb.rd16(addr);
          }
          return regs.get(addr);
      }
    },

    setInt16: (addr, data) => {
      data &= 0xffff;
      regs.set(addr, data);

      switch (addr) {
        case 0x1d80:
          mainVolumeLeft = spu.getVolume(data);
          break;
        case 0x1d82:
          mainVolumeRight = spu.getVolume(data);
          break;
        case 0x1d84:
          reverb.wr16(addr, data);
          break;
        case 0x1d86:
          reverb.wr16(addr, data);
          break;
        case 0x1d88: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue;
          voices[i].keyOn()
          spu.ENDX &= ~(1 << i);
        }
          break
        case 0x1d8a: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue;
          voices[16 + i].keyOn()
          spu.ENDX &= ~(1 << (16 + i));
        }
          break
        case 0x1d8c: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue;
          voices[i].keyOff()
        }
          break
        case 0x1d8e: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue;
          voices[16 + i].keyOff()
        }
          break
        case 0x1d90: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue;
          voices[i].modOn()
        }
          break
        case 0x1d92: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue;
          voices[16 + i].modOn()
        }
          break
        case 0x1d94: for (let i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue;
          voices[i].noiseOn()
        }
          break
        case 0x1d96: for (let i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue;
          voices[16 + i].noiseOn()
        }
          break
        case 0x1d98: for (let i = 0; i < 16; ++i) {
          // if ((data & (1 << i)) === 0) continue;
          voices[i].echoOn(data & (1 << i))
        }
          break
        case 0x1d9a: for (let i = 0; i < 8; ++i) {
          // if ((data & (1 << i)) === 0) continue;
          voices[16 + i].echoOn(data & (1 << i))
        }
          break
        case 0x1d9c:  // readonly Voice 0..15 on/off
          break
        case 0x1d9e:  // readonly Voice 16..23 on/off
          break
        case 0x1da0:  // ??? Legend of Dragoon
          break
        case 0x1da2:
          reverb.wr16(addr, data);
          break
        case 0x1da4: irqOffset = data << 3;
          break
        case 0x1da6: ramOffset = data << 3;
          break
        case 0x1da8:
          ramOffset = ramOffset % memory.byteLength;
          view.setInt16(ramOffset, data, true);
          ramOffset += 2;
          spu.checkIrq();
          break
        case 0x1dac: break
        case 0x1daa:
          if (!(SPUCNT & 0x80) && (data & 0x80)) {
            console.log('reverb', 'on');
          }
          if ((SPUCNT & 0x80) && !(data & 0x80)) {
            console.log('reverb', 'off');
          }
          SPUCNT = data;
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
        case 0x1db0:
          cdVolumeLeft = ((data << 16) >> 16) / 0x8000;
          break
        case 0x1db2:
          cdVolumeRight = ((data << 16) >> 16) / 0x8000;
          break
        case 0x1db4:
          extVolumeLeft = ((data << 16) >> 16) / 0x8000;
          break
        case 0x1db6:
          extVolumeRight = ((data << 16) >> 16) / 0x8000;
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
            const id = (addr - 0x1c00) >>> 4;
            const voice = voices[id];

            voice.wr16(addr & 15, data);
            break;
          }
          if ((addr >= 0x1dc0) && (addr < 0x1e00)) {
            reverb.wr16(addr, data);
            break;
          }
          console.log('spu.setInt16:', hex(addr, 4), hex(data));
        // abort(hex(addr, 4));
      }
    },

    dmaTransferMode0200: (addr, blck) => {
      if (!(addr & 0x007fffff)) return 0x10;

      let transferSize = ((blck >> 16) * (blck & 0xFFFF) * 4) >>> 0;
      // clearCodeCache(addr, transferSize); // optimistice assumption (performance reasons)

      while (transferSize > 0) {
        ramOffset = ramOffset % memory.byteLength;
        const data = view.getInt16(ramOffset, true);
        map16[(addr & 0x001fffff) >>> 1] = data;
        ramOffset += 2;
        transferSize -= 2;
        addr += 2;
      }

      return (blck >> 16) * (blck & 0xFFFF);
    },

    dmaTransferMode0201: (addr, blck) => {
      if (!(addr & 0x007fffff)) return 0x10;

      let transferSize = ((blck >> 16) * (blck & 0xFFFF) * 4) >>> 0;

      while (transferSize > 0) {
        ramOffset = ramOffset % memory.byteLength;
        const data = map16[(addr & 0x001fffff) >>> 1];
        view.setInt16(ramOffset, data, true);
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