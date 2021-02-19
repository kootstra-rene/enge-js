'use strict';

let rc0 = {
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
    // console.log(hex(0x1124, 4), hex(bits32));
    if (bits32 & 1) {
      return abort('synchronisation not yet supported')
      console.log('timer', 0, 'synchronisation', bits32 & 7);
      this.synced = true;
    }
    if (bits32 & 0x80) abort('RC0: toggle mode not yet supported');
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
    if (this.synced) return;

    if (0x0000 === (this.r11x4 & 0x0100)) {
      this.r11x0 += cycles;
    }
    if (0x0100 === (this.r11x4 & 0x0100)) {
      //- todo: proper dotclock
      //let dotclock = gpu.getDotClock();
      this.r11x0 += cycles;
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
    // console.log(hex(0x1114, 4), hex(bits32));
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
    // console.log(hex(0x1124, 4), hex(bits32));
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
