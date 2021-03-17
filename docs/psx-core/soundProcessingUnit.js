(function() {

const frameCount = 44100 >> 2;
'use strict';

var BLOCKSIZE = (28 * 0x1000) >>> 0;

const AudioContext = window.AudioContext || window.webkitAudioContext; 

var left;
var right;

function init() {
  var audioCtx = new AudioContext();
  // audioCtx.suspend();
  var myArrayBuffer = audioCtx.createBuffer(2, frameCount, audioCtx.sampleRate);
  var source = audioCtx.createBufferSource();
  source.buffer = myArrayBuffer;
  source.connect(audioCtx.destination);
  source.loop = true;
  source.playbackRate.value = 44100 / audioCtx.sampleRate;
  source.$started = false;
  // source.start(0);
  window.source = source;
  window.audioCtx = audioCtx;

  left = myArrayBuffer.getChannelData(0)
  right = myArrayBuffer.getChannelData(1)
}

var spu = {
  totalSamples: 0,
  voices: [],
  index: 0,
  writeIndex: (44100 * 0.125) >> 0,

  data: new Uint8Array(512*1024),

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

  silence: function() {
    if (left && right) {
      for (var i = 0; i < frameCount; ++i) {
        left[i] = right[i] = 0.0;
      }
    }
  },

  getVolume: function (data) {
    if (data & 0x8000) return 0.75; // no sweep yet
    return ((data << 17) >> 16) / 0x8000;
  },

  getInt16: function(addr) {
    switch(addr) {
      case 0x1daa:  return this.SPUCNT;
      case 0x1dae:  return this.SPUSTAT;
      case 0x1d9c:  return this.ENDX;
      default    :  if ((addr >= 0x1c00) && (addr < 0x1d80)) {
                      const id = ((addr - 0x1c00) / 16)|0;
                      const voice = this.voices[id];

                      return voice.getRegister(addr);
                    }
                    return map16[((0x01800000 + addr) & 0x01ffffff) >>> 1];
                    // return map.getInt16(0x01800000 + addr);
    }
  },

  setInt16: function(addr, data) {
    data &= 0xffff;
//    console.log(hex(addr, 4), hex(data));

    switch (addr) {
      case 0x1d80:  this.mainVolumeLeft = this.getVolume(data);
                    break;
      case 0x1d82:  this.mainVolumeRight = this.getVolume(data);
                    break;
      case 0x1d84:  this.reverbVolumeLeft = this.getVolume(data);
                    break;
      case 0x1d86:  this.reverbVolumeRight = this.getVolume(data);
                    break;
      case 0x1d88:  for (var i = 0; i < 16; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[i].keyOn()
                      this.ENDX &= ~(1 << i);
                    }
                    break
      case 0x1d8a:  for (var i = 0; i < 8; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[16+i].keyOn()
                      this.ENDX &= ~(1 << (16+i));
                    }
                    break
      case 0x1d8c:  for (var i = 0; i < 16; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[i].keyOff()
                    }
                    break
      case 0x1d8e:  for (var i = 0; i < 8; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[16+i].keyOff()
                    }
                    break
      case 0x1d90:  for (var i = 0; i < 16; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[i].modOn()
                    }
                    break
      case 0x1d92:  for (var i = 0; i < 8; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[16+i].modOn()
                    }
                    break
      case 0x1d94:  for (var i = 0; i < 16; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[i].noiseOn()
                    }
                    break
      case 0x1d96:  for (var i = 0; i < 8; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[16+i].noiseOn()
                    }
                    break
      case 0x1d98:  for (var i = 0; i < 16; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      //this.trace('voice-'+i+'-key-on')
                      this.voices[i].echoOn()
                    }
                    break
      case 0x1d9a:  for (var i = 0; i < 8; ++i) {
                      if ((data & (1 << i)) === 0) continue
                      this.voices[16+i].echoOn()
                    }
                    break
      case 0x1d9c:  // readonly Voice 0..15 on/off
                    break
      case 0x1d9e:  // readonly Voice 16..23 on/off
                    break
      case 0x1da0:  // ??? Legend of Dragoon
                    break
      case 0x1da2:  this.reverbOffset = data << 3;
                    break
      case 0x1da4:  this.irqOffset = data << 3;
                    break
      case 0x1da6:  this.ramOffset = data << 3;
                    break
      case 0x1da8:  this.data[this.ramOffset + 0] = (data >> 0) & 0xff;
                    this.data[this.ramOffset + 1] = (data >> 8) & 0xff;
                    this.ramOffset += 2;
                    this.checkIrq();
                    break
      case 0x1dac:  //this.trace('ram-transfer-control', '$'+hex(data, 4))
                    break
      case 0x1daa:  this.SPUCNT = data;
                    if ((!left || !right) && this.SPUCNT & 0x8000) {
                      init();
                      source.$started = true;
                      audioCtx.resume();
                      source.start(0);
                    }
                    if (this.SPUCNT & (1 << 6)) {
                      this.SPUSTAT &= ~(0x0040);
                    }
                    // todo: delayed application of bits 0-5
                    this.SPUSTATm = (this.SPUCNT & 0x003F);
                    break
      case 0x1dae:  // SPUSTAT (read-only)
                    break
      case 0x1db0:  //this.trace('cd-audio-volume-left', '$'+hex(data, 4))
                    this.cdVolumeLeft = data / 0x8000;
                    break
      case 0x1db2:  //this.trace('cd-audio-volume-right', '$'+hex(data, 4))
                    this.cdVolumeRight = data / 0x8000;
                    break
      case 0x1db4:  this.extVolumeLeft = data / 0x8000;
                    break
      case 0x1db6:  this.extVolumeRight = data / 0x8000;
                    break
      case 0x1db8:  // ??? Legend of Dragoon
                    break
      case 0x1dba:  // ??? Legend of Dragoon 
                    break
      case 0x1dbc:  // ??? Legend of Dragoon 
                    break
      case 0x1dbe:  // ??? Legend of Dragoon 
                    break
      default    :  if ((addr >= 0x1c00) && (addr < 0x1d80)) {
                      var id = ((addr - 0x1c00) / 16) | 0;
                      var voice = this.voices[id];

                      voice.setRegister(addr, data);
                      break;
                    }
                    if ((addr >= 0x1dc0) && (addr < 0x1e00)) {
                      this.setReverbRegister(addr, data);
                      break;
                    }
                    //this.trace('this.setInt16('+hex(addr,4)+','+hex(data,4)+')')
                    abort("Unimplemented spu register:" + hex(addr,4))
                    break
    }
  },

  dmaTransferMode0200: function(addr, blck) {
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

  dmaTransferMode0201: function(addr, blck) {
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

  setReverbRegister: function(addr, data) {
    // todo: implement reverb later
    // this.trace('reverb-'+hex(addr, 4)+'', '$'+hex(data, 4))
  },

  checkIrq: function(voice) {
    if ((this.SPUCNT & 0x8040) !== 0x8040) return;

    const captureIndex = (this.totalSamples % 0x200) << 1;

    var irq = false;
    if (voice !== undefined) {
      if ((voice.blockAddress <= this.irqOffset) && (this.irqOffset < (voice.blockAddress+16))) {
        irq = true;
      }
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
    psx.updateEvent(self, (33868800 / 44100));

    this.SPUSTAT &= ~(0x003F);
    this.SPUSTAT |= (this.SPUSTATm & 0x003F);

    if (!left || !right) return;

    let l = 0, r = 0;

    const captureIndex = (this.totalSamples % 0x200) << 1;
    this.checkIrq();

    for (let i = 23; i >= 0; --i) {
      let voice = this.voices[i];
      if (!voice.adsrState) continue;

// voice begin
      voice.pitchCounter += voice.pitchStep;

      if (voice.pitchCounter >= BLOCKSIZE) {
        voice.pitchCounter -= BLOCKSIZE;

        voice.decodeBlock();
        this.checkIrq(voice);
      }

      const sampleIndex = voice.pitchCounter >>> 12;
      const sample = voice.buffer[sampleIndex];

      const adsrVolume = voice.mixADSR();
      const sampleL = (sample * adsrVolume * voice.volumeLeft);
      const sampleR = (sample * adsrVolume * voice.volumeRight);

      if (i === 3) {
        const mono = (sampleL * 0x8000) >>> 0;
        this.data[0x0C00 + captureIndex] = mono & 0xff;
        this.data[0x0C01 + captureIndex] = mono >> 8;
      }
      if (i === 1) {
        const mono = (sampleL * 0x8000) >>> 0;
        this.data[0x0800 + captureIndex] = mono & 0xff;
        this.data[0x0801 + captureIndex] = mono >> 8;
      }

      l += sampleL;
      r += sampleR;
// voice end
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
    ++this.totalSamples;
  }

}

function Voice(id) {
  this.id           = id
  this.pitchCounter = 0
  this.repeatAddress= 0
  this.blockAddress = 0
  this.s0           = 0.0
  this.s1           = 0.0
  this.buffer       = new Float32Array(28)

  this.volumeLeft = 0.0
  this.volumeRight = 0.0
  this.pitchStep = 0

  this.adsrLevel = 0;
  this.adsrState = 0;

  this.r1Cx0 = 0;
  this.r1Cx2 = 0;
  this.r1Cx4 = 0;
  this.r1Cx6 = 0;
  this.r1Cx8 = 0;
  this.r1CxA = 0;
  this.r1CxE = 0;
}

Voice.prototype.startAdsrAttack = function () {
  this.adsrState = 1;
  this.adsrLevel = 0;
}

Voice.prototype.startAdsrRelease = function() {
  this.adsrState = 4;
}

Voice.prototype.keyOn = function () {
  this.s0 = 0.0;
  this.s1 = 0.0;
  this.pitchCounter = BLOCKSIZE;
  this.blockAddress = this.r1Cx6 << 3;
  this.repeatAddress = this.r1CxE << 3;
  this.startAdsrAttack();
}

Voice.prototype.echoOn = function () {
  // todo: reverb
}

Voice.prototype.modOn = function () {
  // todo: pitch modulation
}

Voice.prototype.noiseOn = function () {
  // todo: noise
}

Voice.prototype.keyOff = function () {
  this.startAdsrRelease();
}

Voice.prototype.decodeBlock = function () {
  var blockAddress = this.blockAddress;
  let shiftFilter = spu.data[blockAddress + 0];
  let flags       = spu.data[blockAddress + 1];

  var shift  = (shiftFilter & 0x0f) >>> 0;
  var filter = (shiftFilter & 0xf0) >>> 3;

  var k0 = xa2flt[filter + 0];
  var k1 = xa2flt[filter + 1];
  var s0 = this.s0;
  var s1 = this.s1;

  var sample = 0;
  var output = this.buffer;
  let value;
  for (var offset = 2 ; offset < 16; ++offset) {
    var data = spu.data[blockAddress + offset]
    var index = ((shift << 8) + data) << 1;

    output[sample++] = value = (s0 * k0) + (s1 * k1) + xa2pcm[index + 0];
    s1 = s0; s0 = value;
    output[sample++] = value = (s0 * k0) + (s1 * k1) + xa2pcm[index + 1];
    s1 = s0; s0 = value;
  }

  this.s0 = s0;
  this.s1 = s1;

  if ((flags & 4) === 4) {
    this.repeatAddress = this.blockAddress;
  }

  this.blockAddress += 16;

  if ((flags & 1) === 1) {
    this.blockAddress = this.repeatAddress;
    spu.ENDX |= (1 << this.id);
    if ((flags & 2) === 0) {
      this.startAdsrRelease();
      this.adsrLevel = 0;
    }
  }
}

Voice.prototype.mixADSR = function () {
  switch (this.adsrState) {
    case 0x0: // silence
              return 0.0;
    case 0x1: this.adsrAttack();
              break;
    case 0x2: this.adsrDecay();
              break;
    case 0x3: this.adsrSustain();
              break;
    case 0x4: this.adsrRelease();
              break;
    default: abort('not implemented');
  }
  if (this.adsrLevel > 0x7FFFFFFF) this.adsrLevel = 0x7FFFFFFF;
  if (this.adsrLevel < 0) {
    if (this.adsrState === 4) {
      if (this.id !== 1 && this.id !== 3) {
        this.adsrState = 0;
      }
    }
    this.adsrLevel = 0;
  }
  return (this.adsrLevel >> 16) / 0x8000;
}

Voice.prototype.adsrAttack = function () {
  if (this.adsrAttackMode) {
    // exponential attack
    if(this.adsrLevel < 0x60000000) {
      this.adsrLevel += rateTable[this.adsrAttackRate - 0x10 + 32];
    }
    else {
      this.adsrLevel += rateTable[this.adsrAttackRate - 0x18 + 32];
    }
  }
  else {
    // linear attack
    this.adsrLevel += rateTable[this.adsrAttackRate - 0x10 + 32];
  }
  if (this.adsrLevel >= 0x7FFFFFFF) {
    this.adsrState = 2; // decay
  }
}

Voice.prototype.adsrDecay = function () {
  if (this.adsrDecayMode) {
    // exponential decay
    switch((this.adsrLevel >> 29) & 0x7) {
      case 0: this.adsrLevel -= rateTable[this.adsrDecayRate - 0x18 +  0 + 32]; break;
      case 1: this.adsrLevel -= rateTable[this.adsrDecayRate - 0x18 +  4 + 32]; break;
      case 2: this.adsrLevel -= rateTable[this.adsrDecayRate - 0x18 +  6 + 32]; break;
      case 3: this.adsrLevel -= rateTable[this.adsrDecayRate - 0x18 +  8 + 32]; break;
      case 4: this.adsrLevel -= rateTable[this.adsrDecayRate - 0x18 +  9 + 32]; break;
      case 5: this.adsrLevel -= rateTable[this.adsrDecayRate - 0x18 + 10 + 32]; break;
      case 6: this.adsrLevel -= rateTable[this.adsrDecayRate - 0x18 + 11 + 32]; break;
      case 7: this.adsrLevel -= rateTable[this.adsrDecayRate - 0x18 + 12 + 32]; break;
    }
  }
  if (((this.adsrLevel >> 28) & 0xF) <= this.adsrSustainLevel) {
    this.adsrState = 3; // sustain
  }
}

Voice.prototype.adsrSustain = function () {
  if (!this.adsrSustainMode) {
    this.adsrLevel += this.adsrLinearSustainRate;
    return;    
  }

  if (this.adsrSustainDirection == 0) {
    if (this.adsrLevel < 0x60000000) 
      this.adsrLevel += rateTable[this.adsrSustainRate - 0x10 + 32];
    else
      this.adsrLevel += rateTable[this.adsrSustainRate - 0x18 + 32];
  }
  else {
    switch ((this.adsrLevel >> 29) & 0x7) {
    case 0: this.adsrLevel -= rateTable[this.adsrSustainRate - 0x1B +  0 + 32]; break;
    case 1: this.adsrLevel -= rateTable[this.adsrSustainRate - 0x1B +  4 + 32]; break;
    case 2: this.adsrLevel -= rateTable[this.adsrSustainRate - 0x1B +  6 + 32]; break;
    case 3: this.adsrLevel -= rateTable[this.adsrSustainRate - 0x1B +  8 + 32]; break;
    case 4: this.adsrLevel -= rateTable[this.adsrSustainRate - 0x1B +  9 + 32]; break;
    case 5: this.adsrLevel -= rateTable[this.adsrSustainRate - 0x1B + 10 + 32]; break;
    case 6: this.adsrLevel -= rateTable[this.adsrSustainRate - 0x1B + 11 + 32]; break;
    case 7: this.adsrLevel -= rateTable[this.adsrSustainRate - 0x1B + 12 + 32]; break;
    }
  }
}

Voice.prototype.adsrRelease = function () {
  if (!this.adsrReleaseMode) {
    this.adsrLevel -= this.adsrLinearReleaseRate;
    return;
  }

  switch ((this.adsrLevel >> 29) & 0x7) {
    case 0: this.adsrLevel -= rateTable[this.adsrReleaseRate - 0x18 +  0 + 32]; break;
    case 1: this.adsrLevel -= rateTable[this.adsrReleaseRate - 0x18 +  4 + 32]; break;
    case 2: this.adsrLevel -= rateTable[this.adsrReleaseRate - 0x18 +  6 + 32]; break;
    case 3: this.adsrLevel -= rateTable[this.adsrReleaseRate - 0x18 +  8 + 32]; break;
    case 4: this.adsrLevel -= rateTable[this.adsrReleaseRate - 0x18 +  9 + 32]; break;
    case 5: this.adsrLevel -= rateTable[this.adsrReleaseRate - 0x18 + 10 + 32]; break;
    case 6: this.adsrLevel -= rateTable[this.adsrReleaseRate - 0x18 + 11 + 32]; break;
    case 7: this.adsrLevel -= rateTable[this.adsrReleaseRate - 0x18 + 12 + 32]; break;
  }
}

Voice.prototype.getRegister = function(addr, data) {
  switch (addr % 16) {
    case 0x0000:  return this.r1Cx0;
    case 0x0002:  return this.r1Cx2;
    case 0x0004:  return this.r1Cx4;
    case 0x0006:  return this.r1Cx6;
    case 0x0008:  return this.r1Cx8;
    case 0x000a:  return this.r1CxA;
    case 0x000c:  return this.adsrLevel >>> 16;
    case 0x000e:  return this.r1CxE;
    default    :  abort(`Unimplemented spu-voice register: ${((addr % 16) >>> 0).toString(16)}`)
                  break
  }
}

Voice.prototype.setRegister = function(addr, data) {
  switch (addr % 16) {
    case 0x0000:  this.volumeLeft = spu.getVolume(data);
                  this.r1Cx0 = data;
                  break
    case 0x0002:  this.volumeRight = spu.getVolume(data)
                  this.r1Cx2 = data;
                  break
    case 0x0004:  this.pitchStep = Math.min(data, 0x4000);
                  this.r1Cx4 = data;
                  break
    case 0x0006:  this.blockAddress = data << 3;
                  this.r1Cx6 = data;
                  break
    case 0x0008:  this.adsrAttackMode   = (data & 0x8000) >>> 15;
                  this.adsrAttackRate   = (((data & 0x7F00) >>> 8) ^ 0x7F);
                  this.adsrDecayMode    = 1;
                  this.adsrDecayRate    = (((data & 0x00F0) >>> 4) ^ 0x1F) << 2;
                  this.adsrSustainLevel = (data & 0x000F) >>> 0;
                  this.r1Cx8 = data;
                  break
    case 0x000a:  this.adsrSustainMode      = (data & 0x8000) >>> 15;
                  this.adsrSustainDirection = (data & 0x4000) >>> 14;
                  this.adsrSustainRate      = (((data & 0x1FC0) >>> 6) ^ 0x7F);
                  this.adsrReleaseMode      = (data & 0x0020) >>> 5;
                  this.adsrReleaseRate      = (((data & 0x001F) >>> 0) ^ 0x1F) << 2;
                  this.r1CxA = data;
                  // optimisations
                  this.adsrLinearReleaseRate = rateTable[this.adsrReleaseRate - 0x0C + 32];
                  if (this.adsrSustainDirection == 0) {
                    this.adsrLinearSustainRate = rateTable[this.adsrSustainRate - 0x10 + 32];
                  }
                  else {
                    this.adsrLinearSustainRate = -rateTable[this.adsrSustainRate - 0x0F + 32];
                  }
                  break
    case 0x000c:  //this.adsrLevel = ((data << 16) >> 16) * 65536.0;
                  this.adsrLevel = data << 16;
                  break
    case 0x000e:  this.repeatAddress = data << 3;
                  this.r1CxE = data;
                  break
    default    :  abort("Unimplemented spu-voice register", hex(addr, 4));
                  break
  }
}

//- init
for (var i = 0; i < 24; ++i) {
  spu.voices[i] = new Voice(i)
}

//- lookup tables
const xa2flt = new Float32Array(16*2);
xa2flt.fill(0.0);

xa2flt[2] =  60/64; xa2flt[3] =   0/64; //- [K0:+0.953125][K1:+0.000000]
xa2flt[4] = 115/64; xa2flt[5] = -52/64; //- [K0:+1.796875][K1:-0.812500]
xa2flt[6] =  98/64; xa2flt[7] = -55/64; //- [K0:+1.531250][K1:-0.859375]
xa2flt[8] = 122/64; xa2flt[9] = -60/64; //- [K0:+1.906250][K1:-0.937500]

const xa2pcm = new Float32Array(16*256*2);

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

// ADSR
const rateTable = new Uint32Array(160);

function InitADSR() {
  let r, rs, rd;

  rateTable.fill(0.0);

  r=3; rs=1; rd=0;

  for (let i = 32; i < 160; ++i) {
    if (r < 0x7FFFFFFF) {
      r += rs;
      rd++;
      if (rd === 5) { rd = 1; rs *= 2; }
    }
   if (r > 0x7FFFFFFF) r = 0x7FFFFFFF;

   rateTable[i] = r;
  }
  // for (let i = 0; i < 160; ++i) {
  //   console.log("adsr-rate-table", rateTable[i]);
  // }
}

InitADSR();

window.spu = spu;
window.xa2flt = xa2flt;
window.xa2pcm = xa2pcm;
})();
