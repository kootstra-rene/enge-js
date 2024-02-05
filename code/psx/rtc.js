mdlr('enge:psx:rtc', m => {

  const r11x0 = new Float64Array(4);
  const r11x4 = new Uint32Array(4);
  const r11x8 = new Uint32Array(4);

  const limitReached = (id, increment, counter) => {
    const limitBit = (r11x4[id] & 0x008) ? 11 : 12;
    switch (limitBit) {
      case 11: var limit = +(r11x8[id] + 1.0);
        break;
      case 12: var limit = +(+0xffff + 1.0);
        break;
    }

    let value = r11x0[id] + increment;
    if (value >= limit) {
      counter?.onLimitReached(counter);
      r11x4[id] |= (1 << limitBit);
      return value %= limit;
    }
    return value;
  }

  const rc0 = {
    freerun: false,

    getValue: () => {
      const f = rc0.freerun;

      let cyclesToPeek = +0;

      switch (r11x4[0] & 0x007) {
        case 0x000: // no irq, clock source, target 0xffff+1
          cyclesToPeek = +(psx.clock - dot.start);
          break;
        case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToPeek = +0; break;
            case 0: cyclesToPeek = +(psx.clock - dot.dispHStart); break;
            case 1: cyclesToPeek = +(dot.dispHStop - dot.dispHStart); break;
          }
          break;
        case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToPeek = +(psx.clock - dot.start); break;
            case 0: cyclesToPeek = +(psx.clock - dot.start); break;
            case 1: cyclesToPeek = +(psx.clock - dot.dispHStop); break;
          }
          break;

        case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToPeek = +(psx.clock - dot.start); break;
            case 0: cyclesToPeek = +(dot.dispHStart - dot.start); break;
            case 1: cyclesToPeek = +(psx.clock - dot.dispHStop); break;
          }
          break;
        case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
          switch (dot.whereInScanLine()) {
            case -1: cyclesToPeek = !f ? +0 : +(psx.clock - dot.start); break;
            case 0: cyclesToPeek = !f ? +0 : +(psx.clock - dot.start); break;
            case 1: cyclesToPeek = !f ? +(psx.clock - dot.dispHStop) : +(psx.clock - dot.start); break;
          }
          break;
      }

      if (r11x4[0] & 0x100) {
        return limitReached(0, +gpu.cyclesToDotClock(cyclesToPeek));
      }
      else {
        return limitReached(0, +cyclesToPeek);
      }
    },

    getTarget: () => {
      return r11x8[0];
    },

    getMode: () => {
      let result = r11x4[0];
      r11x4[0] &= 0xe7ff;
      return result;
    },

    setMode: (bits32) => {
      r11x4[0] = (bits32 & 0x3ff) | (1 << 10);

      let cyclesToSkip = +0;

      switch (bits32 & 0x007) {
        case 0x000: // no irq, clock source, target 0xffff+1
          cyclesToSkip = +(psx.clock - dot.start);
          break;
        case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToSkip = +0; break;
            case 0: cyclesToSkip = +(psx.clock - dot.dispHStart); break;
            case 1: cyclesToSkip = +0; break;
          }
          break;
        case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
        case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToSkip = +0; break;
            case 0: cyclesToSkip = +0; break;
            case 1: cyclesToSkip = +(psx.clock - dot.dispHStop); break;
          }
          break;
        case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
          rc0.freerun = false;
          cyclesToSkip = +0;
          break;
      }

      if (r11x4[0] & 0x100) {
        r11x0[0] = +0, limitReached(0, -gpu.cyclesToDotClock(cyclesToSkip));
      }
      else {
        r11x0[0] = +0, limitReached(0, -cyclesToSkip);
      }
    },

    setTarget: (bits32) => {
      if (!bits32) bits32 = 0xffff;
      r11x8[0] = bits32;
    },

    setValue: (bits32) => {
      r11x0[0] = bits32;
    },

    onLimitReached: () => {
      if (r11x4[0] & 0x0030) {
        cpu.istat |= 0x0010;
      }
    },

    onScanLine: () => {
      const f = rc0.freerun;

      let cyclesToAdd = +0;

      switch (r11x4[0] & 0x007) {
        case 0x000: // no irq, clock source, target 0xffff+1
          cyclesToAdd = +(dot.stop - dot.start);
          break;
        case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
          cyclesToAdd = +(dot.dispHStop - dot.dispHStart);
          break;

        case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
        case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToAdd = +0; break;
            case 0: cyclesToAdd = +0; break;
            case 1: cyclesToAdd = - +(psx.clock - dot.dispHStop); break;
          }
          break;
        case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
          cyclesToAdd = !f ? +(dot.stop - dot.dispHStop) : +(dot.stop - dot.start);
          rc0.freerun = true;
          break;
      }

      if (r11x4[0] & 0x100) {
        r11x0[0] = limitReached(0, gpu.cyclesToDotClock(cyclesToAdd), rc0);
      }
      else {
        r11x0[0] = limitReached(0, cyclesToAdd, rc0);
      }
    }
  }

  const rc1 = {
    freerun: false,

    getValue: () => {
      // const factor = dot.isInVBlank() ? 0.0 : 1.0;

      switch (r11x4[1] & 0x107) {
        case 0x000: // no irq, clock source, target 0xffff+1
          return limitReached(1, +(psx.clock - dot.start));
        case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
          return limitReached(1, dot.isInVBlank() ? +0 : +psx.eventCycles(dot.event));
        case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
          return limitReached(1, +psx.eventCycles(dot.event));
        case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
          return limitReached(1, dot.isInVBlank() ? +0 : +0);
        case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
          if (!rc1.freerun) return limitReached(1, +0);
          return limitReached(1, +psx.eventCycles(dot.event));

        case 0x100: // no irq, h-blank source, target 0xffff+1
        case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
        case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
        case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
          return limitReached(1, +0);
        case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
          if (!rc1.freerun) return limitReached(1, +0);
          return limitReached(1, +0);
      }
    },

    getTarget: () => {
      return r11x8[1];
    },

    getMode: () => {
      let result = r11x4[1];
      r11x4[1] &= 0xe7ff;
      return result;
    },

    setMode: (bits32) => {
      r11x4[1] = ((bits32 & 0x13f) | (1 << 10)) >>> 0;

      // todo: implement synchronisation
      switch (r11x4[1] & 0x107) {
        case 0x000: // no irq, clock source, target 0xffff+1
        case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
        case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
        case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
          r11x0[1] = - +(psx.clock - dot.start);
          r11x0[1] = limitReached(1, +0);
          break;
        case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
          rc1.freerun = false;
          r11x0[1] = +0;
          break;

        case 0x100: // no irq, h-blank source, target 0xffff+1
        case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
        case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
        case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
          r11x0[1] = +0;
          break;
        case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
          rc1.freerun = false;
          r11x0[1] = +0;
          break;
      }
    },

    setTarget: (bits32) => {
      if (!bits32) bits32 = 0xffff;
      r11x8[1] = bits32 >>> 0;
    },

    setValue: (bits32) => {
      r11x0[1] = +bits32;
    },

    onLimitReached: () => {
      if (r11x4[1] & 0x0030) {
        cpu.istat |= 0x0020;
      }
    },

    onScanLine: (isVBlankStart) => {
      const cyclesPerScanLine = +(dot.stop - dot.start);

      switch (r11x4[1] & 0x107) {
        case 0x000: // no irq, clock source, target 0xffff+1
          r11x0[1] = limitReached(1, cyclesPerScanLine, rc1);
          break;
        case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
          r11x0[1] = limitReached(1, dot.isInVBlank() ? +0 : cyclesPerScanLine, rc1);
          break;
        case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
          r11x0[1] = limitReached(1, cyclesPerScanLine, rc1);
          if (isVBlankStart) r11x0[1] = 0;
          break;
        case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
          r11x0[1] = limitReached(1, dot.isInVBlank() ? cyclesPerScanLine : +0, rc1);
          if (dot.isInVBlank()) r11x0[1] = 0;
          break;
        case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
          if (rc1.freerun) {
            r11x0[1] = limitReached(1, cyclesPerScanLine, rc1);
          }
          else {
            r11x0[1] = limitReached(1, +0, rc1);
            if (isVBlankStart) {
              rc1.freerun = true;
            }
          }
          break;

        case 0x100: // no irq, h-blank source, target 0xffff+1
          r11x0[1] = limitReached(1, +1, rc1);
          break;
        case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
          r11x0[1] = limitReached(1, dot.isInVBlank() ? + 0 : +1, rc1);
          break;
        case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
          r11x0[1] = limitReached(1, +1, rc1);
          if (isVBlankStart) r11x0[1] = 0;
          break;
        case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
          r11x0[1] = limitReached(1, dot.isInVBlank() ? +0 : +1, rc1);
          if (isVBlankStart) r11x0[1] = 0;
          break;
        case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
          if (rc1.freerun) {
            r11x0[1] = limitReached(1, +1, rc1);
          }
          else {
            r11x0[1] = limitReached(1, +0, rc1);
            if (isVBlankStart) {
              rc1.freerun = true;
            }
          }
          break;
      }
    }
  }

  const rc2 = {
    getValue: () => {
      switch (r11x4[2] & 0x207) {
        case 0x000: // no irq, clock source, target 0xffff+1
        case 0x003: // no irq, clock source, target 0xffff+1, free run
        case 0x005: // no irq, clock source, target 0xffff+1, free run
          return limitReached(2, +(psx.clock - dot.start));

        case 0x001: // no irq, clock source, target 0xffff+1, stop counter
        case 0x007: // no irq, clock source, target 0xffff+1, stop counter
          return limitReached(2, +0);

        case 0x008: // no irq, clock source, reset @ target+1
          return limitReached(2, +(psx.clock - dot.start));

        case 0x200: // no irq, clock/8 source, target 0xffff+1
          return limitReached(2, 0.125 * +(psx.clock - dot.start));
      }
    },

    getTarget: () => {
      return r11x8[2];
    },

    getMode: () => {
      let result = r11x4[2];
      r11x4[2] &= 0xe7ff;
      return result;
    },

    setMode: (bits32) => {
      r11x4[2] = (bits32 & 0x3ff) | (1 << 10);

      switch (r11x4[2] & 0x207) {
        case 0x000: // no irq, clock source, reset @ 0xffff+1
        case 0x003: // no irq, clock source, reset @ 0xffff+1, free run
        case 0x005: // no irq, clock source, reset @ 0xffff+1, free run
          r11x0[2] = - +(psx.clock - dot.start);
          r11x0[2] = limitReached(2, +0);
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
      }
    },

    setTarget: (bits32) => {
      // todo: check setting target after setMode
      if (!bits32) bits32 = 0xffff;
      r11x8[2] = bits32 & 0xffff;
    },

    setValue: (bits32) => {
      r11x0[2] = bits32;
    },

    onLimitReached: () => {
      if (r11x4[2] & 0x0030) {
        cpu.istat |= 0x0040;
      }
    },

    onScanLine: () => {
      switch (r11x4[2] & 0x207) {
        case 0x000: // no irq, clock source, target 0xffff+1
        case 0x003: // no irq, clock source, target 0xffff+1, free run
        case 0x005: // no irq, clock source, target 0xffff+1, free run
          r11x0[2] = limitReached(2, +(dot.stop - dot.start), rc2);
          break;

        case 0x001: // no irq, clock source, target 0xffff+1, stop counter
        case 0x007: // no irq, clock source, target 0xffff+1, stop counter
          r11x0[2] = limitReached(2, +0, rc2);
          break;

        case 0x200: // no irq, clock/8 source, reset @ 0xffff+1
          r11x0[2] = limitReached(2, 0.125 * +(dot.stop - dot.start), rc2);
          break;
      }
    }
  }

  const MAX_SAFE_INTEGER = +Number.MAX_SAFE_INTEGER;

  const dot = {
    event: null,
    remainder: 0.0,
    scanLine: 0,
    vblank: false,

    dispHStart: MAX_SAFE_INTEGER,
    dispHStop: MAX_SAFE_INTEGER,
    start: MAX_SAFE_INTEGER,
    stop: MAX_SAFE_INTEGER,

    upateToLastGpuState: (self) => {
      const videoCycles = ((gpu.status >> 20) & 1) ? 3406.0 : 3413.0;
      const cpuCycles = (videoCycles * 7.0 / 11.0) * (PSX_SPEED / (768 * 44100));

      dot.start = +self.clock;
      dot.stop = +cpuCycles + dot.start;

      dot.dispHStart = dot.start + (+gpu.dispL * 7.0 / 11.0);
      dot.dispHStop = dot.start + (+gpu.dispR * 7.0 / 11.0);
    },

    complete: (self) => {
      dot.upateToLastGpuState(self);

      const linesPerFrame = ((gpu.status >> 20) & 1) ? 314 : 263;
      dot.scanLine = (dot.scanLine + 1) % linesPerFrame;
      dot.vblank = (dot.scanLine < gpu.dispT) || (dot.scanLine >= gpu.dispB);

      rc0.onScanLine();
      rc1.onScanLine(dot.scanLine === gpu.dispB);
      rc2.onScanLine();
      gpu.onScanLine(dot.scanLine);


      let scanlineCycles = dot.stop - dot.start;
      psx.updateEvent(self, +scanlineCycles);
    },

    isInVBlank: () => {
      return dot.vblank;
    },

    whereInScanLine: () => {
      if (psx.clock < dot.dispHStart) {
        return -1 >> 0;
      }
      if (psx.clock < dot.dispHStop) {
        return 0 >> 0;
      }
      return 1 >> 0;
    }
  }

  const rtc = {
    rd32: (reg) => {
      switch (true) {
        case (reg === 0x1100): return rc0.getValue();
        case (reg === 0x1104): return rc0.getMode();
        case (reg === 0x1108): return rc0.getTarget();
        case (reg === 0x1110): return rc1.getValue();
        case (reg === 0x1114): return rc1.getMode();
        case (reg === 0x1118): return rc1.getTarget();
        case (reg === 0x1120): return rc2.getValue();
        case (reg === 0x1124): return rc2.getMode();
        case (reg === 0x1128): return rc2.getTarget();
      }
    },
    wr32: (reg, data) => {
      switch (true) {
        case (reg === 0x1100): return rc0.setValue(data);
        case (reg === 0x1104): return rc0.setMode(data);
        case (reg === 0x1108): return rc0.setTarget(data);
        case (reg === 0x1110): return rc1.setValue(data);
        case (reg === 0x1114): return rc1.setMode(data);
        case (reg === 0x1118): return rc1.setTarget(data);
        case (reg === 0x1120): return rc2.setValue(data);
        case (reg === 0x1124): return rc2.setMode(data);
        case (reg === 0x1128): return rc2.setTarget(data);
      }
    }
  };

  dot.event = psx.addEvent(0, dot.complete.bind(dot));

  r11x0.fill(0);
  r11x4.fill(0);
  r11x8.fill(0xffff);

  return { rtc };

})