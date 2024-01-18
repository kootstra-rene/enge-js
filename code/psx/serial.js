mdlr('enge:psx:serial', m => {

  const devices = [
    m.require('enge:psx:serial-device').setId(0),
    m.require('enge:psx:serial-device').setId(1),
  ];

  const syncWithDevice = (device, data) => {
    let byte = device.sendReceiveByte(data & 0xff);
    let more = device.hasMore();
    setResult(byte, !more);
  }

  const setResult = (byte, last) => {
    r1044 |= 0x0002; // JOY_STAT.RX = 1
    data = byte & 0xff;

    if (!last) {
      psx.setEvent(eventIRQ, (baud * 8) >>> 0);
    }
  }

  const eventIRQ = psx.addEvent(0, (self, clock) => {
    r1044 |= 0x0200; // JOY_STAT.IRQ = 1;
    cpu.istat |= 0x0080; // todo: should take care of edge triggering
    psx.unsetEvent(self);
  });

  let baud = 0x0088;
  let data = 0;
  let command = 0;
  let r1044 = 0; // JOY_STAT
  let r104a = 0; // JOY_CTRL

  let joy = {
    devices,

    rd08r1040: () => {
      if (r1044 & 0x0002) {
        r1044 &= ~0x0002; // JOY_STAT.RX = 0
      }
      return data;
    },

    rd16r1044: () => {
      return r1044;
    },

    rd16r104a: () => {
      return r104a;
    },

    rd16r104e: () => {
      return baud;
    },

    wr08r1040: function (data) {
      let device = null;
      if ((r104a & 0x0002) === 0x0000) {
        abort();
      }
      if ((r104a & 0x0002) === 0x0002) {
        device = (r104a & 0x2000) ? devices[1] : devices[0];
      }

      switch (command) {
        case 0x00:
          if (!device) {
            return setResult(0xff, true);
          }
          setResult(0xff, false);
          command = data & 0xff;
          if (command === 0x81) device.init();
          if (command === 0x01) device.init();
          break;

        case 0x01:
          device.buildControllerResponse(data & 0xff);
          command = 0x02;
        case 0x02:
          syncWithDevice(device, data);
          break;

        case 0x81:
          device.buildMemCardResponse(data & 0xff);
          command = 0x82;
        case 0x82:
          syncWithDevice(device, data);
          break;

        case 0x83:
          return setResult(0xff, true); // no memcard for now

        default: console.warn('unknown command state:', hex(command, 4), ' device:', device.id);
          break;
      }
    },

    wr16r1048: (data) => {
      if (data !== 0xd) abort(hex(data, 4));
    },

    wr16r104a: function (data) {
      r104a = data & ~(0x0010 | 0x0040); //  mask out write-only bits

      if ((data & 0x0040) || !(r104a & 0x0002)) {
        //  reset when pad is not selected or reset is requested

        let device = null;
        if ((r104a & 0x0002) === 0x0002) {
          device.init();
        }

        psx.unsetEvent(eventIRQ);
        command = 0;
        r1044 = 0x0005;
      }

      if ((data & 0x0010)) {
        r1044 &= ~(0x0200); // JOY_STAT.IRQ = 0
      }
    },

    wr16r104e: function (data) {
      if (data !== 0x88) abort(`invalid JOY_BAUD: $${hex(data, 4)}`);
      baud = data & 0xffff;
    }
  }

  Object.seal(joy);

  return { joy };
})