'use strict';

Uint32Array.prototype.getInt8 = function(index) {
  switch (index & 3) {
    case 0: return (this[index >> 2] << 24) >> 24;
    case 1: return (this[index >> 2] << 16) >> 24;
    case 2: return (this[index >> 2] <<  8) >> 24;
    case 3: return (this[index >> 2] <<  0) >> 24;
  }
}

Uint32Array.prototype.getInt16 = function(index) {
  switch (index & 3) {
    case 0: return (this[index >> 2] << 16) >> 16;
    case 2: return (this[index >> 2] <<  0) >> 16;
    default://abort('unaligned read: ' + hex(index));
  }
}

Uint32Array.prototype.getInt32 = function(index) {
  switch (index & 3) {
    case 0: return (this[index >> 2]) >> 0;
    default://abort('unaligned read: ' + hex(index));
  }
}

Uint32Array.prototype.setInt8 = function(index, data) {
  switch (index & 3) {
    case 0: this[index >> 2] = (this[index >> 2] & 0xffffff00) | ((data & 0xff) <<  0); break;
    case 1: this[index >> 2] = (this[index >> 2] & 0xffff00ff) | ((data & 0xff) <<  8); break;
    case 2: this[index >> 2] = (this[index >> 2] & 0xff00ffff) | ((data & 0xff) << 16); break;
    case 3: this[index >> 2] = (this[index >> 2] & 0x00ffffff) | ((data & 0xff) << 24); break;
  }
}

Uint32Array.prototype.setInt16 = function(index, data) {
  switch (index & 3) {
    case 0: this[index >> 2] = (this[index >> 2] & 0xffff0000) | ((data & 0xffff) <<  0); break;
    case 2: this[index >> 2] = (this[index >> 2] & 0x0000ffff) | ((data & 0xffff) << 16); break;
    default://abort('unaligned write: ' + hex(index));
  }
}

Uint32Array.prototype.setInt32 = function(index, data) {
  switch (index & 3) {
    case 0: this[index >> 2] = data; break;
    default://abort('unaligned write: ' + hex(index));
  }
}

var map = new Uint32Array(0x02000000 >> 2);

var memRead8 = function(addr) {
  var base = addr;// & 0x01ffffff;
  // RAM
  if (base < 0x00800000) {
    return map.getInt8(base & 0x001fffff);
  }
  // EROM
  if (base >= 0x01000000 && base < 0x01080000) {
    return map.getInt8(base);
  }
  if (addr >= 0x01800000 && addr < 0x01801000) {
    return map.getInt8(base);
  }
  // IO-PORTS
  if ((base >= 0x01801000) && (base < 0x01802000)) {
    switch (base & 0x3fff) {
      case 0x1040:  return joy.rd08r1040();
      case 0x10f6:  return dma.rd08r10f6();
      case 0x1800:  return cdr.rd08r1800();
      case 0x1801:  return cdr.rd08r1801();
      case 0x1802:  return cdr.rd08r1802();
      case 0x1803:  return cdr.rd08r1803();
      default:      if ((base >= 0x01801C00) && (base < 0x01802000)) { //chronocross
                      return spu.getInt16(base & 0x3fff);
                    }
                    break;
    }
  }
  // BIOS
  if (base >= 0x01C00000 && base < 0x01C80000) {
    return map.getInt8(base);
  }
  abort(`r8: unable to load from $${addr.toString(16)}`)
}

var memRead8u = function(addr) {
  return memRead8(addr) & 0xFF;
}

var memRead16 = function(addr) {
  var base = addr;// & 0x01ffffff;
  if (base < 0x00800000) {
    return map.getInt16(base & 0x001fffff);
  }
  if (addr >= 0x01800000 && addr < 0x01801000) {
    return map.getInt16(base);
  }
  if ((base >= 0x01801000) && (base < 0x01802000)) {
    switch (base & 0x3fff) {
      case 0x1014:  return map.getInt16(base);
      case 0x1044:  return joy.rd16r1044();
      case 0x104a:  return joy.rd16r104a();
      case 0x104e:  return joy.rd16r104e();
      case 0x1054:  return 0x00;
      case 0x105a:  return 0x00;
      case 0x105e:  return 0x00;
      case 0x1070:  return cpu.istat;
      case 0x1074:  return cpu.imask;
      case 0x10f0:  return dma.rd16r10f0();
      case 0x1100:  return rc0.getValue();
      case 0x1104:  return rc0.getMode();
      case 0x1108:  return rc0.getTarget();
      case 0x1110:  return rc1.getValue();
      case 0x1114:  return rc1.getMode();
      case 0x1118:  return rc1.getTarget();
      case 0x1120:  return rc2.getValue();
      case 0x1124:  return rc2.getMode();
      case 0x1128:  return rc2.getTarget();
      case 0x1130:  return 0 >> 0;
      default:      if ((base >= 0x01801C00) && (base < 0x01802000)) {
                      return spu.getInt16(base & 0x3fff);
                    }
                    break;
    }
  }
  // BIOS
  if (base >= 0x01C00000 && base < 0x01C80000) {
    return map.getInt16(base);
  }
  abort(`r16: unable to load from $${addr.toString(16)}`)
}

