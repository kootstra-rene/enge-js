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

  // Completion flags are gated when raised, then persist until acknowledged.
  const masterFlag = () => {
    const flags = (dicr >> 24) & 0x7f;
    return ((dicr & 0x8000) || ((dicr & 0x800000) && flags)) ? 1 : 0;
  }

  // IRQ3 is only raised on a 0->1 transition of b31
  const updateDicr = (update) => {
    const before = masterFlag();
    update();
    if (!before && masterFlag()) {
      cpu.raiseIrq(0x0008);
    }
  }

  const completeIrq = channel => {
    const enable = 1 << (16 + channel);

    if ((dicr & 0x800000) && (dicr & enable)) {
      updateDicr(() => dicr |= enable << 8);
    }
  }

  // sync mode 1 transfers end with BA (blocks remaining) at zero
  const completedBcr = (ctrl, bcr) => (((ctrl >> 9) & 3) === 1) ? (bcr & 0xffff) : bcr;

  const rd32r10f4 = () => (dicr & 0x7fffffff) | (masterFlag() << 31);

  const wr32r10f4 = data => {
    // b0-5 and b15-23 r/w, b24-30 write 1 to acknowledge, b6-14 always 0
    updateDicr(() => dicr = (dicr & (~((data & 0x7f000000) | 0x00ff803f))) | (data & 0x00ff803f));
  };

  // Transfers requested while their channel was disabled in DPCR, by
  // channel bit: they start once DPCR enables the channel.
  let pending = 0;
  const wr32r10f0 = data => {
    dpcr = data >>> 0;
    if (!pending) return;
    const starts = [[0, () => wr32r1088(r1088)], [1, () => wr32r1098(r1098)], [2, () => wr32r10a8(r10a8)],
      [3, () => wr32r10b8(r10b8)], [4, () => wr32r10c8(r10c8)], [6, () => wr32r10e8(r10e8)]];
    for (const [ch, start] of starts) {
      if (!(pending & (1 << ch)) || !(dpcr & (8 << (ch << 2)))) continue;
      pending &= ~(1 << ch);
      start();
    }
  };

  const wr32r1088 = ctrl => {
    r1088 = ctrl;
    pending &= ~(1 << 0);
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
      pending |= 1 << 0; // started when DPCR enables the channel
    }
  };

  const wr32r1098 = ctrl => {
    r1098 = ctrl;
    pending &= ~(1 << 1);
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
      pending |= 1 << 1; // started when DPCR enables the channel
    }
  };

  // Linked-list GPU DMA walks LINKED_STEP words at a time, a word a cycle
  // (as the other GPU transfers are timed), so the CPU runs alongside: MADR
  // follows the walk, a list that loops keeps the channel busy, and the CPU
  // can rewrite nodes behind it or stop it by clearing CHCR bit 24. A list
  // ends at a link with bit 23 set; MADR keeps that link, and one other than
  // FFFFFFh also sets DICR bit 15.
  // (odd, so that MADR read between steps also moves on a short loop)
  const LINKED_STEP = 509;
  let linkedEnd = 0;

  const linkedListStep = () => {
    if (!(r10a0 & 0x001ffffc)) {
      // a list at address 0 (not a real list): done at once
      r10a0n = 0x00ffffff;
      linkedEnd = 0x00ffffff;
      setEvent(eventDMA2, 10);
      return;
    }
    const step = gpu.dmaLinkedListStep(r10a0, LINKED_STEP);
    const cycles = Math.max(1, ((step.words * 0x110) / 0x100) >>> 0);
    if (step.done) {
      r10a0n = step.next;
      linkedEnd = step.next;
      setEvent(eventDMA2, cycles);
    } else {
      r10a0 = step.next;
      setEvent(eventDMA2Linked, cycles);
    }
  };

  const wr32r10a8 = ctrl => {
    const running = (r10a8 & 0x01000000) !== 0;
    r10a8 = ctrl;
    pending &= ~(1 << 2);
    if (!(ctrl & 0x01000000)) {
      // clearing the start bit stops a transfer in progress
      if (running) {
        unsetEvent(eventDMA2Linked);
        unsetEvent(eventDMA2);
      }
      return;
    }
    if (running && (eventDMA2Linked.active || eventDMA2.active)) return;
    if (dpcr & 0x00000800) {
      let transferSize = 10;

      switch (ctrl) {
        case 0x01000200: transferSize = gpu.dmaTransferMode0200(r10a0, r10a4) || 10;
          r10a0n = r10a0 + (transferSize << 2);
          break;
        case 0x01000201: transferSize = gpu.dmaTransferMode0201(r10a0, r10a4) || 10;
          r10a0n = r10a0 + (transferSize << 2);
          break;
        case 0x01000401:
          // linked list: walked a stretch at a time (see linkedListStep)
          linkedListStep();
          return;

        default: abort(hex(ctrl));
      }

      setEvent(eventDMA2, ((transferSize * 0x110) / 0x100) >>> 0);
    }
    else {
      pending |= 1 << 2; // started when DPCR enables the channel
    }
  };

  const wr32r10b8 = ctrl => {
    r10b8 = ctrl;
    pending &= ~(1 << 3);
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
      pending |= 1 << 3; // started when DPCR enables the channel
    }
  };

  const wr32r10c8 = ctrl => {
    r10c8 = ctrl;
    pending &= ~(1 << 4);
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
      pending |= 1 << 4; // started when DPCR enables the channel
    }
  };

  const wr32r10e8 = ctrl => {
    // only b24, b28 and b30 are r/w, b1 (decrement) is always set
    r10e8 = (ctrl & 0x51000000) | 0x2;
    pending &= ~(1 << 6);
    if (!(r10e8 & 0x01000000)) return;
    // sync mode 0 (start immediately) also needs the manual start trigger
    if (!((ctrl >> 9) & 3) && !(ctrl & 0x10000000)) return;
    if (dpcr & 0x08000000) {
      const transferSize = gpu.dmaLinkedListMode0002(r10e0, r10e4) || 10;
      r10e0n = r10e0; // MADR keeps the start address

      // trigger bit clears once the transfer starts
      r10e8 &= 0xefffffff;

      setEvent(eventDMA6, ((transferSize * 0x110) / 0x100) >>> 0);
    }
    else {
      pending |= 1 << 6; // started when DPCR enables the channel
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

  // A narrow store is a 32-bit write with the other lanes zero. Block control
  // (channel BCR) is the only register that honours the byte enables and keeps
  // the lanes that are not written (as in DuckStation). For DICR this means a
  // byte store that acknowledges a flag also clears the enables.
  const narrowWrite = (addr, data, lanes, shift) => {
    const reg = addr & 0x3ffc;
    let value = (data << shift) & lanes;
    if ((reg & 0x0c) === 0x04 && reg < 0x10f0) {
      value = (dma.rd32(reg) & ~lanes) | value;
    }
    dma.wr32(reg, value);
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
    [0x10f0, _ => wr32r10f0(_)],
    [0x10f4, _ => wr32r10f4(_)],
  ]);

  // the completion events, idle until a transfer starts
  const idle = event => (unsetEvent(event), event);

  const eventDMA0 = idle(addEvent(0, (self) => {
    completeIrq(0);

    r1088 &= 0xfeffffff;
    r1080 = r1080n;
    r1084 = completedBcr(r1088, r1084);

    unsetEvent(self);
  }));

  const eventDMA2Linked = idle(addEvent(0, (self) => {
    unsetEvent(self);
    linkedListStep();
  }));

  const eventDMA2 = idle(addEvent(0, (self) => {
    completeIrq(2);
    if ((r10a8 & 0x00000600) === 0x00000400 && linkedEnd !== 0x00ffffff) {
      updateDicr(() => dicr |= 0x8000);
    }

    r10a8 &= 0xfeffffff;
    r10a0 = r10a0n;
    r10a4 = completedBcr(r10a8, r10a4);

    unsetEvent(self);
  }));

  const eventDMA3 = idle(addEvent(0, (self) => {
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
  }));

  const eventDMA4 = idle(addEvent(0, (self) => {
    completeIrq(4);

    r10c8 &= 0xfeffffff;
    r10c0 = r10c0n;
    r10c4 = completedBcr(r10c8, r10c4);

    unsetEvent(self);
  }));

  const eventDMA6 = idle(addEvent(0, (self) => {
    completeIrq(6);

    r10e8 &= 0xfeffffff;
    r10e0 = r10e0n;

    unsetEvent(self);
  }));

  return { dma };
})
