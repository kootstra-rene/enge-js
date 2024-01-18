mdlr('enge:psx:rec', m => {

  function createFunction(pc, code, jumps) {
    const lines = [
      "  return function $" + hex(pc).toUpperCase() + "(psx) { ++calls;\n    " + code.replace(/[\r\n]/g, '\n    ') + "\n  }"
    ];
    lines.unshift('');

    const points = [...new Set(jumps || [])];
    points.forEach(addr => {
      lines.unshift(`  const _${hex(addr)} = getCacheEntry(0x${hex(addr)});`);
    });
    lines.unshift(`'use strict;'`);
    var generator = new Function(lines.join('\n'));
    return generator();
  }

  const rec = {
    '02': (rec, opc) => {
      rec.stop = true;
      rec.jump = true;
      rec.skipNext = true;
      rec.branchTarget = (opc & 0x007FFFFF) << 2;
      const code = rec.setReg(0, `target = _${hex(rec.branchTarget)}`);
      return code;
    },

    '03': (rec, opc) => {
      rec.stop = true;
      rec.jump = true;
      rec.branchTarget = (opc & 0x007FFFFF) << 2;
      const code = rec.setReg(0, `target = _${hex(rec.branchTarget)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
      return code;
    },

    '04': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = rec.setReg(0, `target = (${rec.getRS()} === ${rec.getRT()}) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '05': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = rec.setReg(0, `target = (${rec.getRS()} !== ${rec.getRT()}) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '06': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = rec.setReg(0, `target = (${rec.getRS()} <= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '07': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = rec.setReg(0, `target = (${rec.getRS()} > 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '08': (rec, opc) => {
      const code = rec.setReg(rec.rt, ((opc << 16) >> 16) + ' + ' + rec.getRS());
      return code;
    },

    '09': (rec, opc) => {
      const code = rec.setReg(rec.rt, ((opc << 16) >> 16) + ' + ' + rec.getRS());
      return code;
    },

    '0A': (rec, opc) => {
      const code = rec.setReg(rec.rt, '(' + rec.getRS() + ' < ' + ((opc << 16) >> 16) + ') ? 1 : 0');
      return code;
    },

    '0B': (rec, opc) => {
      const code = rec.setReg(rec.rt, '((' + rec.getRS() + ' >>> 0) < (' + ((opc << 16) >> 16) + ' >>> 0)) ? 1 : 0');
      return code;
    },

    '0C': (rec, opc) => {
      const code = rec.setReg(rec.rt, rec.getRS() + ' & 0x' + hex(opc, 4));
      return code;
    },

    '0D': (rec, opc) => {
      const code = rec.setReg(rec.rt, rec.getRS() + ' | 0x' + hex(opc, 4));
      return code;
    },

    '0E': (rec, opc) => {
      const code = rec.setReg(rec.rt, rec.getRS() + ' ^ 0x' + hex(opc, 4));
      return code;
    },

    '0F': (rec, opc) => {
      const code = rec.setReg(rec.rt, '0x' + hex((opc & 0xffff) << 16), true);
      return code;
    },

    '20': (rec, opc) => {
      const code = rec.setReg(rec.rt, '(memRead8(' + rec.getOF(opc) + ') << 24) >> 24');
      return code;
    },

    '21': (rec, opc) => {
      const code = rec.setReg(rec.rt, '(memRead16 (' + rec.getOF(opc) + ') << 16) >> 16');
      return code;
    },

    '22': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.lwl(' + rec.rt + ', ' + rec.getOF(opc) + ')');
      return code;
    },

    '23': (rec, opc) => {
      const code = rec.setReg(rec.rt, 'memRead32(' + rec.getOF(opc) + ')');
      return code;
    },

    '24': (rec, opc) => {
      const code = rec.setReg(rec.rt, 'memRead8(' + rec.getOF(opc) + ') & 0xff');
      return code;
    },

    '25': (rec, opc) => {
      const code = rec.setReg(rec.rt, 'memRead16(' + rec.getOF(opc) + ') & 0xffff');
      return code;
    },

    '26': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.lwr(' + rec.rt + ', ' + rec.getOF(opc) + ')');
      return code;
    },

    '28': (rec, opc) => {
      const code = rec.setReg(0, 'memWrite8(' + rec.getOF(opc) + ', ' + rec.getRT() + ')');
      return code;
    },

    '29': (rec, opc) => {
      const code = rec.setReg(0, 'memWrite16(' + rec.getOF(opc) + ', ' + rec.getRT() + ')');
      return code;
    },

    '2A': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.swl(' + rec.rt + ', ' + rec.getOF(opc) + ')');
      return code;
    },

    '2B': (rec, opc) => {
      const code = rec.setReg(0, `memWrite32(${rec.getOF(opc)}, ${rec.getRT()})`);
      return code;
    },

    '2E': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.swr(' + rec.rt + ', ' + rec.getOF(opc) + ')');
      return code;
    },

    '32': (rec, opc) => {
      const code = rec.setReg(0, 'gte.set(' + rec.rt + ', memRead32(' + rec.getOF(opc) + '))');
      return code;
    },

    '3A': (rec, opc) => {
      const code = rec.setReg(0, 'memWrite32(' + rec.getOF(opc) + ', gte.get(' + rec.rt + '))');
      return code;
    },

    '40': (rec, opc) => {
      if (opc === 0) return ''; // nop
      const code = rec.setReg(rec.rd, rec.getRT() + ' << ' + ((opc >> 6) & 0x1f));
      return code;
    },

    '42': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRT() + ' >>> ' + ((opc >> 6) & 0x1f));
      return code;
    },

    '43': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRT() + ' >> ' + ((opc >> 6) & 0x1f));
      return code;
    },

    '44': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRT() + ' << (' + rec.getRS() + ' & 0x1f)');
      return code;
    },

    '46': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRT() + ' >>> (' + rec.getRS() + ' & 0x1f)');
      return code;
    },

    '47': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRT() + ' >> (' + rec.getRS() + ' & 0x1f)');
      return code;
    },

    '48': (rec, opc) => {
      rec.stop = true;
      rec.jump = true;
      rec.skipNext = true;
      const code = rec.setReg(0, 'target = getCacheEntry(' + rec.getRS() + ')');
      return code;
    },

    '49': (rec, opc) => {
      rec.stop = true;
      rec.jump = true;
      const code = rec.setReg(rec.rd, '0x' + hex(rec.pc + 8) + ';\ntarget = getCacheEntry(' + rec.getRS() + ')');
      return code;
    },

    '4C': (rec, opc) => {
      rec.stop = true;
      rec.syscall = true;
      const code = rec.setReg(0, 'target = cpuException(8 << 2, 0x' + hex(rec.pc) + ')');
      return code;
    },

    '4D': (rec, opc) => {
      return '//break';
    },

    '50': (rec, opc) => {
      const code = rec.setReg(rec.rd, 'cpu.hi');
      return code;
    },

    '51': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.hi = ' + rec.getRS());
      return code;
    },

    '52': (rec, opc) => {
      const code = rec.setReg(rec.rd, 'cpu.lo');
      return code;
    },

    '53': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.lo = ' + rec.getRS());
      return code;
    },

    '58': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.mult(' + rec.getRS() + ', ' + rec.getRT() + ')');
      rec.cycles += 8;
      return code;
    },

    '59': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.multu(' + rec.getRS() + ', ' + rec.getRT() + ')');
      rec.cycles += 8;
      return code;
    },

    '5A': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.div(' + rec.getRS() + ', ' + rec.getRT() + ')');
      rec.cycles += 35;
      return code;
    },

    '5B': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.divu(' + rec.getRS() + ', ' + rec.getRT() + ')');
      rec.cycles += 35;
      return code;
    },

    '60': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRS() + ' + ' + rec.getRT());
      return code;
    },

    '61': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRS() + ' + ' + rec.getRT());
      return code;
    },

    '62': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRS() + ' - ' + rec.getRT());
      return code;
    },

    '63': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRS() + ' - ' + rec.getRT());
      return code;
    },

    '64': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRS() + ' & ' + rec.getRT());
      return code;
    },

    '65': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRS() + ' | ' + rec.getRT());
      return code;
    },

    '66': (rec, opc) => {
      const code = rec.setReg(rec.rd, rec.getRS() + ' ^ ' + rec.getRT());
      return code;
    },

    '67': (rec, opc) => {
      const code = rec.setReg(rec.rd, '~(' + rec.getRS() + ' | ' + rec.getRT() + ')');
      return code;
    },

    '6A': (rec, opc) => {
      const code = rec.setReg(rec.rd, '(' + rec.getRS() + ' < ' + rec.getRT() + ') ? 1 : 0');
      return code;
    },

    '6B': (rec, opc) => {
      const code = rec.setReg(rec.rd, '((' + rec.getRS() + ' >>> 0) < (' + rec.getRT() + ' >>> 0)) ? 1 : 0');
      return code;
    },

    '80': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = rec.setReg(0, `target = (${rec.getRS()} < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '81': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = rec.setReg(0, `target = (${rec.getRS()} >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '90': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = rec.setReg(0, `target = (${rec.getRS()} < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
      return code;
    },

    '91': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = rec.setReg(0, `target = (${rec.getRS()} >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
      return code;
    },

    'A0': (rec, opc) => {
      const code = rec.setReg(rec.rt, 'cpu.getCtrl(' + rec.rd + ')');
      return code;
    },

    'A4': (rec, opc) => {
      const code = rec.setReg(0, 'cpu.setCtrl(' + rec.rd + ', ' + rec.getRT() + ')');
      return code;
    },

    'B0': (rec, opc) => { // simplicity
      const code = rec.setReg(0, 'cpu.rfe()');
      return code;
    },

    'C0': (rec, opc) => {
      const code = rec.setReg(rec.rt, 'gte.get(' + rec.rd + ')');
      return code;
    },

    'C2': (rec, opc) => {
      const code = rec.setReg(rec.rt, 'gte.get(' + (32 + rec.rd) + ')');
      return code;
    },

    'C4': (rec, opc) => {
      const code = rec.setReg(0, 'gte.set(' + rec.rd + ', ' + rec.getRT() + ')');
      return code;
    },

    'C6': (rec, opc) => {
      const code = rec.setReg(0, 'gte.set(' + (32 + rec.rd) + ', ' + rec.getRT() + ')');
      return code;
    },

    'D0': (rec, opc) => {
      rec.cycles += gte.cycles(opc & 0x1ffffff);
      const code = rec.setReg(0, 'gte.command(0x' + hex(opc & 0x1ffffff) + ')');
      return code;
    },
    'invalid': (rec, opc) => {
      abort('invalid instruction');
    }
  }
  rec.D1 = rec.D0;
  rec.D2 = rec.D0;
  rec.D3 = rec.D0;
  rec.D4 = rec.D0;
  rec.D5 = rec.D0;
  rec.D6 = rec.D0;
  rec.D7 = rec.D0;
  rec.D8 = rec.D0;
  rec.D9 = rec.D0;
  rec.DA = rec.D0;
  rec.DB = rec.D0;
  rec.DC = rec.D0;
  rec.DD = rec.D0;
  rec.DE = rec.D0;
  rec.DF = rec.D0;

  const recmap = new Array(256);
  for (let i = 0; i < 256; ++i) {
    recmap[i] = rec[`${hex(i, 2).toUpperCase()}`] || rec.invalid;
  }

  function compileInstruction(state, lines, delaySlot) {
    const iwordIndex = getCacheIndex(state.pc);
    const opcode = map[iwordIndex >> 2];
    var opc = 0;
    switch ((opcode >>> 26) & 0x3f) {
      default: opc = 0x00 + ((opcode >>> 26) & 0x3f); break;
      case 0x00: opc = 0x40 + ((opcode >>> 0) & 0x3f); break;
      case 0x01: opc = 0x80 + ((opcode >>> 16) & 0x1f); break;
      case 0x10: opc = 0xA0 + ((opcode >>> 21) & 0x1f); break;
      case 0x12: opc = 0xC0 + ((opcode >>> 21) & 0x1f); break;
    }

    state.rd = (opcode >>> 11) & 0x1F;
    state.rs = (opcode >>> 21) & 0x1F;
    state.rt = (opcode >>> 16) & 0x1F;

    lines.push(recmap[opc](state, opcode));
  }

  const state = {
    'pc': 0,
    'rt': 0,
    'rs': 0,
    'rd': 0,
    'stop': false,
    'break': false,
    'syscall': false,
    'cause': false,
    'sr': false,
    'cycles': 0,
    'skipNext': false,
    entry: null,
    branchTarget: 0,
    jump: false,
    entryPC: 0,

    reg: function (r) {
      return r ? 'gpr[' + r + ']' : '0';
    },
    getRS: function () {
      return `${state.reg(state.rs)}`;
    },
    getRT: function () {
      return `${state.reg(state.rt)}`;
    },
    getOF: function (opcode) {
      const offset = ((opcode << 16) >> 16);
      return `(${offset} + ${state.reg(state.rs)}) & 0x01ffffff`;
    },
    setReg: function (nr, value) {
      const iword = map[getCacheIndex(state.pc) >>> 2];
      return ((nr) ? state.reg(nr) + ' = ' : '') + `${value};`;
    },
    clear: function () {
      state.branchTarget = 0;
      state.jump = false;
      state.stop = false;
      state.break = false;
      state.syscall = false;
      state.cause = false;
      state.sr = false;
      state.cycles = 0;
      state.skipNext = false;
    }
  };

  function compileBlockLines(entry) {
    const pc = entry.pc >>> 0;
    state.clear();
    state.pc = pc;
    state.entryPC = pc;
    state.entry = entry;

    const lines = [];

    // todo: limit the amount of cycles per block
    while (!state.stop && state.cycles < 2048) {
      compileInstruction(state, lines, false);
      state.cycles += 1;
      state.pc += 4;
    }

    if (!state.stop && state.cycles >= 64) {
      state.branchTarget = (state.pc >>> 0) & 0x01ffffff;
      state.skipNext = true;
      state.jump = true;
      const code = state.setReg('*snip*', 0, `target = _${hex(state.branchTarget)}`);
      lines.push(code);

      // console.log('abort', lines);
      // debugger;
    }

    if (state.stop && (!state.break && !state.syscall && !state.sr)) {
      compileInstruction(state, lines, true);
      state.cycles += 1;
      state.pc += 4;
    }

    if (pc === 0xa0 || pc === 0xb0 || pc === 0xc0) {
      lines.unshift(`trace(${pc}, gpr[9]);`);
    }
    lines.push('psx.clock += ' + state.cycles + ';');

    return lines;
  }

  function compileBlock(entry) {
    const pc = entry.pc >>> 0;
    let lines = compileBlockLines(entry).join('\n').split('\n');

    entry.jump = getCacheEntry(state.branchTarget);
    entry.next = state.skipNext ? null : getCacheEntry(state.pc);

    let jumps = [
      state.branchTarget >>> 0,
      state.skipNext ? 0 : state.pc >>> 0,
      pc
    ].filter(a => a !== null || a !== undefined);

    lines.push(' ');
    lines.push('return target;');
    lines.unshift(`const gpr = cpu.gpr; let target = _${hex(pc)};\n`);

    if (pc < 0x00200000) {
      lines.unshift(`if (!fastCache[${pc}]) { return invalidateCache(this); }`);
      fastCache[pc] = 1;
    }
    return createFunction(pc, lines.filter(a => a).join('\n'), jumps);
  }


  const cached = new Map();
  const fastCache = new Uint8Array(0x00200000);
  fastCache.fill(0);

  Object.seal(state);
  Object.seal(rec);
  Object.seal(cached);

  function getCacheIndex(pc) {
    let ipc = pc & 0x01ffffff;
    if (ipc < 0x800000) ipc &= 0x1fffff;
    return ipc;
  }

  let clears = 0;
  function clearCodeCache(addr, size) {
    const ibase = getCacheIndex(addr);
    if (ibase >= 0x00200000) return;

    fastCache.fill(0, ibase, ibase + size);
    ++clears;
  }

  function lazyCompile() {
    this.code = compileBlock(this);
    return this;
  }

  function getCacheEntry(pc) {
    const lutIndex = getCacheIndex(pc);
    let entry = cached.get(lutIndex);

    if (!entry) {
      cached.set(lutIndex, entry = CacheEntryFactory.createCacheEntry(lutIndex));
      entry.code = lazyCompile;
    }
    return entry;
  }

  const CacheEntryFactory = {
    createCacheEntry: pc => Object.seal({
      pc: pc >>> 0,
      code: null,
      jump: null,
      next: null,
    })
  };

  const cyclesPerTrace = 33868800;
  const local = window.location.href.indexOf('file://') === 0;
  let prevCounter = 0;
  let prevFpsCounter = 0;
  let prevFpsRenderCounter = 0;

  psx.addEvent(0, self => {
    const renderCounter = renderer.fpsRenderCounter - prevFpsRenderCounter;
    prevFpsRenderCounter = renderer.fpsRenderCounter;

    if (local) console.log(`${calls} ${(cyclesPerTrace / calls).toFixed(1)} ${clears} ${context.counter - prevCounter}/${renderer.fpsCounter - prevFpsCounter}/${renderCounter}`);
    psx.setEvent(self, cyclesPerTrace);
    prevCounter = context.counter;
    prevFpsCounter = renderer.fpsCounter;
    clears = 0;
    calls = 0;
  });

  window.calls = 0;
  window.vector = null;
  window.fastCache = fastCache;
  window.cached = cached;

  window.invalidateCache = entry => {
    entry.code = lazyCompile;
    return entry;
  }

  window.resetCacheEntry = entry => {
    entry.code = lazyCompile;
    return entry;
  }

  return {
    getCacheEntry,
    clearCodeCache,
  }

})
