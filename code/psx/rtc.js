mdlr('enge:psx:rtc', ({ include }) => {

  const r11x0 = new Float64Array(4);
  const r11x4 = new Uint32Array(4);
  const r11x8 = new Uint32Array(4);
  const irqDone = new Uint8Array(4); // one-shot IRQ already raised since mode write

  // Advances counter `id` by `increment` and detects the target and overflow
  // events separately (mode bit 11 = reached target, bit 12 = reached 0xffff).
  // When `counter` is given, the IRQ enable for each event that occurred is
  // checked (bit 4 = IRQ at target, bit 5 = IRQ at 0xffff); getValue() calls
  // this without `counter` to peek, which only updates the reached flags.
  const limitReached = (id, increment, counter) => {
    const mode = r11x4[id];
    const target = +r11x8[id];
    const old = +r11x0[id];

    let value = old + increment;
    let hitTarget = false;
    let hitOverflow = false;

    if (mode & 0x008) {
      // reset counter after counter = target
      const limit = +(target + 1.0);
      if (value >= limit) {
        hitTarget = true;
        // with target 0xffff the counter also passes 0xffff
        hitOverflow = (limit >= 0x10000);
        value %= limit;
      }
    }
    else {
      // free running to 0xffff; the target can still be passed on the way
      if (old < target && value >= target) {
        hitTarget = true;
      }
      if (value >= 0x10000) {
        hitOverflow = true;
        value %= 0x10000;
        if (value >= target) hitTarget = true;
      }
    }

    if (hitTarget) r11x4[id] |= (1 << 11);
    if (hitOverflow) r11x4[id] |= (1 << 12);

    if (counter && ((hitTarget && (mode & 0x010)) || (hitOverflow && (mode & 0x020)))) {
      // bit 6 clear = one-shot: only the first IRQ after a mode write is raised
      if ((mode & 0x040) || !irqDone[id]) {
        irqDone[id] = 1;
        counter.onLimitReached(counter);
      }
    }
    return value;
  }

  // Sync mode bits (0-2) only matter while sync is enabled (bit 0); with sync
  // disabled every combination behaves as free running (key 0).
  const syncKey = (mode) => (mode & 0x001) ? (mode & 0x007) : 0x000;

  // Value bookkeeping shared by all counters: r11x0[n] holds the counter value
  // at the start of the current scanline (minus any offset from a mid-line
  // register write), elapsed() returns how far the counter advanced since then.
  // A register write stores `value - elapsed()` so the next read returns
  // exactly `value`; onScanLine() then adds the cycles of the finished line.

  const rc0 = {
    freerun: false,

    elapsed: () => {
      const f = rc0.freerun;

      let cyclesToPeek = +0;

      switch (syncKey(r11x4[0])) {
        case 0x000: // free run
          cyclesToPeek = +(psx.clock - dot.start);
          break;
        case 0x001: // pause in hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToPeek = +0; break;
            case 0: cyclesToPeek = +(psx.clock - dot.dispHStart); break;
            case 1: cyclesToPeek = +(dot.dispHStop - dot.dispHStart); break;
          }
          break;
        case 0x003: // reset counter at hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToPeek = +(psx.clock - dot.start); break;
            case 0: cyclesToPeek = +(psx.clock - dot.start); break;
            case 1: cyclesToPeek = +(psx.clock - dot.dispHStop); break;
          }
          break;
        case 0x005: // reset counter at hblank, pause outside hblank
          switch (dot.whereInScanLine()) {
            case -1: cyclesToPeek = +(psx.clock - dot.start); break;
            case 0: cyclesToPeek = +(dot.dispHStart - dot.start); break;
            case 1: cyclesToPeek = +(psx.clock - dot.dispHStop); break;
          }
          break;
        case 0x007: // pause until hblank then switch to free run
          switch (dot.whereInScanLine()) {
            case -1: cyclesToPeek = !f ? +0 : +(psx.clock - dot.start); break;
            case 0: cyclesToPeek = !f ? +0 : +(psx.clock - dot.start); break;
            case 1: cyclesToPeek = !f ? +(psx.clock - dot.dispHStop) : +(psx.clock - dot.start); break;
          }
          break;
      }

      if (r11x4[0] & 0x100) {
        return +gpu.cyclesToDotClock(cyclesToPeek);
      }
      return +cyclesToPeek;
    },

    getValue: () => {
      return limitReached(0, rc0.elapsed());
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
      irqDone[0] = 0;
      if (syncKey(r11x4[0]) === 0x007) rc0.freerun = false;

      // a mode write restarts the counter at 0
      r11x0[0] = -rc0.elapsed();
    },

    setTarget: (bits32) => {
      if (!bits32) bits32 = 0xffff;
      r11x8[0] = bits32;
    },

    setValue: (bits32) => {
      r11x0[0] = (bits32 & 0xffff) - rc0.elapsed();
    },

    onLimitReached: () => {
      // IRQ enables are checked per event in limitReached()
      cpu.istat |= 0x0010;
    },

    onScanLine: () => {
      const f = rc0.freerun;

      let cyclesToAdd = +0;

      switch (syncKey(r11x4[0])) {
        case 0x000: // free run
          cyclesToAdd = +(dot.stop - dot.start);
          break;
        case 0x001: // pause in hblank
          cyclesToAdd = +(dot.dispHStop - dot.dispHStart);
          break;

        case 0x003: // reset counter at hblank
        case 0x005: // reset counter at hblank, pause outside hblank
          // the value is derived from the position in the line; drop any
          // offset from a register write, the hblank reset has passed it
          r11x0[0] = +0;
          break;
        case 0x007: // pause until hblank then switch to free run
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
    vblank: false, // vblank state of the scanline that just finished

    elapsed: () => {
      switch ((r11x4[1] & 0x100) | syncKey(r11x4[1])) {
        case 0x000: // clock source, free run
          return +(psx.clock - dot.start);
        case 0x001: // clock source, pause in vblank
          return dot.isInVBlank() ? +0 : +psx.eventCycles(dot.event);
        case 0x003: // clock source, reset counter at vblank
          return +psx.eventCycles(dot.event);
        case 0x005: // clock source, reset counter at vblank, count only in vblank
          return dot.isInVBlank() ? +psx.eventCycles(dot.event) : +0;
        case 0x007: // clock source, pause until vblank then switch to free run
          return rc1.freerun ? +psx.eventCycles(dot.event) : +0;

        default: // h-blank source: only advances at scanline boundaries
          return +0;
      }
    },

    getValue: () => {
      return limitReached(1, rc1.elapsed());
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
      // keep bits 6/7 (repeat, toggle) and 9 (clock source) readable
      r11x4[1] = ((bits32 & 0x3ff) | (1 << 10)) >>> 0;
      irqDone[1] = 0;
      if (syncKey(r11x4[1]) === 0x007) rc1.freerun = false;

      // a mode write restarts the counter at 0
      r11x0[1] = -rc1.elapsed();
    },

    setTarget: (bits32) => {
      if (!bits32) bits32 = 0xffff;
      r11x8[1] = bits32 >>> 0;
    },

    setValue: (bits32) => {
      r11x0[1] = (bits32 & 0xffff) - rc1.elapsed();
    },

    onLimitReached: () => {
      // IRQ enables are checked per event in limitReached()
      cpu.istat |= 0x0020;
    },

    onScanLine: (isVBlankStart) => {
      const cyclesPerScanLine = +(dot.stop - dot.start);
      const wasVBlank = rc1.vblank;
      rc1.vblank = dot.isInVBlank();

      switch ((r11x4[1] & 0x100) | syncKey(r11x4[1])) {
        case 0x000: // clock source, free run
          r11x0[1] = limitReached(1, cyclesPerScanLine, rc1);
          break;
        case 0x001: // clock source, pause in vblank
          r11x0[1] = limitReached(1, dot.isInVBlank() ? +0 : cyclesPerScanLine, rc1);
          break;
        case 0x003: // clock source, reset counter at vblank
          r11x0[1] = limitReached(1, cyclesPerScanLine, rc1);
          if (isVBlankStart) r11x0[1] = 0;
          break;
        case 0x005: // clock source, reset counter at vblank, count only in vblank
          r11x0[1] = limitReached(1, wasVBlank ? cyclesPerScanLine : +0, rc1);
          if (isVBlankStart) r11x0[1] = 0;
          break;
        case 0x007: // clock source, pause until vblank then switch to free run
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

        case 0x100: // h-blank source, free run
          r11x0[1] = limitReached(1, +1, rc1);
          break;
        case 0x101: // h-blank source, pause in vblank
          r11x0[1] = limitReached(1, dot.isInVBlank() ? +0 : +1, rc1);
          break;
        case 0x103: // h-blank source, reset counter at vblank
          r11x0[1] = limitReached(1, +1, rc1);
          if (isVBlankStart) r11x0[1] = 0;
          break;
        case 0x105: // h-blank source, reset counter at vblank, count only in vblank
          r11x0[1] = limitReached(1, wasVBlank ? +1 : +0, rc1);
          if (isVBlankStart) r11x0[1] = 0;
          break;
        case 0x107: // h-blank source, pause until vblank then switch to free run
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
    // Timer 2 has no gate: sync modes 0 and 3 stop the counter, 1 and 2 (and
    // sync disabled) free run. Clock source 2/3 (bit 9) is sysclk/8.
    rate: () => {
      const sync = syncKey(r11x4[2]);
      if (sync === 0x001 || sync === 0x007) return +0;
      return (r11x4[2] & 0x200) ? +0.125 : +1.0;
    },

    elapsed: () => {
      return rc2.rate() * +(psx.clock - dot.start);
    },

    getValue: () => {
      return limitReached(2, rc2.elapsed());
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
      irqDone[2] = 0;

      // a mode write restarts the counter at 0
      r11x0[2] = -rc2.elapsed();
    },

    setTarget: (bits32) => {
      // todo: check setting target after setMode
      if (!bits32) bits32 = 0xffff;
      r11x8[2] = bits32 & 0xffff;
    },

    setValue: (bits32) => {
      r11x0[2] = (bits32 & 0xffff) - rc2.elapsed();
    },

    onLimitReached: () => {
      // IRQ enables are checked per event in limitReached()
      cpu.istat |= 0x0040;
    },

    onScanLine: () => {
      r11x0[2] = limitReached(2, rc2.rate() * +(dot.stop - dot.start), rc2);
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