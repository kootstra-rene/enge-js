mdlr('enge:psx:rtc', ({ include }) => {

  const r11x0 = new Float64Array(3); // counter value at last[n]
  const r11x4 = new Uint32Array(3);  // mode
  const r11x8 = new Uint32Array(3);  // target
  const last = new Float64Array(3);  // psx clock the counter has been advanced to
  const due = new Float64Array(3);   // psx clock of the next possible IRQ
  const irqDone = new Uint8Array(3); // one-shot IRQ already raised since mode write
  const freerun = new Uint8Array(3); // sync mode 3: gate started since mode write

  const IRQ = [0x0010, 0x0020, 0x0040];
  const IDLE = +Number.MAX_SAFE_INTEGER;

  // Mode bit 10 is the inverted IRQ line. In pulse mode (bit 7 clear) it only
  // drops for a few cycles, so it reads as 1; in toggle mode it flips on every
  // event. I_STAT is edge triggered and set when the line goes active.
  const raiseIrq = (id) => {
    if (r11x4[id] & 0x080) {
      r11x4[id] ^= 0x400;
      cpu.setIrqLine(IRQ[id], !(r11x4[id] & 0x400));
    }
    else {
      cpu.setIrqLine(IRQ[id], true);
      cpu.setIrqLine(IRQ[id], false);
    }
  }

  // Advances counter `id` by `increment` and detects the target and overflow
  // events separately (mode bit 11 = reached target, bit 12 = reached 0xffff).
  // The IRQ enable for each event that occurred is checked (bit 4 = IRQ at
  // target, bit 5 = IRQ at 0xffff).
  const limitReached = (id, increment) => {
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

    if ((hitTarget && (mode & 0x010)) || (hitOverflow && (mode & 0x020))) {
      // bit 6 clear = one-shot: only the first IRQ after a mode write is raised
      if ((mode & 0x040) || !irqDone[id]) {
        irqDone[id] = 1;
        raiseIrq(id);
      }
    }
    return value;
  }

  // Number of counter ticks until the next enabled IRQ event.
  const ticksToIrq = (id) => {
    const mode = r11x4[id];
    const target = +r11x8[id];
    const value = +r11x0[id];

    let ticks = Infinity;
    if (mode & 0x008) {
      const limit = +(target + 1.0);
      if ((mode & 0x010) || ((mode & 0x020) && (limit >= 0x10000))) {
        ticks = limit - value;
      }
    }
    else {
      if (mode & 0x010) {
        ticks = (value < target) ? (target - value) : (0x10000 - value + target);
      }
      if (mode & 0x020) {
        ticks = Math.min(ticks, 0x10000 - value);
      }
    }
    return ticks;
  }

  // Sync mode bits (0-2) only matter while sync is enabled (bit 0); with sync
  // disabled every combination behaves as free running (key 0).
  const syncKey = (mode) => (mode & 0x001) ? (mode & 0x007) : 0x000;

  // Counter ticks per CPU cycle, ignoring the gate. Timer 1 with the hblank
  // source ticks once per scanline instead (see dot.complete).
  const rate = (id) => {
    const mode = r11x4[id];
    switch (id) {
      case 0: return (mode & 0x100) ? +gpu.cyclesToDotClock(1.0) : +1.0;
      case 1: return (mode & 0x100) ? +0.0 : +1.0;
      case 2: return (mode & 0x200) ? +0.125 : +1.0;
    }
  }

  // Gate of timer 0 is hblank, of timer 1 vblank. Timer 2 has no gate.
  const gateAt = (id, clock) => {
    switch (id) {
      case 0: return (clock < dot.dispHStart) || (clock >= dot.dispHStop);
      case 1: return dot.vblank;
    }
    return false;
  }

  const counting = (id, gate) => {
    const sync = syncKey(r11x4[id]);
    if (id === 2) {
      // sync modes 0 and 3 stop the counter, 1 and 2 free run
      return (sync !== 0x001) && (sync !== 0x007);
    }
    switch (sync) {
      case 0x001: return !gate;          // pause during the gate
      case 0x005: return gate;           // count only during the gate
      case 0x007: return !!freerun[id];  // pause until the gate starts once
    }
    return true;
  }

  const gateStart = (id) => {
    switch (syncKey(r11x4[id])) {
      case 0x005: r11x0[id] = +0; break;  // reset and run while the gate is active
      case 0x007: freerun[id] = 1; break; // switch to free run
    }
  }

  const gateEnd = (id) => {
    // sync mode 1 resets the counter at the end of the gate
    if (syncKey(r11x4[id]) === 0x003) r11x0[id] = +0;
  }

  const run = (id, cycles, gate) => {
    if (cycles > 0 && counting(id, gate)) {
      const ticks = +(cycles * rate(id));
      if (ticks > 0) r11x0[id] = limitReached(id, ticks);
    }
  }

  // Advances counter `id` from last[id] to `clock`, splitting the time at the
  // hblank edges of the current scanline for timer 0. Vblank edges only occur
  // at scanline boundaries and are handled in dot.complete.
  const sync = (id, clock = psx.clock) => {
    let t = +last[id];
    if (clock <= t) return;

    if (id === 0) {
      if (t < dot.dispHStart && dot.dispHStart <= clock) {
        run(0, dot.dispHStart - t, gateAt(0, t));
        gateEnd(0);
        t = +dot.dispHStart;
      }
      if (t < dot.dispHStop && dot.dispHStop <= clock) {
        run(0, dot.dispHStop - t, gateAt(0, t));
        gateStart(0);
        t = +dot.dispHStop;
      }
    }
    run(id, clock - t, gateAt(id, t));
    last[id] = +clock;
  }

  // Determines when counter `id` can raise its next IRQ. Events that turn out
  // early (the gate paused or reset the counter) just plan again; they are
  // never late, so IRQs arrive at the exact cycle.
  const plan = (id) => {
    due[id] = Infinity;

    const mode = r11x4[id];
    if (!(mode & 0x030)) return;
    if (!(mode & 0x040) && irqDone[id]) return;

    const t = +last[id];
    if (!counting(id, gateAt(id, t))) {
      // paused by the hblank gate: look again when it changes; other gates
      // only change at scanline boundaries
      if (id === 0) {
        if (t < dot.dispHStart) due[0] = +dot.dispHStart;
        else if (t < dot.dispHStop) due[0] = +dot.dispHStop;
      }
      return;
    }

    const ticksPerCycle = rate(id);
    if (!ticksPerCycle) return; // hblank source: ticks at scanline boundaries

    due[id] = t + Math.max(1.0, Math.ceil(ticksToIrq(id) / ticksPerCycle));
  }

  const reschedule = () => {
    const clock = Math.min(due[0], due[1], due[2]);
    psx.setEvent(irqEvent, (clock === Infinity) ? IDLE : Math.max(0.0, clock - psx.clock));
  }

  const getValue = (id) => {
    sync(id);
    return r11x0[id] & 0xffff;
  }

  const getMode = (id) => {
    sync(id);
    const result = r11x4[id];
    r11x4[id] &= 0xe7ff;
    return result;
  }

  const setMode = (id, bits32) => {
    sync(id);
    // reached bits 11/12 are kept; they only clear when the mode is read
    r11x4[id] = ((bits32 & 0xe3ff) | (1 << 10) | (r11x4[id] & 0x1800)) >>> 0;
    irqDone[id] = 0;
    freerun[id] = 0;
    cpu.setIrqLine(IRQ[id], false);

    // a mode write restarts the counter at 0
    r11x0[id] = +0;
    plan(id);
    reschedule();
  }

  const setTarget = (id, bits32) => {
    sync(id);
    r11x8[id] = bits32 & 0xffff;
    plan(id);
    reschedule();
  }

  const setValue = (id, bits32) => {
    sync(id);
    r11x0[id] = bits32 & 0xffff;
    plan(id);
    reschedule();
  }

  const MAX_SAFE_INTEGER = +Number.MAX_SAFE_INTEGER;

  const dot = {
    event: null,
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
      // finish the scanline that just ended with its own geometry
      const end = +self.clock;
      sync(0, end);
      sync(1, end);
      sync(2, end);

      // timer 1 with the hblank source ticks once per scanline
      if ((r11x4[1] & 0x100) && counting(1, dot.vblank)) {
        r11x0[1] = limitReached(1, +1.0);
      }

      dot.upateToLastGpuState(self);

      const wasVBlank = dot.vblank;
      const linesPerFrame = ((gpu.status >> 20) & 1) ? 314 : 263;
      dot.scanLine = (dot.scanLine + 1) % linesPerFrame;
      dot.vblank = (dot.scanLine < gpu.dispT) || (dot.scanLine >= gpu.dispB);

      if (!wasVBlank && dot.vblank) gateStart(1);
      if (wasVBlank && !dot.vblank) gateEnd(1);

      plan(0);
      plan(1);
      plan(2);
      reschedule();

      gpu.onScanLine(dot.scanLine);

      let scanlineCycles = dot.stop - dot.start;
      psx.updateEvent(self, +scanlineCycles);
    },
  }

  const rtc = {
    rd32: (reg) => {
      const id = (reg >> 4) & 3;
      switch (reg & 0xf) {
        case 0x0: return getValue(id);
        case 0x4: return getMode(id);
        case 0x8: return r11x8[id];
      }
    },
    wr32: (reg, data) => {
      const id = (reg >> 4) & 3;
      switch (reg & 0xf) {
        case 0x0: return setValue(id, data);
        case 0x4: return setMode(id, data);
        case 0x8: return setTarget(id, data);
      }
    }
  };

  dot.event = psx.addEvent(0, dot.complete.bind(dot));

  // fires when a counter may raise its next IRQ
  const irqEvent = psx.addEvent(0, () => {
    const clock = +psx.clock;
    for (let id = 0; id < 3; ++id) {
      if (due[id] <= clock) {
        sync(id);
        plan(id);
      }
    }
    reschedule();
  });

  r11x0.fill(0);
  r11x4.fill(1 << 10);
  r11x8.fill(0xffff);
  due.fill(Infinity);

  return { rtc };

})
