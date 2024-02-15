mdlr('enge:psx:dma', m => {

  let dpcr;
  let dicr;
  let r1080, r1084, r1088, r1080n;
  let r1090, r1094, r1098, r1090n;
  let r10a0, r10a4, r10a8, r10a0n;
  let r10b0, r10b4, r10b8, r10b0n;
  let r10c0, r10c4, r10c8, r10c0n;
  let r10e0, r10e4, r10e8, r10e0n;

  const [addEvent, setEvent, unsetEvent] = [psx.addEvent, psx.setEvent, psx.unsetEvent];

  const completeIrq = channel => {
    const enable = 1 << (16 + channel);
    const flag = (1 << 31) | (enable << 8);

    if (dicr & enable) {
      cpu.istat |= 0x0008;
      dicr |= flag;
    }
  }

  const rd32r10f4 = () => {
    // faulty needs more
    //IF b15=1 OR (b23=1 AND (b16-22 AND b24-30)>0) THEN b31=1 ELSE b31=0
    return dicr & 0x7fffffff;
  }

  const wr08r10f6 = data => {
    data = (data << 16) | (dicr & 0xffff);
    dicr = (dicr & (~((data & 0x7f000000) | 0x00ffffff))) | (data & 0x00ffffff);
  };

  const wr32r10f4 = data => {
    dicr = (dicr & (~((data & 0x7f000000) | 0x00ffffff))) | (data & 0x00ffffff);
  };

  const wr32r1088 = ctrl => {
    r1088 = ctrl;
    if (dpcr & 0x00000008) {
      let transferSize = 10;

      switch (ctrl) {
        case 0x00000000: break;
        case 0x01000201: transferSize = mdc.dmaTransferMode0201(r1080, r1084);
          r1080n = r1080 + (transferSize << 2);
          break;

        default: abort(hex(ctrl));
      }

      setEvent(eventDMA0, ((transferSize * 0x110) / 0x100) >>> 0);
    }
    else {
      r1088 &= 0xfeffffff;
    }
  };

  const wr32r1098 = ctrl => {
    r1098 = ctrl;
    if (dpcr & 0x00000080) {
      let transferSize = 10;

      switch (ctrl) {
        case 0x00000000: break;
        case 0x01000200: transferSize = mdc.dmaTransferMode0200(r1090, r1094);
          r1090n = r1090 + (transferSize << 2);
          break;

        default: abort(hex(ctrl));
      }

    }
    else {
      r1098 &= 0xfeffffff;
    }
  };

  const wr32r10a8 = ctrl => {
    r10a8 = ctrl;
    if (dpcr & 0x00000800) {
      let transferSize = 10;

      switch (ctrl) {
        case 0x00000000: break;
        case 0x00000001: break;
        case 0x00000401: break;
        case 0x00000201: break;
        case 0x01000200: transferSize = gpu.dmaTransferMode0200(r10a0, r10a4) || 10;
          r10a0n = r10a0 + (transferSize << 2);
          break;
        case 0x01000201: transferSize = gpu.dmaTransferMode0201(r10a0, r10a4) || 10;
          r10a0n = r10a0 + (transferSize << 2);
          break;
        case 0x01000401: transferSize = gpu.dmaTransferMode0401(r10a0, r10a4) || 10;
          r10a0n = 0x00ffffff;
          break;

        default: abort(hex(ctrl));
      }

      setEvent(eventDMA2, ((transferSize * 0x110) / 0x100) >>> 0);
    }
    else {
      r10a8 &= 0xfeffffff;
    }
  };

  const wr32r10b8 = ctrl => {
    r10b8 = ctrl;
    if (dpcr & 0x00008000) {
      let transferSize = 10;

      switch (ctrl) {
        case 0x00000000: break;
        case 0x11000000: transferSize = cdr.dmaTransferMode0000(r10b0, r10b4);
          r10b0n = r10b0 + (transferSize << 2);
          break;
        case 0x11400100: transferSize = cdr.dmaTransferMode0000(r10b0, r10b4);
          r10b0n = r10b0 + (transferSize << 2);
          break;

        default: abort(hex(ctrl));
      }

      setEvent(eventDMA3, ((transferSize * (cdr.mode & 0x80) ? 0x1400 : 0x2800) / 0x100) >>> 0);
    }
    else {
      r10b8 &= 0xfeffffff;
    }
  };

  const wr32r10c8 = ctrl => {
    r10c8 = ctrl;
    if (dpcr & 0x00080000) {
      let transferSize = 10;

      switch (ctrl) {
        case 0x00000201: break;
        case 0x01000000:
        case 0x01000200: transferSize = spu.dmaTransferMode0200(r10c0, r10c4);
          r10c0n = r10c0 + (transferSize << 2);
          break;
        case 0x01000001:
        case 0x01000201: transferSize = spu.dmaTransferMode0201(r10c0, r10c4);
          r10c0n = r10c0 + (transferSize << 2);
          break;

        default: abort(hex(ctrl));
      }

      setEvent(eventDMA4, ((transferSize * 0x420) / 0x100) >>> 0);
    }
    else {
      r10c8 &= 0xfeffffff;
    }
  };

  const wr32r10e8 = ctrl => {
    r10e8 = (ctrl & 0x50000002) | 0x2;
    if (dpcr & 0x08000000) {
      let transferSize = 10;

      switch (r10e8) {
        case 0x00000002: r10e0n = r10e0 = map[(r10e0 & 0x01ffffff) >> 2];
          break;
        case 0x10000002:
        case 0x50000002: transferSize = gpu.dmaLinkedListMode0002(r10e0, r10e4);
          r10e0n = 0x00ffffff; // todo: update with actual value
          break;

        default: abort(hex(ctrl) + ' ' + hex(r10e8));
      }

      setEvent(eventDMA6, ((transferSize * 0x110) / 0x100) >>> 0);
    }
    else {
      r10e8 &= 0xfeffffff;
    }
  };

  const dma = {
    // called mby mdec
    completeDMA1: (self, clock) => {
      completeIrq(1);

      r1098 &= 0xfeffffff;
      r1090 = r1090n;

      unsetEvent(self);
    },

    rd08: addr => {
      switch (addr & 0x3fff) {
        case 0x10f6: return (dicr >> 16) & 0xff;
        default: return dma.rd32(addr);
      }
    },
    rd16: addr => dma.rd32(addr),
    rd32: addr => $rd32.get(addr & 0x3fff)(),
    wr08: (addr, data) => {
      switch (addr & 0x3fff) {
        case 0x10f6: wr08r10f6(data); break;
        default: return dma.wr32(addr, data);
      }
    },
    wr16: (addr, data) => dma.wr32(addr, data),
    wr32: (addr, data) => $wr32.get(addr & 0x3fff)(data),
  };

  const $rd32 = new Map([
    [0x1080, _ => r1080 >> 0],
    [0x1088, _ => r1088 >> 0],
    [0x1090, _ => r1090 >> 0],
    [0x1098, _ => r1098 >> 0],
    [0x10a0, _ => r10a0 >> 0],
    [0x10a8, _ => r10a8 >> 0],
    [0x10b0, _ => r10b0 >> 0],
    [0x10b8, _ => r10b8 >> 0],
    [0x10c0, _ => r10c0 >> 0],
    [0x10c8, _ => r10c8 >> 0],
    [0x10e0, _ => r10e0 >> 0],
    [0x10e8, _ => r10e8 >> 0],
    [0x10f0, _ => dpcr >> 0],
    [0x10f4, _ => rd32r10f4() >> 0],
  ]);

  const $wr32 = new Map([
    [0x1080, _ => r1080 = _ >>> 0],
    [0x1084, _ => r1084 = _ >>> 0],
    [0x1088, _ => wr32r1088(_)],
    [0x1090, _ => r1090 = _ >>> 0],
    [0x1094, _ => r1094 = _ >>> 0],
    [0x1098, _ => wr32r1098(_)],
    [0x10a0, _ => r10a0 = _ >>> 0],
    [0x10a4, _ => r10a4 = _ >>> 0],
    [0x10a8, _ => wr32r10a8(_)],
    [0x10b0, _ => r10b0 = _ >>> 0],
    [0x10b4, _ => r10b4 = _ >>> 0],
    [0x10b8, _ => wr32r10b8(_)],
    [0x10c0, _ => r10c0 = _ >>> 0],
    [0x10c4, _ => r10c4 = _ >>> 0],
    [0x10c8, _ => wr32r10c8(_)],
    [0x10e0, _ => r10e0 = _ >>> 0],
    [0x10e4, _ => r10e4 = _ >>> 0],
    [0x10e8, _ => wr32r10e8(_)],
    [0x10f0, _ => dpcr = _ >>> 0],
    [0x10f4, _ => wr32r10f4(_)],
  ]);

  const eventDMA0 = addEvent(0, (self) => {
    completeIrq(0);

    r1088 &= 0xfeffffff;
    r1080 = r1080n;

    unsetEvent(self);
  });

  const eventDMA2 = addEvent(0, (self) => {
    completeIrq(2);

    r10a8 &= 0xfeffffff;
    r10a0 = r10a0n;

    unsetEvent(self);
  });

  const eventDMA3 = addEvent(0, (self) => {
    completeIrq(3);

    r10b8 &= 0xfeffffff;
    r10b0 = r10b0n;

    unsetEvent(self);
  });

  const eventDMA4 = addEvent(0, (self) => {
    completeIrq(4);

    r10c8 &= 0xfeffffff;
    r10c0 = r10c0n;

    unsetEvent(self);
  });

  const eventDMA6 = addEvent(0, (self) => {
    completeIrq(6);

    r10e8 &= 0xfeffffff;
    r10e0 = r10e0n;

    unsetEvent(self);
  });

  return { dma };
})