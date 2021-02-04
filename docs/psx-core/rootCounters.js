'use strict';

var Counter = function(id) {
  this.id = id;
  this.cycles = 0;
  this.cyclesPerCount = 0;
  this.counter = 0;
  this.rmode = 0;
  this.rtarget = 0;
  this.realTarget = 0;
  this.wait = false;
  
  this.recalibrate();
}

Counter.prototype.recalibrate = function() {
  var realTarget = (this.rmode & 0x0008) ? (this.rtarget+1) : (0xffff+1);
  switch (this.id) {
  case 0: let dotclock = gpu.getDotClock();
          switch ((this.rmode >> 8) & 0x3) {
          case 0: this.calibrate(33868800,   1 * realTarget);  break;
          case 1: this.calibrate(dotclock,   1 * realTarget);  break;
          case 2: this.calibrate(33868800,   1 * realTarget);  break;
          case 3: this.calibrate(dotclock,   1 * realTarget);  break;
          }
          break;
  case 1: switch ((this.rmode >> 8) & 0x3) {
          case 0: this.calibrate(33868800,    1 * realTarget);  break;
          case 1: this.calibrate(53222400, 3413 * realTarget);  break;
          case 2: this.calibrate(33868800,    1 * realTarget);  break;
          case 3: this.calibrate(53222400, 3413 * realTarget);  break;
          }
          break;
  case 2: switch ((this.rmode >> 8) & 0x3) {
          case 0: this.calibrate(33868800,   1 * realTarget);  break;
          case 1: this.calibrate(33868800,   1 * realTarget);  break;
          case 2: this.calibrate(33868800,   8 * realTarget);  break;
          case 3: this.calibrate(33868800,   8 * realTarget);  break;
          }
          break;
  }
  this.realTarget = realTarget;
  this.cyclesPerCount = this.cycles/realTarget;
}

Counter.prototype.calibrate = function(freq, rate) {
  this.cycles = ((33868800.0 * rate) / freq) >> 0;
}

Counter.prototype.getMode = function() {
  let result = this.rmode;
  this.rmode &= 0xe7ff;
  return result;
}

Counter.prototype.getValue = function() {
  var counter = (this.counter / this.cyclesPerCount) >>> 0;
  return counter % this.realTarget;
}

Counter.prototype.getTarget = function() {
  return this.rtarget;
}

Counter.prototype.setMode = function(value) {
  console.log(hex(0x114, 4), hex(value));
  if (value & 1) {
    console.log('timer', this.id, 'synchronisation', value & 7);
    this.wait = true;
    // debugger;
  }
  if (value & 0x80) debugger;
  this.rmode = value | 0x0400;
  this.recalibrate();
  this.counter = 0;
}

Counter.prototype.setValue = function(value) {
  if (value !== 0) abort('rc'+this.id + ' <= ' + hex(value));
  this.counter = this.cyclesPerCount * (value & 0xffff);
}

Counter.prototype.setTarget = function(value) {
  this.rtarget = value & 0xffff;
  this.recalibrate();
}

Counter.prototype.advance = function(cycles) {
  if (this.wait) return false;

  this.counter += cycles;
  if (this.counter >= this.cycles) {
    this.counter -= this.cycles;
    if (((this.rmode & 0x0030) !== 0x0000)) {
      if (this.rmode & (1 << 4)) this.rmode |= 0x0800;
      if (this.rmode & (1 << 5)) this.rmode |= 0x1000;
      this.rmode &= ~(1 << 10); // clear IRQ bit (means that an irq is there)
      switch (this.id) {
      case 0: cpu.istat |= 0x0010; return true;
      case 1: cpu.istat |= 0x0020; return true;
      case 2: cpu.istat |= 0x0040; return true;
      }
    }
  }
  return false;
}

var rc0 = new Counter(0);
// var rc1 = new Counter(1);
// var rc2 = new Counter(2);

// rc1.onHBlank = function() {
// }

// rc1.onVBlankEnd = function() {
//   if (this.rmode & 1) {
//     this.rmode &= ~0x0001;
//     this.wait = false;
//   }
// }

