mdlr('enge:psx:cpu', m => {

  const cop = new Int32Array(32);
  const gpr = new Int32Array(32);

  const cpu = {
    gpr,
    'cause': 0,
    'cycles': 0,
    'epc': 0,
    'hi': 0,
    'imask': 0,
    'istat': 0,
    'icurr': 0,
    'lo': 0,
    'pc': 0,
    'sr': 0,
    forceWriteBits: 0x00000000 >>> 0,

    getCtrl: (reg) => {
      switch (reg) {
        case 12: return cpu.sr >> 0;
        case 13: return cpu.cause >> 0;
        case 14: return cpu.epc >> 0;
        case 15: return 2 >> 0;
      }
      return cop[reg];
    },

    setCtrl: (reg, value) => {
      cop[reg] = value >> 0;
      switch (reg) {
        case 3: break;
        case 5: break;
        case 6: break;
        case 7: break;
        case 9: break;
        case 11: break;
        case 12: cpu.sr = value;
          // trick to force writing to unused memory location with isolated cache
          cpu.forceWriteBits = (value & 0x00010000) ? 0x01fffffc >>> 0 : 0x00000000 >>> 0;
          break;
        case 13: cpu.cause = cpu.cause & 0xfffffcff;
          cpu.cause |= (value & 0x00000300);
          break;
      }
    },

    rfe: () => {
      cpu.sr = (cpu.sr & ~0x0F) | ((cpu.sr >> 2) & 0x0F);
    },

    lwl: (reg, addr) => {
      const data = memRead32((addr & ~3) & 0x01ffffff);
      switch (addr & 3) {
        case 0: gpr[reg] = (gpr[reg] & 0x00FFFFFF) | (data << 24); break;
        case 1: gpr[reg] = (gpr[reg] & 0x0000FFFF) | (data << 16); break;
        case 2: gpr[reg] = (gpr[reg] & 0x000000FF) | (data << 8); break;
        case 3: gpr[reg] = (gpr[reg] & 0x00000000) | (data << 0); break;
      };
    },

    lwr: (reg, addr) => {
      const data = memRead32((addr & ~3) & 0x01ffffff);
      switch (addr & 3) {
        case 0: gpr[reg] = (gpr[reg] & 0x00000000) | (data >>> 0); break;
        case 1: gpr[reg] = (gpr[reg] & 0xFF000000) | (data >>> 8); break;
        case 2: gpr[reg] = (gpr[reg] & 0xFFFF0000) | (data >>> 16); break;
        case 3: gpr[reg] = (gpr[reg] & 0xFFFFFF00) | (data >>> 24); break;
      };
    },

    swl: (reg, addr) => {
      let data = memRead32((addr & ~3) & 0x01ffffff) >>> 0;
      switch (addr & 3) {
        case 0: data = (data & 0xFFFFFF00) | (gpr[reg] >>> 24); break;
        case 1: data = (data & 0xFFFF0000) | (gpr[reg] >>> 16); break;
        case 2: data = (data & 0xFF000000) | (gpr[reg] >>> 8); break;
        case 3: data = (data & 0x00000000) | (gpr[reg] >>> 0); break;
      };
      memWrite32((addr & ~3) & 0x01ffffff, data);
    },

    swr: (reg, addr) => {
      let data = memRead32((addr & ~3) & 0x01ffffff) >>> 0;
      switch (addr & 3) {
        case 0: data = (data & 0x00000000) | (gpr[reg] << 0); break;
        case 1: data = (data & 0x000000FF) | (gpr[reg] << 8); break;
        case 2: data = (data & 0x0000FFFF) | (gpr[reg] << 16); break;
        case 3: data = (data & 0x00FFFFFF) | (gpr[reg] << 24); break;
      };
      memWrite32((addr & ~3) & 0x01ffffff, data);
    },


    neg: (a) => {
      let a00 = (a >> 0) & 0xffff;
      let a16 = (a >> 16) & 0xffff;

      let v = (~a00 & 0xFFFF) + 1;
      a00 = v & 0xFFFF;
      v = (~a16 & 0xFFFF) + (v >>> 16);
      a16 = v & 0xFFFF;

      return (a16 << 16) | a00;
    },

    mult: (a, b) => {
      a >>= 0; b >>= 0;
      let n = 0;
      if (a < 0) { n ^= 1; a = cpu.neg(a); }
      if (b < 0) { n ^= 1; b = cpu.neg(b); }
      cpu.multu(a, b);
      if (n === 1) {
        let a00 = (cpu.lo >>> 0) & 0xffff;
        let a16 = (cpu.lo >>> 16) & 0xffff;
        let a32 = (cpu.hi >>> 0) & 0xffff;
        let a48 = (cpu.hi >>> 16) & 0xffff;

        let v = (~a00 & 0xFFFF) + 1;
        a00 = v & 0xFFFF;
        v = (~a16 & 0xFFFF) + (v >>> 16);
        a16 = v & 0xFFFF;
        v = (~a32 & 0xFFFF) + (v >>> 16);
        a32 = v & 0xFFFF;
        v = (~a48 & 0xFFFF) + (v >>> 16);
        a48 = v & 0xFFFF;

        cpu.hi = ((a48 << 16) | a32) >> 0;
        cpu.lo = ((a16 << 16) | a00) >>> 0;
      }
    },

    multu: (a, b) => {
      a >>>= 0; b >>>= 0;
      let a00 = a & 0xffff;
      let a16 = a >>> 16;
      let b00 = b & 0xffff;
      let b16 = b >>> 16;

      let c48 = 0, c32 = 0, c16 = 0, c00 = 0;
      c00 += (a00 * b00);
      c16 += (c00 >>> 16);
      c00 &= 0xFFFF;

      c16 += (a00 * b16);
      c32 += (c16 >>> 16);
      c16 &= 0xFFFF;

      c16 += (a16 * b00);
      c32 += (c16 >>> 16);
      c16 &= 0xFFFF;

      c32 += (a16 * b16);
      c48 += (c32 >>> 16);
      c32 &= 0xFFFF;

      cpu.hi = ((c48 << 16) | c32) >>> 0;
      cpu.lo = ((c16 << 16) | c00) >>> 0;
    },

    div:  (a, b) => {
      if (b === 0) {
        if ((a >> 0) >= 0) {
          cpu.hi = a;
          cpu.lo = 0xffffffff;
        }
        else {
          cpu.hi = a;
          cpu.lo = 0x00000001;
        }
      }
      else if (((b >> 0) === -1) && ((a >>> 0) === 0x80000000)) {
        cpu.hi = 0 >> 0;
        cpu.lo = 0x80000000 >> 0;
      }
      else {
        cpu.hi = ((a >> 0) % (b >> 0)) >> 0;
        cpu.lo = ((a >> 0) / (b >> 0)) >> 0;
      }
    },

    divu:  (a, b) => {
      if (b === 0) {
        cpu.hi = a;
        cpu.lo = 0xffffffff;
      }
      else {
        cpu.hi = ((a >>> 0) % (b >>> 0)) >>> 0;
        cpu.lo = ((a >>> 0) / (b >>> 0)) >>> 0;
      }
    }
  };

  const cpuException = (id, pc) => {
    cpu.sr = (cpu.sr & ~0x3F) | ((cpu.sr << 2) & 0x3F);
    cpu.cause = (cpu.cause & ~0x7C) | id;
    cpu.epc = pc;
    return vector;
  }

  const cpuInterrupt = (entry) => {
    if ((cpu.sr & 1) === 1) {
      let ip = cpu.cause & 0x300;
      let im = cpu.sr & 0x300;
      if ((ip & im) !== 0) {
        return cpuException((ip & im), entry.pc);
      }
      else
        if ((cpu.sr & 0x400) === 0x400) {
          if (cpu.istat & cpu.imask) {
            return cpuException(0x400, entry.pc);
          }
        }
    }
    return entry;
  }

  return { cpu, cpuException, cpuInterrupt }
})