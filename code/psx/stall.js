mdlr('enge:psx:stall', ({ include }) => {

  // ?debug-stall: detects when the CPU keeps running the same few blocks
  // (a wait loop) and prints a report of what the loop does and which
  // memory and hardware registers it reads, with the values it gets back.
  //
  // Detection is per animation frame: the set of executed block addresses
  // is tracked, and when no new block shows up for STABLE_FRAMES frames
  // while the set stays small, the next CAPTURE_FRAMES frames are recorded
  // with wrapped memRead*/memWrite* globals (recompiled code calls them by
  // name), and the report is printed to the console once per stall.

  const enabled = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('debug-stall');

  const MAX_BLOCKS = 48;
  const STABLE_FRAMES = 120;   // ~2 seconds at 60 fps
  const CAPTURE_FRAMES = 30;
  const MAX_VALUES = 6;

  const hex = (v, n = 8) => (v >>> 0).toString(16).padStart(n, '0');

  // ---------------------------------------------------------------------------
  // addresses
  // ---------------------------------------------------------------------------

  // masked (& 0x01ffffff) address -> CPU address as a game would write it
  const cpuAddress = (addr) => {
    addr >>>= 0;
    if (addr < 0x00800000) return (0x80000000 | addr) >>> 0;
    if (addr >= 0x01c00000 && addr < 0x01c80000) return (0xbfc00000 + (addr - 0x01c00000)) >>> 0;
    return (0x1e000000 + addr) >>> 0; // 0x01801070 -> 0x1f801070
  };

  const DMA_NAMES = ['MDECin', 'MDECout', 'GPU', 'CDROM', 'SPU', 'PIO', 'OTC'];
  const IO_NAMES = {
    0x1040: 'JOY_DATA', 0x1044: 'JOY_STAT', 0x1048: 'JOY_MODE', 0x104a: 'JOY_CTRL', 0x104e: 'JOY_BAUD',
    0x1070: 'I_STAT', 0x1074: 'I_MASK',
    0x10f0: 'DPCR', 0x10f4: 'DICR',
    0x1800: 'CD_STATUS', 0x1801: 'CD_1801', 0x1802: 'CD_1802', 0x1803: 'CD_1803',
    0x1810: 'GPUREAD/GP0', 0x1814: 'GPUSTAT/GP1', 0x1820: 'MDEC_DATA', 0x1824: 'MDEC_STATUS',
    0x1d88: 'SPU_KON', 0x1d8a: 'SPU_KON_HI', 0x1d8c: 'SPU_KOFF', 0x1d8e: 'SPU_KOFF_HI',
    0x1d9c: 'SPU_ENDX', 0x1d9e: 'SPU_ENDX_HI', 0x1da4: 'SPU_IRQ_ADDR', 0x1da6: 'SPU_XFER_ADDR',
    0x1da8: 'SPU_FIFO', 0x1daa: 'SPUCNT', 0x1dac: 'SPU_XFER_CTRL', 0x1dae: 'SPUSTAT',
  };

  const ioName = (addr) => {
    if (addr < 0x00800000) return 'RAM';
    if (addr >= 0x01800000 && addr < 0x01800400) return 'scratchpad';
    if (addr >= 0x01c00000 && addr < 0x01c80000) return 'BIOS';
    if (addr < 0x01801000 || addr >= 0x01802000) return '';
    const reg = addr & 0x3fff;
    if (IO_NAMES[reg]) return IO_NAMES[reg];
    if (reg >= 0x1080 && reg < 0x10f0) {
      const ch = (reg - 0x1080) >> 4;
      return `DMA${ch}_${['MADR', 'BCR', 'CHCR', '?'][(reg >> 2) & 3]} (${DMA_NAMES[ch]})`;
    }
    if (reg >= 0x1100 && reg < 0x1130) {
      return `TIMER${(reg - 0x1100) >> 4}_${['COUNT', 'MODE', 'TARGET', '?'][(reg >> 2) & 3]}`;
    }
    if (reg >= 0x1c00 && reg < 0x1d80) return `SPU_VOICE${(reg - 0x1c00) >> 4}+${hex(reg & 15, 1)}`;
    if (reg >= 0x1c00 && reg < 0x2000) return 'SPU';
    return 'IO';
  };

  // ---------------------------------------------------------------------------
  // MIPS-I disassembler (R3000A + COP0 + GTE)
  // ---------------------------------------------------------------------------

  const REG = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
    's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra'];
  const COP0 = { 3: 'bpc', 5: 'bda', 6: 'jumpdest', 7: 'dcic', 8: 'badvaddr', 9: 'bdam', 11: 'bpcm', 12: 'sr', 13: 'cause', 14: 'epc', 15: 'prid' };
  const GTE_CMD = { 0x01: 'rtps', 0x06: 'nclip', 0x0c: 'op', 0x10: 'dpcs', 0x11: 'intpl', 0x12: 'mvmva', 0x13: 'ncds', 0x14: 'cdp',
    0x16: 'ncdt', 0x1b: 'nccs', 0x1c: 'cc', 0x1e: 'ncs', 0x20: 'nct', 0x28: 'sqr', 0x29: 'dcpl', 0x2a: 'dpct', 0x2d: 'avsz3',
    0x2e: 'avsz4', 0x30: 'rtpt', 0x3d: 'gpf', 0x3e: 'gpl', 0x3f: 'ncct' };
  const SPECIAL = { 0x00: 'sll', 0x02: 'srl', 0x03: 'sra', 0x04: 'sllv', 0x06: 'srlv', 0x07: 'srav', 0x08: 'jr', 0x09: 'jalr',
    0x0c: 'syscall', 0x0d: 'break', 0x10: 'mfhi', 0x11: 'mthi', 0x12: 'mflo', 0x13: 'mtlo', 0x18: 'mult', 0x19: 'multu',
    0x1a: 'div', 0x1b: 'divu', 0x20: 'add', 0x21: 'addu', 0x22: 'sub', 0x23: 'subu', 0x24: 'and', 0x25: 'or',
    0x26: 'xor', 0x27: 'nor', 0x2a: 'slt', 0x2b: 'sltu' };
  const IMM = { 0x08: 'addi', 0x09: 'addiu', 0x0a: 'slti', 0x0b: 'sltiu', 0x0c: 'andi', 0x0d: 'ori', 0x0e: 'xori' };
  const MEM = { 0x20: 'lb', 0x21: 'lh', 0x22: 'lwl', 0x23: 'lw', 0x24: 'lbu', 0x25: 'lhu', 0x26: 'lwr',
    0x28: 'sb', 0x29: 'sh', 0x2a: 'swl', 0x2b: 'sw', 0x2e: 'swr', 0x32: 'lwc2', 0x3a: 'swc2' };
  const BRANCH = { 0x04: 'beq', 0x05: 'bne', 0x06: 'blez', 0x07: 'bgtz' };
  const REGIMM = { 0x00: 'bltz', 0x01: 'bgez', 0x10: 'bltzal', 0x11: 'bgezal' };

  const imm16 = (w) => (w << 16) >> 16;
  const shex = (v) => (v < 0 ? '-0x' + (-v).toString(16) : '0x' + v.toString(16));

  // Returns { text, mem } where mem is the base register and offset of a
  // load/store, so callers can show the effective address.
  const disasm = (word, pc) => {
    const w = word >>> 0;
    const op = w >>> 26, rs = (w >>> 21) & 31, rt = (w >>> 16) & 31, rd = (w >>> 11) & 31;
    const sa = (w >>> 6) & 31, fn = w & 63, imm = imm16(w);
    const target = (pc + 4 + imm * 4) >>> 0;
    const R = (r) => REG[r];

    if (w === 0) return { text: 'nop' };
    switch (op) {
      case 0x00: {
        const m = SPECIAL[fn];
        if (!m) break;
        if (fn <= 0x03) return { text: `${m} ${R(rd)}, ${R(rt)}, ${sa}` };
        if (fn <= 0x07) return { text: `${m} ${R(rd)}, ${R(rt)}, ${R(rs)}` };
        if (fn === 0x08) return { text: `jr ${R(rs)}`, jump: true };
        if (fn === 0x09) return { text: rd === 31 ? `jalr ${R(rs)}` : `jalr ${R(rd)}, ${R(rs)}`, jump: true };
        if (fn === 0x0c || fn === 0x0d) return { text: `${m} 0x${((w >>> 6) & 0xfffff).toString(16)}`, jump: fn === 0x0c };
        if (fn === 0x10 || fn === 0x12) return { text: `${m} ${R(rd)}` };
        if (fn === 0x11 || fn === 0x13) return { text: `${m} ${R(rs)}` };
        if (fn >= 0x18 && fn <= 0x1b) return { text: `${m} ${R(rs)}, ${R(rt)}` };
        return { text: `${m} ${R(rd)}, ${R(rs)}, ${R(rt)}` };
      }
      case 0x01: {
        const m = REGIMM[rt];
        if (m) return { text: `${m} ${R(rs)}, 0x${hex(target)}`, branch: target };
        break;
      }
      case 0x02:
      case 0x03: {
        const t = (((pc + 4) & 0xf0000000) | ((w & 0x03ffffff) << 2)) >>> 0;
        return { text: `${op === 2 ? 'j' : 'jal'} 0x${hex(t)}`, branch: t, jump: true };
      }
      case 0x04: case 0x05:
        if (op === 0x04 && rs === 0 && rt === 0) return { text: `b 0x${hex(target)}`, branch: target, jump: true };
        return { text: `${BRANCH[op]} ${R(rs)}, ${R(rt)}, 0x${hex(target)}`, branch: target };
      case 0x06: case 0x07:
        return { text: `${BRANCH[op]} ${R(rs)}, 0x${hex(target)}`, branch: target };
      case 0x0f:
        return { text: `lui ${R(rt)}, 0x${(w & 0xffff).toString(16)}` };
      case 0x10:
        if (rs === 0x00) return { text: `mfc0 ${R(rt)}, ${COP0[rd] || '$' + rd}` };
        if (rs === 0x04) return { text: `mtc0 ${R(rt)}, ${COP0[rd] || '$' + rd}` };
        if (rs === 0x10 && fn === 0x10) return { text: 'rfe' };
        break;
      case 0x12:
        if (rs & 0x10) {
          const cmd = w & 0x01ffffff;
          return { text: `${GTE_CMD[cmd & 0x3f] || 'cop2'} 0x${cmd.toString(16)}` };
        }
        if (rs === 0x00) return { text: `mfc2 ${R(rt)}, $${rd}` };
        if (rs === 0x02) return { text: `cfc2 ${R(rt)}, $${rd}` };
        if (rs === 0x04) return { text: `mtc2 ${R(rt)}, $${rd}` };
        if (rs === 0x06) return { text: `ctc2 ${R(rt)}, $${rd}` };
        break;
      default:
        if (IMM[op]) {
          const value = op >= 0x0c ? '0x' + (w & 0xffff).toString(16) : shex(imm);
          return { text: `${IMM[op]} ${R(rt)}, ${R(rs)}, ${value}` };
        }
        if (MEM[op]) {
          const reg = (op === 0x32 || op === 0x3a) ? '$' + rt : R(rt);
          return { text: `${MEM[op]} ${reg}, ${shex(imm)}(${R(rs)})`, mem: { base: rs, offset: imm, store: op >= 0x28 } };
        }
    }
    return { text: `.word 0x${hex(w)}` };
  };

  // ---------------------------------------------------------------------------
  // detection and capture
  // ---------------------------------------------------------------------------

  let frameBlocks = new Map();
  let watch = new Set();
  let quietFrames = 0;
  let reported = false;
  let capturing = 0;
  let captureBlocks = new Map();
  let reads = new Map();
  let writes = new Map();
  let original = null;
  let lastReport = '';

  const note = (table, addr, size, value) => {
    const key = (addr >>> 0) * 4 + (size >> 3); // keeps 8/16/32-bit accesses apart
    let e = table.get(key);
    if (!e) table.set(key, e = { addr: addr >>> 0, size, count: 0, values: new Map() });
    ++e.count;
    if (e.values.size < MAX_VALUES || e.values.has(value)) e.values.set(value, (e.values.get(value) || 0) + 1);
  };

  const ACCESSORS = [['memRead8', 8, false], ['memRead16', 16, false], ['memRead32', 32, false],
    ['memWrite8', 8, true], ['memWrite16', 16, true], ['memWrite32', 32, true]];

  const startCapture = () => {
    original = {};
    for (const [name, size, store] of ACCESSORS) {
      const fn = original[name] = globalThis[name];
      if (typeof fn !== 'function') continue;
      globalThis[name] = store
        ? (addr, value) => { note(writes, addr, size, value >>> 0); return fn(addr, value); }
        : (addr) => { const value = fn(addr); note(reads, addr, size, value >>> 0); return value; };
    }
    captureBlocks = new Map();
    reads = new Map();
    writes = new Map();
    capturing = CAPTURE_FRAMES;
  };

  const stopCapture = () => {
    for (const [name] of ACCESSORS) if (original && original[name]) globalThis[name] = original[name];
    original = null;
    capturing = 0;
  };

  const blockWords = (entry) => {
    const pc = entry.pc >>> 0;
    const words = [];
    const end = entry.end && entry.end > pc ? Math.min(entry.end, pc + 4 * 64) : pc + 4 * 64;
    let delaySlot = false;
    for (let a = pc; a < end; a += 4) {
      const word = map[a >>> 2] >>> 0;
      words.push([a, word]);
      if (delaySlot) break;
      const d = disasm(word, cpuAddress(a));
      if (!entry.end && (d.branch !== undefined || d.jump)) delaySlot = true;
    }
    return words;
  };

  const formatValues = (e) => [...e.values.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `0x${hex(v, e.size >> 2)}${e.values.size > 1 ? ` x${n}` : ''}`)
    .join(', ') + (e.values.size >= MAX_VALUES ? ', ...' : '');

  const formatAccesses = (title, table) => {
    const rows = [...table.values()].sort((a, b) => b.count - a.count).slice(0, 24);
    if (!rows.length) return [`${title}: none`];
    return [`${title} (address, size, name, count/frame, values seen):`, ...rows.map(e =>
      `  0x${hex(cpuAddress(e.addr))}  ${String(e.size).padStart(2)}  ${ioName(e.addr).padEnd(22)} ${(e.count / CAPTURE_FRAMES).toFixed(0).padStart(7)}  ${formatValues(e)}`)];
  };

  const buildReport = () => {
    const g = cpu.gpr;
    const lines = [];
    lines.push(`[STALL] the CPU has been running the same ${watch.size} block(s) for ${STABLE_FRAMES + CAPTURE_FRAMES} frames`);
    lines.push(`pc=0x${hex(cpu.pc)} ra=0x${hex(g[31])} sp=0x${hex(g[29])} sr=0x${hex(cpu.sr)} cause=0x${hex(cpu.cause)} epc=0x${hex(cpu.epc)}`);
    lines.push(`i_stat=0x${hex(cpu.istat, 3)} i_mask=0x${hex(cpu.imask, 3)} gpustat=0x${hex(typeof gpu !== 'undefined' ? gpu.status : 0)} clock=${Math.round(psx.clock)}`);
    lines.push('gpr: ' + REG.map((n, i) => `${n}=${hex(g[i])}`).join(' '));
    lines.push('');
    lines.push(...formatAccesses('reads', reads));
    lines.push('');
    lines.push(...formatAccesses('writes', writes));
    lines.push('');

    const hot = [...captureBlocks.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
    lines.push('hot blocks (address, calls/frame):');
    for (const [, { entry, count }] of hot) {
      lines.push(`  block 0x${hex(cpuAddress(entry.pc))}  ${(count / CAPTURE_FRAMES).toFixed(0)}/frame`);
      for (const [a, word] of blockWords(entry)) {
        const d = disasm(word, cpuAddress(a));
        let comment = '';
        if (d.mem) {
          const ea = ((g[d.mem.base] + d.mem.offset) & 0x01ffffff) >>> 0;
          const name = ioName(ea);
          comment = `  ; [0x${hex(cpuAddress(ea))}]${name && name !== 'RAM' ? ' ' + name : ''}`;
        }
        lines.push(`    ${hex(cpuAddress(a))}: ${hex(word)}  ${d.text}${comment}`);
      }
    }
    lines.push('');
    lines.push('Effective addresses use the register values at the time of the report.');
    return lines.join('\n');
  };

  const stall = {
    enabled,
    disasm,

    // called for every block the main loop runs (only when enabled)
    block: (entry) => {
      const e = frameBlocks.get(entry.pc);
      if (e) ++e.count; else frameBlocks.set(entry.pc, { entry, count: 1 });
      if (capturing) {
        const c = captureBlocks.get(entry.pc);
        if (c) ++c.count; else captureBlocks.set(entry.pc, { entry, count: 1 });
      }
    },

    // called once per animation frame (only when enabled)
    endFrame: () => {
      if (capturing) {
        if (--capturing === 0) {
          stopCapture();
          lastReport = buildReport();
          console.warn(lastReport);
          console.warn('[STALL] the report is also in window.stallReport; in DevTools: copy(stallReport)');
          if (typeof window !== 'undefined') window.stallReport = lastReport;
          reported = true;
        }
        frameBlocks = new Map();
        return;
      }

      let fresh = 0;
      for (const pc of frameBlocks.keys()) if (!watch.has(pc)) ++fresh;

      if (frameBlocks.size === 0) {
        // nothing ran this frame, keep the current state
      }
      else if (watch.size + fresh <= MAX_BLOCKS) {
        for (const pc of frameBlocks.keys()) watch.add(pc);
        quietFrames = fresh ? 0 : quietFrames + 1;
        if (fresh) reported = false; // the loop changed: a later stall gets its own report
      }
      else {
        watch = frameBlocks.size <= MAX_BLOCKS ? new Set(frameBlocks.keys()) : new Set();
        quietFrames = 0;
        reported = false;
      }
      frameBlocks = new Map();

      if (!reported && quietFrames >= STABLE_FRAMES && watch.size) startCapture();
    },

    report: () => lastReport,
  };

  return { stall };
})
