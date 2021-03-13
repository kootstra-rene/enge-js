const cdr = (() => {
  'use strict';

  var itob = function(i) {
    return (Math.floor(i / 10) * 16 + Math.floor(i % 10));
  }
  var btoi = function(b) {
    return (Math.floor(b / 16) * 10 + Math.floor(b % 16));
  }

  let sectorData8 = new Int8Array(0);
  let sectorData16 = new Int16Array(0);
  let sectorData32 = new Int32Array(0);

  var cdr = {
    cdImage   : new Uint32Array(0), //- maybe Uint8Array
    cdRomFile : undefined,
    currLoc   : 0,
    filter    : {},
    hasCdFile : false,
    irq       : 0,
    irqEnable : 0xff,
    mode      : 0,
    ncmdctrl  : 0,
    ncmdread  : 0,
    params    : new Array(16),
    pcm       : new Float32Array(8064*44100/18900),
    pcmidx    : 0,
    pcmmax    : 0,
    results   : new Array(16),
    sectorEnd : 0,
    sectorIndex : 0,
    sectorOffset : 0,
    sectorSize : 0,
    seekLoc   : 0,
    currTrack : {},
    status    : 0x18, // fifo empty and not full
    statusCode: 0x00,
    xa        : new Float32Array(8064),
    playIndex : 0,
    lastCommand: 0,
    tracks: [],
    volCdLeft2SpuLeft: 1.0,
    volCdLeft2SpuRight: 0.0,
    volCdRight2SpuLeft: 0.0,
    volCdRight2SpuRight: 1.0,
    config: {
      volCdLeft2SpuLeft: 1.0,
      volCdLeft2SpuRight: 0.0,
      volCdRight2SpuLeft: 0.0,
      volCdRight2SpuRight: 1.0,
    },
    mute: false,

    rd08r1800: function() {
      return cdr.status;
    },

    rd08r1801: function() {
      if ((cdr.status & 0x23) == 0x21) {
        if (cdr.results.length === 1) {
          cdr.status &= ~0x40; // data fifo is empty
          cdr.status &= ~0x20; // response fifo is empty
        }
        return cdr.results.shift();
      }
      return 0;
    },

    rd08r1802: function() {
      if (cdr.status & 0x40) {
        return cdr.cdImage.getInt8(cdr.sectorOffset + cdr.sectorIndex++);
      }
      return 0x00;
    },

    rd08r1803: function() {
      switch (cdr.status & 3) {
        case  0:  return 0xE0 | cdr.irqEnable;
        case  1:  return cdr.irq;
        default:  abort('unimplemented index mode:' + (cdr.status & 3));
      };
    },

    wr08r1800: function(data) {
      cdr.status = (cdr.status & ~3) | (data & 3);
    },

    wr08r1801: function(data) {
      switch (cdr.status & 3) {
        case  0:  cdr.command(data);
                  break;
        case  3:  cdr.config.volCdRight2SpuRight = ((data & 0xff) >>> 0) / 0x80;
                  break;
        default:  abort('unimplemented index mode:' + (cdr.status & 3));
      };
    },

    wr08r1802: function(data) {
      switch (cdr.status & 3) {
        case  0:  cdr.params.push(data);
                  if (cdr.params.length === 16) cdr.status &= ~0x10; // fifo full
                  break;
        case  1:  cdr.irqEnable = data;
                  cdr.irq = 0;
                  break;
        case  2:  cdr.config.volCdLeft2SpuLeft = ((data & 0xff) >>> 0) / 0x80;
                  break;
        case  3:  cdr.config.volCdRight2SpuLeft = ((data & 0xff) >>> 0) / 0x80;
                  break;
        default:  abort('unimplemented index mode:' + (cdr.status & 3));
      };
    },

    wr08r1803: function(data) {
      switch (cdr.status & 3) {
        case 0: if (data === 0x80) {
                  // want data
                  cdr.status |= 0x40;
                }
                break;
        case 1: if (data & (0x1F & cdr.irqEnable)) {
                  cdr.acknowledgeInterrupt(data);
                }
                if (data & 0x40) {
                  cdr.resetparams();
                }
                break;
        case 2: cdr.config.volCdLeft2SpuRight = ((data & 0xff) >>> 0) / 0x80;
                break;
        case 3: //console.log(' - Audio Volume Apply Changes: $' + hex(data, 2));
                if (data & 0x20) {
                  cdr.volCdLeft2SpuLeft = cdr.config.volCdLeft2SpuLeft;
                  cdr.volCdLeft2SpuRight = cdr.config.volCdLeft2SpuRight;
                  cdr.volCdRight2SpuLeft = cdr.config.volCdRight2SpuLeft;
                  cdr.volCdRight2SpuRight = cdr.config.volCdRight2SpuRight;
                }
                break;

        default:  abort('unimplemented index mode:' + (cdr.status & 3));
      };
    },

    acknowledgeInterrupt: function(data) {
      cdr.irq &= ~(data & (0x1F & cdr.irqEnable));
    },

    resetparams: function() {
      cdr.params.length = 0;// = [];
    },

    command: function(data) {
      let nevtctrl = 0x0200;

      cdr.setIrq(0);
      cdr.results.length = 0;
      cdr.status  |= 0x80;
      cdr.ncmdctrl = data;
  // console.log('cd-cmd', data.toString(16))
      switch (data) {
        case 0x01:  //- CdlNop
                    nevtctrl = 0xc4e1;
                    break;
        case 0x03:  //- CdlPlay
        case 0x0b:  //- CdlMute
        case 0x0c:  //- CdlDemute
        case 0x0d:  //- CdlSetFilter
        case 0x0e:  //- CdlSetmode
        case 0x0f:  //- CdlGetparam
        case 0x10:  //- CdlGetLocL
        case 0x11:  //- CdlGetLocP
        case 0x13:  //- CdlGetTN
        case 0x14:  //- CdlGetTD
        case 0x19:  //- CdlTest
        case 0x1a:  //- CdlID
        case 0x1e:  //- CdlReadTOC
                    break;
        case 0x0a:  //- CdlInit
                    nevtctrl = 0x13cce;
        case 0x02:  //- CdlSetloc
        case 0x06:  //- CdlReadN
        case 0x07:  //- CdlStandby
        case 0x08:  //- CdlStop
        case 0x15:  //- CdlSeekL
        case 0x16:  //- CdlSeekP
        case 0x1B:  //- CdlReadS
                    cdr.stopReading();
                    break;
        case 0x09:  //- CdlPause
                    cdr.stopReading();
                    break;

        default:  abort('unimplemented command: $' + hex(data, 2));
      }

      psx.setEvent(this.eventCmd, nevtctrl >>> 0);
    },

    setIrq: function(data) {
      cdr.irq = (cdr.irq & 0xE0) | (data & 0x1F);
      if (cdr.irq & (0x1F & cdr.irqEnable)) {
        cpu.istat |= 0x0004;
      }
    },

    enqueueEvent: function(irq, ...params) {
      if (this.results.length) abort('not yet read all results');
      this.results.push(params);
      this.status &= ~0x80;
      this.status |= 0x20;
      this.setIrq(irq);
    },

    eventCmd: null,
    completeCmd: function(self, clock) {
      self.active = false;
      if (cdr.irq & 0x1F) {
        psx.setEvent(this.eventCmd, 64);
        return;
      }
      const readCycles = 33868800 / ((cdr.mode & 0x80) ? 150 : 75);

      var currentCommand = cdr.ncmdctrl;
      cdr.ncmdctrl = 0;
      switch (currentCommand) {
        case 0x00:  break;
        case 0x01:  if (!cdr.hasCdFile) {
                      this.enqueueEvent(5, 0x01);
                    }
                    else {
                      this.enqueueEvent(3, 0x02);
                    }
                    break;

        case 0x02:  if (!((cdr.params[0] === 0) && (cdr.params[1] === 0) && (cdr.params[2] === 0))) {
                      cdr.seekLoc = (btoi(cdr.params[0]) * (60 * 75)) +
                                    (btoi(cdr.params[1]) * (75)) +
                                    (btoi(cdr.params[2]));
                    }
                    else {
                      cdr.seekLoc = cdr.currLoc;
                    }
                    this.enqueueEvent(3, 0x02);
                    break;

        case 0x03:  if (cdr.params.length === 0 || cdr.params[0] === 0) {
                      cdr.currLoc = cdr.seekLoc;
                    }
                    if (cdr.params.length === 1) {
                      cdr.currTrack = cdr.tracks[btoi(cdr.params[0])];
                      cdr.currLoc = cdr.seekLoc = cdr.currTrack.begin + 150;
                      console.log(`CdlPlay: ${btoi(cdr.params[0])} : ${cdr.currLoc}`)
                    }
                    psx.setEvent(this.eventRead, readCycles >>> 0);
                    cdr.ncmdread = 0x03;
                    this.enqueueEvent(3, 0x82);
                    break;

        case 0x06:  psx.setEvent(this.eventRead, readCycles >>> 0);
                    cdr.ncmdread = 0x06;
                    this.enqueueEvent(3, 0x42);
                    cdr.currLoc = cdr.seekLoc;
                    break;

        case 0x07:  this.enqueueEvent(3, 0x00);
                    cdr.ncmdctrl = 0x70;
                    cdr.status |= 0x80;
                    break

        case 0x70:  this.enqueueEvent(2, 0x02);
                    break;

        case 0x08:  this.enqueueEvent(3, 0x02);
                    psx.setEvent(this.eventCmd, ((cdr.mode & 0x80) ? 0x18a6076 : 0xd38aca) >>> 0);
                    cdr.ncmdctrl = 0x80;
                    cdr.status |= 0x80;
                    break;
        case 0x80:  this.enqueueEvent(2, 0x00);
                    break;

        case 0x09:  cdr.results.push(cdr.statusCode | 0x20); // reading data sectors
                    psx.setEvent(this.eventCmd, ((cdr.mode & 0x80) ? 0x10bd93 : 0x21181c) >>> 0);
                    cdr.ncmdctrl = 0x90;
                    cdr.status |= 0x80;
                    cdr.status |= 0x20;
                    cdr.setIrq(3);
                    break;
        case 0x90:  cdr.statusCode = (cdr.statusCode & ~ 0x20) | 0x02; // not reading data sectors
                    cdr.results.push(cdr.statusCode);
                    cdr.status &= ~0x80;
                    cdr.status |= 0x20;
                    cdr.setIrq(2);
                    break;

        case 0x0A:  this.enqueueEvent(3, 0x02);
                    psx.setEvent(this.eventCmd, 0x1000 >>> 0);
                    cdr.ncmdctrl = 0xA0;
                    cdr.status |= 0x80;
                    break;
        case 0xA0:  this.enqueueEvent(2, 0x02);
                    break;

        case 0x0B:  this.enqueueEvent(3, 0x02);
                    this.mute = true;
                    break;

        case 0x0C:  this.enqueueEvent(3, 0x02);
                    this.mute = false;
                    break;

        case 0x0D:  this.filter = {file:cdr.params[0], chan:cdr.params[1]};
                    this.enqueueEvent(3, 0x02);
                    break;

        case 0x0E:  this.enqueueEvent(3, 0x02);
                    this.mode = cdr.params[0];
                    break;

        case 0x0F:  this.enqueueEvent(3, 0x02, cdr.mode, 0, cdr.filter.file, cdr.filter.chan);
                    break;

        case 0x10:  cdr.results.push(cdr.cdImage.getInt8(cdr.sectorOffset + 12+0));
                    cdr.results.push(cdr.cdImage.getInt8(cdr.sectorOffset + 12+1));
                    cdr.results.push(cdr.cdImage.getInt8(cdr.sectorOffset + 12+2));
                    cdr.results.push(cdr.cdImage.getInt8(cdr.sectorOffset + 12+3));
                    cdr.results.push(cdr.cdImage.getInt8(cdr.sectorOffset + 12+4));
                    cdr.results.push(cdr.cdImage.getInt8(cdr.sectorOffset + 12+5));
                    cdr.results.push(cdr.cdImage.getInt8(cdr.sectorOffset + 12+6));
                    cdr.results.push(cdr.cdImage.getInt8(cdr.sectorOffset + 12+7));
                    cdr.status &= ~0x80;
                    cdr.status |= 0x20;
                    cdr.setIrq(3);
                    break;

        case 0x11:{ let loc = (cdr.currLoc - 150 - cdr.currTrack.begin);
                    let mm = (loc / (60*75)) >> 0;
                    let ss = ((loc / (75)) >> 0) % 60;
                    let st = loc % 75;
                    cdr.results.push(itob(cdr.currTrack.id));
                    cdr.results.push(0x01);
                    cdr.results.push(itob(mm));
                    cdr.results.push(itob(ss));
                    cdr.results.push(itob(st));
                    cdr.results.push(itob((((cdr.currLoc-150) / 75) / 60) % 60));
                    cdr.results.push(itob((((cdr.currLoc-150) / 75) % 60)));
                    cdr.results.push(itob((((cdr.currLoc-150) % 75))));
                    cdr.status &= ~0x80;
                    cdr.status |= 0x20;
                    cdr.setIrq(3);
                  } break;

        case 0x13:  console.log(`CdlGetTN`);
                    cdr.statusCode |= 0x02;
                    cdr.results.push(cdr.statusCode);
                    cdr.results.push(0x01);
                    cdr.results.push(itob(this.tracks.length-1));
                    cdr.status &= ~0x80;
                    cdr.status |= 0x20;
                    cdr.setIrq(3);
                    break;

        case 0x14:{ let mmss = 0;
                    let track = this.tracks[btoi(cdr.params[0])];
                    if (!track) {
                      // door open
                      cdr.statusCode |= 0x10;
                      cdr.results.push(0x11);
                      cdr.results.push(0x80);
                      cdr.status &= ~0x80;
                      cdr.status |= 0x20;
                      cdr.setIrq(5);
                      break;
                    }
                    if (cdr.params[0] === 0) {
                      mmss = Math.floor((track.end + 150) / 75);
                    }
                    else {
                      mmss = Math.floor((track.begin + 150) / 75);
                    }
                    console.log(`CdlGetTD: ${cdr.params[0]}`, track);
                    cdr.statusCode |= 0x02;
                    cdr.results.push(cdr.statusCode);
                    cdr.results.push(itob(Math.floor(mmss / 60)));
                    cdr.results.push(itob(Math.floor(mmss % 60)));
                    cdr.status &= ~0x80;
                    cdr.status |= 0x20;
                    cdr.setIrq(3);
                  } break;

        case 0x15:  psx.setEvent(this.eventCmd, 0x1000 >>> 0);
                    cdr.ncmdctrl = 0x150;
                    this.enqueueEvent(3, 0x42); // SEEKING
                    cdr.status |= 0x80;
                    break;
        case 0x150: this.enqueueEvent(2, 0x2); // done
                    cdr.currLoc = cdr.seekLoc;
                    break;

        case 0x16:  psx.setEvent(this.eventCmd, 0x1000 >>> 0);
                    cdr.ncmdctrl = 0x160;
                    this.enqueueEvent(3, 0x42); // SEEKING
                    cdr.status |= 0x80;
                    break;
        case 0x160: this.enqueueEvent(2, 0x2); // done
                    cdr.currLoc = cdr.seekLoc;
                    break;

        case 0x19:  cdr.results.push(0x99);
                    cdr.results.push(0x02);
                    cdr.results.push(0x01);
                    cdr.results.push(0xC3);
                    cdr.status &= ~0x80;
                    cdr.status |= 0x20;
                    cdr.setIrq(3);
                    break;

        case 0x1A:  psx.setEvent(this.eventCmd, 0x4a00 >>> 0);
                    cdr.results.push(cdr.statusCode);
                    cdr.ncmdctrl = 0x1A0;
                    cdr.status |= 0x20;
                    cdr.setIrq(3);
                    break;
        case 0x1A0: 
                    if (cdr.hasCdFile) {
                      cdr.results.push(0x02);
                      cdr.results.push(0x00);
                      cdr.results.push(0x20);
                      cdr.results.push(0x00);
                      cdr.results.push('e'.charCodeAt(0));
                      cdr.results.push('N'.charCodeAt(0));
                      cdr.results.push('G'.charCodeAt(0));
                      cdr.results.push('E'.charCodeAt(0));
                      cdr.status &= ~0x80;
                      cdr.status |= 0x20;
                      cdr.setIrq(2);
                    }
                    else {
                      // door open
                      cdr.statusCode |= 0x10;
                      cdr.results.push(0x11);
                      cdr.results.push(0x80);
                      cdr.status &= ~0x80;
                      cdr.status |= 0x20;
                      cdr.setIrq(5);
                    }
                    //- audio
                    // cdr.results.push(0x0A);
                    // cdr.results.push(0x90);
                    // cdr.results.push(0x00);
                    // cdr.results.push(0x00);
                    // cdr.results.push(0x00);
                    // cdr.results.push(0x00);
                    // cdr.results.push(0x00);
                    // cdr.results.push(0x00);
                    // cdr.status &= ~0x80;
                    // cdr.status |= 0x20;
                    // cdr.setIrq(5);
                    break;

        case 0x1B:  psx.setEvent(this.eventRead, readCycles >>> 0);
                    cdr.ncmdread = 0x1B;
                    this.enqueueEvent(3, 0x42);
                    cdr.currLoc = cdr.seekLoc;
                    break;

        case 0x1E:  psx.setEvent(this.eventCmd, 0x1000 >>> 0);
                    cdr.ncmdctrl = 0x1E0;
                    this.enqueueEvent(3, 0x02);
                    break;
        case 0x1E0: this.enqueueEvent(2, 0x02);
                    break;

        default:  abort('unimplemented async command: $' + hex(cdr.ncmdctrl, 2));
      }
      cdr.lastCommand = currentCommand;
      cdr.resetparams();
    },

    eventRead: null,
    completeRead: function (self, clock) {
      if (cdr.irq & 0x1F) {
        psx.updateEvent(self, 64);
        return;
      }

      var readCycles = 33868800 / ((cdr.mode & 0x80) ? 150 : 75);
      switch (cdr.ncmdread) {
        case 0x03:  cdr.playIndex = 0;
                    if ((cdr.mode & 0x05) == 0x05) {
                      let loc = cdr.currLoc - 150;
                      // playing CDDA and reporting is on
                      switch(loc % 75) {
                        case  0:
                        case 20:
                        case 40:
                        case 60:{
                          let amm = (loc / (60*75)) >> 0;
                          let ass = ((loc / (75)) >> 0) % 60;
                          let ast = loc % 75;
                          cdr.results.push(0x82, itob(cdr.currTrack.id), 1, itob(amm), itob(ass), itob(ast), 0, 0);
                          cdr.status &= ~0x80;
                          cdr.status |= 0x40;
                          cdr.status |= 0x20;
                          cdr.setIrq(1);
                        } break;

                        case 10:
                        case 30:
                        case 50:
                        case 70: {
                          let loc = (cdr.currLoc - cdr.currTrack.begin);
                          let amm = (loc / (60*75)) >> 0;
                          let ass = ((loc / (75)) >> 0) % 60;
                          let ast = loc % 75;
                          cdr.results.push(0x82, itob(cdr.currTrack.id), 1, itob(amm), 0x80 | itob(ass), itob(ast), 0, 0);
                          cdr.status &= ~0x80;
                          cdr.status |= 0x40;
                          cdr.status |= 0x20;
                          cdr.setIrq(1);
                        } break;
                      }
                      cdr.readSector(cdr.currLoc); // todo: read sector ahead to reduce audio glitches
                      psx.updateEvent(self, readCycles);
                      cdr.currLoc++;
                      break;
                    }
        case 0x06:
        case 0x1b:  cdr.results.push(0x22);
                    cdr.status &= ~0x80;
                    cdr.status |= 0x40;
                    cdr.status |= 0x20;
                    cdr.setIrq(1);
                    cdr.readSector(cdr.currLoc); // todo: read sector ahead to reduce audio glitches
                    psx.updateEvent(self, readCycles);
                    cdr.currLoc++;
                    break;

        default:  //abort('unimplemented async read: $' + hex(cdr.ncmdread, 2));
                  this.eventRead.active = false;
      }
    },

    readSector: function(readLoc) {
      if (cdr.cdImage === undefined) return;

      for (let i = 1; i < cdr.tracks.length; ++i) {
        let track = cdr.currTrack = cdr.tracks[i];
        if ((track.begin < readLoc) && (readLoc < track.end)) break;
      }
      cdr.sectorOffset = (readLoc - 150) * 2352;

      switch(cdr.mode & 0x30) {
        case 0x00:  cdr.sectorIndex = 24;
                    cdr.sectorSize = 2048;
                    break;
        case 0x10:  cdr.sectorIndex = 24;
                    cdr.sectorSize = 2328;
                    break;
        case 0x20:
        case 0x30:  cdr.sectorIndex = 12;
                    cdr.sectorSize = 2340;
                    break;
      }
      cdr.sectorEnd = cdr.sectorIndex + cdr.sectorSize;

      if ((cdr.mode & 0x48) !== 0) { //playXaAudio
        var mode = sectorData8[cdr.sectorOffset + 0x0f];
        if (mode !== 2) return;

        if ((cdr.mode & 0x48) === 0x48) { // useFilter
          var file = sectorData8[cdr.sectorOffset + 0x10];
          if (file !== cdr.filter.file) return;

          var chan = sectorData8[cdr.sectorOffset + 0x11];
          if (chan !== cdr.filter.chan) return;
        }

        var sub = sectorData8[cdr.sectorOffset + 0x12];
        if ((sub & 0x44) !== 0x44) return;
        var nfo = sectorData8[cdr.sectorOffset + 0x13];

        switch ((nfo >>> 0) & 3) {
          case 0: var ms = 'mono';    break;
          case 1: var ms = 'stereo';  break;
        }
        switch ((nfo >>> 2) & 1) {
          case 0: var sr = 37800;   break;
          case 1: var sr = 18900;   break;
        }
        switch ((nfo >>> 4) & 3) {
          case 0: var bs = '4bit';    break;
          case 1: var bs = '8bit';    break;
        }
        switch ((nfo >>> 6) & 1) {
          case 0: var em = 'normal';  break;
          case 1: var em = 'emphasis';break;
        }
        //var min = cdr.cdImage.getInt8(cdr.sectorOffset + 0x0c);
        //var sec = cdr.cdImage.getInt8(cdr.sectorOffset + 0x0d);
        //var frm = cdr.cdImage.getInt8(cdr.sectorOffset + 0x0e);
        //console.log('mss:', hex(min,2), hex(sec,2), hex(frm,2), hex(sub,2), ms, sr, bs, em)
        cdr.pcmidx = 0;
        cdr.xa.fill(0);
        cdr.pcm.fill(0);
        if (ms === 'stereo') {
          var ix = cdr.decodeStereo();
        }
        if (ms === 'mono') {
          var ix = cdr.decodeMono();
        }

        var samples = (44100 * ix) / sr;
        var i = 0;
        var upscaleFreq = 0;
        var xa = cdr.xa;
        var ix = -1;
        var pcm = cdr.pcm;

        for (var s = 0; s < samples; s+=2) {
          pcm[++ix] = xa[i+0];
          pcm[++ix] = xa[i+1];
          upscaleFreq += sr;
          if (upscaleFreq >= 44100) {
            upscaleFreq -= 44100;
            i += 2;
          }
        }
        cdr.pcmmax = ix;
        //debugger
      }
    },

  nextpcm: function(buf) {
    if (cdr.ncmdread === 0x03) {
      if (cdr.currTrack.audio) {
        const offset = (cdr.sectorOffset + cdr.playIndex) >> 1;
        let sampleL = sectorData16[offset + 0] / 32768.0;
        let sampleR = sectorData16[offset + 1] / 32768.0;
        let sL = sampleL * cdr.volCdLeft2SpuLeft + sampleR * cdr.volCdRight2SpuLeft;
        let sR = sampleR * cdr.volCdRight2SpuRight + sampleL * cdr.volCdLeft2SpuRight;
        buf[0] = sL;
        buf[1] = sR;
      }
      if (cdr.currTrack.data) {
        buf[0] = 0.0;
        buf[1] = 0.0;
      }
      cdr.playIndex += 4;
      return;
    }
    if ((cdr.mode & 0x48) !== 0) {

      // if due to timing issues we read beyond the buffer, repeat last samples to reduce clicks.
      if (cdr.pcmidx >= (cdr.pcmmax-1)) cdr.pcmidx = cdr.pcmmax-1;
      let sampleL = cdr.pcm[cdr.pcmidx + 0];
      let sampleR = cdr.pcm[cdr.pcmidx + 1];
      let sL = sampleL * cdr.volCdLeft2SpuLeft + sampleR * cdr.volCdRight2SpuLeft;
      let sR = sampleR * cdr.volCdRight2SpuRight + sampleL * cdr.volCdLeft2SpuRight;
      buf[0] = sL;
      buf[1] = sR;
      cdr.pcmidx += 2;
    }
  },

  decodeMono: function() {
    var ix = 0;
    var sl = this.sl;//[0.0, 0.0];
    var xa = cdr.xa;

    for (var sg = 0; sg < 18; ++sg) {
      var sectorOffset = cdr.sectorOffset + 24 + (sg * 128);

      for (var su = 0; su < 8; ++su) {
        var shiftFilter = sectorData8[sectorOffset + 4 + su];
        var shift  = (shiftFilter & 0x0f) >>> 0;
        var filter = (shiftFilter & 0xf0) >>> 3;
        var k0 = xa2flt[filter + 0]
        var k1 = xa2flt[filter + 1]

        for (var sd = 0; sd < 28; ++sd) {
          const offset = (sectorOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
          var data = sectorData8[offset] & 0xff;

          var index = (shift * 256 + data) * 2;

          var s = (sl[1] * k0) + (sl[0] * k1) + xa2pcm[index + (su & 1)];
          sl[0] = sl[1];
          sl[1] = s;

          xa[ix++] = s;
          xa[ix++] = s;
        }
      }
    }
    //debugger
    return ix;
  },

  sl:[0.0, 0.0],
  sr:[0.0, 0.0],

  decodeStereo: function() {
    var ix = 0;
    var sl = this.sl;//[0.0, 0.0];
    var sr = this.sr;//[0.0, 0.0];
    var xa = cdr.xa;

    for (var sg = 0; sg < 18; ++sg) {
      var sectorOffset = cdr.sectorOffset + 24 + (sg * 128);

      for (var su = 0; su < 8; su += 2) {
        var shiftFilter = sectorData8[sectorOffset + 4 + su];
        var shift  = (shiftFilter & 0x0f) >>> 0;
        var filter = (shiftFilter & 0xf0) >>> 3;
        var k0 = xa2flt[filter + 0]
        var k1 = xa2flt[filter + 1]

        for (var sd = 0; sd < 28; ++sd) {
          const offset = (sectorOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
          var data = sectorData8[offset] & 0xff;
          var index = (shift * 256 + data) * 2;

          var s = (sl[1] * k0) + (sl[0] * k1) + xa2pcm[index + 0];
          sl[0] = sl[1];
          sl[1] = s;

          xa[ix + sd*2 + 0] = s;
        }

        var shiftFilter = sectorData8[sectorOffset + 5 + su];
        var shift  = (shiftFilter & 0x0f) >>> 0;
        var filter = (shiftFilter & 0xf0) >>> 3;
        var k0 = xa2flt[filter + 0]
        var k1 = xa2flt[filter + 1]

        for (var sd = 0; sd < 28; ++sd) {
          const offset = (sectorOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
          var data = sectorData8[offset] & 0xff;
          var index = (shift * 256 + data) * 2;

          var s = (sr[1] * k0) + (sr[0] * k1) + xa2pcm[index + 1];
          sr[0] = sr[1];
          sr[1] = s;

          xa[ix + sd*2 + 1] = s;
        }
        ix += 2*28;
      }
    }
    //debugger
    return ix;
  },

    stopReading: function() {
      cdr.eventRead.active = false;
      cdr.statusCode &= ~0x20;
      cdr.ncmdread = 0;
    },

    dmaTransferMode0000: function(addr, blck) {
      var transferSize = (blck & 0xFFFF) << 2;

      clearCodeCache(addr, transferSize);

      for (var i = 0; i < transferSize; i += 4) {
        map[(addr & 0x001fffff) >> 2] = sectorData32[(cdr.sectorOffset + cdr.sectorIndex) >> 2];
        cdr.sectorIndex += 4;
        addr += 4;
      }
      if (cdr.sectorIndex >= cdr.sectorEnd) {
        cdr.status &= ~0x40;
      }

      return transferSize;
    },

    setTOC: function(tracks) {
      this.tracks = tracks;
      console.log(tracks);
    },

    setCdImage: function(data) {
      sectorData32 = new Int32Array(data.buffer);
      sectorData16 = new Int16Array(data.buffer);
      sectorData8 = new Int8Array(data.buffer);

      cdr.hasCdFile = true;
      cdr.cdImage = data;
    }
  }

  Object.seal(cdr);
  return cdr;
})();
