(scope => {

  'use strict';

  const map = new Int32Array(0x02000000 >> 2);
  const map8 = new Int8Array(map.buffer);
  const map16 = new Int16Array(map.buffer);
  const ram = new DataView(map.buffer, 0, 2 * 1024 * 1024);
  const rom = new DataView(map.buffer, 0x01c00000, 512 * 1024);

  function hwRead8(addr) {
    psx.clock += 3;
    switch (addr & 0x3fff) {
      case 0x1040: return joy.rd08r1040();
      case 0x1044: return (joy.rd16r1044() << 24) >> 24;
      case 0x1054: return 0 >> 0;
      case 0x1060: return map8[addr >>> 0] >> 0;
      case 0x1070: return (cpu.istat << 24) >> 24;
      case 0x10f0: return (dma.rd16r10f0() << 24) >> 24;
      case 0x10f6: return dma.rd08r10f6();
      case 0x1100: return (rc0.getValue() << 24) >> 24;
      case 0x1800: return cdr.rd08r1800();
      case 0x1801: return cdr.rd08r1801();
      case 0x1802: return cdr.rd08r1802();
      case 0x1803: return cdr.rd08r1803();
      case 0x1814: return (gpu.rd32r1814() << 24) >> 24;
      case 0x1824: return (mdc.rd32r1824() << 24) >> 24;
      default:
        if (addr < 0x01801000) {
          psx.clock -= 3;
          return map8[addr >>> 0];
        }
        if (addr >= 0x01802000) {
          psx.clock += 10;
          return map8[addr >>> 0];
        }
        if ((addr >= 0x01801C00) && (addr < 0x01802000)) { //chronocross
          return spu.getInt16(addr & 0x3fff);
        }
        break;
    }
  }

  function memRead8(base) {
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
    abort(`r8: unable to load from $${hex(base, 8)}`)
  }

  function hwRead16(addr) {
    psx.clock += 3;
    switch (addr & 0x3fff) {
      case 0x1014: return map16[addr >>> 1];
      case 0x1044: return joy.rd16r1044();
      case 0x104a: return joy.rd16r104a();
      case 0x104e: return joy.rd16r104e();
      case 0x1054: return 0x00;
      case 0x105a: return 0x00;
      case 0x105e: return 0x00;
      case 0x1060: return map16[addr >>> 1] >> 0;
      case 0x1070: return cpu.istat;
      case 0x1074: return cpu.imask;
      case 0x10f0: return dma.rd16r10f0();
      case 0x1100: return rc0.getValue();
      case 0x1104: return rc0.getMode();
      case 0x1108: return rc0.getTarget();
      case 0x1110: return rc1.getValue();
      case 0x1114: return rc1.getMode();
      case 0x1118: return rc1.getTarget();
      case 0x1120: return rc2.getValue();
      case 0x1124: return rc2.getMode();
      case 0x1128: return rc2.getTarget();
      case 0x1130: return 0 >> 0;
      case 0x1800: return cdr.rd08r1800();
      case 0x1814: return (gpu.rd32r1814() << 16) >> 16;
      case 0x1824: return (mdc.rd32r1824() << 16) >> 16;
      default:
        if (addr < 0x01801000) {
          psx.clock -= 3;
          return map16[addr >>> 1];
        }
        if (addr >= 0x01802000) {
          psx.clock += 24;
          return map16[addr >>> 1];
        }
        if ((addr >= 0x01801C00) && (addr < 0x01802000)) {
          return spu.getInt16(addr & 0x3fff);
        }
        break;
    }
  }

  function memRead16(base) {
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
    abort(`r16: unable to load from $${hex(base, 8)}`)
  }

  function hwRead32(addr) {
    psx.clock += 3;
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
      case 0x1100: return rc0.getValue() >> 0;
      case 0x1104: return rc0.getMode() >> 0;
      case 0x1108: return rc0.getTarget() >> 0;
      case 0x1110: return rc1.getValue() >> 0;
      case 0x1114: return rc1.getMode() >> 0;
      case 0x1118: return rc1.getTarget() >> 0;
      case 0x1120: return rc2.getValue() >> 0;
      case 0x1124: return rc2.getMode() >> 0;
      case 0x1128: return rc2.getTarget() >> 0;
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
          return spu.getInt16(addr & 0x3fff);
        }
        break;
    }
    abort(`r32: unable to load from $${hex(addr, 8)}`)
  }

  function memRead32(base) {
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
    abort(`r32: unable to load from $${hex(base, 8)}`)
  }

  function hwWrite8(addr, data) {
    switch (addr & 0x3fff) {
      case 0x1040: return joy.wr08r1040(data);
      case 0x10f6: return dma.wr08r10f6(data);
      case 0x1800: return cdr.wr08r1800(data);
      case 0x1801: return cdr.wr08r1801(data);
      case 0x1802: return cdr.wr08r1802(data);
      case 0x1803: return cdr.wr08r1803(data);
      default: abort(`w8: unable to store at $${hex(addr, 8)}`);
    }
  }

  function memWrite8(base, data) {
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
    abort(`w8: unable to store at $${hex(base, 8)}`)
  }

  function hwWrite16(addr, data) {
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
      case 0x1100: return rc0.setValue(data);
      case 0x1104: return rc0.setMode(data);
      case 0x1108: return rc0.setTarget(data);
      case 0x1110: return rc1.setValue(data);
      case 0x1114: return rc1.setMode(data);
      case 0x1118: return rc1.setTarget(data);
      case 0x1120: return rc2.setValue(data);
      case 0x1124: return rc2.setMode(data);
      case 0x1128: return rc2.setTarget(data);
      default:
        if ((addr >= 0x01801C00) && (addr < 0x01802000)) {
          map16[addr >>> 1] = data;
          return spu.setInt16(addr & 0x3fff, data);
        }
        abort(`w16: unable to store at $${hex(addr, 8)}`);
        break;
    }
  }

  function memWrite16(base, data) {
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
    abort(`w16: unable to store at $${hex(base, 8)}`)
  }

  function hwWrite32(addr, data) {
    switch (addr & 0x3fff) {
      case 0x1000: break;
      case 0x1004: break;
      case 0x1008: break;
      case 0x100c: break;
      case 0x1010: break;
      case 0x1014: break;
      case 0x1018: break;
      case 0x101c: break;
      case 0x1020: break;
      case 0x1060: break;
      case 0x1070: cpu.istat &= (data & cpu.imask); break;
      case 0x1074: cpu.imask = data >>> 0; break;
      case 0x1080: dma.r1080 = data >>> 0; break;
      case 0x1084: dma.r1084 = data >>> 0; break;
      case 0x1088: dma.wr32r1088(data); break;
      case 0x1090: dma.r1090 = data >>> 0; break;
      case 0x1094: dma.r1094 = data >>> 0; break;
      case 0x1098: dma.wr32r1098(data); break;
      case 0x10a0: dma.r10a0 = data >>> 0; break;
      case 0x10a4: dma.r10a4 = data >>> 0; break;
      case 0x10a8: dma.wr32r10a8(data); break;
      case 0x10b0: dma.r10b0 = data >>> 0; break;
      case 0x10b4: dma.r10b4 = data >>> 0; break;
      case 0x10b8: dma.wr32r10b8(data); break;
      case 0x10c0: dma.r10c0 = data >>> 0; break;
      case 0x10c4: dma.r10c4 = data >>> 0; break;
      case 0x10c8: dma.wr32r10c8(data); break;
      case 0x10e0: dma.r10e0 = data >>> 0; break;
      case 0x10e4: dma.r10e4 = data >>> 0; break;
      case 0x10e8: dma.wr32r10e8(data); break;
      case 0x10f0: dma.wr32r10f0(data); break;
      case 0x10f4: dma.wr32r10f4(data); break;
      case 0x1100: rc0.setValue(data); break;
      case 0x1104: rc0.setMode(data); break;
      case 0x1108: rc0.setTarget(data); break;
      case 0x1110: rc1.setValue(data); break;
      case 0x1114: rc1.setMode(data); break;
      case 0x1118: rc1.setTarget(data); break;
      case 0x1120: rc2.setValue(data); break;
      case 0x1124: rc2.setMode(data); break;
      case 0x1128: rc2.setTarget(data); break;
      case 0x1810: gpu.wr32r1810(data); break;
      case 0x1814: gpu.wr32r1814(data); break;
      case 0x1820: mdc.wr32r1820(data); break;
      case 0x1824: mdc.wr32r1824(data); break;

      default: abort(`w32: unable to store at $${hex(addr, 8)}`);
    }
  }

  function memWrite32(base, data) {
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
    abort(`w32: unable to store at $${hex(base, 8)}`)
  }

  scope.map = map;
  scope.map8 = map8;
  scope.map16 = map16;

  scope.memRead8 = memRead8;
  scope.memRead16 = memRead16;
  scope.memRead32 = memRead32;
  scope.memWrite8 = memWrite8;
  scope.memWrite16 = memWrite16;
  scope.memWrite32 = memWrite32;

  scope.ram = ram;
  scope.rom = rom;
})(window);
