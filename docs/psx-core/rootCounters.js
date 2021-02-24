'use strict';

let rc0 = {
  r11x0: 0x0000,
  r11x4: 0x0000,
  r11x8: 0x0000,
  clockSet: 0,
  event: null,

  complete: function(self, clock) {
    // console.log('rc2 fired', clock);
    if ((this.r11x4 & 0x3ff) === 0x058) {
      psx.updateEvent(self, this.r11x8);
    }
    else {
      self.active = false;
    }
  },

  getValue: function(bits32) {
    if (0x0000 === (this.r11x4 & 0x0100)) {
      return this.r11x0 + (psx.clock - this.clockSet) >> 0;
    }
    else {
      return this.r11x0 + gpu.cyclesToDotClock(psx.clock - this.clockSet);
    }
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
    // console.log(hex(0x1104, 4), hex(bits32));
    // if (bits32 & 0x1) return abort('synchronisation mode not supported');
    if (bits32 & 0x80) return abort('toggle mode not supported');
    this.r11x4 = (bits32 & 0x3ff) | (1 << 10);
    this.r11x0 = 0;
    this.event.active = false;
    this.clockSet = psx.clock;

    if (bits32 & 0x30) {
      if ((bits32 & 0x3ff) !== 0x058) return abort('IRQ not supported');
      psx.setEvent(this.event, this.r11x8);
    }
  },

  setTarget: function(bits32) {
    // console.log(hex(0x1108, 4), hex(bits32));
    this.r11x8 = bits32 & 0xffff;
  },

  setValue: function(bits32) {
    // console.log(hex(0x1100, 4), hex(bits32));
    this.clockSet = psx.clock;
    this.r11x0 = bits32;
  }
}

let rc1 = {
  r11x0: 0x0000,
  r11x4: 0x0000,
  r11x8: 0x0000,
  clockSet: 0,
  event: null,

  complete: function(self, clock) {
    switch (this.r11x4 & 0x3ff) {
      case 0x000: 
      case 0x158: self.active = false;
                  break;

      case 0x258: psx.updateEvent(self, this.r11x8);
                  break;

      default:    return abort('invalid mode');
    }
  },

  getValue: function(bits32) {
    if (0x0000 === (this.r11x4 & 0x0100)) {
      return this.r11x0 + (psx.clock - this.clockSet) >> 0;
    }
    else {
      return this.r11x0;
    }
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
    // if (bits32 & 0x1) return abort('synchronisation mode not supported');
    if (bits32 & 0x80) return abort('toggle mode not supported');
    this.r11x4 = (bits32 & 0x3ff) | (1 << 10);
    this.r11x0 = 0;
    this.clockSet = psx.clock;

    if (bits32 & 0x30) {
      switch (bits32 & 0x3ff) {
        case 0x158: this.event.active = false;
                    break;
        case 0x258: psx.set(this.event, this.r11x8);
                    break;
        default:    return abort('IRQ not supported');
      }
    }
  },

  setTarget: function(bits32) {
    // console.log(hex(0x1118, 4), hex(bits32));
    this.r11x8 = bits32 & 0xffff;
  },

  setValue: function(bits32) {
    // console.log(hex(0x1110, 4), hex(bits32));
    this.clockSet = psx.clock;
    this.r11x0 = bits32 & 0xffff;
  },

  onScanLine: function () {
    if (0x0100 === (this.r11x4 & 0x0100)) {
      ++this.r11x0;

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
    }
  }
}

let rc2 = {
  r11x0: 0x0000,
  r11x4: 0x0000,
  r11x8: 0x0000,
  clockSet: 0,
  event: null,

  complete: function(self, clock) {
    // console.log('rc2 fired', clock);
    if ((this.r11x4 & 0x3ff) === 0x258) {
      psx.updateEvent(self, this.r11x8 * 8);
    }
    else {
      self.active = false;
    }
  },

  getValue: function(bits32) {
    if (0x0000 === (this.r11x4 & 0x0200)) {
      return this.r11x0 + (psx.clock - this.clockSet) >> 0;
    }
    else {
      return this.r11x0 + (psx.clock - this.clockSet) >> 3;
    }
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
    if (bits32 & 0x1) return abort('synchronisation mode not supported');
    if (bits32 & 0x80) return abort('toggle mode not supported');
    this.r11x4 = (bits32 & 0x3ff) | (1 << 10);
    this.r11x0 = 0;
    this.event.active = false;
    this.clockSet = psx.clock;

    if (bits32 & 0x30) {
      if ((bits32 & 0x3ff) !== 0x258) return abort('IRQ not supported');
      psx.setEvent(this.event, this.r11x8 * 8);
    }
  },

  setTarget: function(bits32) {
    // console.log(hex(0x1128, 4), hex(bits32));
    this.r11x8 = bits32 & 0xffff;
  },

  setValue: function(bits32) {
    // console.log(hex(0x1120, 4), hex(bits32));
    this.clockSet = psx.clock;
    this.r11x0 = bits32;
  }
}


let dot = {
  event: null,
  remainder: 0.0,

  complete: function(self, clock) {
    const videoCycles = ((gpu.status >> 20) & 1) ? 3406 : 3413;
    let cpuCycles = (videoCycles * 7.0 / 11.0);

    this.remainder += (cpuCycles - (cpuCycles >>> 0));
    if (this.remainder >= 1.0) {
      this.remainder -= 1.0;
      ++cpuCycles;
    }

    psx.updateEvent(self, (cpuCycles >>> 0));

    gpu.onScanLine();
    rc1.onScanLine();
  }
}

Object.seal(rc0);
Object.seal(rc1);
Object.seal(rc2);

Object.seal(dot);
