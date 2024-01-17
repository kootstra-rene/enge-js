mdlr('enge:psx:spu', m => {

  const frameCount = (1.0 * 44100) >> 1;

  const CYCLES_PER_EVENT = 8;

  let left = null;
  let right = null;

  function init() {
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

  var spu = {
    totalSamples: 0,
    voices: [],
    index: 0,
    writeIndex: (44100 * 0.125) >> 0,

    data: new Uint8Array(512 * 1024),

    ENDX: 0x00ffffff,
    SPUCNT: 0x0000,
    SPUSTAT: 0x0000,
    SPUSTATm: 0x0000,
    mainVolumeLeft: 0.0,
    mainVolumeRight: 0.0,
    reverbVolumeLeft: 0.0,
    reverbVolumeRight: 0.0,
    cdVolumeLeft: 0.0,
    cdVolumeRight: 0.0,
    extVolumeLeft: 0.0,
    extVolumeRight: 0.0,
    irqOffset: 0,
    ramOffset: 0,
    reverbOffset: 0,

    silence: function () {
      if (left && right) {
        for (var i = 0; i < frameCount; ++i) {
          left[i] = right[i] = 0.0;
        }
      }
    },

    getVolume: function (data) {
      // if (data & 0x8000) return 0.75; // no sweep yet
      return ((data << 17) >> 16) / 0x8000;
    },

    getInt16: function (addr) {
      switch (addr) {
        case 0x1daa: return this.SPUCNT;
        case 0x1dae: return (this.SPUSTAT & ~0x3f) | (this.SPUCNT & 0x3f);
        case 0x1d9c: return this.ENDX;
        default:
          if ((addr >= 0x1c00) && (addr < 0x1d80)) {
            const id = (addr - 0x1c00) >> 4;
            const voice = this.voices[id];

            return voice.getRegister(addr & 0xf);
          }
          return map16[((0x01800000 + addr) & 0x01ffffff) >>> 1];
      }
    },

    setInt16: function (addr, data) {
      data &= 0xffff;

      switch (addr) {
        case 0x1d80: this.mainVolumeLeft = this.getVolume(data);
          break;
        case 0x1d82: this.mainVolumeRight = this.getVolume(data);
          break;
        case 0x1d84: this.reverbVolumeLeft = this.getVolume(data);
          break;
        case 0x1d86: this.reverbVolumeRight = this.getVolume(data);
          break;
        case 0x1d88: for (var i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[i].keyOn()
          this.ENDX &= ~(1 << i);
        }
          break
        case 0x1d8a: for (var i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[16 + i].keyOn()
          this.ENDX &= ~(1 << (16 + i));
        }
          break
        case 0x1d8c: for (var i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[i].keyOff()
        }
          break
        case 0x1d8e: for (var i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[16 + i].keyOff()
        }
          break
        case 0x1d90: for (var i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[i].modOn()
        }
          break
        case 0x1d92: for (var i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[16 + i].modOn()
        }
          break
        case 0x1d94: for (var i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[i].noiseOn()
        }
          break
        case 0x1d96: for (var i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[16 + i].noiseOn()
        }
          break
        case 0x1d98: for (var i = 0; i < 16; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[i].echoOn()
        }
          break
        case 0x1d9a: for (var i = 0; i < 8; ++i) {
          if ((data & (1 << i)) === 0) continue
          this.voices[16 + i].echoOn()
        }
          break
        case 0x1d9c:  // readonly Voice 0..15 on/off
          break
        case 0x1d9e:  // readonly Voice 16..23 on/off
          break
        case 0x1da0:  // ??? Legend of Dragoon
          break
        case 0x1da2: this.reverbOffset = data << 3;
          break
        case 0x1da4: this.irqOffset = data << 3;
          break
        case 0x1da6: this.ramOffset = data << 3;
          break
        case 0x1da8: this.data[this.ramOffset + 0] = (data >> 0) & 0xff;
          this.data[this.ramOffset + 1] = (data >> 8) & 0xff;
          this.ramOffset += 2;
          this.checkIrq();
          break
        case 0x1dac: break
        case 0x1daa: this.SPUCNT = data;
          if ((!left || !right) && this.SPUCNT & 0x8000) {
            init();
          }
          if (this.SPUCNT & (1 << 6)) {
            this.SPUSTAT &= ~(0x0040);
          }
          // todo: delayed application of bits 0-5
          this.SPUSTATm = (this.SPUCNT & 0x003F);
          break
        case 0x1dae:  // SPUSTAT (read-only)
          break
        case 0x1db0: this.cdVolumeLeft = data / 0x8000;
          break
        case 0x1db2: this.cdVolumeRight = data / 0x8000;
          break
        case 0x1db4: this.extVolumeLeft = data / 0x8000;
          break
        case 0x1db6: this.extVolumeRight = data / 0x8000;
          break
        case 0x1db8:  // ??? Legend of Dragoon
          break
        case 0x1dba:  // ??? Legend of Dragoon 
          break
        case 0x1dbc:  // ??? Legend of Dragoon 
          break
        case 0x1dbe:  // ??? Legend of Dragoon 
          break
        default: if ((addr >= 0x1c00) && (addr < 0x1d80)) {
          var id = ((addr - 0x1c00) / 16) | 0;
          var voice = this.voices[id];

          voice.setRegister(addr & 0xf, data);
          break;
        }
          if ((addr >= 0x1dc0) && (addr < 0x1e00)) {
            this.setReverbRegister(addr, data);
            break;
          }
          abort("Unimplemented spu register:" + hex(addr, 4))
          break
      }
    },

    dmaTransferMode0200: function (addr, blck) {
      if (!(addr & 0x007fffff)) return 0x10;

      var transferSize = ((blck >> 16) * (blck & 0xFFFF) * 4) >>> 0;
      clearCodeCache(addr, transferSize);

      while (transferSize > 0) {
        var data = 0;
        data |= (this.data[this.ramOffset + 0] >>> 0) << 0;
        data |= (this.data[this.ramOffset + 1] >>> 0) << 8;
        map16[(addr & 0x001fffff) >>> 1] = data;
        this.ramOffset += 2;
        transferSize -= 2;
        addr += 2;
      }

      return (blck >> 16) * (blck & 0xFFFF);
    },

    dmaTransferMode0201: function (addr, blck) {
      if (!(addr & 0x007fffff)) return 0x10;
      var transferSize = ((blck >> 16) * (blck & 0xFFFF) * 4) >>> 0;

      while (transferSize > 0) {
        const data = map16[(addr & 0x001fffff) >>> 1];
        this.data[this.ramOffset + 0] = (data >> 0) & 0xff;
        this.data[this.ramOffset + 1] = (data >> 8) & 0xff;
        this.checkIrq();
        this.ramOffset += 2;
        transferSize -= 2;
        addr += 2;
      }

      return (blck >> 16) * (blck & 0xFFFF);
    },

    setReverbRegister: function (addr, data) {
      // todo: implement reverb later
    },

    checkIrq: function (voice) {
      if ((this.SPUCNT & 0x8040) !== 0x8040) return;

      const captureIndex = (this.totalSamples % 0x200) << 1;

      let irq = false;
      if (voice !== undefined) {
        irq = voice.checkIrq(this.irqOffset);
      }
      else {
        if (this.ramOffset === this.irqOffset) {
          irq = true;
        }
        if (captureIndex === this.irqOffset) {
          irq = true;
        }
      }


      if (irq) {
        cpu.istat |= 0x200;
        this.SPUSTAT |= 0x0040;
      }
    },

    event: function (self, clock) {
      psx.updateEvent(self, (PSX_SPEED / 44100 * CYCLES_PER_EVENT));
      if (!left || !right) return;

      this.SPUSTAT &= ~(0x003F);
      this.SPUSTAT |= (this.SPUSTATm & 0x003F);

      for (let tt = CYCLES_PER_EVENT; tt > 0; --tt) {
        ++this.totalSamples;

        let l = 0, r = 0;

        const captureIndex = (this.totalSamples % 0x200) << 1;
        this.checkIrq();

        let audio = [0.0, 0.0];
        for (let i = 0; i < 24; ++i) {
          let voice = this.voices[i];
          if (!voice.advance(spu.data, audio)) ;

          l += audio[0];
          r += audio[1];

          if (i === 3) {
            const mono = (audio[0] * 0x8000) >>> 0;
            this.data[0x0C00 + captureIndex] = mono & 0xff;
            this.data[0x0C01 + captureIndex] = mono >> 8;
          }
          if (i === 1) {
            const mono = (audio[0] * 0x8000) >>> 0;
            this.data[0x0800 + captureIndex] = mono & 0xff;
            this.data[0x0801 + captureIndex] = mono >> 8;
          }
        }

        var cdxa = [0.0, 0.0];
        cdr.nextpcm(cdxa);

        let cdSampleL = (cdxa[0] * this.cdVolumeLeft);
        let cdSampleR = (cdxa[1] * this.cdVolumeRight);
        {
          const mono = (cdSampleL * 0x8000) >>> 0;
          this.data[0x0000 + captureIndex] = mono & 0xff;
          this.data[0x0001 + captureIndex] = mono >> 8;
        }
        {
          const mono = (cdSampleR * 0x8000) >>> 0;
          this.data[0x0400 + captureIndex] = mono & 0xff;
          this.data[0x0401 + captureIndex] = mono >> 8;
        }
        l += cdSampleL;
        r += cdSampleR;

        l = (l * this.mainVolumeLeft);
        r = (r * this.mainVolumeRight);

        left[this.writeIndex] = Math.max(Math.min(l, 1.0), -1.0);
        right[this.writeIndex] = Math.max(Math.min(r, 1.0), -1.0);
        this.writeIndex = (this.writeIndex + 1) % frameCount;

        if (captureIndex === 0x000) {
          this.SPUSTAT &= ~0x0800;
        }
        if (captureIndex === 0x200) {
          this.SPUSTAT |= 0x0800;
        }
      }
    }

  }

  //- init
  for (var i = 0; i < 24; ++i) {
    // mdlr does not cache compiled modules, so this works perfectly
    const { voice } = m.require('enge:psx:spu-voice');
    spu.voices[i] = voice.setId(i);
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