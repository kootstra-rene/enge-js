// see rootcounters.md for details

const {rc0, rc1, rc2, dot} = (() => {
'use strict';

const r11x0 = new Float64Array(4);
const r11x4 = new Uint32Array(4);
const r11x8 = new Uint32Array(4);

r11x0.fill(0);
r11x4.fill(0);
r11x8.fill(0xffff);

function limitReached(id, limitBit, increment, cb) {
  switch (limitBit) {
    case 11:  var limit = +(r11x8[id] + 1.0);
              break;
    case 12:  var limit = +(+0xffff + 1.0);
              break;
    default:  return abort('invalid limit bit');
  }

  let value = r11x0[id] + increment;
  if (value >= limit) {
    if (cb) cb();
    r11x4[id] |= (1 << limitBit);
    return value %= limit;
  }
  return value;
}

const rc0 = {
  freerun: false,

  getValue: function(bits32) {
    const f = this.freerun;

    let cyclesToPeak = +0;

    switch (r11x4[0] & 0x00f) {
      case 0x000: // no irq, clock source, target 0xffff+1
                  cyclesToPeak = +(psx.clock - dot.start);
                  break;
      case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
                  switch (dot.whereInScanLine()) {
                    case -1:  cyclesToPeak = +0; break;
                    case  0:  cyclesToPeak = +(psx.clock - dot.dispHStart); break;
                    case  1:  cyclesToPeak = +(dot.dispHStop - dot.dispHStart); break;
                  }
                  break;
      case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
                  switch (dot.whereInScanLine()) {
                    case -1:  cyclesToPeak = +(psx.clock - dot.start); break;
                    case  0:  cyclesToPeak = +(psx.clock - dot.start); break;
                    case  1:  cyclesToPeak = +(psx.clock - dot.dispHStop); break;
                  }
                  break;

      case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
                  switch (dot.whereInScanLine()) {
                    case -1:  cyclesToPeak = +(psx.clock - dot.start); break;
                    case  0:  cyclesToPeak = +(dot.dispHStart - dot.start); break;
                    case  1:  cyclesToPeak = +(psx.clock - dot.dispHStop); break;
                  }
                  break;
      case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
                  switch (dot.whereInScanLine()) {
                    case -1:  cyclesToPeak = !f ? +0 : +(psx.clock - dot.start); break;
                    case  0:  cyclesToPeak = !f ? +0 : +(psx.clock - dot.start); break;
                    case  1:  cyclesToPeak = !f ? +(psx.clock - dot.dispHStop) : +(psx.clock - dot.start); break;
                  }
                  break;

      default:    return abort(`RC0: invalid mode: $${hex(r11x4[0], 4)}`);
    }

    if (r11x4[0] & 0x100) {
      return limitReached(0, 12, +gpu.cyclesToDotClock(cyclesToPeak));
    }
    else {
      return limitReached(0, 12, +cyclesToPeak);
    }
  },

  getTarget: function(bits32) {
    return r11x8[0];
  },

  getMode: function() {
    let result = r11x4[0];
    r11x4[0] &= 0xe7ff;
    return result;
  },

  setMode: function(bits32) {
    // console.log(hex(0x1104, 4), hex(bits32));
    r11x4[0] = (bits32 & 0x3ff) | (1 << 10);

    let cyclesToSkip = +0;

    switch (bits32 & 0x00f) {
      case 0x000: // no irq, clock source, target 0xffff+1
                  cyclesToSkip = +(psx.clock - dot.start);
                  break;
      case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
                  switch (dot.whereInScanLine()) {
                    case -1:  cyclesToSkip = +0; break;
                    case  0:  cyclesToSkip = +(psx.clock - dot.dispHStart); break;
                    case  1:  cyclesToSkip = +0; break;
                  }
                  break;
      case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
      case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
                  switch (dot.whereInScanLine()) {
                    case -1:  cyclesToSkip = +0; break;
                    case  0:  cyclesToSkip = +0; break;
                    case  1:  cyclesToSkip = +(psx.clock - dot.dispHStop); break;
                  }
                  break;
      case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
                  this.freerun = false;
                  cyclesToSkip = +0;
                  break;

      default:    return abort(`RC0: invalid mode: $${hex(r11x4[0], 4)}`);
    }

    if (r11x4[0] & 0x100) {
      r11x0[0] = +0, limitReached(0, 12, -gpu.cyclesToDotClock(cyclesToSkip));
    }
    else {
      r11x0[0] = +0, limitReached(0, 12, -cyclesToSkip);
    }
  },

  setTarget: function(bits32) {
    // console.log(hex(0x1108, 4), hex(bits32));
    if (!bits32) bits32 = 0xffff;
    r11x8[0] = bits32;
  },

  setValue: function(bits32) {
    // console.log(hex(0x1100, 4), hex(bits32));
    if (bits32) return abort('not supported');
    r11x0[0] = bits32;
  },

  onLimitReached: function() {
    if (r11x4[0] & 0x0030) { // IRQ enabled
      cpu.istat |= 0x0010;
    }
  },

  onScanLine: function() {
    const f = this.freerun;

    let cyclesToAdd = +0;

    switch (r11x4[0] & 0x00f) {
      case 0x000: // no irq, clock source, target 0xffff+1
                  cyclesToAdd = +(dot.stop - dot.start);
                  break;
      case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
                  cyclesToAdd = +(dot.dispHStop - dot.dispHStart);
                  break;

      case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
      case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
                  switch (dot.whereInScanLine()) {
                    case -1:  cyclesToAdd = +0; break;
                    case  0:  cyclesToAdd = +0; break;
                    case  1:  cyclesToAdd = - +(psx.clock - dot.dispHStop); break;
                  }
                  break;
      case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
                  cyclesToAdd = !f ? +(dot.stop - dot.dispHStop) : +(dot.stop - dot.start); 
                  this.freerun = true;
                  break;

      default:    return abort(`RC1: invalid mode: $${hex(r11x4[0], 4)}`);
    }

    if (r11x4[0] & 0x100) {
      r11x0[0] = limitReached(0, 12, gpu.cyclesToDotClock(cyclesToAdd), this.onLimitReached);
    }
    else {
      r11x0[0] = limitReached(0, 12, cyclesToAdd, this.onLimitReached);
    }
  }
}

const rc1 = {
  freerun: false,

  getValue: function(bits32) {
    const factor = dot.isInVBlank() ? 0.0 : 1.0;
    const limit = (r11x4[1] & 0x008) ? 11 : 12;

    switch (r11x4[1] & 0x107) {
      case 0x000: // no irq, clock source, target 0xffff+1
                  return limitReached(1, limit, +(psx.clock - dot.start));
      case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
                  return limitReached(1, limit, dot.isInVBlank() ? +0 : +psx.eventCycles(dot.event));
      case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
                  return limitReached(1, limit, +psx.eventCycles(dot.event));
      case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
                  return limitReached(1, limit, dot.isInVBlank() ? +0 : +0);
      case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
                  if (!this.freerun) return limitReached(1, 12, +0);
                  return limitReached(1, limit, +psx.eventCycles(dot.event));

      case 0x100: // no irq, h-blank source, target 0xffff+1
      case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
      case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
      case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
                  return limitReached(1, limit, +0);
      case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
                  if (!this.freerun) return limitReached(1, 12, +0);
                  return limitReached(1, limit, +0);

      default:    return abort(`RC1: invalid mode: $${hex(r11x4[1], 4)}`);
    }
  },

  getTarget: function(bits32) {
    return r11x8[1];
  },

  getMode: function() {
    let result = r11x4[1];
    r11x4[1] &= 0xe7ff;
    return result;
  },

  setMode: function(bits32) {
    // console.log(hex(0x1114, 4), hex(bits32));
    r11x4[1] = ((bits32 & 0x13f) | (1 << 10)) >>> 0;

    const limit = (r11x4[1] & 0x008) ? 11 : 12;

    // todo: implement synchronisation
    switch (r11x4[1] & 0x107) {
      case 0x000: // no irq, clock source, target 0xffff+1
      case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
      case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
      case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
                  r11x0[1] = - +(psx.clock - dot.start);
                  r11x0[1] = limitReached(1, limit, +0);
                  break;
      case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
                  this.freerun = false;
                  r11x0[1] = +0;
                  break;

      case 0x100: // no irq, h-blank source, target 0xffff+1
      case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
      case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
      case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
                  r11x0[1] = +0;
                  break;
      case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
                  this.freerun = false;
                  r11x0[1] = +0;
                  break;

      default:    return abort(`RC1: invalid mode: $${hex(r11x4[1], 4)}`);
    }
  },

  setTarget: function(bits32) {
    // console.log(hex(0x1118, 4), hex(bits32));
    if (!bits32) bits32 = 0xffff;
    r11x8[1] = bits32 >>> 0;
  },

  setValue: function(bits32) {
    // console.log(hex(0x1110, 4), hex(bits32));
    if (bits32) return abort('not supported');
    r11x0[1] = +bits32;
  },

  onLimitReached: function() {
    if (r11x4[1] & 0x0030) { // IRQ enabled
      cpu.istat |= 0x0020;
    }
  },

  onScanLine: function(isVBlankStart) {
    const limit = (r11x4[1] & 0x008) ? 11 : 12;
    const cyclesPerScanLine = +(dot.stop - dot.start);

    switch (r11x4[1] & 0x107) {
      case 0x000: // no irq, clock source, target 0xffff+1
                  r11x0[1] = limitReached(1, limit, cyclesPerScanLine, this.onLimitReached);
                  break;
      case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
                  r11x0[1] = limitReached(1, limit, dot.isInVBlank() ? +0 : cyclesPerScanLine, this.onLimitReached);
                  break;
      case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
                  r11x0[1] = limitReached(1, limit, cyclesPerScanLine, this.onLimitReached);
                  if (isVBlankStart) r11x0[1] = 0;
                  break;
      case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
                  r11x0[1] = limitReached(1, limit, dot.isInVBlank() ? cyclesPerScanLine : +0, this.onLimitReached);
                  if (dot.isInVBlank()) r11x0[1] = 0;
                  break;
      case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
                  if (this.freerun) {
                    r11x0[1] = limitReached(1, limit, cyclesPerScanLine, this.onLimitReached);
                  }
                  else {
                    r11x0[1] = limitReached(1, limit, +0, this.onLimitReached);
                    if (isVBlankStart) {
                      this.freerun = true;
                    }
                  }
                  break;

      case 0x100: // no irq, h-blank source, target 0xffff+1
                  r11x0[1] = limitReached(1, limit, +1, this.onLimitReached);
                  break;
      case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
                  r11x0[1] = limitReached(1, limit, dot.isInVBlank() ? + 0 : +1, this.onLimitReached);
                  break;
      case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
                  r11x0[1] = limitReached(1, limit, +1, this.onLimitReached);
                  if (isVBlankStart) r11x0[1] = 0;
                  break;
      case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
                  r11x0[1] = limitReached(1, limit, dot.isInVBlank() ? +0 : +1, this.onLimitReached);
                  if (isVBlankStart) r11x0[1] = 0;
                  break;
      case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
                  if (this.freerun) {
                    r11x0[1] = limitReached(1, limit, +1, this.onLimitReached);
                  }
                  else {
                    r11x0[1] = limitReached(1, limit, +0, this.onLimitReached);
                    if (isVBlankStart) {
                      this.freerun = true;
                    }
                  }
                  break;

      default:    return abort(`RC1: invalid mode: $${hex(r11x4[1], 4)}`);
    }
  }
}

const rc2 = {
  getValue: function(bits32) {
    const limit = (r11x4[2] & 0x008) ? 11 : 12;

    switch (r11x4[2] & 0x207) {
      case 0x000: // no irq, clock source, target 0xffff+1
      case 0x003: // no irq, clock source, target 0xffff+1, free run
      case 0x005: // no irq, clock source, target 0xffff+1, free run
                  return limitReached(2, limit, +(psx.clock - dot.start));

      case 0x001: // no irq, clock source, target 0xffff+1, stop counter
      case 0x007: // no irq, clock source, target 0xffff+1, stop counter
                  return limitReached(2, limit, +0);

      case 0x008: // no irq, clock source, reset @ target+1
                  return limitReached(2, limit, +(psx.clock - dot.start));

      case 0x200: // no irq, clock/8 source, target 0xffff+1
                  return limitReached(2, limit, 0.125 * +(psx.clock - dot.start));

      default:    return abort(`RC2: invalid mode: $${hex(r11x4[2], 4)}`);
    }
  },

  getTarget: function(bits32) {
    return r11x8[2];
  },

  getMode: function() {
    let result = r11x4[2];
    r11x4[2] &= 0xe7ff;
    return result;
  },

  setMode: function(bits32) {
    // console.log(hex(0x1124, 4), hex(bits32));
    const limit = (r11x4[2] & 0x008) ? 11 : 12;
    r11x4[2] = (bits32 & 0x3ff) | (1 << 10);

    switch (r11x4[2] & 0x207) {
      case 0x000: // no irq, clock source, reset @ 0xffff+1
      case 0x003: // no irq, clock source, reset @ 0xffff+1, free run
      case 0x005: // no irq, clock source, reset @ 0xffff+1, free run
                  r11x0[2] = - +(psx.clock - dot.start);
                  r11x0[2] = limitReached(2, limit, +0);
                  break;

      case 0x001: // no irq, clock source, reset @ 0xffff+1, stop counter
      case 0x007: // no irq, clock source, reset @ 0xffff+1, stop counter
                  r11x0[2] = +0;
                  break;

      case 0x008: // no irq, clock source, reset @ target+1
                  r11x0[2] = -1.000 * psx.eventCycles(dot.event);
                  break;

      case 0x200: // no irq, clock/8 source, reset @ 0xffff+1
                  r11x0[2] = -0.125 * psx.eventCycles(dot.event);
                  break;

      default:    return abort(`RC2: invalid mode: $${hex(r11x4[2], 4)}`);
    }
  },

  setTarget: function(bits32) {
    // todo: check setting target after setMode
    if (!bits32) bits32 = 0xffff;
    r11x8[2] = bits32 & 0xffff;
  },

  setValue: function(bits32) {
    if (bits32) return abort('not supported');
    r11x0[2] = bits32;
  },

  onLimitReached: function() {
    if (r11x4[2] & 0x0030) { // IRQ enabled
      cpu.istat |= 0x0040;
    }
  },

  onScanLine: function() {
    const limit = (r11x4[2] & 0x008) ? 11 : 12;

    switch (r11x4[2] & 0x207) {
      case 0x000: // no irq, clock source, target 0xffff+1
      case 0x003: // no irq, clock source, target 0xffff+1, free run
      case 0x005: // no irq, clock source, target 0xffff+1, free run
                  r11x0[2] = limitReached(2, limit, +(dot.stop - dot.start), this.onLimitReached);
                  break;

      case 0x001: // no irq, clock source, target 0xffff+1, stop counter
      case 0x007: // no irq, clock source, target 0xffff+1, stop counter
                  r11x0[2] = limitReached(2, limit, +0, this.onLimitReached);
                  break;

      case 0x200: // no irq, clock/8 source, reset @ 0xffff+1
                  r11x0[2] = limitReached(2, limit, 0.125 * +(dot.stop - dot.start), this.onLimitReached);
                  break;

      default:    return abort(`RC2: invalid mode: $${hex(r11x4[2], 4)}`);
    }
  }
}


const dot = {
  event: null,
  remainder: 0.0,
  scanLine: 0,
  vblank: false,

  dispHStart: +Number.MAX_SAFE_INTEGER,
  dispHStop: +Number.MAX_SAFE_INTEGER,
  start: +Number.MAX_SAFE_INTEGER,
  stop: +Number.MAX_SAFE_INTEGER,

  upateToLastGpuState: function(self) {
    const videoCycles = ((gpu.status >> 20) & 1) ? 3406.0 : 3413.0;
    const cpuCycles = (videoCycles * 7.0 / 11.0);

    this.start = +self.clock;
    this.stop  = +cpuCycles + this.start;

    this.dispHStart = this.start + (+gpu.dispL * 7.0 / 11.0);
    this.dispHStop  = this.start + (+gpu.dispR * 7.0 / 11.0);
  },

  complete: function(self, clock) {
    this.upateToLastGpuState(self);

    const linesPerFrame = ((gpu.status >> 20) & 1) ? 314 : 263;
    this.scanLine = (this.scanLine + 1) % linesPerFrame;
    this.vblank = (this.scanLine < gpu.dispT) || (this.scanLine >= gpu.dispB);

    rc0.onScanLine();
    rc1.onScanLine(this.scanLine === gpu.dispB);
    rc2.onScanLine();
    gpu.onScanLine();


    let scanlineCycles = this.stop - this.start;
    psx.updateEvent(self, +scanlineCycles);
  },

  isInVBlank: function() {
    return this.vblank;
  },

  $whereInScanLine: function() {
    if (psx.clock < this.dispHStart) {
      console.log('#whereInScanLine:', -1, psx.clock, this.dispHStart.toFixed(1), this.dispHStop.toFixed(1), gpu.cyclesToDotClock(1));
      // before dispay
      return -1 >> 0;
    }
    if (psx.clock < this.dispHStop) {
      console.log('#whereInScanLine:', 0, psx.clock, this.dispHStart.toFixed(1), this.dispHStop.toFixed(1), gpu.cyclesToDotClock(1));
      // during dispay
      return 0 >> 0;
    }
    console.log('#whereInScanLine:', 1, psx.clock, this.dispHStart.toFixed(1), this.dispHStop.toFixed(1), gpu.cyclesToDotClock(1));
    // after dispay
    return 1 >> 0;
  },

  whereInScanLine: function() {
    if (psx.clock < this.dispHStart) {
      return -1 >> 0;
    }
    if (psx.clock < this.dispHStop) {
      return 0 >> 0;
    }
    return 1 >> 0;
  },

}

Object.seal(rc0);
Object.seal(rc1);
Object.seal(rc2);

Object.seal(dot);

return {rc0, rc1, rc2, dot};
})();
