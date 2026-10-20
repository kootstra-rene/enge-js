mdlr('enge:psx:dma', ({ include }) => {

  const dmaDebug = new URLSearchParams(window.location.search).has('debug-cd');
  const dmaLog = (...args) => {
    if (dmaDebug) console.debug('[DMA]', ...args);
  };

  let dpcr;
  let dicr;
  let r1080, r1084, r1088, r1080n;
  let r1090, r1094, r1098, r1090n;
  let r10a0, r10a4, r10a8, r10a0n;
  let r10b0, r10b4, r10b8, r10b0n;
  let r10c0, r10c4, r10c8, r10c0n;
  let r10e0, r10e4, r10e8, r10e0n;

  const [addEvent, setEvent, unsetEvent] = [psx.addEvent, psx.setEvent, psx.unsetEvent];

  // b31 = b15 OR (b23 AND (b16-22 AND b24-30) != 0)
  const masterFlag = () => {
    const pending = (dicr >> 16) & (dicr >> 24) & 0x7f;
    return ((dicr & 0x8000) || ((dicr & 0x800000) && pending)) ? 1 : 0;
  }

  // IRQ3 is only raised on a 0->1 transition of b31
  const updateDicr = (update) => {
    const before = masterFlag();
    update();
    if (!before && masterFlag()) {
      cpu.raiseIrq(0x0008);
    }
  }

  // A completion flag is set only when its channel is enabled in b16-22; the
  // master enable (b23) only gates b31, so it can be turned on afterwards.
  const completeIrq = channel => {
    const enable = 1 << (16 + channel);

    if (dicr & enable) {
      updateDicr(() => dicr |= enable << 8);
    }
  }

  // sync mode 1 transfers end with BA (blocks remaining) at zero
  const completedBcr = (ctrl, bcr) => (((ctrl >> 9) & 3) === 1) ? (bcr & 0xffff) : bcr;

  const rd32r10f4 = () => (dicr & 0x7fffffff) | (masterFlag() << 31);

  // b0-5 and b15-23 r/w, b24-30 write 1 to acknowledge, b6-14 always 0.
  // `lanes` selects the bytes a narrow store drives; the others are untouched.
  const wr32r10f4 = (data, lanes = 0xffffffff) => {
    const rw = 0x00ff803f & lanes;
    const ack = data & 0x7f000000 & lanes;
    updateDicr(() => dicr = (dicr & ~(ack | rw)) | (data & rw));
  };

  const wr32r1088 = ctrl => {
    r1088 = ctrl;
    if (!(ctrl & 0x01000000)) return;
    if (dpcr & 0x00000008) {
      let transferSize = 10;

      switch (ctrl) {
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
    if (!(ctrl & 0x01000000)) return;
    if (dpcr & 0x00000080) {
      let transferSize = 10;

      switch (ctrl) {
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
    if (!(ctrl & 0x01000000)) return;
    if (dpcr & 0x00000800) {
      let transferSize = 10;

      switch (ctrl) {
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
    if (!(ctrl & 0x01000000)) return;
    if (dpcr & 0x00008000) {
      let transferSize = 10;

      dmaLog('channel 3 start', {
        ctrl: `0x${(ctrl >>> 0).toString(16)}`,
        addr: `0x${(r10b0 >>> 0).toString(16)}`,
        block: `0x${(r10b4 >>> 0).toString(16)}`,
        dicr: `0x${(dicr >>> 0).toString(16)}`
      });

      switch (ctrl) {
        case 0x11000000: transferSize = cdr.dmaTransferMode0000(r10b0, r10b4);
          r10b0n = r10b0 + (transferSize << 2);
          break;
        case 0x11400100: transferSize = cdr.dmaTransferMode0000(r10b0, r10b4);
          r10b0n = r10b0 + (transferSize << 2);
          break;

        default: abort(hex(ctrl));
      }

      // trigger bit clears once the transfer starts
      r10b8 &= 0xefffffff;

      const rate = (cdr.mode & 0x80) ? 0x1400 : 0x2800;
      setEvent(eventDMA3, ((transferSize * rate) / 0x100) >>> 0);
    }
    else {
      r10b8 &= 0xfeffffff;
    }
  };

  const wr32r10c8 = ctrl => {
    r10c8 = ctrl;
    if (!(ctrl & 0x01000000)) return;
    if (dpcr & 0x00080000) {
      let transferSize = 10;

      switch (ctrl) {
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
    // only b24, b28 and b30 are r/w, b1 (decrement) is always set
    r10e8 = (ctrl & 0x51000000) | 0x2;
    if (!(r10e8 & 0x01000000)) return;
    // sync mode 0 (start immediately) also needs the manual start trigger
    if (!((ctrl >> 9) & 3) && !(ctrl & 0x10000000)) return;
    if (dpcr & 0x08000000) {
      const transferSize = gpu.dmaLinkedListMode0002(r10e0, r10e4) || 10;
      r10e0n = 0x00ffffff; // todo: update with actual value

      // trigger bit clears once the transfer starts
      r10e8 &= 0xefffffff;

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
      r1094 = completedBcr(r1098, r1094);

      unsetEvent(self);
    },

    // Narrow accesses use the byte lanes of the aligned 32-bit register.
    // Unmapped registers (channel 5, 0x10f8, 0x10fc) read as 0, writes are
    // ignored.
    rd08: addr => (dma.rd32(addr) >> ((addr & 3) << 3)) & 0xff,
    rd16: addr => (dma.rd32(addr) >> ((addr & 2) << 3)) & 0xffff,
    rd32: addr => {
      const read = $rd32.get(addr & 0x3ffc);
      return read ? read() : 0;
    },
    wr08: (addr, data) => narrowWrite(addr, data & 0xff, 0xff << ((addr & 3) << 3), (addr & 3) << 3),
    wr16: (addr, data) => narrowWrite(addr, data & 0xffff, 0xffff << ((addr & 2) << 3), (addr & 2) << 3),
    wr32: (addr, data) => {
      const write = $wr32.get(addr & 0x3ffc);
      if (write) write(data);
    },
  };

  // DICR merges the lanes that are not written, so acknowledging a flag with
  // a byte store does not change the enables. The other registers take the
  // store as a 32-bit write with the remaining lanes zero.
  const narrowWrite = (addr, data, lanes, shift) => {
    if ((addr & 0x3ffc) === 0x10f4) return wr32r10f4(data << shift, lanes);
    dma.wr32(addr, (data << shift) & lanes);
  };

  const $rd32 = new Map([
    [0x1080, _ => r1080 >> 0],
    [0x1084, _ => r1084 >> 0],
    [0x1088, _ => r1088 >> 0],
    [0x1090, _ => r1090 >> 0],
    [0x1094, _ => r1094 >> 0],
    [0x1098, _ => r1098 >> 0],
    [0x10a0, _ => r10a0 >> 0],
    [0x10a4, _ => r10a4 >> 0],
    [0x10a8, _ => r10a8 >> 0],
    [0x10b0, _ => r10b0 >> 0],
    [0x10b4, _ => r10b4 >> 0],
    [0x10b8, _ => r10b8 >> 0],
    [0x10c0, _ => r10c0 >> 0],
    [0x10c4, _ => r10c4 >> 0],
    [0x10c8, _ => r10c8 >> 0],
    [0x10e0, _ => r10e0 >> 0],
    [0x10e4, _ => r10e4 >> 0],
    [0x10e8, _ => r10e8 >> 0],
    [0x10f0, _ => dpcr >> 0],
    [0x10f4, _ => rd32r10f4() >> 0],
  ]);

  const $wr32 = new Map([
    [0x1080, _ => r1080 = _ & 0x00ffffff],
    [0x1084, _ => r1084 = _ >>> 0],
    [0x1088, _ => wr32r1088(_)],
    [0x1090, _ => r1090 = _ & 0x00ffffff],
    [0x1094, _ => r1094 = _ >>> 0],
    [0x1098, _ => wr32r1098(_)],
    [0x10a0, _ => r10a0 = _ & 0x00ffffff],
    [0x10a4, _ => r10a4 = _ >>> 0],
    [0x10a8, _ => wr32r10a8(_)],
    [0x10b0, _ => r10b0 = _ & 0x00ffffff],
    [0x10b4, _ => r10b4 = _ >>> 0],
    [0x10b8, _ => wr32r10b8(_)],
    [0x10c0, _ => r10c0 = _ & 0x00ffffff],
    [0x10c4, _ => r10c4 = _ >>> 0],
    [0x10c8, _ => wr32r10c8(_)],
    [0x10e0, _ => r10e0 = _ & 0x00ffffff],
    [0x10e4, _ => r10e4 = _ >>> 0],
    [0x10e8, _ => wr32r10e8(_)],
    [0x10f0, _ => dpcr = _ >>> 0],
    [0x10f4, _ => wr32r10f4(_)],
  ]);

  const eventDMA0 = addEvent(0, (self) => {
    completeIrq(0);

    r1088 &= 0xfeffffff;
    r1080 = r1080n;
    r1084 = completedBcr(r1088, r1084);

    unsetEvent(self);
  });

  const eventDMA2 = addEvent(0, (self) => {
    completeIrq(2);

    r10a8 &= 0xfeffffff;
    r10a0 = r10a0n;
    r10a4 = completedBcr(r10a8, r10a4);

    unsetEvent(self);
  });

  const eventDMA3 = addEvent(0, (self) => {
    completeIrq(3);

    dmaLog('channel 3 complete', {
      addr: `0x${(r10b0n >>> 0).toString(16)}`,
      control: `0x${(r10b8 >>> 0).toString(16)}`,
      dicr: `0x${(dicr >>> 0).toString(16)}`,
      istat: `0x${(cpu.istat >>> 0).toString(16)}`,
      imask: `0x${(cpu.imask >>> 0).toString(16)}`,
      sr: `0x${(cpu.sr >>> 0).toString(16)}`
    });

    r10b8 &= 0xfeffffff;
    r10b0 = r10b0n;

    unsetEvent(self);
  });

  const eventDMA4 = addEvent(0, (self) => {
    completeIrq(4);

    r10c8 &= 0xfeffffff;
    r10c0 = r10c0n;
    r10c4 = completedBcr(r10c8, r10c4);

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
