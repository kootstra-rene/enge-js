mdlr('enge:psx:test-asm', () => {

  // A small MIPS I assembler for the specs, so hardware tests written in
  // assembly can be kept close to their original source.
  //
  //   const { words, labels } = assemble(`
  //     loop:  lw    $t0, 0($a0)
  //            bnez  $t0, loop
  //            addiu $a0, $a0, 4
  //   `, 0x1000);
  //
  // The assembler never reorders: delay slots are written out explicitly, as
  // with `.set noreorder`. Comments start with # or //, or are /* blocks */;
  // `;` separates statements on one line. `.word` emits data, `.space n`
  // zero bytes, other directives are ignored. Immediates are numbers, labels,
  // %hi(x) / %lo(x), `.` (the current address), sums and products of those,
  // and symbols from `.set NAME, value`. Numeric
  // local labels work as in GNU as (`1:` ... `b 1b`, `b 1f`), and so do the
  // two-operand shorthands (`ori $v0, 8`, `addu $v0, $a0`, `sll $v0, 2`).

  const REGS = [
    'zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
    't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
    's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
    't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra',
  ];
  const REG = new Map(REGS.map((name, i) => [name, i]));
  REG.set('s8', 30);

  const reg = text => {
    const name = text.trim().replace(/^\$/, '');
    if (/^\d+$/.test(name) && +name < 32) return +name;
    if (REG.has(name)) return REG.get(name);
    throw new Error(`not a register: ${text}`);
  };

  // R-type funct, I-type opcode and REGIMM rt codes
  const FUNCT = {
    sll: 0x00, srl: 0x02, sra: 0x03, sllv: 0x04, srlv: 0x06, srav: 0x07,
    jr: 0x08, jalr: 0x09, syscall: 0x0c, break: 0x0d,
    mfhi: 0x10, mthi: 0x11, mflo: 0x12, mtlo: 0x13,
    mult: 0x18, multu: 0x19, div: 0x1a, divu: 0x1b,
    add: 0x20, addu: 0x21, sub: 0x22, subu: 0x23,
    and: 0x24, or: 0x25, xor: 0x26, nor: 0x27, slt: 0x2a, sltu: 0x2b,
  };
  const IMM = { addi: 0x08, addiu: 0x09, slti: 0x0a, sltiu: 0x0b, andi: 0x0c, ori: 0x0d, xori: 0x0e };
  const MEM = {
    lb: 0x20, lh: 0x21, lwl: 0x22, lw: 0x23, lbu: 0x24, lhu: 0x25, lwr: 0x26,
    sb: 0x28, sh: 0x29, swl: 0x2a, sw: 0x2b, swr: 0x2e,
    lwc0: 0x30, lwc1: 0x31, lwc2: 0x32, lwc3: 0x33,
    swc0: 0x38, swc1: 0x39, swc2: 0x3a, swc3: 0x3b,
  };
  const REGIMM = { bltz: 0x00, bgez: 0x01, bltzal: 0x10, bgezal: 0x11 };

  // GTE commands with the sf/lm/mvmva fields most code uses; `cop2 imm` for others
  const GTE = {
    rtps: 0x0180001, rtpt: 0x0280030, nclip: 0x1400006, op: 0x170000c, op0: 0x170000c, op12: 0x178000c,
    dpcs: 0x0780010, intpl: 0x0980011, mvmva: 0x0400012, ncds: 0x0e80013, cdp: 0x1280014,
    ncdt: 0x0f80016, nccs: 0x108041b, cc: 0x138041c, ncs: 0x0c8041e, nct: 0x0d80420,
    sqr: 0x0a00428, sqr12: 0x0a80428, dcpl: 0x0680029, dpct: 0x0f8002a, avsz3: 0x158002d,
    avsz4: 0x168002e, ncct: 0x118043f, gpf: 0x0190003d, gpf12: 0x0198003d, gpl: 0x01a0003e, gpl12: 0x01a8003e,
  };

  const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(#|\/\/).*$/gm, '');

  // split "a, b, c" on commas outside parentheses
  const operands = text => {
    const out = [];
    let depth = 0, current = '';
    for (const c of text) {
      if (c === '(') ++depth;
      if (c === ')') --depth;
      if (c === ',' && depth === 0) { out.push(current.trim()); current = ''; }
      else current += c;
    }
    if (current.trim()) out.push(current.trim());
    return out;
  };

  const assemble = (source, origin = 0) => {
    origin >>>= 0;
    const labels = {};
    const consts = {}; // .set symbols, known while sizing
    const locals = {}; // numeric label -> addresses
    const items = []; // { addr, size, emit(value) }

    let addr = origin;
    const statements = stripComments(source).split(/[\n;]/);

    // Pass 1: labels and sizes. Each item knows how to encode itself once the
    // labels are known.
    for (let raw of statements) {
      let line = raw.trim();
      let m;
      while ((m = /^([A-Za-z_.$][\w.$]*|\d+)\s*:/.exec(line))) {
        if (/^\d+$/.test(m[1])) (locals[m[1]] ||= []).push(addr);
        else labels[m[1]] = addr;
        line = line.slice(m[0].length).trim();
      }
      if (!line) continue;
      const [, op, rest = ''] = /^(\S+)\s*(.*)$/.exec(line);
      const mnemonic = op.toLowerCase();
      const args = operands(rest);
      const at = addr;

      if (mnemonic === '.word') {
        items.push({ addr: at, size: args.length, encode: value => args.map(a => value(a) >>> 0) });
        addr += 4 * args.length;
        continue;
      }
      if (mnemonic === '.space' || mnemonic === '.skip') {
        const n = Number(args[0]);
        if (n & 3) throw new Error('.space must be a multiple of 4');
        items.push({ addr: at, size: n >> 2, encode: () => new Array(n >> 2).fill(0) });
        addr += n;
        continue;
      }
      if (mnemonic === '.align') {
        const a = 1 << Number(args[0]);
        const pad = ((addr + a - 1) & ~(a - 1)) - addr;
        if (pad) items.push({ addr: at, size: pad >> 2, encode: () => new Array(pad >> 2).fill(0) });
        addr += pad;
        continue;
      }
      // .set NAME, value / .equ NAME, value: a symbol (constants only)
      if ((mnemonic === '.set' || mnemonic === '.equ') && args.length === 2) {
        labels[args[0]] = consts[args[0]] = evaluate(args[1], labels, addr, locals);
        continue;
      }
      if (mnemonic.startsWith('.')) continue;

      const size = sizeOf(mnemonic, args, consts);
      items.push({ addr: at, size, encode: value => encode(mnemonic, args, at, value, line, size) });
      addr += 4 * size;
    }

    // Pass 2: encode
    const words = [];
    for (const item of items) {
      const value = text => evaluate(text, labels, item.addr, locals);
      const out = item.encode(value);
      if (out.length !== item.size) throw new Error(`internal size mismatch at ${item.addr.toString(16)}`);
      for (const w of out) words.push(w >>> 0);
    }
    return { words, labels, origin, end: origin + 4 * words.length };
  };

  const evaluate = (text, labels, here, locals = {}) => {
    text = text.trim();
    let m;
    if ((m = /^%hi\((.*)\)$/.exec(text))) {
      const v = evaluate(m[1], labels, here, locals) >>> 0;
      return ((v + 0x8000) >>> 16) & 0xffff;
    }
    if ((m = /^%lo\((.*)\)$/.exec(text))) {
      return (evaluate(m[1], labels, here, locals) << 16) >> 16;
    }
    // sum of terms
    const terms = text.replace(/\s+/g, '').match(/[+-]?[^+-]+/g);
    if (!terms) throw new Error(`bad expression: ${text}`);
    let sum = 0;
    for (const term of terms) {
      const sign = term[0] === '-' ? -1 : 1;
      let body = term.replace(/^[+-]/, '');
      const not = body.startsWith('~');
      if (not) body = body.slice(1);
      let v;
      if (body.includes('*')) v = body.split('*').reduce((p, f) => p * evaluate(f, labels, here, locals), 1);
      else if (/^(0x[0-9a-f]+|\d+)$/i.test(body)) v = Number(body);
      else if (body === '.' && here !== undefined) v = here;
      else if ((m = /^(\d+)([fb])$/.exec(body)) && locals[m[1]]) {
        const defs = locals[m[1]];
        v = m[2] === 'f' ? defs.find(a => a > here) : defs.filter(a => a <= here).pop();
        if (v === undefined) throw new Error(`no local label ${body}`);
      }
      else if (Object.prototype.hasOwnProperty.call(labels, body)) v = labels[body];
      else throw new Error(`unknown symbol: ${body}`);
      sum += sign * v;
    }
    return sum;
  };

  const isConstant = text => /^[+-]?~?(0x[0-9a-f]+|\d+)$/i.test(text.trim());

  const sizeOf = (mnemonic, args, consts = {}) => {
    switch (mnemonic) {
      case 'la': return 2;
      case 'li': {
        const symbols = args[1].match(/(?<![\w$])[A-Za-z_][\w.$]*/g) || [];
        if (!isConstant(args[1]) && !symbols.every(name => name in consts)) return 2;
        const v = evaluate(args[1], consts);
        return (v >= -0x8000 && v <= 0xffff) || (v & 0xffff) === 0 ? 1 : 2;
      }
      default: return 1;
    }
  };

  const R = (rs, rt, rd, sa, funct) => ((rs << 21) | (rt << 16) | (rd << 11) | (sa << 6) | funct) >>> 0;
  const I = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;

  const parseMem = text => {
    const m = /^(.*)\((\$?\w+)\)$/.exec(text.trim());
    if (!m) throw new Error(`not a memory operand: ${text}`);
    return { offset: m[1].trim() || '0', base: reg(m[2]) };
  };

  const copReg = text => {
    const t = text.trim().replace(/^\$/, '');
    if (/^\d+$/.test(t)) return +t;
    throw new Error(`not a coprocessor register: ${text}`);
  };

  const encode = (mnemonic, args, pc, value, line, size = sizeOf(mnemonic, args)) => {
    const imm16 = (text) => {
      const v = value(text);
      if (v < -0x8000 || v > 0xffff) throw new Error(`immediate out of range in "${line}"`);
      return v & 0xffff;
    };
    const branch = text => {
      const target = value(text);
      const offset = (target - (pc + 4)) >> 2;
      if (offset < -0x8000 || offset > 0x7fff) throw new Error(`branch out of range in "${line}"`);
      return offset & 0xffff;
    };

    // two-operand shorthands: op rd, rt == op rd, rd, rt
    const threeOp = ['add', 'addu', 'sub', 'subu', 'and', 'or', 'xor', 'nor', 'slt', 'sltu', 'sll', 'srl', 'sra', 'sllv', 'srlv', 'srav'];
    if ((threeOp.includes(mnemonic) || mnemonic in IMM) && args.length === 2) args = [args[0], ...args];
    if (mnemonic === 'j' && /^\$/.test(args[0])) mnemonic = 'jr';

    if (mnemonic in FUNCT) {
      const f = FUNCT[mnemonic];
      switch (mnemonic) {
        case 'sll': case 'srl': case 'sra':
          return [R(0, reg(args[1]), reg(args[0]), value(args[2]) & 31, f)];
        case 'sllv': case 'srlv': case 'srav':
          return [R(reg(args[2]), reg(args[1]), reg(args[0]), 0, f)];
        case 'jr': return [R(reg(args[0]), 0, 0, 0, f)];
        case 'jalr': return args.length === 1 ? [R(reg(args[0]), 0, 31, 0, f)] : [R(reg(args[1]), 0, reg(args[0]), 0, f)];
        case 'syscall': return [((args.length ? value(args[0]) & 0xfffff : 0) << 6 | f) >>> 0];
        case 'break': {
          const code = args.length ? ((value(args[0]) & 0x3ff) << 10) | (args.length > 1 ? value(args[1]) & 0x3ff : 0) : 0;
          return [((code << 6) | f) >>> 0];
        }
        case 'mfhi': case 'mflo': return [R(0, 0, reg(args[0]), 0, f)];
        case 'mthi': case 'mtlo': return [R(reg(args[0]), 0, 0, 0, f)];
        case 'mult': case 'multu': case 'div': case 'divu': {
          const a = args.length === 3 ? args.slice(1) : args;
          return [R(reg(a[0]), reg(a[1]), 0, 0, f)];
        }
        default: return [R(reg(args[1]), reg(args[2]), reg(args[0]), 0, f)];
      }
    }
    if (mnemonic in IMM) {
      const v = value(args[2]);
      const ok = (mnemonic === 'andi' || mnemonic === 'ori' || mnemonic === 'xori') ? v >= 0 && v <= 0xffff : v >= -0x8000 && v <= 0xffff;
      if (!ok) throw new Error(`immediate out of range in "${line}"`);
      return [I(IMM[mnemonic], reg(args[1]), reg(args[0]), v)];
    }
    if (mnemonic in MEM) {
      const { offset, base } = parseMem(args[1]);
      const rt = /^(lwc|swc)/.test(mnemonic) ? copReg(args[0]) : reg(args[0]);
      return [I(MEM[mnemonic], base, rt, imm16(offset))];
    }
    if (mnemonic in REGIMM) return [I(0x01, reg(args[0]), REGIMM[mnemonic], branch(args[1]))];
    if (mnemonic in GTE) return [((0x25 << 25) | GTE[mnemonic]) >>> 0];

    switch (mnemonic) {
      case 'lui': return [I(0x0f, 0, reg(args[0]), imm16(args[1]))];
      case 'beq': return [I(0x04, reg(args[0]), reg(args[1]), branch(args[2]))];
      case 'bne': return [I(0x05, reg(args[0]), reg(args[1]), branch(args[2]))];
      case 'blez': return [I(0x06, reg(args[0]), 0, branch(args[1]))];
      case 'bgtz': return [I(0x07, reg(args[0]), 0, branch(args[1]))];
      case 'beqz': return [I(0x04, reg(args[0]), 0, branch(args[1]))];
      case 'bnez': return [I(0x05, reg(args[0]), 0, branch(args[1]))];
      case 'b': return [I(0x04, 0, 0, branch(args[0]))];
      case 'bal': return [I(0x01, 0, 0x11, branch(args[0]))];
      case 'j': return [((0x02 << 26) | ((value(args[0]) >>> 2) & 0x3ffffff)) >>> 0];
      case 'jal': return [((0x03 << 26) | ((value(args[0]) >>> 2) & 0x3ffffff)) >>> 0];
      case 'nop': return [0];
      case 'move': return [R(reg(args[1]), 0, reg(args[0]), 0, FUNCT.or)]; // as GNU as encodes it
      case 'negu': case 'neg': return [R(0, reg(args[1]), reg(args[0]), 0, mnemonic === 'neg' ? FUNCT.sub : FUNCT.subu)];
      case 'not': return [R(reg(args[1]), 0, reg(args[0]), 0, FUNCT.nor)];
      case 'li': {
        const rt = reg(args[0]);
        const v = value(args[1]) >>> 0;
        const s = (v << 0);
        if (size === 1) {
          if (s >= -0x8000 && s <= 0x7fff) return [I(0x09, 0, rt, s)];
          if (v <= 0xffff) return [I(0x0d, 0, rt, v)];
          return [I(0x0f, 0, rt, v >>> 16)];
        }
        return [I(0x0f, 0, rt, v >>> 16), I(0x0d, rt, rt, v & 0xffff)];
      }
      case 'la': {
        const rt = reg(args[0]);
        const v = value(args[1]) >>> 0;
        return [I(0x0f, 0, rt, ((v + 0x8000) >>> 16) & 0xffff), I(0x09, rt, rt, v & 0xffff)];
      }
      // coprocessor moves: mfcN rt, rd / mtcN rt, rd / cfcN / ctcN
      case 'mfc0': case 'mfc1': case 'mfc2': case 'mfc3':
      case 'cfc0': case 'cfc1': case 'cfc2': case 'cfc3':
      case 'mtc0': case 'mtc1': case 'mtc2': case 'mtc3':
      case 'ctc0': case 'ctc1': case 'ctc2': case 'ctc3': {
        const z = +mnemonic[3];
        const rs = { mf: 0, cf: 2, mt: 4, ct: 6 }[mnemonic.slice(0, 2)];
        return [(((0x10 + z) << 26) | (rs << 21) | (reg(args[0]) << 16) | (copReg(args[1]) << 11)) >>> 0];
      }
      case 'rfe': return [0x42000010];
      // coprocessor condition branches: bcNf / bcNt
      case 'bc0f': case 'bc0t': case 'bc1f': case 'bc1t': case 'bc2f': case 'bc2t': case 'bc3f': case 'bc3t': {
        const z = +mnemonic[2];
        return [(((0x10 + z) << 26) | (8 << 21) | ((mnemonic[3] === 't' ? 1 : 0) << 16) | branch(args[0])) >>> 0];
      }
      // copN imm25: a coprocessor command
      case 'cop0': case 'cop1': case 'cop2': case 'cop3': {
        const z = +mnemonic[3];
        return [(((0x10 + z) << 26) | (1 << 25) | (value(args[0]) & 0x1ffffff)) >>> 0];
      }
    }
    throw new Error(`unknown instruction: ${line}`);
  };

  return { assemble, REGS };
})