var memRead16u = function(addr) {
  return memRead16(addr) & 0xFFFF;
}

const hwRead32 = function(addr) {
  switch (addr & 0x3fff) {
    case 0x1014:  return map.getInt32(addr);
    case 0x1044:  return joy.rd16r1044() >>> 0;
    case 0x1060:  return map.getInt32(addr);
    case 0x1070:  return cpu.istat >>> 0;
    case 0x1074:  return cpu.imask >>> 0;
    case 0x1080:  return dma.r1080 >>> 0;
    case 0x1088:  return dma.r1088 >>> 0;
    case 0x1090:  return dma.r1090 >>> 0;
    case 0x1098:  return dma.r1098 >>> 0;
    case 0x10a0:  return dma.r10a0 >>> 0;
    case 0x10a8:  return dma.r10a8 >>> 0;
    case 0x10b0:  return dma.r10b0 >>> 0;
    case 0x10b8:  return dma.r10b8 >>> 0;
    case 0x10c0:  return dma.r10c0 >>> 0;
    case 0x10c8:  return dma.r10c8 >>> 0;
    case 0x10e0:  return dma.r10e0 >>> 0;
    case 0x10e8:  return dma.r10e8 >>> 0;
    case 0x10f0:  return dma.rd32r10f0() >>> 0;
    case 0x10f4:  return dma.rd32r10f4() >>> 0;
    case 0x1100:  return rc0.getValue() >>> 0;
    case 0x1110:  return rc1.getValue() >>> 0;
    case 0x1120:  return rc2.getValue() >>> 0;
    case 0x1810:  return gpu.rd32r1810() >>> 0;
    case 0x1814:  return gpu.rd32r1814() >>> 0;
    case 0x1820:  return mdc.rd32r1820() >>> 0;
    case 0x1824:  return mdc.rd32r1824() >>> 0;
  }
  abort(`r32: unable to load from $${addr.toString(16)}`)
}

const memRead32 = function(addr) {
  if (addr < 0x00800000) {
    return map[(addr & 0x001fffff) >> 2] >>> 0;
  }
  if (addr >= 0x01800000 && addr < 0x01801000) {
    return map[addr >> 2] >>> 0;
  }
  if ((addr >= 0x01801000) && (addr < 0x01802000)) {
  	return hwRead32(addr) >>> 0;
  }
  // BIOS
  if (addr >= 0x01C00000 && addr < 0x01C80000) {
    return map[addr >> 2] >>> 0;
  }
  if (addr === 0x01fe0130) {
    return map[addr >> 2] >>> 0;
  }
  abort(`r32: unable to load from $${addr.toString(16)}`)
}

var memWrite8 = function(addr, data) {
  var base = addr;// & 0x01ffffff;
  if (base < 0x00800000) {
    if (0 === (cpu.sr & 0x00010000)) {
      map.setInt8(base & 0x001fffff, data);
      clearCodeCache(addr);
    }
    return;
  }
  if ((base >= 0x01800000) && (base < 0x01801000)) {
    return map.setInt8(base, data);
  }
  if ((base >= 0x01801000) && (base < 0x01802000)) {
    switch (base & 0x3fff) {
      case 0x1040:  return joy.wr08r1040(data);
      case 0x10f6:  return dma.wr08r10f6(data);
      case 0x1800:  return cdr.wr08r1800(data);
      case 0x1801:  return cdr.wr08r1801(data);
      case 0x1802:  return cdr.wr08r1802(data);
      case 0x1803:  return cdr.wr08r1803(data);
      }
  }
  if (base === 0x1802041) {
    return map.setInt8(base, data);
  }
  abort(`w8: unable to store at $${addr.toString(16)}`)
}