let rc1 = {
  r11x0: 0x0000,
  r11x4: 0x0000,
  r11x8: 0x0000,
  synced: false,

  getValue: function(bits32) {
    return this.r11x0 & 0xffff;
  },

  getTarget: function(bits32) {
    return this.r11x8 & 0xffff;
  },

  getMode: function() {
    let result = this.r11x4;
    this.r11x4 &= 0xe7ff;
    return result;
  },

  setMode: function(bits32) {
    console.log(hex(0x1114, 4), hex(bits32));
    if (bits32 & 1) {
      console.log('timer', 1, 'synchronisation', bits32 & 7);
      this.synced = true;
      // debugger;
    }
    if (bits32 & 0x80) abort('RC1: toggle mode not yet supported');
    this.r11x4 = (bits32 & 0x1fff) | (1 << 10);
    this.r11x0 = 0;
  },

  setTarget: function(bits32) {
    this.r11x8 = bits32 & 0xffff;
  },

  setValue: function(bits32) {
    this.r11x0 = bits32;
  },

  onHBlank: function () {
    if (0x0100 === (this.r11x4 & 0x0100)) {
      ++this.r11x0;
    }
  },

  onVBlankEnd: function() {
    if (this.r11x4 & 0x0001) {
      // synchronisation mode
      if (7 !== (this.r11x4 & 0x0007)) return abort('unsupported synchronisation mode');
      this.r11x4 &= ~0x0001;
      this.synced = false;
    }
  },

  advance: function (cycles) {
    if (this.synced) return;

    if (0x0000 === (this.r11x4 & 0x0100)) {
      this.r11x0 += cycles;
    }

    if (this.r11x4 & 0x0008) {
      // reset after target
      if (this.r11x0 > this.r11x8) {
        if (this.r11x4 & 0x0010) { // IRQ on target
          this.r11x4 |= 0x0800;
          cpu.istat |= 0x0020;
        }
        this.r11x0 -= this.r11x8;
      }
    }
    else {
      // reset after 0xffff
      if (this.r11x0 > 0xffff) {
        if (this.r11x4 & 0x0020) { // IRQ on ffff
          this.r11x4 |= 0x1000;
          cpu.istat |= 0x0020;
        }
        this.r11x0 -= 0xffff;
      }
    }
  }
}

let rc2 = {
  r11x0: 0x0000,
  r11x4: 0x0000,
  r11x8: 0x0000,
  synced: false,

  getValue: function(bits32) {
    return this.r11x0 & 0xffff;
  },

  getTarget: function(bits32) {
    return this.r11x8 & 0xffff;
  },

  getMode: function() {
    let result = this.r11x4;
    this.r11x4 &= 0xe7ff;
    return result;
  },

  setMode: function(bits32) {
    console.log(hex(0x1124, 4), hex(bits32));
    if (bits32 & 1) {
      return abort('synchronisation not yet supported')
      console.log('timer', 2, 'synchronisation', bits32 & 7);
      this.synced = true;
    }
    if (bits32 & 0x80) abort('RC2: toggle mode not yet supported');
    this.r11x4 = (bits32 & 0x1fff) | (1 << 10);
    this.r11x0 = 0;
  },

  setTarget: function(bits32) {
    this.r11x8 = bits32 & 0xffff;
  },

  setValue: function(bits32) {
    this.r11x0 = bits32;
  },

  advance: function (cycles) {
    if (cycles & 7) return abort('cycles should be multiple of 8')
    if (this.synced) return;

    if (0x0000 === (this.r11x4 & 0x0200)) {
      this.r11x0 += cycles;
    }
    if (0x0200 === (this.r11x4 & 0x0200)) {
      this.r11x0 += cycles / 8;
    }

    if (this.r11x4 & 0x0008) {
      // reset after target
      if (this.r11x0 > this.r11x8) {
        if (this.r11x4 & 0x0010) { // IRQ on target
          this.r11x4 |= 0x0800;
          cpu.istat |= 0x0040;
        }
        this.r11x0 -= this.r11x8;
      }
    }
    else {
      // reset after 0xffff
      if (this.r11x0 > 0xffff) {
        if (this.r11x4 & 0x0020) { // IRQ on ffff
          this.r11x4 |= 0x1000;
          cpu.istat |= 0x0040;
        }
        this.r11x0 -= 0xffff;
      }
    }
  }
}

Object.seal(rc0);
Object.seal(rc1);
Object.seal(rc2);
