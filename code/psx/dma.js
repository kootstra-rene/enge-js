mdlr('enge:psx:dma', m => {

  let dpcr = 0;
  let dicr = 0;

  const [addEvent, setEvent, unsetEvent] = [psx.addEvent, psx.setEvent, psx.unsetEvent];

  const completeIrq = channel => {
    const enable = 1 << (16 + channel);
    const flag = (1 << 31) | (enable << 8);

    if (dicr & enable) {
      cpu.istat |= 0x0008;
      dicr |= flag;
    }
  }

  const dma = {
    // todo: move to file scope.
    r1080: 0, r1084: 0, r1088: 0, r1080n: 0,
    r1090: 0, r1094: 0, r1098: 0, r1090n: 0,
    r10a0: 0, r10a4: 0, r10a8: 0, r10a0n: 0,
    r10b0: 0, r10b4: 0, r10b8: 0, r10b0n: 0,
    r10c0: 0, r10c4: 0, r10c8: 0, r10c0n: 0,
    r10e0: 0, r10e4: 0, r10e8: 0, r10e0n: 0,

    // called my mdec
    completeDMA1: (self, clock) => {
      completeIrq(1);

      dma.r1098 &= 0xfeffffff;
      dma.r1090 = dma.r1090n;

      unsetEvent(self);
    },

    rd08r10f6: () => {
      return (dicr >> 16) & 0xff;
    },

    rd16r10f0: () => {
      return dpcr & 0xffff;
    },

    rd32r10f0: () => {
      return dpcr;
    },

    rd32r10f4: () => {
      // faulty needs more
      //IF b15=1 OR (b23=1 AND (b16-22 AND b24-30)>0) THEN b31=1 ELSE b31=0
      return dicr & 0x7fffffff;
    },

    wr32r10f0: data => {
      dpcr = data;
    },

    wr08r10f6: data => {
      data = (data << 16) | (dicr & 0xffff);
      dicr = (dicr & (~((data & 0x7f000000) | 0x00ffffff))) | (data & 0x00ffffff);
    },

    wr32r10f4: data => {
      dicr = (dicr & (~((data & 0x7f000000) | 0x00ffffff))) | (data & 0x00ffffff);
    },

    wr32r1088: ctrl => {
      dma.r1088 = ctrl;
      if (dpcr & 0x00000008) {
        let transferSize = 10;

        switch (ctrl) {
          case 0x00000000: break;
          case 0x01000201: transferSize = mdc.dmaTransferMode0201(dma.r1080, dma.r1084);
            dma.r1080n = dma.r1080 + (transferSize << 2);
            break;

          default: abort(hex(ctrl));
        }

        setEvent(eventDMA0, ((transferSize * 0x110) / 0x100) >>> 0);
      }
      else {
        dma.r1088 &= 0xfeffffff;
      }
    },

    wr32r1098: ctrl=> {
      dma.r1098 = ctrl;
      if (dpcr & 0x00000080) {
        let transferSize = 10;

        switch (ctrl) {
          case 0x00000000: break;
          case 0x01000200: transferSize = mdc.dmaTransferMode0200(dma.r1090, dma.r1094);
            dma.r1090n = dma.r1090 + (transferSize << 2);
            break;

          default: abort(hex(ctrl));
        }

      }
      else {
        dma.r1098 &= 0xfeffffff;
      }
    },

    wr32r10a8: ctrl=> {
      dma.r10a8 = ctrl;
      if (dpcr & 0x00000800) {
        let transferSize = 10;

        switch (ctrl) {
          case 0x00000000: break;
          case 0x00000001: break;
          case 0x00000401: break;
          case 0x00000201: break;
          case 0x01000200: transferSize = gpu.dmaTransferMode0200(dma.r10a0, dma.r10a4) || 10;
            dma.r10a0n = dma.r10a0 + (transferSize << 2);
            break;
          case 0x01000201: transferSize = gpu.dmaTransferMode0201(dma.r10a0, dma.r10a4) || 10;
            dma.r10a0n = dma.r10a0 + (transferSize << 2);
            break;
          case 0x01000401: transferSize = gpu.dmaTransferMode0401(dma.r10a0, dma.r10a4) || 10;
            dma.r10a0n = 0x00ffffff;
            break;

          default: abort(hex(ctrl));
        }

        setEvent(eventDMA2, ((transferSize * 0x110) / 0x100) >>> 0);
      }
      else {
        dma.r10a8 &= 0xfeffffff;
      }
    },

    wr32r10b8: ctrl=> {
      dma.r10b8 = ctrl;
      if (dpcr & 0x00008000) {
        let transferSize = 10;

        switch (ctrl) {
          case 0x00000000: break;
          case 0x11000000: transferSize = cdr.dmaTransferMode0000(dma.r10b0, dma.r10b4);
            dma.r10b0n = dma.r10b0 + (transferSize << 2);
            break;
          case 0x11400100: transferSize = cdr.dmaTransferMode0000(dma.r10b0, dma.r10b4);
            dma.r10b0n = dma.r10b0 + (transferSize << 2);
            break;

          default: abort(hex(ctrl));
        }

        setEvent(eventDMA3, ((transferSize * (cdr.mode & 0x80) ? 0x1400 : 0x2800) / 0x100) >>> 0);
      }
      else {
        dma.r10b8 &= 0xfeffffff;
      }
    },

    wr32r10c8: ctrl=> {
      dma.r10c8 = ctrl;
      if (dpcr & 0x00080000) {
        let transferSize = 10;

        switch (ctrl) {
          case 0x00000201: break;
          case 0x01000000:
          case 0x01000200: transferSize = spu.dmaTransferMode0200(dma.r10c0, dma.r10c4);
            dma.r10c0n = dma.r10c0 + (transferSize << 2);
            break;
          case 0x01000001:
          case 0x01000201: transferSize = spu.dmaTransferMode0201(dma.r10c0, dma.r10c4);
            dma.r10c0n = dma.r10c0 + (transferSize << 2);
            break;

          default: abort(hex(ctrl));
        }

        setEvent(eventDMA4, ((transferSize * 0x420) / 0x100) >>> 0);
      }
      else {
        dma.r10c8 &= 0xfeffffff;
      }
    },

    wr32r10e8: ctrl=> {
      dma.r10e8 = (ctrl & 0x50000002) | 0x2;
      if (dpcr & 0x08000000) {
        let transferSize = 10;

        switch (dma.r10e8) {
          case 0x00000002: dma.r10e0n = dma.r10e0 = map[(dma.r10e0 & 0x01ffffff) >> 2];
            break;
          case 0x10000002:
          case 0x50000002: transferSize = gpu.dmaLinkedListMode0002(dma.r10e0, dma.r10e4);
            dma.r10e0n = 0x00ffffff;
            break;

          default: abort(hex(ctrl) + ' ' + hex(dma.r10e8));
        }

        setEvent(eventDMA6, ((transferSize * 0x110) / 0x100) >>> 0);
      }
      else {
        dma.r10e8 &= 0xfeffffff;
      }
    },
  }

  const eventDMA0 = addEvent(0, (self, clock) => {
    completeIrq(0);

    dma.r1088 &= 0xfeffffff;
    dma.r1080 = dma.r1080n;

    unsetEvent(self);
  });

  const eventDMA2 = addEvent(0, (self, clock) => {
    completeIrq(2);

    dma.r10a8 &= 0xfeffffff;
    dma.r10a0 = dma.r10a0n;

    unsetEvent(self);
  });

  const eventDMA3 = addEvent(0, (self, clock) => {
    completeIrq(3);

    dma.r10b8 &= 0xfeffffff;
    dma.r10b0 = dma.r10b0n;

    unsetEvent(self);
  });

  const eventDMA4 = addEvent(0, (self, clock) => {
    completeIrq(4);

    dma.r10c8 &= 0xfeffffff;
    dma.r10c0 = dma.r10c0n;

    unsetEvent(self);
  });

  const eventDMA6 = addEvent(0, (self, clock) => {
    completeIrq(6);

    dma.r10e8 &= 0xfeffffff;
    dma.r10e0 = dma.r10e0n;

    unsetEvent(self);
  });

  return { dma };
})