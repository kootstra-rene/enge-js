// todo: switch to dataview https://v8.dev/blog/dataview

mdlr('enge:psx:mmu', m => {

  const { dma } = m.require('enge:psx:dma');
  const { rtc } = m.require('enge:psx:rtc');

  window.dma = dma; // todo: fix this dependency of mdec

  const map = new Int32Array(0x02000000 >> 2);
  const map8 = new Int8Array(map.buffer);
  const map16 = new Int16Array(map.buffer);
  const ram = new DataView(map.buffer, 0, 2 * 1024 * 1024);
  const rom = new DataView(map.buffer, 0x01c00000, 512 * 1024);

  const hwRead8 = (addr) => {
    const reg = addr & 0x3fff;

    psx.clock += 3;

    switch (true) {
      case reg >= 0x1100 && reg < 0x1130:
        return rtc.rd32(reg);
      case reg >= 0x1C00 && reg < 0x2000:
        return !(reg & 1) && spu.getInt16(reg);
    }

    switch (addr & 0x3fff) {
      case 0x1040: return joy.rd08r1040();
      case 0x1044: return (joy.rd16r1044() << 24) >> 24;
      case 0x1054: return 0 >> 0;
      case 0x1060: return map8[addr >>> 0] >> 0;
      case 0x1070: return (cpu.istat << 24) >> 24;
      case 0x10f0: return dma.rd16r10f0();
      case 0x10f6: return dma.rd08r10f6();
      case 0x1800: return cdr.rd08r1800();
      case 0x1801: return cdr.rd08r1801();
      case 0x1802: return cdr.rd08r1802();
      case 0x1803: return cdr.rd08r1803();
      case 0x1814: return gpu.rd32r1814();
      case 0x1824: return mdc.rd32r1824();
      default:
        if (addr < 0x01801000) {
          psx.clock -= 3;
          return map8[addr >>> 0];
        }
        if (addr >= 0x01802000) {
          psx.clock += 10;
          return map8[addr >>> 0];
        }
        break;
    }
  }

  const memRead8 = (base) => {
    if (base < 0x00800000) {
      psx.clock += 2;
      return ram.getInt8(base & 0x001fffff);
    }
    if ((base >= 0x01800000) && (base < 0x01803000)) {
      return (hwRead8(base) << 24) >> 24;
    }
    if (base >= 0x01A00000 && base < 0x01A80000) {
      psx.clock += 5;
      return map8[base >>> 0] >> 0;
    }
    if (base >= 0x01C00000 && base < 0x01C80000) {
      psx.clock += 8;
      return map8[base >>> 0] >> 0;
    }
    if (base >= 0x01000000 && base < 0x01080000) {
      psx.clock += 6;
      return map8[base >>> 0] >> 0;
    }
    if (base === 0x01fe0130) {
      return map8[base >>> 0] >> 0;
    }
    abort(hex(base, 8));
  }

  const hwRead16 = (addr) => {
    const reg = addr & 0x3fff;

    psx.clock += 3;

    switch (true) {
      case reg >= 0x1100 && reg < 0x1130:
        return rtc.rd32(reg);
      case reg >= 0x1C00 && reg < 0x2000:
        return spu.getInt16(reg);
    }

    switch (addr & 0x3fff) {
      case 0x1014: return map16[addr >>> 1];
      case 0x1044: return joy.rd16r1044();
      case 0x104a: return joy.rd16r104a();
      case 0x104e: return joy.rd16r104e();
      case 0x1054: return 0x00;
      case 0x105a: return 0;
      case 0x105e: return 0;
      case 0x1060: return map16[addr >>> 1] >> 0;
      case 0x1070: return cpu.istat;
      case 0x1074: return cpu.imask;
      case 0x10f0: return dma.rd16r10f0();
      case 0x1130: return 0;
      case 0x1800: return cdr.rd08r1800();
      case 0x1814: return gpu.rd32r1814();
      case 0x1824: return mdc.rd32r1824();
      default:
        if (addr < 0x01801000) {
          psx.clock -= 3;
          return map16[addr >>> 1];
        }
        if (addr >= 0x01802000) {
          psx.clock += 24;
          return map16[addr >>> 1];
        }
        break;
    }
  }

  const memRead16 = (base) => {
    if (base < 0x00800000) {
      psx.clock += 3;
      return ram.getInt16(base & 0x001fffff, true);
      // return map16[(base & 0x001fffff) >>> 1];
    }
    if ((base >= 0x01800000) && (base < 0x01803000)) {
      return (hwRead16(base) << 16) >> 16;
    }
    if (base >= 0x01A00000 && base < 0x01A80000) {
      psx.clock += 5;
      return map16[base >>> 1] >> 0;
    }
    if (base >= 0x01C00000 && base < 0x01C80000) {
      psx.clock += 12;
      return map16[base >>> 1];
    }
    if (base >= 0x01000000 && base < 0x01080000) {
      psx.clock += 12;
      return map16[base >>> 1];
    }
    if (base === 0x01fe0130) {
      return map16[base >>> 1] >> 0;
    }
    abort(hex(base, 8));
  }

  const hwRead32 = (addr) => {
    const reg = addr & 0x3fff;

    psx.clock += 3;

    switch (true) {
      case reg >= 0x1100 && reg < 0x1130:
        return rtc.rd32(reg);
      // case reg >= 0x1C00 && reg < 0x2000:
      //   spu.setInt16(reg, data >>> 0);
      //   return;
    }

    switch (addr & 0x3fff) {
      case 0x1014: return map[addr >>> 2] >> 0;
      case 0x1020: return map[addr >>> 2] >> 0;
      case 0x1044: return joy.rd16r1044() >> 0;
      case 0x1054: return 0x00;
      case 0x1060: return map[addr >>> 2] >> 0;
      case 0x1070: return cpu.istat >> 0;
      case 0x1074: return cpu.imask >> 0;
      case 0x1080: return dma.r1080 >> 0;
      case 0x1088: return dma.r1088 >> 0;
      case 0x1090: return dma.r1090 >> 0;
      case 0x1098: return dma.r1098 >> 0;
      case 0x10a0: return dma.r10a0 >> 0;
      case 0x10a8: return dma.r10a8 >> 0;
      case 0x10b0: return dma.r10b0 >> 0;
      case 0x10b8: return dma.r10b8 >> 0;
      case 0x10c0: return dma.r10c0 >> 0;
      case 0x10c8: return dma.r10c8 >> 0;
      case 0x10e0: return dma.r10e0 >> 0;
      case 0x10e8: return dma.r10e8 >> 0;
      case 0x10f0: return dma.rd32r10f0() >> 0;
      case 0x10f4: return dma.rd32r10f4() >> 0;
      case 0x1800: return cdr.rd08r1800();
      case 0x1810: return gpu.rd32r1810() >> 0;
      case 0x1814: return gpu.rd32r1814() >> 0;
      case 0x1820: return mdc.rd32r1820() >> 0;
      case 0x1824: return mdc.rd32r1824() >> 0;
      default:
        if (addr < 0x01801000) {
          psx.clock -= 3;
          return map[addr >>> 2] >> 0;
        }
        if (addr >= 0x01802000) {
          psx.clock += 56;
          return map[addr >>> 2] >> 0;
        }
        if ((addr >= 0x01801C00) && (addr < 0x01802000)) {
          return (spu.getInt16(addr & 0x3fff) & 0xffff) | (spu.getInt16((addr + 2) & 0x3fff) << 16);
        }
        break;
    }
    abort(hex(addr, 8));
  }

  const memRead32 = (base) => {
    if (base < 0x00800000) {
      psx.clock += 5;
      return ram.getInt32(base & 0x001fffff, true);
      // return map[(base & 0x001fffff) >>> 2] >> 0;
    }

    if ((base >= 0x01800000) && (base < 0x01803000)) {
      return hwRead32(base) >> 0;
    }
    if (base >= 0x01A00000 && base < 0x01A80000) {
      psx.clock += 9;
      return map[base >>> 2] >> 0;
    }
    if (base >= 0x01C00000 && base < 0x01C80000) {
      psx.clock += 24;
      return map[base >>> 2] >> 0;
    }
    if (base === 0x01fe0130) {
      return map[base >>> 2] >> 0;
    }
    if (base >= 0x01000000 && base < 0x01080000) {
      psx.clock += 24;
      return map[base >>> 2];
    }
    abort(hex(base, 8));
  }

  const hwWrite8 = (addr, data) => {
    switch (addr & 0x3fff) {
      case 0x1040: return joy.wr08r1040(data);
      case 0x10f6: return dma.wr08r10f6(data);
      case 0x1800: return cdr.wr08r1800(data);
      case 0x1801: return cdr.wr08r1801(data);
      case 0x1802: return cdr.wr08r1802(data);
      case 0x1803: return cdr.wr08r1803(data);
    }
    abort(hex(addr, 8));
  }

  const memWrite8 = (base, data) => {
    if (base < 0x00800000) {
      const addr = base & 0x001fffff;
      map8[(addr | cpu.forceWriteBits) >>> 0] = data;
      fastCache[addr] = 0;
      return;
    }
    if ((base >= 0x01800000) && (base < 0x01802000)) {
      map8[base >>> 0] = data;
      if (base >= 0x01801000) hwWrite8(base, data);
      return;
    }
    if (base === 0x1802041) {
      map8[base >>> 0] = data;
      return;
    }
    abort(hex(base, 8));
  }

  const hwWrite16 = (addr, data) => {
    const reg = addr & 0x3fff;

    switch (true) {
      case reg >= 0x1100 && reg < 0x1130:
        rtc.wr32(reg, data);
        return;
      case reg >= 0x1C00 && reg < 0x2000:
        spu.setInt16(reg, data >>> 0);
        return;
    }

    switch (addr & 0x3fff) {
      case 0x1014: return map16[addr >>> 1] = data;
      case 0x1048: return joy.wr16r1048(data);
      case 0x104a: return joy.wr16r104a(data);
      case 0x104e: return joy.wr16r104e(data);
      case 0x1058: return;
      case 0x105a: return;
      case 0x105e: return;
      case 0x1070: cpu.istat &= ((data & 0xffff) & cpu.imask); return;
      case 0x1074: cpu.imask = data; return;
      case 0x10f0: return dma.wr32r10f0(data);
    }
    abort(hex(addr, 8));
  }

  const memWrite16 = (base, data) => {
    if (base < 0x00800000) {
      const addr = base & 0x001fffff;
      map16[(addr | cpu.forceWriteBits) >>> 1] = data;
      fastCache[addr] = 0;
      return;
    }
    if ((base >= 0x01800000) && (base < 0x01802000)) {
      map16[base >>> 1] = data;
      if (base >= 0x01801000) hwWrite16(base, data);
      return;
    }
    if ((base >= 0x01802000) && (base < 0x01803000)) {
      map16[base >>> 1] = data;
      return;
    }
    abort(hex(base, 8));
  }

  const hwWrite32 = (addr, data) => {
    const reg = addr & 0x3fff;

    switch (true) {
      case reg >= 0x1100 && reg < 0x1130:
        rtc.wr32(reg, data);
        return;
      case reg >= 0x1C00 && reg < 0x2000:
        spu.setInt16(reg + 0, data >>> 0);
        spu.setInt16(reg + 2, data >>> 16);
        return;
    }

    switch (reg) {
      case 0x1000: return;
      case 0x1004: return;
      case 0x1008: return;
      case 0x100c: return;
      case 0x1010: return;
      case 0x1014: return;
      case 0x1018: return;
      case 0x101c: return;
      case 0x1020: return;
      case 0x1060: return;
      case 0x1070: cpu.istat &= (data & cpu.imask); return;
      case 0x1074: cpu.imask = data >>> 0; return;
      case 0x1080: dma.r1080 = data >>> 0; return;
      case 0x1084: dma.r1084 = data >>> 0; return;
      case 0x1088: dma.wr32r1088(data); return;
      case 0x1090: dma.r1090 = data >>> 0; return;
      case 0x1094: dma.r1094 = data >>> 0; return;
      case 0x1098: dma.wr32r1098(data); return;
      case 0x10a0: dma.r10a0 = data >>> 0; return;
      case 0x10a4: dma.r10a4 = data >>> 0; return;
      case 0x10a8: dma.wr32r10a8(data); return;
      case 0x10b0: dma.r10b0 = data >>> 0; return;
      case 0x10b4: dma.r10b4 = data >>> 0; return;
      case 0x10b8: dma.wr32r10b8(data); return;
      case 0x10c0: dma.r10c0 = data >>> 0; return;
      case 0x10c4: dma.r10c4 = data >>> 0; return;
      case 0x10c8: dma.wr32r10c8(data); return;
      case 0x10e0: dma.r10e0 = data >>> 0; return;
      case 0x10e4: dma.r10e4 = data >>> 0; return;
      case 0x10e8: dma.wr32r10e8(data); return;
      case 0x10f0: dma.wr32r10f0(data); return;
      case 0x10f4: dma.wr32r10f4(data); return;
      case 0x1810: gpu.wr32r1810(data); return;
      case 0x1814: gpu.wr32r1814(data); return;
      case 0x1820: mdc.wr32r1820(data); return;
      case 0x1824: mdc.wr32r1824(data); return;
    }
    abort(hex(addr, 8));
  }

  const memWrite32 = (base, data) => {
    if (base < 0x00800000) {
      const addr = base & 0x001fffff;
      map[(addr | cpu.forceWriteBits) >>> 2] = data;
      fastCache[addr] = 0;
      return;
    }
    if ((base >= 0x01800000) && (base < 0x01802000)) {
      map[base >>> 2] = data;
      if (base >= 0x01801000) hwWrite32(base, data);
      return;
    }
    if (base === 0x01fe0130) {
      map[base >>> 2] = data;
      return;
    }
    abort(hex(base, 8));
  }

  return {
    map, map8, map16, ram, rom, memRead8, memRead16, memRead32, memWrite8, memWrite16, memWrite32
  }

})