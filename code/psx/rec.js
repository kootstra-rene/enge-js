mdlr('enge:psx:rec', ({ include }) => {

  const getOF = (opcode) => {
    const offset = ((opcode << 16) >> 16);
    return `(${offset} + ${getRS()}) & 0x01ffffff`;
  };
  const getRS = () => {
    return state.reg(state.rs);
  };
  const getRT = () => {
    return state.reg(state.rt);
  }
  const setReg = (nr, value) => {
    if (nr) state.wreg = nr;
    return (nr ? state.reg(nr) + ' = ' : '') + `${value};`;
  };

  // Deferred GPR write for MIPS-I load-delay slots (loads + MFC0/MFC2/CFC2).
  // The value is computed now but committed to the GPR one instruction later
  // (see compileInstruction), so the delay-slot instruction sees the OLD
  // register value, matching real R3000 behaviour.
  const setLoad = (nr, value) => {
    if (!nr) return `${value};`;
    const tmp = `_ld${state.loadSeq++}`;
    state.newLoad = { reg: nr, tmp };
    return `const ${tmp} = ${value};`;
  };

  // Current value of rt as seen by LWL/LWR, which merge into it. A load to rt
  // that is still in flight is forwarded instead of the stale GPR: from the
  // previous instruction, or (first instruction of a block) from the load
  // deferred across the block boundary in _dr/_dv.
  const getLoadBase = (nr) => {
    if (state.pendingLoad && state.pendingLoad.reg === nr) return state.pendingLoad.tmp;
    if (state.first) return `(_dr === ${nr} ? _dv : ${state.reg(nr)})`;
    return state.reg(nr);
  };

  // PGXP hooks are only generated when the pgxp module is loaded and enabled
  // (?pgxp in the URL); otherwise the compiled code is unchanged.
  const pgxpOn = () => typeof pgxp !== 'undefined' && pgxp.enabled;
  // ?pgxp=cpu: ALU instructions carry fractions too (see PGXP_ALU below)
  const pgxpCpu = () => pgxpOn() && pgxp.cpu;
  // ?debug-pgxp: stores also report their kind and instruction address
  const pgxpDebug = () => pgxpOn() && pgxp.debug;
  // word containing a masked address, like wordOf() in pgxp.js
  const pgxpWord = (a) => `(${a} < 0x00800000 ? map[(${a} & 0x001fffff) >>> 2] : map[${a} >>> 2])`;
  const pgxpNote = (kind, a) => pgxpDebug() ? `\npgxp.noteStore(${kind}, ${a}, 0x${hex(state.pc)});` : '';
  // store through a temporary address so the debug note can use it
  const pgxpStore = (kind, store) => {
    if (!pgxpDebug()) return null;
    const a = `_pa${state.loadSeq++}`;
    return `const ${a} = ${getOF(state.opcode)};\n` + store(a) + pgxpNote(kind, a);
  };
  // same mapping as shadowIndex() in pgxp.js, inlined into compiled code
  const pgxpIndex = (a) => `((${a} < 0x00800000 ? (${a} & 0x001fffff) : (0x00200000 | (${a} & 0x3ff))) >>> 2)`;

  // PGXP: `addu rd, rs, zero` / `or rd, rs, zero` (and the mirrored forms)
  // are register moves; carry the sub-pixel fraction along with the value.
  const pgxpMove = (rec) => {
    if (!pgxpOn() || pgxpCpu() || !rec.rd) return '';
    if (rec.rt === 0) return `\npgxp.move(${rec.rd}, ${rec.rs});`;
    if (rec.rs === 0) return `\npgxp.move(${rec.rd}, ${rec.rt});`;
    return '';
  };

  const createFunction = (pc, code, jumps) => {
    const lines = [
      "  return function $" + hex(pc).toUpperCase() + "(psx) { ++calls;\n    " + code.replace(/[\r\n]/g, '\n    ') + "\n  }"
    ];
    lines.unshift('');

    const points = [...new Set(jumps?.filter(a => a) || [])];
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
      const code = setReg(0, `target = _${hex(rec.branchTarget)}`);
      return code;
    },

    '03': (rec, opc) => {
      rec.stop = true;
      rec.jump = true;
      rec.branchTarget = (opc & 0x007FFFFF) << 2;
      const code = setReg(0, `target = _${hex(rec.branchTarget)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
      rec.wreg = 31;
      return code;
    },

    '04': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = setReg(0, `target = (${getRS()} === ${getRT()}) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '05': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = setReg(0, `target = (${getRS()} !== ${getRT()}) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '06': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = setReg(0, `target = (${getRS()} <= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '07': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = setReg(0, `target = (${getRS()} > 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '08': (rec, opc) => {
      const code = setReg(rec.rt, ((opc << 16) >> 16) + ' + ' + getRS());
      return code;
    },

    '09': (rec, opc) => {
      const code = setReg(rec.rt, ((opc << 16) >> 16) + ' + ' + getRS());
      // addiu rt, rs, 0 is a register move
      if (pgxpOn() && !pgxpCpu() && rec.rt && !(opc & 0xffff)) return code + `\npgxp.move(${rec.rt}, ${rec.rs});`;
      return code;
    },

    '0A': (rec, opc) => {
      const code = setReg(rec.rt, '(' + getRS() + ' < ' + ((opc << 16) >> 16) + ') ? 1 : 0');
      return code;
    },

    '0B': (rec, opc) => {
      const code = setReg(rec.rt, '((' + getRS() + ' >>> 0) < (' + ((opc << 16) >> 16) + ' >>> 0)) ? 1 : 0');
      return code;
    },

    '0C': (rec, opc) => {
      const code = setReg(rec.rt, getRS() + ' & 0x' + hex(opc, 4));
      return code;
    },

    '0D': (rec, opc) => {
      const code = setReg(rec.rt, getRS() + ' | 0x' + hex(opc, 4));
      return code;
    },

    '0E': (rec, opc) => {
      const code = setReg(rec.rt, getRS() + ' ^ 0x' + hex(opc, 4));
      return code;
    },

    '0F': (rec, opc) => {
      const code = setReg(rec.rt, '0x' + hex((opc & 0xffff) << 16), true);
      return code;
    },

    '20': (rec, opc) => {
      const code = setLoad(rec.rt, '(memRead8(' + getOF(opc) + ') << 24) >> 24');
      return code;
    },

    '21': (rec, opc) => {
      if (pgxpOn()) return pgxpHalfLoad(rec, opc, a => `(memRead16(${a}) << 16) >> 16`);
      const code = setLoad(rec.rt, '(memRead16 (' + getOF(opc) + ') << 16) >> 16');
      return code;
    },

    '22': (rec, opc) => {
      const code = setLoad(rec.rt, 'cpu.lwl(' + getLoadBase(rec.rt) + ', ' + getOF(opc) + ')');
      return code;
    },

    '23': (rec, opc) => {
      if (pgxpOn()) {
        // inline fast path: only call into pgxp when the word has a fraction
        const a = `_pa${state.loadSeq++}`;
        const code = `const ${a} = ${getOF(opc)};\n` + setLoad(rec.rt, `memRead32(${a})`);
        const value = state.newLoad ? state.newLoad.tmp : null;
        if (!value) return code;
        return code + `\nif (pgxpMemFrac[${pgxpIndex(a)}] !== 0) pgxp.lw(${rec.rt}, ${a}, ${value});`;
      }
      const code = setLoad(rec.rt, 'memRead32(' + getOF(opc) + ')');
      return code;
    },

    '24': (rec, opc) => {
      const code = setLoad(rec.rt, 'memRead8(' + getOF(opc) + ') & 0xff');
      return code;
    },

    '25': (rec, opc) => {
      if (pgxpOn()) return pgxpHalfLoad(rec, opc, a => `memRead16(${a}) & 0xffff`);
      const code = setLoad(rec.rt, 'memRead16(' + getOF(opc) + ') & 0xffff');
      return code;
    },

    '26': (rec, opc) => {
      const code = setLoad(rec.rt, 'cpu.lwr(' + getLoadBase(rec.rt) + ', ' + getOF(opc) + ')');
      return code;
    },

    '28': (rec, opc) => {
      const debug = pgxpStore(1, a => `memWrite8(${a}, ${getRT()});`);
      if (debug) return debug;
      const code = setReg(0, 'memWrite8(' + getOF(opc) + ', ' + getRT() + ')');
      return code;
    },

    '29': (rec, opc) => {
      if (pgxpOn()) {
        // the word before the store is needed to keep the other half's fraction
        const a = `_pa${state.loadSeq++}`, c = `_pc${state.loadSeq}`, w = `_pw${state.loadSeq}`;
        return `const ${a} = ${getOF(opc)};\n` +
          `const ${c} = (pgxpGprFrac[${rec.rt}] | pgxpMemFrac[${pgxpIndex(a)}]) !== 0, ${w} = ${c} ? ${pgxpWord(a)} : 0;\n` +
          `memWrite16(${a}, ${getRT()});\n` +
          `if (${c}) pgxp.sh(${rec.rt}, ${a}, ${getRT()}, ${w});` + pgxpNote(2, a);
      }
      const debug = pgxpStore(2, a => `memWrite16(${a}, ${getRT()});`);
      if (debug) return debug;
      const code = setReg(0, 'memWrite16(' + getOF(opc) + ', ' + getRT() + ')');
      return code;
    },

    '2A': (rec, opc) => {
      const debug = pgxpStore(5, a => `cpu.swl(${rec.rt}, ${a});`);
      if (debug) return debug;
      const code = setReg(0, 'cpu.swl(' + rec.rt + ', ' + getOF(opc) + ')');
      return code;
    },

    '2B': (rec, opc) => {
      if (pgxpOn()) {
        // inline fast path: only call into pgxp when rt carries a fraction
        const a = `_pa${state.loadSeq++}`;
        if (!rec.rt) return `const ${a} = ${getOF(opc)};\nmemWrite32(${a}, 0);` + pgxpNote(3, a);
        return `const ${a} = ${getOF(opc)};\nmemWrite32(${a}, ${getRT()});\n` +
          `if (pgxpGprFrac[${rec.rt}] !== 0) pgxp.sw(${rec.rt}, ${a}, ${getRT()});` + pgxpNote(3, a);
      }
      const code = setReg(0, `memWrite32(${getOF(opc)}, ${getRT()})`);
      return code;
    },

    '2E': (rec, opc) => {
      const debug = pgxpStore(5, a => `cpu.swr(${rec.rt}, ${a});`);
      if (debug) return debug;
      const code = setReg(0, 'cpu.swr(' + rec.rt + ', ' + getOF(opc) + ')');
      return code;
    },

    '32': (rec, opc) => {
      if (pgxpOn() && rec.rt >= 0x0c && rec.rt <= 0x0f) {
        const a = `_pa${state.loadSeq++}`, v = `_pv${state.loadSeq}`;
        return `const ${a} = ${getOF(opc)}, ${v} = memRead32(${a});\ngte.set(${rec.rt}, ${v});\n` +
          `if (pgxpMemFrac[${pgxpIndex(a)}] !== 0) pgxp.lwc2(${rec.rt}, ${a}, ${v});`;
      }
      const code = setReg(0, 'gte.set(' + rec.rt + ', memRead32(' + getOF(opc) + '))');
      return code;
    },

    '3A': (rec, opc) => {
      if (pgxpOn()) return (pgxpDebug() ? `pgxp.pc = 0x${hex(rec.pc)};\n` : '') + setReg(0, `pgxp.swc2(${rec.rt}, ${getOF(opc)})`);
      const code = setReg(0, 'memWrite32(' + getOF(opc) + ', gte.get(' + rec.rt + '))');
      return code;
    },

    '40': (rec, opc) => {
      if (opc === 0) return ''; // nop
      const code = setReg(rec.rd, getRT() + ' << ' + ((opc >> 6) & 0x1f));
      return code;
    },

    '42': (rec, opc) => {
      const code = setReg(rec.rd, getRT() + ' >>> ' + ((opc >> 6) & 0x1f));
      return code;
    },

    '43': (rec, opc) => {
      const code = setReg(rec.rd, getRT() + ' >> ' + ((opc >> 6) & 0x1f));
      return code;
    },

    '44': (rec, opc) => {
      const code = setReg(rec.rd, getRT() + ' << (' + getRS() + ' & 0x1f)');
      return code;
    },

    '46': (rec, opc) => {
      const code = setReg(rec.rd, getRT() + ' >>> (' + getRS() + ' & 0x1f)');
      return code;
    },

    '47': (rec, opc) => {
      const code = setReg(rec.rd, getRT() + ' >> (' + getRS() + ' & 0x1f)');
      return code;
    },

    '48': (rec, opc) => {
      rec.stop = true;
      rec.jump = true;
      rec.skipNext = true;
      const code = setReg(0, 'target = getCacheEntry(' + getRS() + ')');
      return code;
    },

    '49': (rec, opc) => {
      rec.stop = true;
      rec.jump = true;
      // Read rs before writing the link register: with `jalr rX, rX` the jump
      // must go to the old value of rX, not to the return address.
      const code = setReg(0, 'target = getCacheEntry(' + getRS() + ')') + '\n' + setReg(rec.rd, '0x' + hex(rec.pc + 8));
      return code;
    },

    '4C': (rec, opc) => {
      rec.stop = true;
      rec.syscall = true;
      const code = setReg(0, 'target = cpuException(8 << 2, 0x' + hex(rec.pc) + ')');
      return code;
    },

    '4D': (rec, opc) => {
      return '//break';
    },

    '50': (rec, opc) => {
      const code = setReg(rec.rd, 'cpu.hi');
      return code;
    },

    '51': (rec, opc) => {
      const code = setReg(0, 'cpu.hi = ' + getRS());
      return code;
    },

    '52': (rec, opc) => {
      const code = setReg(rec.rd, 'cpu.lo');
      return code;
    },

    '53': (rec, opc) => {
      const code = setReg(0, 'cpu.lo = ' + getRS());
      return code;
    },

    '58': (rec, opc) => {
      const code = setReg(0, 'cpu.mult(' + getRS() + ', ' + getRT() + ')');
      rec.cycles += 8;
      return code;
    },

    '59': (rec, opc) => {
      const code = setReg(0, 'cpu.multu(' + getRS() + ', ' + getRT() + ')');
      rec.cycles += 8;
      return code;
    },

    '5A': (rec, opc) => {
      const code = setReg(0, 'cpu.div(' + getRS() + ', ' + getRT() + ')');
      rec.cycles += 35;
      return code;
    },

    '5B': (rec, opc) => {
      const code = setReg(0, 'cpu.divu(' + getRS() + ', ' + getRT() + ')');
      rec.cycles += 35;
      return code;
    },

    '60': (rec, opc) => {
      const code = setReg(rec.rd, getRS() + ' + ' + getRT());
      return code;
    },

    '61': (rec, opc) => {
      const code = setReg(rec.rd, getRS() + ' + ' + getRT());
      return code + pgxpMove(rec);
    },

    '62': (rec, opc) => {
      const code = setReg(rec.rd, getRS() + ' - ' + getRT());
      return code;
    },

    '63': (rec, opc) => {
      const code = setReg(rec.rd, getRS() + ' - ' + getRT());
      return code;
    },

    '64': (rec, opc) => {
      const code = setReg(rec.rd, getRS() + ' & ' + getRT());
      return code;
    },

    '65': (rec, opc) => {
      const code = setReg(rec.rd, getRS() + ' | ' + getRT());
      return code + pgxpMove(rec);
    },

    '66': (rec, opc) => {
      const code = setReg(rec.rd, getRS() + ' ^ ' + getRT());
      return code;
    },

    '67': (rec, opc) => {
      const code = setReg(rec.rd, '~(' + getRS() + ' | ' + getRT() + ')');
      return code;
    },

    '6A': (rec, opc) => {
      const code = setReg(rec.rd, '(' + getRS() + ' < ' + getRT() + ') ? 1 : 0');
      return code;
    },

    '6B': (rec, opc) => {
      const code = setReg(rec.rd, '((' + getRS() + ' >>> 0) < (' + getRT() + ' >>> 0)) ? 1 : 0');
      return code;
    },

    '80': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = setReg(0, `target = (${getRS()} < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '81': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = setReg(0, `target = (${getRS()} >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
      return code;
    },

    '90': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = setReg(0, `target = (${getRS()} < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
      rec.wreg = 31;
      return code;
    },

    '91': (rec, opc) => {
      rec.stop = true;
      rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
      const code = setReg(0, `target = (${getRS()} >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
      rec.wreg = 31;
      return code;
    },

    'A0': (rec, opc) => {
      const code = setLoad(rec.rt, 'cpu.getCtrl(' + rec.rd + ')');
      return code;
    },

    'A4': (rec, opc) => {
      // SR/CAUSE writes can unmask a pending interrupt: end the block so it is
      // taken right after this instruction.
      if (rec.rd === 12 || rec.rd === 13) rec.sync = true;
      const code = setReg(0, 'cpu.setCtrl(' + rec.rd + ', ' + getRT() + ')');
      return code;
    },

    'B0': (rec, opc) => { // simplicity
      rec.sync = true;
      const code = setReg(0, 'cpu.rfe()');
      return code;
    },

    'C0': (rec, opc) => {
      if (pgxpOn()) return setLoad(rec.rt, `pgxp.mfc2(${rec.rt}, ${rec.rd})`);
      const code = setLoad(rec.rt, 'gte.get(' + rec.rd + ')');
      return code;
    },

    'C2': (rec, opc) => {
      const code = setLoad(rec.rt, 'gte.get(' + (32 + rec.rd) + ')');
      return code;
    },

    'C4': (rec, opc) => {
      const code = setReg(0, 'gte.set(' + rec.rd + ', ' + getRT() + ')');
      if (pgxpOn() && rec.rd >= 0x0c && rec.rd <= 0x0f && rec.rt) {
        return code + `\nif (pgxpGprFrac[${rec.rt}] !== 0) pgxp.mtc2(${rec.rd}, ${rec.rt}, ${getRT()});`;
      }
      return code;
    },

    'C6': (rec, opc) => {
      const code = setReg(0, 'gte.set(' + (32 + rec.rd) + ', ' + getRT() + ')');
      return code;
    },

    'D0': (rec, opc) => {
      rec.cycles += gte.cycles(opc & 0x1ffffff);
      const code = setReg(0, 'gte.command(0x' + hex(opc & 0x1ffffff) + ')');
      return code;
    },
    'invalid': (rec, opc) => {
      abort('invalid instruction');
    }
  }
  // PGXP: LH/LHU through a temporary address; the fraction of that half of
  // the word becomes the x half of rt (after the load delay, like LW)
  function pgxpHalfLoad(rec, opc, load) {
    const a = `_pa${state.loadSeq++}`;
    const code = `const ${a} = ${getOF(opc)};\n` + setLoad(rec.rt, load(a));
    const value = state.newLoad ? state.newLoad.tmp : null;
    if (!value) return code;
    return code + `\nif (pgxpMemFrac[${pgxpIndex(a)}] !== 0) pgxp.lh(${rec.rt}, ${a}, ${value});`;
  }

  // PGXP CPU mode (?pgxp=cpu): before these ALU instructions, if a source
  // register carries a fraction, pgxp.alu() computes the result's fraction.
  // [kind (see pgxp.js), operand form]
  //   r: rd = rs op rt   i: rt = rs op simm16   u: rt = rs op uimm16   s: rd = rt op sa
  const PGXP_ALU = {
    '08': [5, 'i'], '09': [5, 'i'], '0C': [7, 'u'], '0D': [6, 'u'],
    '40': [8, 's'], '42': [9, 's'], '43': [10, 's'],
    '60': [1, 'r'], '61': [1, 'r'], '62': [2, 'r'], '63': [2, 'r'], '64': [4, 'r'], '65': [3, 'r'],
  };
  for (const [key, [kind, form]] of Object.entries(PGXP_ALU)) {
    const base = rec[key];
    rec[key] = (st, opc) => {
      const code = base(st, opc);
      if (!pgxpCpu() || opc === 0) return code;
      const R = (r) => st.reg(r);
      let pre = '';
      switch (form) {
        case 'r': if (st.rd) pre = `if ((pgxpGprFrac[${st.rs}] | pgxpGprFrac[${st.rt}]) !== 0) pgxp.alu(${kind}, ${st.rd}, ${st.rs}, ${st.rt}, ${R(st.rs)}, ${R(st.rt)}, 0);`; break;
        case 'i': if (st.rt) pre = `if (pgxpGprFrac[${st.rs}] !== 0) pgxp.alu(${kind}, ${st.rt}, ${st.rs}, 0, ${R(st.rs)}, 0, ${(opc << 16) >> 16});`; break;
        case 'u': if (st.rt) pre = `if (pgxpGprFrac[${st.rs}] !== 0) pgxp.alu(${kind}, ${st.rt}, ${st.rs}, 0, ${R(st.rs)}, 0, ${opc & 0xffff});`; break;
        case 's': if (st.rd) pre = `if (pgxpGprFrac[${st.rt}] !== 0) pgxp.alu(${kind}, ${st.rd}, 0, ${st.rt}, 0, ${R(st.rt)}, ${(opc >> 6) & 0x1f});`; break;
      }
      return pre ? pre + '\n' + code : code;
    };
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

  function compileInstruction(state, lines) {
    const iwordIndex = getCacheIndex(state.pc);
    const opcode = map[iwordIndex >> 2];
    let opc = 0;
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

    state.wreg = 0;
    state.newLoad = null;
    state.opcode = opcode;
    lines.push(recmap[opc](state, opcode));

    // MIPS-I load delay: commit the previous instruction's pending load now
    // (after this delay-slot instruction's reads), unless this instruction
    // overwrote the same register — in which case that write wins — or is
    // itself a load to the same register, which cancels the first load.
    if (state.pendingLoad) {
      const reg = state.pendingLoad.reg;
      if (reg !== state.wreg && !(state.newLoad && state.newLoad.reg === reg)) {
        lines.push(`gpr[${state.pendingLoad.reg}] = ${state.pendingLoad.tmp};`);
      }
      state.pendingLoad = null;
    }
    if (state.newLoad) {
      state.pendingLoad = state.newLoad;
      state.newLoad = null;
    }
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
    sync: false,
    first: false,
    loadSeq: 0,
    pendingLoad: null,
    newLoad: null,
    wreg: 0,
    entry: null,
    branchTarget: 0,
    jump: false,
    entryPC: 0,

    reg: (r) => {
      return r ? 'gpr[' + r + ']' : '0';
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
      state.sync = false;
      state.first = false;
      state.loadSeq = 0;
      state.pendingLoad = null;
      state.newLoad = null;
      state.wreg = 0;
    }
  };

  const compileBlockLines = (entry) => {
    const pc = entry.pc >>> 0;
    state.clear();
    state.pc = pc;
    state.entryPC = pc;
    state.entry = entry;

    const lines = [];

    // Cross-block load delay (Tekken 2 "vertex explosions" fix): a load in a
    // branch delay slot is the last instruction of this block, so its GPR write
    // must be deferred into the NEXT block and only become visible AFTER that
    // block's first instruction. The pending load is carried at runtime in
    // cpu.dr/cpu.dv (captured here, applied below). We emit the apply right
    // after the first instruction, honouring slot-write-wins (if that first
    // instruction writes the same register, the load is discarded).
    let firstApplied = false;
    state.first = true;

    // todo: limit the amount of cycles per block
    while (!state.stop && !state.sync && state.cycles < 2048) {
      compileInstruction(state, lines, false);
      if (!firstApplied) {
        firstApplied = true;
        state.first = false;
        const fw = state.wreg || (state.pendingLoad ? state.pendingLoad.reg : 0);
        lines.push(`if (_dr !== 0 && _dr !== ${fw}) { gpr[_dr] = _dv; }`);
      }
      state.cycles += 1;
      state.pc += 4;
    }

    if (!state.stop && (state.sync || state.cycles >= 64)) {
      state.branchTarget = (state.pc >>> 0) & 0x01ffffff;
      state.skipNext = true;
      state.jump = true;
      const code = setReg(0, `target = _${hex(state.branchTarget)}`);
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
    // A load still pending at the block boundary is a branch-delay-slot load:
    // defer its GPR write into the next block (see cross-block load delay above)
    // instead of committing it here, so the next block's first instruction still
    // sees the OLD register value.
    if (state.pendingLoad) {
      lines.push(`cpu.dr = ${state.pendingLoad.reg}; cpu.dv = ${state.pendingLoad.tmp};`);
      state.pendingLoad = null;
    }
    lines.push('psx.clock += ' + state.cycles + ';');

    return lines;
  }

  const compileBlock = (entry) => {
    const pc = entry.pc >>> 0;
    let lines = compileBlockLines(entry).join('\n').split('\n');

    // entry.jump = getCacheEntry(state.branchTarget);
    // entry.next = state.skipNext ? null : getCacheEntry(state.pc);

    let jumps = [
      state.branchTarget >>> 0,
      state.skipNext ? 0 : state.pc >>> 0,
      // pc
    ].filter(a => a !== null || a !== undefined);

    lines.push(' ');
    lines.push('return target;');
    // lines.unshift(`const gpr = cpu.gpr; let target = _${hex(pc)};\n`);
    lines.unshift(`const gpr = cpu.gpr; let target; const _dr = cpu.dr, _dv = cpu.dv; cpu.dr = 0;\n`);

    if (pc < RAM_SIZE) {
      // state.pc is one past the last compiled instruction (incl. delay slot)
      registerBlock(entry, pc, Math.min(state.pc >>> 0, RAM_SIZE));
    }
    return createFunction(pc, lines.filter(a => a).join('\n'), jumps);
  }

  const cached = new Map();

  // ---------------------------------------------------------------------------
  // Self-modifying code detection for RAM.
  //
  // codeWords has one byte per RAM word: non-zero when at least one compiled
  // block contains that instruction word. mmu.js checks it on every RAM store
  // and only calls invalidateCodeWord() when an actual instruction word is
  // overwritten, so data that merely sits next to code never triggers a
  // recompile.
  //
  // To find the blocks that contain a word, RAM is split into lines of
  // CODE_LINE_SIZE bytes; every block is listed in each line it spans
  // (including blocks entered in the middle of other blocks). Invalidation
  // resets only the blocks whose [start, end) range contains the written
  // word, then clears codeWords for words no remaining block covers.
  //
  // Entries are reset in place (entry.code = lazyCompile) and never deleted:
  // compiled blocks hold direct references to their jump targets.
  // ---------------------------------------------------------------------------
  const RAM_SIZE = 0x00200000;
  const CODE_LINE_SHIFT = 8;
  const CODE_LINE_SIZE = 1 << CODE_LINE_SHIFT;
  const codeWords = new Uint8Array(RAM_SIZE >>> 2);
  const lineBlocks = new Array(RAM_SIZE >>> CODE_LINE_SHIFT);
  for (let i = 0; i < lineBlocks.length; ++i) lineBlocks[i] = [];

  let recompiles = 0;
  let invalidations = 0;

  function registerBlock(entry, start, end) {
    if (entry.end) unregisterBlock(entry);
    if (end <= start) end = start + 4;
    entry.start = start;
    entry.end = end;
    const firstLine = start >>> CODE_LINE_SHIFT;
    const lastLine = (end - 1) >>> CODE_LINE_SHIFT;
    for (let line = firstLine; line <= lastLine; ++line) {
      lineBlocks[line].push(entry);
    }
    codeWords.fill(1, start >>> 2, end >>> 2);
  }

  function unregisterBlock(entry) {
    const firstLine = entry.start >>> CODE_LINE_SHIFT;
    const lastLine = (entry.end - 1) >>> CODE_LINE_SHIFT;
    for (let line = firstLine; line <= lastLine; ++line) {
      const list = lineBlocks[line];
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
    }
    entry.start = entry.end = 0;
  }

  // Recompute codeWords for [start, end) from the blocks still registered.
  function refreshCodeWords(start, end) {
    codeWords.fill(0, start >>> 2, end >>> 2);
    const firstLine = start >>> CODE_LINE_SHIFT;
    const lastLine = (end - 1) >>> CODE_LINE_SHIFT;
    for (let line = firstLine; line <= lastLine; ++line) {
      for (const block of lineBlocks[line]) {
        const s = Math.max(block.start, start);
        const e = Math.min(block.end, end);
        if (e > s) codeWords.fill(1, s >>> 2, e >>> 2);
      }
    }
  }

  // Reset every block overlapping RAM range [start, end).
  function invalidateRange(start, end) {
    const firstLine = start >>> CODE_LINE_SHIFT;
    const lastLine = (end - 1) >>> CODE_LINE_SHIFT;
    let lo = start, hi = end;
    for (let line = firstLine; line <= lastLine; ++line) {
      const list = lineBlocks[line];
      for (let i = list.length - 1; i >= 0; --i) {
        const block = list[i];
        if (block.start >= end || block.end <= start) continue;
        if (block.start < lo) lo = block.start;
        if (block.end > hi) hi = block.end;
        unregisterBlock(block);
        block.code = lazyCompile;
        ++invalidations;
      }
    }
    refreshCodeWords(lo & ~3, hi);
  }

  // Called by mmu.js when a store hits a word flagged in codeWords.
  function invalidateCodeWord(addr) {
    const word = addr & (RAM_SIZE - 4);
    invalidateRange(word, word + 4);
  }

  function getCacheIndex(pc) {
    let ipc = pc & 0x01ffffff;
    if (ipc < 0x800000) ipc &= 0x1fffff;
    return ipc;
  }

  let clears = 0;
  function clearCodeCache(addr, size) {
    const ibase = getCacheIndex(addr) & ~3;
    const iend = getCacheIndex(addr) + size;
    if (ibase < RAM_SIZE) {
      if (iend <= ibase) return;
      invalidateRange(ibase, Math.min(iend, RAM_SIZE));
      // DMA addresses wrap around the 2MB RAM mirror
      if (iend > RAM_SIZE) invalidateRange(0, Math.min(iend - RAM_SIZE, RAM_SIZE));
    }
    else {
      // The BIOS is mapped above RAM and is not covered by codeWords, so its
      // blocks are reset explicitly. Entries are reset in place and never
      // deleted: compiled blocks hold direct references to their jump targets.
      for (const [pc, entry] of cached) {
        if (pc >= ibase && pc < iend) entry.code = lazyCompile;
      }
    }
    ++clears;
  }

  function lazyCompile() {
    ++recompiles;
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
    createCacheEntry: pc => ({
      pc: pc >>> 0,
      code: null,
      // jump: null,
      // next: null,
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

    if (local) console.log(`${calls} ${(cyclesPerTrace / calls).toFixed(1)} ${clears} rec:${recompiles} inv:${invalidations} ${context.counter - prevCounter}/${renderer.fpsCounter - prevFpsCounter}/${renderCounter}`);
    psx.setEvent(self, cyclesPerTrace);
    prevCounter = context.counter;
    prevFpsCounter = renderer.fpsCounter;
    clears = 0;
    recompiles = 0;
    invalidations = 0;
    calls = 0;
  });

  window.calls = 0;
  window.vector = null;
  window.codeWords = codeWords;
  window.invalidateCodeWord = invalidateCodeWord;
  window.cached = cached;

  window.resetCacheEntry = entry => {
    if (entry.end) unregisterBlock(entry);
    entry.code = lazyCompile;
    return entry;
  }

  return {
    getCacheEntry,
    clearCodeCache,
  }

})
