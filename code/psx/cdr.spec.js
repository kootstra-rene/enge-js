mdlr('[test]enge:psx:cdr', ({ include, test }) => {

  const { describe, it, expect, beforeEach, before, after } = test;

  const PSX_SPEED = 44100 * 768;
  const SECTOR_SIZE = 2352;

  // cdr.js uses the emulator globals; provide minimal stand-ins.
  const globalNames = ['window', 'psx', 'cpu', 'PSX_SPEED', 'abort', 'hex', 'clearCodeCache'];
  const savedGlobals = {};
  const windowStubs = { location: { search: '' }, localStorage: { getItem: () => null } };
  const addedWindowStubs = [];

  const createScheduler = () => {
    const events = [];
    const psx = {
      clock: 0,
      addEvent: (clocks, cb) => {
        const event = { active: true, clock: psx.clock + clocks, cb };
        events.push(event);
        return event;
      },
      setEvent: (event, clocks) => {
        event.active = true;
        event.clock = psx.clock + clocks;
      },
      updateEvent: (event, clocks) => {
        event.active = true;
        event.clock += clocks;
      },
      unsetEvent: event => {
        event.active = false;
      },
      // Fires due events in clock order until `cycles` have passed.
      run: cycles => {
        const end = psx.clock + cycles;
        for (let guard = 0; guard < 100000; guard++) {
          const due = events.filter(event => event.active && event.clock <= end);
          if (!due.length) break;
          const next = due.reduce((a, b) => (b.clock < a.clock ? b : a));
          psx.clock = Math.max(psx.clock, next.clock);
          next.cb(next, psx.clock);
        }
        psx.clock = end;
      },
    };
    return psx;
  };

  // Mode 2 image whose user data (sector offset 24) is filled with `marker`.
  const createDisc = (marker, sectors = 16) => {
    const image = new Uint8Array(sectors * SECTOR_SIZE);
    for (let lba = 0; lba < sectors; lba++) {
      const sector = image.subarray(lba * SECTOR_SIZE, (lba + 1) * SECTOR_SIZE);
      sector.fill(0xFF, 1, 11);
      sector[0x0F] = 0x02;
      sector.fill(marker, 24, 24 + 2048);
    }
    return image;
  };

  const toc = sectors => [
    { id: 0, begin: 0, end: sectors },
    { id: 1, begin: 0, end: sectors, data: true },
  ];

  let psx;
  let cdr;

  const pendingInterrupt = () => {
    cdr.wr08r1800(1);
    const flags = cdr.rd08r1803() & 0x1F;
    cdr.wr08r1800(0);
    return flags;
  };

  // Runs the emulated clock until the controller raises an interrupt, then reads
  // and acknowledges the response like the BIOS does.
  const response = (maxCycles = 2 * PSX_SPEED) => {
    for (let spent = 0; !pendingInterrupt() && spent < maxCycles; spent += 0x1000) psx.run(0x1000);
    const int = pendingInterrupt();
    const results = [];
    while (cdr.rd08r1800() & 0x20) results.push(cdr.rd08r1801() & 0xFF);
    cdr.wr08r1800(1);
    cdr.wr08r1803(0x1F);
    cdr.wr08r1800(0);
    return { int, results };
  };

  const send = (command, ...params) => {
    cdr.wr08r1800(0);
    params.forEach(param => cdr.wr08r1802(param));
    cdr.wr08r1801(command);
    return response();
  };

  const readDataByte = () => {
    cdr.wr08r1800(0);
    cdr.wr08r1803(0x80);
    return cdr.rd08r1802() & 0xFF;
  };

  const insert = disc => {
    cdr.setCdImage(disc);
    cdr.setTOC(toc(disc.length / SECTOR_SIZE));
  };

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    if (typeof window === 'undefined') globalThis.window = {};
    for (const [name, stub] of Object.entries(windowStubs)) {
      if (window[name]) continue;
      window[name] = stub;
      addedWindowStubs.push(name);
    }
    globalThis.PSX_SPEED = PSX_SPEED;
    globalThis.clearCodeCache = () => {};
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    globalThis.hex = (value, length) => (value >>> 0).toString(16).padStart(length || 8, '0');
  });

  after(async () => {
    for (const name of addedWindowStubs) delete window[name];
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  beforeEach(async () => {
    psx = globalThis.psx = createScheduler();
    globalThis.cpu = { istat: 0 };
    ({ cdr } = include('enge:psx:cdr'));
    insert(createDisc(0xA1));
  });

  describe('shell closed', () => {

    it('should report the spindle motor running on GetStat', async () => {
      expect(send(0x01)).to.eql({ int: 3, results: [0x02] });
      expect(cdr.shellOpen).to.be.false;
    });

    it('should reset the controller when a new image is loaded', async () => {
      cdr.wr08r1800(0);
      cdr.wr08r1801(0x01);
      psx.run(0x10000);
      expect(pendingInterrupt()).to.eql(3);

      insert(createDisc(0xB2));
      expect(pendingInterrupt()).to.eql(0);
    });

  });

  describe('shell open', () => {

    it('should report shell open and motor stopped on GetStat', async () => {
      cdr.openShell();
      expect(cdr.shellOpen).to.be.true;
      expect(send(0x01)).to.eql({ int: 3, results: [0x10] });
    });

    it('should reject commands that need a disc with INT5 80h', async () => {
      cdr.openShell();
      expect(send(0x1A)).to.eql({ int: 5, results: [0x11, 0x80] }); // GetID
      expect(send(0x06)).to.eql({ int: 5, results: [0x11, 0x80] }); // ReadN
      expect(send(0x1E)).to.eql({ int: 5, results: [0x11, 0x80] }); // ReadTOC
    });

    it('should still accept commands that do not need a disc', async () => {
      cdr.openShell();
      expect(send(0x02, 0x00, 0x02, 0x00).int).to.eql(3); // Setloc
      expect(send(0x0E, 0x80).int).to.eql(3);             // Setmode
    });

    it('should abort a running read with INT5 08h', async () => {
      send(0x02, 0x00, 0x02, 0x00);
      expect(send(0x06).int).to.eql(3); // ReadN acknowledged
      cdr.openShell();
      expect(response()).to.eql({ int: 5, results: [0x11, 0x08] });
      psx.run(PSX_SPEED);
      expect(pendingInterrupt()).to.eql(0); // no more sectors are delivered
    });

    it('should keep the controller state when the disc is swapped', async () => {
      cdr.wr08r1800(0);
      cdr.wr08r1801(0x01);
      psx.run(0x10000);
      cdr.openShell();

      insert(createDisc(0xB2));
      expect(pendingInterrupt()).to.eql(3);
    });

  });

  describe('shell closed again', () => {

    it('should latch the shell open bit until the first GetStat', async () => {
      cdr.openShell();
      cdr.closeShell();
      expect(cdr.shellOpen).to.be.false;
      expect(send(0x01)).to.eql({ int: 3, results: [0x12] });
      expect(send(0x01)).to.eql({ int: 3, results: [0x02] });
    });

    it('should read from the new disc after a swap', async () => {
      expect(send(0x02, 0x00, 0x02, 0x00).int).to.eql(3);
      expect(send(0x06).int).to.eql(3);
      expect(response().int).to.eql(1);
      expect(readDataByte()).to.eql(0xA1);

      cdr.openShell();
      response(); // read aborted
      insert(createDisc(0xB2));
      cdr.closeShell();
      send(0x01);

      expect(send(0x02, 0x00, 0x02, 0x00).int).to.eql(3);
      expect(send(0x06).int).to.eql(3);
      expect(response().int).to.eql(1);
      expect(readDataByte()).to.eql(0xB2);
    });

    it('should identify the new disc on GetID', async () => {
      cdr.openShell();
      insert(createDisc(0xB2));
      cdr.closeShell();
      send(0x01);
      expect(send(0x1A).int).to.eql(3);
      expect(response().int).to.eql(2);
    });

    it('should keep the shell open for the requested delay', async () => {
      cdr.openShell();
      cdr.closeShell(PSX_SPEED);
      psx.run(PSX_SPEED - 1);
      expect(cdr.shellOpen).to.be.true;
      psx.run(1);
      expect(cdr.shellOpen).to.be.false;
    });

    it('should cancel a delayed close when the shell is opened again', async () => {
      cdr.openShell();
      cdr.closeShell(1000);
      cdr.openShell();
      psx.run(2000);
      expect(cdr.shellOpen).to.be.true;
    });

  });

  describe('save states', () => {

    it('should save and restore the shell state', async () => {
      cdr.openShell();
      const state = cdr.getState();
      expect(state.shellOpen).to.be.true;

      cdr.closeShell();
      cdr.setState(state);
      expect(cdr.shellOpen).to.be.true;
    });

    it('should treat states without shell information as closed', async () => {
      const state = cdr.getState();
      delete state.shellOpen;
      cdr.openShell();
      cdr.setState(state);
      expect(cdr.shellOpen).to.be.false;
    });

  });

  // Based on ps1-tests cdrom/timing and cdrom/getloc
  // (https://github.com/JaCzekanski/ps1-tests, MIT), captured on real hardware.
  // Hardware times are in CPU cycles; tolerances cover the spread in the logs.
  describe('hardware timing and getloc', () => {

    const timed = () => {
      const start = psx.clock;
      const { int, results } = response();
      return { int, results, cycles: psx.clock - start };
    };

    const sectorIntervals = count => {
      expect(send(0x02, 0x00, 0x02, 0x00).int).to.eql(3); // Setloc 00:02:00
      expect(send(0x06).int).to.eql(3);                   // ReadN
      expect(timed().int).to.eql(1);                      // first sector
      const intervals = [];
      for (let i = 0; i < count; ++i) {
        const { int, cycles } = timed();
        expect(int).to.eql(1);
        intervals.push(cycles);
      }
      return intervals.reduce((a, b) => a + b, 0) / count;
    };

    it('should deliver sectors every ~446000 cycles at single speed', async () => {
      // hardware: remaining sectors avg 446040..446224 cycles
      const average = sectorIntervals(5);
      expect(Math.abs(average - 446100) < 446100 * 0.03).to.be.true;
    });

    it('should deliver sectors every ~222000 cycles at double speed', async () => {
      // hardware: remaining sectors avg 222171..222386 cycles
      expect(send(0x0E, 0x80).int).to.eql(3); // Setmode double speed
      const average = sectorIntervals(5);
      expect(Math.abs(average - 222300) < 222300 * 0.03).to.be.true;
    });

    for (const [speed, mode] of [['single', 0x00], ['double', 0x80]]) {
      it(`should complete Pause after ~1000000 cycles at ${speed} speed`, async () => {
        // hardware: Pause Complete 1006472..1022496 (single), 1028832..1046336 (double)
        expect(send(0x0E, mode).int).to.eql(3);
        sectorIntervals(1);
        expect(send(0x09).int).to.eql(3);
        const { int, cycles } = timed();
        expect(int).to.eql(2);
        expect(cycles > 900000 && cycles < 1150000).to.be.true;
      });
    }

    it('should fail GetlocL with INT5 before any sector was read', async () => {
      // hardware: "GetlocL failed, IRQ = 5" right after the initial reset
      expect(send(0x10).int).to.eql(5);
    });

    it('should return the header of the last read sector on GetlocL', async () => {
      // hardware: after a seek/read GetlocL returns that sector's header (e.g. [00:02:16] mode 2)
      const bcd = v => ((v / 10) << 4) | (v % 10);
      const disc = createDisc(0xA1);
      for (let lba = 0; lba < disc.length / SECTOR_SIZE; lba++) {
        const msf = lba + 150;
        disc.set([bcd((msf / 4500) | 0), bcd(((msf / 75) | 0) % 60), bcd(msf % 75)], lba * SECTOR_SIZE + 12);
      }
      insert(disc);
      sectorIntervals(1);
      expect(send(0x09).int).to.eql(3);
      response();
      const { int, results } = send(0x10);
      expect(int).to.eql(3);
      expect(results.slice(0, 2)).to.eql([0x00, 0x02]);      // MM SS
      expect([0x00, 0x01, 0x02].includes(results[2])).to.be.true; // FF of a sector that was read
      expect(results[3]).to.eql(0x02);                        // mode 2
    });

  });

});
