mdlr('[test]enge:psx:serial-hardware', ({ include, test }) => {

  const { describe, it, xit, expect, before, after } = test;

  // Ported from the nugget serial port tests (https://github.com/pcsx-redux/
  // nugget, tests/sio-reset and tests/rumble, MIT), verified on real
  // hardware with a DualShock in port 1.

  const { createMachine } = include('enge:psx:test-machine');

  const IREG = 0x1f801070, IMASK = 0x1f801074;
  const IRQ_CONTROLLER = 1 << 7;
  const SIO_CTRL_TXEN = 1 << 0, SIO_CTRL_DTR = 1 << 1, SIO_CTRL_ERRRES = 1 << 4;
  const SIO_STAT_RXRDY = 1 << 1;

  const hex = (v, n = 4) => '0x' + (v >>> 0).toString(16).padStart(n, '0');

  let m;
  after(async () => { m?.dispose(); });

  // SIOS[p]: fifo (8 bit), stat, mode, ctrl, baud (16 bit)
  const sio = p => {
    const b = 0x1f801040 + 16 * p;
    return {
      get fifo() { return m.read8(b) & 0xff; },
      set fifo(v) { m.write8(b, v); },
      get stat() { return m.read16(b + 4) & 0xffff; },
      get stat32() { return m.read32(b + 4) >>> 0; },
      get mode() { return m.read16(b + 8) & 0xffff; },
      set mode(v) { m.write16(b + 8, v); },
      get ctrl() { return m.read16(b + 10) & 0xffff; },
      set ctrl(v) { m.write16(b + 10, v); },
      get baudRate() { return m.read16(b + 14) & 0xffff; },
      set baudRate(v) { m.write16(b + 14, v); },
    };
  };

  describe('SIO_CTRL bit 6 reset (sio-reset)', () => {

    before(async () => { m = createMachine(); });

    // Write mode, baud and control, then reset with control bit 6: the
    // status reads 005h (DSR/CTS, bits 7-8, are live inputs and left out),
    // mode, control and baud read 0, and stay 0 when control is rewritten.
    const port = (p, mode, ctrl, baud) => {
      const s = sio(p);
      s.mode = mode;
      s.baudRate = baud;
      s.ctrl = ctrl;
      s.ctrl = ctrl | 0x40;
      const after = { stat: hex(s.stat32 & 0x27f, 3), mode: hex(s.mode), ctrl: hex(s.ctrl), baud: hex(s.baudRate) };
      s.ctrl = ctrl;
      const rewrite = { mode: hex(s.mode), baud: hex(s.baudRate) };
      return { after, rewrite };
    };

    const reset = { after: { stat: '0x005', mode: '0x0000', ctrl: '0x0000', baud: '0x0000' }, rewrite: { mode: '0x0000', baud: '0x0000' } };

    // writing a SIO mode other than 000Dh stops the emulator
    // (serial.js wr16r1048: abort)
    xit('resets port 0', async () => {
      expect(port(0, 0x003d, 0x1c01, 0x0088)).to.eql(reset);
    });

    // SIO1 (1F801050h) is not emulated: its status reads 0, without the TX
    // ready and TX empty bits
    xit('resets port 1', async () => {
      expect(port(1, 0x007e, 0x0c27, 0x0012)).to.eql(reset);
    });

  });

  describe('DualShock motor mapping, command 4Dh (rumble)', () => {

    // Command 4Dh on a DualShock is a get/set: the nine byte transfer carries
    // six new motor mapping bytes out and returns the six that were in
    // effect before it.
    //
    //   Send  01h 4Dh 00h aa  bb  cc  dd  ee  ff
    //   Reply Hiz F3h 5Ah aa  bb  cc  dd  ee  ff   <- the OLD aa..ff

    const SIO0 = sio(0);
    let busy;

    before(async () => {
      m = createMachine();
      m.joy.devices[0].setControllerMode('analog'); // an analog pad in port 1
      m.write32(IMASK, 0);
      m.write32(IREG, 0);
      busy = m.asm(0x80010000, `
        settle: blez  $a0, 2f
                nop
        1:      addiu $a0, -1
                bgtz  $a0, 1b
                nop
        2:      jr    $ra
                nop
      `).labels.settle;
    });

    const settle = n => m.call(busy, n);

    const padDeselect = () => {
      SIO0.ctrl = 0; // dropping select resets the pad's state machine
      settle(100);
    };
    const padSelect = () => {
      SIO0.ctrl = SIO_CTRL_DTR;
      SIO0.baudRate = 0x88; // 250 kHz
      SIO0.mode = 0xd;      // MUL1, 8 bit, no parity
      while (SIO0.stat & SIO_STAT_RXRDY) void SIO0.fifo;
      SIO0.ctrl = SIO0.ctrl | SIO_CTRL_TXEN;
      settle(100);
    };
    const padTransceive = out => {
      SIO0.ctrl = SIO0.ctrl | SIO_CTRL_ERRRES;
      m.write32(IREG, ~IRQ_CONTROLLER);
      SIO0.fifo = out;
      m.idleUntil(() => (SIO0.stat & SIO_STAT_RXRDY) !== 0, 100000, 8);
      return SIO0.fifo;
    };
    // a nine byte frame to the pad on port 1; byte n of the reply came back
    // while byte n went out
    const padFrame = out => {
      padSelect();
      const reply = out.map(padTransceive);
      padDeselect();
      return reply;
    };

    const enterConfig = [0x01, 0x43, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00];
    const queryOnly = [0x01, 0x4d, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

    // In config mode the id byte is F3h and the second byte is 5Ah.
    it('rumbleEntersConfigMode', async () => {
      let reply = padFrame(enterConfig);
      expect(reply[1] !== 0xff).to.be.true;
      reply = padFrame(queryOnly);
      expect([reply[1], reply[2]].map(v => hex(v, 2))).to.eql(['0xf3', '0x5a']);
    });

    // Send a mapping, ask again, and the answer has to be what was sent.
    // Two writes, so all six slots round-trip.
    it('rumbleMappingReadsBack', async () => {
      const setFirst = [0x01, 0x4d, 0x00, 0x00, 0x01, 0xff, 0xff, 0xff, 0xff];
      const setSecond = [0x01, 0x4d, 0x00, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];
      let reply = padFrame(enterConfig);
      expect(reply[1] !== 0xff).to.be.true;
      reply = padFrame(setFirst);
      expect(hex(reply[1], 2)).to.eql('0xf3');
      const mapping = r => ({ id: hex(r[1], 2), map: r.slice(3).map(v => hex(v, 2)) });
      // asking again while writing a different mapping returns the first one
      reply = padFrame(setSecond);
      expect(mapping(reply)).to.eql(mapping([0, 0xf3, 0, 0x00, 0x01, 0xff, 0xff, 0xff, 0xff]));
      // and once more, so every slot has carried a value of its own
      reply = padFrame(queryOnly);
      expect(mapping(reply)).to.eql(mapping([0, 0xf3, 0, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
    });

  });

})
