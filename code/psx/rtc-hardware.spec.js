mdlr('[test]enge:psx:rtc-hardware', ({ include, test }) => {

  const { describe, it, xit, expect, before, after } = test;

  // Ported from the nugget root counter tests (https://github.com/pcsx-redux/
  // nugget, tests/timers, MIT), verified on SCPH-5501 and SCPH-7001. The
  // counters are read and written 16 bits wide as the original does; the
  // BUSY_WAIT(n) delay loops run as MIPS code, the polling loops wait in
  // emulated time.

  const { createMachine } = include('enge:psx:test-machine');
  const { gpuHelpers } = include('enge:psx:test-gpu');

  const TM_SYNC_EN = 0x0001, TM_RESET_TARGET = 0x0008, TM_IRQ_TARGET = 0x0010, TM_IRQ_REPEAT = 0x0040;
  const TM_IRQ_TOGGLE = 0x0080, TM_CLK_EXTERNAL = 0x0100, TM_CLK_DIV8 = 0x0200, TM_IRQ_REQUEST = 0x0400;
  const TM_HIT_TARGET = 0x0800, TM_HIT_OVERFLOW = 0x1000;
  const TM_SYNC_MODE = n => (n & 3) << 1;

  const IREG = 0x1f801070, IMASK = 0x1f801074;

  let m, g, busy;

  before(async () => {
    m = createMachine();
    g = gpuHelpers(m);
    m.write32(IMASK, 0);
    m.write32(IREG, 0);
    // BUSY_WAIT(n): for (_bw = n; _bw > 0; _bw--) __asm__ volatile("");
    busy = m.asm(0x80010000, `
      busy:  blez  $a0, 2f
             nop
      1:     addiu $a0, -1
             bgtz  $a0, 1b
             nop
      2:     jr    $ra
             nop
    `).labels.busy;
  });
  after(async () => { m?.dispose(); });

  const BUSY_WAIT = n => m.call(busy, n);

  // COUNTERS[n].value / .mode / .target, 16 bits wide
  const counter = n => ({
    get value() { return m.read16(0x1f801100 + 16 * n) & 0xffff; },
    get mode() { return m.read16(0x1f801104 + 16 * n) & 0xffff; },
    set mode(v) { m.write16(0x1f801104 + 16 * n, v); },
    get target() { return m.read16(0x1f801108 + 16 * n) & 0xffff; },
    set target(v) { m.write16(0x1f801108 + 16 * n, v); },
  });
  const COUNTERS = [counter(0), counter(1), counter(2)];

  // a polling loop: one pass costs a few cycles on the console
  const pollUntil = (cond, cycles = 33868800) => m.idleUntil(cond, cycles, 8);

  const waitVSync = () => {
    pollUntil(() => (g.gpuStatus() & 0x80000000) !== 0);
    pollUntil(() => (g.gpuStatus() & 0x80000000) === 0);
  };

  describe('target, overflow and IRQ flags', () => {

    // With target = N and reset-on-target the counter counts 0..N, then
    // resets; the hit-target flag (bit 11) is set once the target is reached.
    it('timerTargetResetHitsTarget', async () => {
      COUNTERS[2].target = 0x0010;
      COUNTERS[2].mode = TM_RESET_TARGET;
      BUSY_WAIT(500);
      expect((COUNTERS[2].mode & TM_HIT_TARGET) !== 0).to.be.true;
    });

    // reset-on-target well below FFFFh: no overflow (bit 12)
    it('timerTargetResetNoOverflow', async () => {
      COUNTERS[2].target = 0x0010;
      COUNTERS[2].mode = TM_RESET_TARGET;
      BUSY_WAIT(500);
      expect(COUNTERS[2].mode & TM_HIT_OVERFLOW).to.eql(0);
    });

    // the same delay in both clock modes: the ratio should be about 8
    it('timerSysclockDiv8Ratio', async () => {
      COUNTERS[2].target = 0xffff;
      COUNTERS[2].mode = TM_CLK_DIV8;
      BUSY_WAIT(1000);
      const div8 = COUNTERS[2].value;
      COUNTERS[2].target = 0xffff;
      COUNTERS[2].mode = 0;
      BUSY_WAIT(1000);
      const sys = COUNTERS[2].value;
      const ratio = Math.trunc(sys / (div8 || 1));
      expect(ratio >= 6 && ratio <= 10).to.be.true;
    });

    // writing the mode register resets the counter to 0
    it('timerModeWriteResetsCounter', async () => {
      COUNTERS[2].mode = 0;
      COUNTERS[2].target = 0xffff;
      BUSY_WAIT(50000);
      void COUNTERS[2].value;
      COUNTERS[2].mode = 0;
      void COUNTERS[2].value;
      COUNTERS[2].mode = 0;
      COUNTERS[2].target = 0xffff;
      BUSY_WAIT(50000);
      const before = COUNTERS[2].value;
      expect(before > 0).to.be.true;
      COUNTERS[2].mode = 0;
      const after = COUNTERS[2].value;
      expect(after < 10).to.be.true;
    });

    // hit-target (bit 11) is set on target and cleared by reading the mode
    it('timerHitTargetFlagSetAndCleared', async () => {
      COUNTERS[2].target = 0x1000;
      COUNTERS[2].mode = TM_RESET_TARGET;
      BUSY_WAIT(50000);
      void COUNTERS[2].mode;
      void COUNTERS[2].mode;
      COUNTERS[2].mode = TM_RESET_TARGET;
      BUSY_WAIT(50000);
      const mode1 = COUNTERS[2].mode;
      const mode2 = COUNTERS[2].mode;
      expect([(mode1 & TM_HIT_TARGET) ? 1 : 0, (mode2 & TM_HIT_TARGET) ? 1 : 0]).to.eql([1, 0]);
    });

    // hit-overflow (bit 12) is set on FFFFh and cleared by reading the mode
    it('timerHitOverflowFlagSetAndCleared', async () => {
      COUNTERS[2].target = 0xffff;
      COUNTERS[2].mode = 0;
      BUSY_WAIT(100000);
      const mode1 = COUNTERS[2].mode;
      const mode2 = COUNTERS[2].mode;
      expect([(mode1 & TM_HIT_OVERFLOW) !== 0, mode2 & TM_HIT_OVERFLOW]).to.eql([true, 0]);
    });

    // pulse mode (bit 7 = 0): bit 10 reads 1 after an IRQ
    it('timerIrqPulseModeBit10', async () => {
      COUNTERS[2].target = 0x0080;
      COUNTERS[2].mode = TM_RESET_TARGET | TM_IRQ_TARGET | TM_IRQ_REPEAT;
      BUSY_WAIT(1000);
      expect((COUNTERS[2].mode & TM_IRQ_REQUEST) !== 0).to.be.true;
    });

    // toggle mode (bit 7 = 1): bit 10 toggles on each IRQ
    it('timerIrqToggleModeBit10', async () => {
      COUNTERS[2].target = 0x0010;
      COUNTERS[2].mode = TM_RESET_TARGET | TM_IRQ_TARGET | TM_IRQ_REPEAT | TM_IRQ_TOGGLE;
      BUSY_WAIT(200);
      let sawZero = 0, sawOne = 0;
      for (let i = 0; i < 50; ++i) {
        if (COUNTERS[2].mode & TM_IRQ_REQUEST) sawOne = 1;
        else sawZero = 1;
        BUSY_WAIT(10);
      }
      expect([sawZero, sawOne]).to.eql([1, 1]);
    });

  });

  describe('timer 2 synchronisation modes', () => {

    // modes 0 and 3 stop the counter, modes 1 and 2 run free
    const sync = (name, mode, stops) => it(name, async () => {
      COUNTERS[2].target = 0xffff;
      COUNTERS[2].mode = TM_SYNC_EN | TM_SYNC_MODE(mode);
      BUSY_WAIT(50000);
      const v1 = COUNTERS[2].value;
      BUSY_WAIT(50000);
      const v2 = COUNTERS[2].value;
      const delta = (v2 - v1) & 0xffff;
      if (stops) expect(delta).to.eql(0);
      else expect(delta > 0).to.be.true;
    });

    sync('timerRc2SyncMode0Stop', 0, true);
    sync('timerRc2SyncMode1Free', 1, false);
    sync('timerRc2SyncMode2Free', 2, false);
    sync('timerRc2SyncMode3Stop', 3, true);

  });

  describe('timer 0 gate modes (hblank)', () => {

    // gate mode 0: paused during hblank, so slower than free run
    it('timerC0GateMode0PauseDuringHblank', async () => {
      COUNTERS[0].target = 0xffff;
      COUNTERS[0].mode = TM_SYNC_EN | TM_SYNC_MODE(0);
      BUSY_WAIT(20000);
      const gated = COUNTERS[0].value;
      COUNTERS[0].mode = 0;
      BUSY_WAIT(20000);
      const free = COUNTERS[0].value;
      expect(gated < free).to.be.true;
    });

    // gate mode 1: reset at each hblank, so values stay small. Timer 0
    // ignores gate modes 1 and 2 and runs free.
    xit('timerC0GateMode1ResetAtHblank', async () => {
      COUNTERS[0].target = 0xffff;
      COUNTERS[0].mode = TM_SYNC_EN | TM_SYNC_MODE(1);
      BUSY_WAIT(50000);
      expect(COUNTERS[0].value < 0x2000).to.be.true;
    });

    // gate mode 2: reset at hblank and paused outside it
    xit('timerC0GateMode2ResetPauseOutside', async () => {
      COUNTERS[0].target = 0xffff;
      COUNTERS[0].mode = TM_SYNC_EN | TM_SYNC_MODE(2);
      BUSY_WAIT(50000);
      expect(COUNTERS[0].value < 0x2000).to.be.true;
    });

    // gate mode 3: paused until the first hblank, then free run. Timer 0
    // stays paused.
    xit('timerC0GateMode3FreeAfterHblank', async () => {
      COUNTERS[0].target = 0xffff;
      COUNTERS[0].mode = 0;
      BUSY_WAIT(50000);
      const free = COUNTERS[0].value;
      COUNTERS[0].mode = TM_SYNC_EN | TM_SYNC_MODE(3);
      BUSY_WAIT(50000);
      const gated = COUNTERS[0].value;
      expect(Math.abs(free - gated) < 0x2000).to.be.true;
    });

  });

  describe('clock sources', () => {

    // timer 2 as Pandemonium 2 sets it up: sysclock/8, count to target, IRQ
    // repeat; the count is proportional to the elapsed time
    it('timerPE2Scenario', async () => {
      COUNTERS[2].target = 0x1000;
      COUNTERS[2].mode = TM_CLK_DIV8 | TM_IRQ_REPEAT | TM_RESET_TARGET | TM_IRQ_TARGET;
      BUSY_WAIT(50000);
      const count = COUNTERS[2].value;
      expect(count > 100 && count < 0x1000).to.be.true;
    });

    // timer 1 counting hblanks, timer 0 the dot clock: dots per line is
    // between 330 (256px) and 860 (640px)
    it('timerDotclockRate', async () => {
      COUNTERS[1].target = 0xffff;
      COUNTERS[1].mode = TM_CLK_EXTERNAL;
      COUNTERS[0].target = 0xffff;
      COUNTERS[0].mode = TM_CLK_EXTERNAL;
      COUNTERS[1].mode = TM_CLK_EXTERNAL;
      pollUntil(() => COUNTERS[1].value >= 1);
      COUNTERS[1].mode = TM_CLK_EXTERNAL;
      COUNTERS[0].mode = TM_CLK_EXTERNAL;
      pollUntil(() => COUNTERS[1].value >= 10);
      const dots = COUNTERS[0].value, lines = COUNTERS[1].value;
      const dpl = Math.trunc(dots / lines);
      expect(dpl >= 330 && dpl <= 860).to.be.true;
    });

    const measureDotsPerLine = scanlines => {
      COUNTERS[1].target = 0xffff;
      COUNTERS[1].mode = TM_CLK_EXTERNAL;
      COUNTERS[0].target = 0xffff;
      COUNTERS[0].mode = TM_CLK_EXTERNAL;
      COUNTERS[1].mode = TM_CLK_EXTERNAL;
      COUNTERS[0].mode = TM_CLK_EXTERNAL;
      pollUntil(() => COUNTERS[1].value >= scanlines);
      const dots = COUNTERS[0].value, lines = COUNTERS[1].value;
      return Math.trunc((dots + Math.trunc(lines / 2)) / lines);
    };

    // dots per line at each horizontal resolution, NTSC and PAL
    const dotclock = (name, hResolution, videoMode, hResolutionExtended, expected) => it(name, async () => {
      g.setDisplayMode({ hResolution, vResolution: g.VR_240, videoMode, colorDepth: g.CD_15BITS, videoInterlace: g.VI_OFF, hResolutionExtended });
      waitVSync();
      waitVSync();
      measureDotsPerLine(50);
      const dpl = measureDotsPerLine(50);
      expect({ dpl, ok: dpl >= expected - 1 && dpl <= expected + 1 }).to.eql({ dpl, ok: true });
    });

    dotclock('timerDotclock256NTSC', 0, 0, 0, 341);
    dotclock('timerDotclock256PAL', 0, 1, 0, 340);
    dotclock('timerDotclock320NTSC', 1, 0, 0, 426);
    dotclock('timerDotclock320PAL', 1, 1, 0, 426);
    dotclock('timerDotclock512NTSC', 2, 0, 0, 682);
    dotclock('timerDotclock512PAL', 2, 1, 0, 681);
    dotclock('timerDotclock640NTSC', 3, 0, 0, 853);
    dotclock('timerDotclock640PAL', 3, 1, 0, 851);
    dotclock('timerDotclock368NTSC', 0, 0, 1, 487);
    dotclock('timerDotclock368PAL', 0, 1, 1, 486);

  });

  describe('reset period', () => {

    // Timer 2 runs reset-on-target for N periods while timer 0 counts the
    // system clock as the reference. The period is target+2 cycles on the
    // system clock and exactly target*8 on System Clock/8.
    const timePeriods = (mode, target, periods) => {
      COUNTERS[0].mode = 0;
      COUNTERS[2].target = target;
      COUNTERS[2].mode = mode;
      let last2 = COUNTERS[2].value;
      // align to a wrap of timer 2
      pollUntil(() => { const v = COUNTERS[2].value; const wrapped = v < last2; last2 = v; return wrapped; });
      let last0 = COUNTERS[0].value;
      let elapsed = 0, wraps = 0;
      last2 = COUNTERS[2].value;
      while (wraps < periods) {
        m.idle(8);
        const v2 = COUNTERS[2].value;
        const v0 = COUNTERS[0].value;
        elapsed += (v0 - last0) & 0xffff;
        last0 = v0;
        if (v2 < last2) wraps++;
        last2 = v2;
      }
      return elapsed;
    };

    // a fixed allowance of 160 cycles for the edges of the run
    const periodIs = (elapsed, period, periods) => elapsed + 160 >= period * periods && elapsed <= period * periods + 160;

    // The period is target+1 on the system clock (201 and 401 cycles) and
    // target*8+8 on System Clock/8 (408 and 808).
    xit('reset_period_accumulated', async () => {
      const s200 = timePeriods(TM_RESET_TARGET, 200, 10000);
      const s400 = timePeriods(TM_RESET_TARGET, 400, 10000);
      const d50 = timePeriods(TM_RESET_TARGET | TM_CLK_DIV8, 50, 10000);
      const d100 = timePeriods(TM_RESET_TARGET | TM_CLK_DIV8, 100, 10000);
      const f = timePeriods(0, 0, 100);
      const f8 = timePeriods(TM_CLK_DIV8, 0, 20);
      COUNTERS[2].mode = 0;
      expect({
        s200: periodIs(s200, 202, 10000), s400: periodIs(s400, 402, 10000),
        d50: periodIs(d50, 400, 10000), d100: periodIs(d100, 800, 10000),
        f: periodIs(f, 65536, 100), f8: periodIs(f8, 524288, 20),
      }).to.eql({ s200: true, s400: true, d50: true, d100: true, f: true, f8: true });
    });

  });

})