var memWrite16 = function(addr, data) {
  var base = addr;// & 0x01ffffff;
  if (base < 0x00800000) {
    if (0 === (cpu.sr & 0x00010000)) {
      map.setInt16(base & 0x001fffff, data);
      clearCodeCache(addr);
    }
    return;
  }
  if ((base >= 0x01800000) && (base < 0x01801000)) {
    return map.setInt16(base, data);
  }
  if ((base >= 0x01801000) && (base < 0x01802000)) {
    map.setInt16(base, data);
    switch (base & 0x3fff) {
      case 0x1014:  return map.setInt16(base, data);
      case 0x1048:  return joy.wr16r1048(data);
      case 0x104a:  return joy.wr16r104a(data);
      case 0x104e:  return joy.wr16r104e(data);
      case 0x1058:  return;
      case 0x105a:  return;
      case 0x105e:  return;
      case 0x1070:  //log('cpuIrqAck', hex(data))
                    cpu.istat &= ((data & 0xffff) & cpu.imask); return;
      case 0x1074:  cpu.imask = data; return;
      case 0x10f0:  return dma.wr32r10f0(data);
      case 0x1100:  return rc0.setValue(data);
      case 0x1104:  return rc0.setMode(data);
      case 0x1108:  return rc0.setTarget(data);
      case 0x1110:  return rc1.setValue(data);
      case 0x1114:  return rc1.setMode(data);
      case 0x1118:  return rc1.setTarget(data);
      case 0x1120:  return rc2.setValue(data);
      case 0x1124:  return rc2.setMode(data);
      case 0x1128:  return rc2.setTarget(data);
      default:      if ((base >= 0x01801C00) && (base < 0x01802000)) {
                      map.setInt16(base, data);
                      return spu.setInt16(base & 0x3fff, data);
                    }
                    break;
    }
  }
  abort(`w16: unable to store at $${addr.toString(16)}`)
}

const hwWrite32 = function(addr, data) {
  switch (addr & 0x3fff) {
    case 0x1000:  break;
    case 0x1004:  break;
    case 0x1008:  break;
    case 0x100c:  break;
    case 0x1010:  break;
    case 0x1014:  break;
    case 0x1018:  break;
    case 0x101c:  break;
    case 0x1020:  break;
    case 0x1060:  break;
    case 0x1070:  //log('cpuIrqAck', hex(data))
                  cpu.istat &= (data & cpu.imask); break;
    case 0x1074:  cpu.imask = data >>> 0; break;
    case 0x1080:  dma.r1080 = data >>> 0; break;
    case 0x1084:  dma.r1084 = data >>> 0; break;
    case 0x1088:  dma.wr32r1088(data);    break;
    case 0x1090:  dma.r1090 = data >>> 0; break;
    case 0x1094:  dma.r1094 = data >>> 0; break;
    case 0x1098:  dma.wr32r1098(data);    break;
    case 0x10a0:  dma.r10a0 = data >>> 0; break;
    case 0x10a4:  dma.r10a4 = data >>> 0; break;
    case 0x10a8:  dma.wr32r10a8(data);    break;
    case 0x10b0:  dma.r10b0 = data >>> 0; break;
    case 0x10b4:  dma.r10b4 = data >>> 0; break;
    case 0x10b8:  dma.wr32r10b8(data);    break;
    case 0x10c0:  dma.r10c0 = data >>> 0; break;
    case 0x10c4:  dma.r10c4 = data >>> 0; break;
    case 0x10c8:  dma.wr32r10c8(data);    break;
    case 0x10e0:  dma.r10e0 = data >>> 0; break;
    case 0x10e4:  dma.r10e4 = data >>> 0; break;
    case 0x10e8:  dma.wr32r10e8(data);    break;
    case 0x10f0:  dma.wr32r10f0(data);    break;
    case 0x10f4:  dma.wr32r10f4(data);    break;
    case 0x1104:  rc0.setMode(data);      break;
    case 0x1108:  rc0.setTarget(data);    break;
    case 0x1110:  rc1.setValue(data);     break;
    case 0x1114:  rc1.setMode(data);      break;
    case 0x1118:  rc1.setTarget(data);    break;
    case 0x1124:  rc2.setMode(data);      break;
    case 0x1810:  gpu.wr32r1810(data);    break;
    case 0x1814:  gpu.wr32r1814(data);    break;
    case 0x1820:  mdc.wr32r1820(data);    break;
    case 0x1824:  mdc.wr32r1824(data);    break;

    default:      abort(`w32: unable to store at $${hex(addr, 8)}`);
  }
}

var memWrite32 = function(addr, data) {
  if (addr < 0x00800000) {
    if (0 === (cpu.sr & 0x00010000)) {
  	  map[(addr & 0x001fffff) >> 2] = data;
      clearCodeCache(addr);
    }
    return;
  }
  if (addr >= 0x01800000 && addr < 0x01801000) {
    map[addr >> 2] = data;
    return;
  }
  if ((addr >= 0x01801000) && (addr < 0x01802000)) {
    map[addr >> 2] = data;
    return hwWrite32(addr, data);
  }
  if (addr === 0x01fe0130) {
    map[addr >> 2] = data;
    return;
  }
  abort(`w32: unable to store at $${addr.toString(16)}`)
}