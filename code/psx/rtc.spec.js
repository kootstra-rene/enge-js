mdlr('[test]enge:psx:rtc', ({ include, test }) => {

  const { describe, it, expect, beforeEach, before, after } = test;

  // Expected behaviour comes from ps1-tests timers/psx.log, captured on real
  // hardware (https://github.com/JaCzekanski/ps1-tests, MIT). The hardware
  // numbers include ~11 cycles of read overhead (1000 cycles reads as 1011);
  // the emulator has none, so rates are compared, not raw samples.

  const PSX_SPEED = 44100 * 768;
  const LINE = 3413 * 7 / 11; // NTSC scanline in CPU cycles

  const globalNames = ['psx', 'cpu', 'gpu', 'PSX_SPEED'];
  const savedGlobals = {};

  // gpu stub: display area and dot clock as gpu.js provides them
  const widths = [10, 7, 8, 7, 5, 7, 4, 7];
  const createGpu = () => {
    const gpu = {
      status: 0, dispL: 0x260, dispR: 0xc60, dispT: 16, dispB: 256,
      onScanLine: () => {},
      cyclesToDotClock: cycles => cycles * 11.0 / 7.0 / widths[(gpu.status >> 16) & 7],
    };
    return gpu;
  };

  // scheduler stub that fires the scanline event the way core.js does
  const createScheduler = () => {
    let event = null;
    const psx = {
      clock: 0,
      addEvent: (clocks, cb) => (event = { cb, start: psx.clock, clock: psx.clock + clocks }),
      updateEvent: (e, clocks) => { e.start = e.clock; e.clock += clocks; },
      eventCycles: e => psx.clock - e.start,
      advance: cycles => {
        const end = psx.clock + cycles;
        while (event && event.clock <= end) {
          psx.clock = event.clock;
          event.cb(event, psx.clock);
        }
        psx.clock = end;
      },
      nextLine: () => psx.advance(event.clock - psx.clock),
    };
    return psx;
  };

  let psx, rtc;

  const MODE = [0x1104, 0x1114, 0x1124];
  const VALUE = [0x1100, 0x1110, 0x1120];
  const TARGET = [0x1108, 0x1118, 0x1128];

  const setMode = (timer, mode) => rtc.wr32(MODE[timer], mode);
  const value = timer => rtc.rd32(VALUE[timer]) >> 0;

  // samples every `step` cycles, like the hardware test's delay loop
  const samples = (timer, count, step = 123) => {
    const out = [];
    for (let i = 0; i < count; ++i) { psx.advance(step); out.push(value(timer)); }
    return out;
  };

  const lines = n => { for (let i = 0; i < n; ++i) psx.nextLine(); };

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    globalThis.PSX_SPEED = PSX_SPEED;
  });

  after(async () => {
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  beforeEach(async () => {
    psx = globalThis.psx = createScheduler();
    globalThis.cpu = { istat: 0 };
    globalThis.gpu = createGpu();
    ({ rtc } = include('enge:psx:rtc'));
    psx.nextLine(); // establish the first scanline
    lines(20);      // move into the visible area
  });

  describe('clock sources', () => {

    it('should count the system clock one per cycle on all timers', async () => {
      for (const timer of [0, 1, 2]) {
        setMode(timer, 0x000);
        psx.advance(1000);
        expect(value(timer)).to.eql(1000);
        psx.advance(4000);
        expect(value(timer)).to.eql(5000);
      }
    });

    it('should count timer 0 at the dot clock for each horizontal resolution', async () => {
      // hardware, 320 wide: 1011 cycles -> 198, 5011 cycles -> 983
      const resolutions = [[0, 10], [2, 8], [1, 7], [4, 5], [6, 4]]; // GPUSTAT bits 16-18, divider
      for (const [hres, divider] of resolutions) {
        gpu.status = hres << 16;
        setMode(0, 0x100);
        psx.advance(5000);
        expect(value(0)).to.eql(Math.floor(5000 * 11 / 7 / divider));
      }
    });

    it('should count timer 1 once per scanline with the hblank source', async () => {
      // hardware: 1000 cycles -> 0 or 1, 5000 cycles -> 2 or 3, a frame -> 263
      setMode(1, 0x100);
      lines(3);
      expect(value(1)).to.eql(3);
      psx.advance(5000);
      expect(value(1) - 3).to.eql(Math.floor(5000 / LINE));
    });

    it('should count timer 2 at the system clock / 8', async () => {
      // hardware: 1011 cycles -> 126, 5011 cycles -> 626
      setMode(2, 0x200);
      psx.advance(5000);
      expect(value(2)).to.eql(625);
    });

  });

  describe('timer 0 sync modes (hblank gate)', () => {

    it('should reset at every hblank in sync mode 1', async () => {
      // hardware row: 242, 365, 488, 611, 46, 169, ... (drops at the hblank)
      setMode(0, 0x003);
      const row = samples(0, 40);
      expect(row.every(v => v >= 0 && v < LINE)).to.eql(true);
      expect(row.some((v, i) => i > 0 && v < row[i - 1])).to.eql(true);
    });

    it('should pause until the first hblank and then free run in sync mode 3', async () => {
      // hardware row: 0, 0, 0, 37, 160, 283, ... (starts once hblank occurred)
      psx.advance(100);
      setMode(0, 0x007);
      const row = samples(0, 40);
      const start = row.findIndex(v => v > 0);
      expect(start >= 0).to.eql(true);
      expect(row.slice(start + 1).every((v, i) => v > row[start + i])).to.eql(true);
    });

  });

  describe('timer 1 sync modes (vblank gate)', () => {

    it('should free run outside vblank in sync modes 0 and 1', async () => {
      // hardware rows: 248, 371, 494, ... (no vblank during the samples)
      for (const mode of [0x001, 0x003]) {
        setMode(1, mode);
        psx.advance(1000);
        expect(value(1)).to.eql(1000);
      }
    });

    it('should hold 0 outside vblank in sync modes 2 and 3', async () => {
      // hardware rows: all 0
      for (const mode of [0x005, 0x007]) {
        setMode(1, mode);
        expect(samples(1, 10).every(v => v === 0)).to.eql(true);
      }
    });

    it('should count during vblank in sync mode 2', async () => {
      setMode(1, 0x005);
      lines(236 + 3); // into vblank (display ends at line 256)
      expect(value(1) > 0).to.eql(true);
    });

  });

  describe('timer 2 sync modes', () => {

    it('should stop in sync modes 0 and 3', async () => {
      // hardware rows: all 0
      for (const mode of [0x001, 0x007]) {
        setMode(2, mode);
        expect(samples(2, 10).every(v => v === 0)).to.eql(true);
      }
    });

    it('should free run in sync modes 1 and 2', async () => {
      // hardware rows: 248, 371, 494, ... (123 cycles apart)
      for (const mode of [0x003, 0x005]) {
        setMode(2, mode);
        expect(samples(2, 10)).to.eql([123, 246, 369, 492, 615, 738, 861, 984, 1107, 1230]);
      }
    });

  });

  describe('reset at target (timer 2, target = 10)', () => {

    // hardware: every value 0..10 lasts the same time, 11 is never seen,
    // reached target = 1, reached 0xffff = 0
    it('should show the target value and wrap to 0 without reaching target + 1', async () => {
      rtc.wr32(TARGET[2], 10);
      setMode(2, 0x008);
      const seen = new Set();
      for (let i = 0; i < 40; ++i) { psx.advance(1); seen.add(value(2)); }
      expect([...seen].sort((a, b) => a - b)).to.eql([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('should set reached target and not reached 0xffff', async () => {
      rtc.wr32(TARGET[2], 10);
      setMode(2, 0x008);
      lines(1);
      const mode = rtc.rd32(MODE[2]);
      expect([(mode >> 11) & 1, (mode >> 12) & 1]).to.eql([1, 0]);
    });

    it('should clear the reached bits when the mode is read', async () => {
      rtc.wr32(TARGET[2], 10);
      setMode(2, 0x008);
      lines(1);
      rtc.rd32(MODE[2]);
      expect((rtc.rd32(MODE[2]) >> 11) & 3).to.eql(0);
    });

  });

  describe('interrupts', () => {

    it('should raise the target IRQ without reset at target', async () => {
      rtc.wr32(TARGET[2], 1000);
      setMode(2, 0x010);
      lines(2);
      expect(cpu.istat & 0x40).to.eql(0x40);
    });

    it('should not raise an overflow-only IRQ at the target', async () => {
      rtc.wr32(TARGET[2], 1000);
      setMode(2, 0x028);
      lines(4);
      expect(cpu.istat & 0x40).to.eql(0);
    });

    it('should raise a one-shot IRQ only once per mode write', async () => {
      rtc.wr32(TARGET[2], 1000);
      setMode(2, 0x018);
      lines(2);
      expect(cpu.istat & 0x40).to.eql(0x40);
      cpu.istat = 0;
      lines(4);
      expect(cpu.istat & 0x40).to.eql(0);
    });

    it('should keep raising IRQs in repeat mode', async () => {
      rtc.wr32(TARGET[2], 1000);
      setMode(2, 0x058);
      lines(2);
      cpu.istat = 0;
      lines(4);
      expect(cpu.istat & 0x40).to.eql(0x40);
    });

  });

  describe('register writes', () => {

    it('should restart the counter at 0 on a mode write', async () => {
      psx.advance(1000);
      setMode(0, 0x000);
      psx.advance(10);
      expect(value(0)).to.eql(10);
    });

    it('should read back a counter value written mid-scanline', async () => {
      setMode(2, 0x000);
      psx.advance(500);
      rtc.wr32(VALUE[2], 100);
      psx.advance(10);
      expect(value(2)).to.eql(110);
      psx.nextLine();
      expect(value(2) > 110).to.eql(true);
    });

    it('should keep mode bits 0-9 readable on all timers', async () => {
      for (const timer of [0, 1, 2]) {
        setMode(timer, 0x2d8);
        expect(rtc.rd32(MODE[timer]) & 0x3ff).to.eql(0x2d8);
      }
    });

  });

})
