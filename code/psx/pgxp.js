mdlr('enge:psx:pgxp', ({ include }) => {

  // PGXP (precision geometry): carries the quarter-pixel fraction of GTE
  // screen coordinates (SXY) from the GTE, through CPU registers and memory,
  // to the GPU, so polygons can be drawn at sub-pixel positions instead of
  // snapping to whole pixels.
  //
  // Only the fraction is stored: the integer part is always the value the
  // game itself sees and stores. Each shadow entry keeps the raw 32-bit word
  // it belongs to, and a fraction is only used while the register or memory
  // word still holds exactly that value. Anything that changes the word
  // without going through the hooks below (byte stores, DMA, arithmetic)
  // therefore just falls back to the normal integer position: a shadow can
  // be missing, but never wrong.
  //
  // frac byte: bits 0-1 x fraction (low halfword), bits 2-3 y fraction (high
  // halfword), bit 4 = x valid, bit 5 = y valid. The halves are tracked
  // separately so packed screen words can be split and recombined.
  //
  // Memory-type instructions (LW/SW, LH/LHU/SH, LWC2/SWC2, MFC2/MTC2, moves)
  // are tracked whenever PGXP is on. ?pgxp=cpu also tracks the ALU
  // instructions games use on screen coordinates (CPU mode, see alu()).

  const params = new URLSearchParams(window.location.search);
  const enabled = params.has('pgxp');
  const cpuMode = enabled && params.get('pgxp') === 'cpu';
  // ?pgxp&debug-pgxp: report every emulated second how many polygon vertices
  // are precise, and why the others are not (see noteVertex)
  const debug = enabled && params.has('debug-pgxp');

  const VX = 0x10, VY = 0x20, VALID = VX | VY;
  const lowF = (f) => f & (0x03 | VX);                                // x half
  const highF = (f) => f & (0x0c | VY);                               // y half
  const toHigh = (f) => (f & VX) ? (((f & 3) << 2) | VY) : 0;          // x half moved to the y half
  const toLow = (f) => (f & VY) ? (((f >> 2) & 3) | VX) : 0;           // y half moved to the x half
  const isSxy = (reg) => reg >= 0x0c && reg <= 0x0f;

  // ALU kinds used by the recompiler in CPU mode (rec.js PGXP_ALU)
  const ADDU = 1, SUBU = 2, OR = 3, AND = 4, ADDIU = 5, ORI = 6, ANDI = 7, SLL = 8, SRL = 9, SRA = 10;
  const RAM_WORDS = 0x00200000 >>> 2;
  const SHADOW_WORDS = RAM_WORDS + (0x400 >>> 2);

  const memRaw = new Int32Array(SHADOW_WORDS);
  const memFrac = new Uint8Array(SHADOW_WORDS);
  const gprRaw = new Int32Array(32);
  const gprFrac = new Uint8Array(32);

  // addr is the masked (& 0x01ffffff) address the recompiler passes to
  // memRead32/memWrite32: RAM (and its mirrors) maps to the RAM shadow,
  // everything else to the 1KB scratchpad shadow. Hardware registers alias
  // into the scratchpad shadow too, which is harmless: they are never
  // written with a fraction, and entries only apply while the raw word
  // matches. The recompiler inlines the same expression (see INDEX_JS).
  const shadowIndex = (addr) => (addr < 0x00800000 ? (addr & 0x001fffff) : (0x00200000 | (addr & 0x3ff))) >>> 2;

  const setGpr = (rt, value, frac) => {
    gprRaw[rt] = value;
    gprFrac[rt] = frac;
  };

  const setMem = (addr, value, frac) => {
    const index = shadowIndex(addr);
    memRaw[index] = value;
    memFrac[index] = frac;
  };

  const memFracAt = (index, value) => (memFrac[index] && memRaw[index] === value) ? memFrac[index] : 0;
  const gprFracOf = (r, value) => (r && gprFrac[r] && gprRaw[r] === value) ? gprFrac[r] : 0;
  const wordOf = (addr) => addr < 0x00800000 ? map[(addr & 0x001fffff) >>> 2] : map[addr >>> 2];

  // a half of a mask keeps a coordinate when it covers all 11 bits the GPU uses
  const keepByMask = (f, mask) =>
    (((mask & 0x7ff) === 0x7ff) ? lowF(f) : 0) | ((((mask >>> 16) & 0x7ff) === 0x7ff) ? highF(f) : 0);

  // per half: keep a fraction when exactly one operand has one for that half
  const eitherHalf = (fa, fb) =>
    ((fa & VX) && !(fb & VX) ? lowF(fa) : (fb & VX) && !(fa & VX) ? lowF(fb) : 0) |
    ((fa & VY) && !(fb & VY) ? highF(fa) : (fb & VY) && !(fa & VY) ? highF(fb) : 0);

  // ---------------------------------------------------------------------------
  // ?debug-pgxp: coverage statistics
  //
  // Recompiled stores tag each shadow word with the kind and address of the
  // last CPU store to it. When the GPU reads a polygon vertex without a
  // fraction, the tag tells why: which store wrote it, or that the word was
  // never stored by the CPU, or changed afterwards without a tracked store
  // (DMA, for instance).
  // ---------------------------------------------------------------------------
  const STORE_SB = 1, STORE_SH = 2, STORE_SW = 3, STORE_SWC2 = 4, STORE_SWLR = 5;
  const lastKind = debug ? new Uint8Array(SHADOW_WORDS) : null;
  const lastPc = debug ? new Uint32Array(SHADOW_WORDS) : null;
  const lastVal = debug ? new Int32Array(SHADOW_WORDS) : null;
  let stats = null;
  const resetStats = () => { stats = { vertices: 0, precise: 0, direct: 0, misses: new Map() }; };
  resetStats();

  const hex8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
  const cpuAddress = (pc) => pc < 0x00800000 ? (0x80000000 | pc) >>> 0
    : (pc >= 0x01c00000 && pc < 0x01c80000) ? (0xbfc00000 + (pc - 0x01c00000)) >>> 0 : (0x1e000000 + pc) >>> 0;
  const wordAt = wordOf;

  const miss = (reason, pc) => {
    let m = stats.misses.get(reason);
    if (!m) stats.misses.set(reason, m = { count: 0, pcs: new Map() });
    ++m.count;
    if (pc !== undefined) m.pcs.set(pc, (m.pcs.get(pc) || 0) + 1);
  };

  const report = () => {
    if (!stats.vertices && !stats.direct) return;
    const pct = stats.vertices ? (100 * stats.precise / stats.vertices).toFixed(1) : '0.0';
    const parts = [...stats.misses.entries()].sort((a, b) => b[1].count - a[1].count).map(([reason, m]) => {
      const pcs = [...m.pcs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([pc, n]) => `0x${hex8(cpuAddress(pc))} x${n}`).join(', ');
      return `${reason}: ${m.count}${pcs ? ` (at ${pcs})` : ''}`;
    });
    const line = `[PGXP] ${stats.precise}/${stats.vertices} polygon vertices precise (${pct}%)` +
      (parts.length ? ` | not precise: ${parts.join(' | ')}` : '') +
      (stats.direct ? ` | ${stats.direct} vertices in polygons written to GP0 by the CPU (never precise)` : '');
    console.log(line);
    window.pgxpStats = line;
    resetStats();
  };

  if (debug) {
    psx.addEvent(0, self => { report(); psx.setEvent(self, 33868800); });
  }

  const pgxp = {
    enabled,

    // Slow paths for LW/SW. The recompiler inlines the cheap checks
    // (pgxpMemFrac[index] / pgxpGprFrac[rt] non-zero) and only calls these
    // when a fraction may be involved. Entries are never cleared eagerly:
    // a fraction only applies while the register/word still holds the raw
    // value it was recorded for.

    // after LW rt, (addr) loaded value: carry the word's fraction into rt
    lw: (rt, addr, value) => {
      const index = shadowIndex(addr);
      if (rt && memRaw[index] === value) setGpr(rt, value, memFrac[index]);
    },

    // after SW rt, (addr) stored value: carry rt's fraction into memory
    sw: (rt, addr, value) => {
      if (gprRaw[rt] === value) setMem(addr, value, gprFrac[rt]);
    },

    // SWC2 rt, (addr): store a GTE register with its fraction
    swc2: (rt, addr) => {
      const value = gte.get(rt);
      memWrite32(addr, value);
      setMem(addr, value, isSxy(rt) ? gte.frac(rt) | VALID : 0);
      if (debug) pgxp.noteStore(STORE_SWC2, addr, pgxp.pc);
    },

    // LWC2 into SXY: called after gte.set(reg, value) when the word has a fraction
    lwc2: (reg, addr, value) => {
      gte.setFrac(reg, memFracAt(shadowIndex(addr), value));
    },

    // MTC2 into SXY: called after gte.set(reg, value) when rt has a fraction
    mtc2: (reg, rt, value) => {
      gte.setFrac(reg, gprFracOf(rt, value));
    },

    // LH/LHU rt, (addr): called after the load (value = the loaded, extended
    // halfword) when the word has a fraction; that half becomes rt's x half
    lh: (rt, addr, value) => {
      if (!rt) return;
      const f = memFracAt(shadowIndex(addr), wordOf(addr));
      setGpr(rt, value, (addr & 2) ? toLow(f) : lowF(f));
    },

    // SH rt, (addr): called after the store (oldWord = the word before it)
    // when rt or the word has a fraction. rt's x half goes into the stored
    // half, the other half keeps its fraction.
    sh: (rt, addr, value, oldWord) => {
      const index = shadowIndex(addr);
      const old = (memFrac[index] && memRaw[index] === oldWord) ? memFrac[index] : 0;
      const f = gprFracOf(rt, value);
      memRaw[index] = wordOf(addr);
      memFrac[index] = (addr & 2) ? (lowF(old) | toHigh(f)) : (highF(old) | lowF(f));
    },

    // CPU mode: called before an ALU instruction when a source has a fraction.
    // Computes the result like the instruction does and the fraction it keeps:
    // integer offsets keep it, halves can be split (andi/shift by 16) and
    // combined (or/addu), anything else drops it (integer fallback).
    cpu: cpuMode,
    alu: (kind, rd, rs, rt, a, b, imm) => {
      if (!rd) return;
      const fa = gprFracOf(rs, a), fb = gprFracOf(rt, b);
      let r, f;
      switch (kind) {
        case ADDU: r = (a + b) | 0; f = eitherHalf(fa, fb); break;
        case SUBU: r = (a - b) | 0; f = eitherHalf(fa, 0) & ~((fb & VX ? 0x03 | VX : 0) | (fb & VY ? 0x0c | VY : 0)); break;
        case OR: r = a | b;
          f = ((b & 0xffff) === 0 ? lowF(fa) : (a & 0xffff) === 0 ? lowF(fb) : 0) |
            ((b >>> 16) === 0 ? highF(fa) : (a >>> 16) === 0 ? highF(fb) : 0);
          break;
        case AND: r = a & b; f = fa && !fb ? keepByMask(fa, b) : fb && !fa ? keepByMask(fb, a) : 0; break;
        case ADDIU: r = (a + imm) | 0; f = fa; break;
        case ORI: r = a | imm; f = highF(fa) | (imm === 0 ? lowF(fa) : 0); break;
        case ANDI: r = a & imm; f = keepByMask(fa, imm); break;
        case SLL: r = b << imm; f = imm === 0 ? fb : imm === 16 ? toHigh(fb) : 0; break;
        case SRL: r = (b >>> imm) | 0; f = imm === 0 ? fb : imm === 16 ? toLow(fb) : 0; break;
        case SRA: r = b >> imm; f = imm === 0 ? fb : imm === 16 ? toLow(fb) : 0; break;
        default: return;
      }
      setGpr(rd, r, f);
    },

    // ?debug-pgxp: set by recompiled code before SWC2 (instruction address)
    debug,
    pc: 0,

    // ?debug-pgxp: called by recompiled code after every store
    noteStore: (kind, addr, pc) => {
      const index = shadowIndex(addr);
      lastKind[index] = kind;
      lastPc[index] = pc;
      lastVal[index] = wordAt(addr);
    },

    // ?debug-pgxp: called by the GPU for every polygon vertex read from RAM
    noteVertex: (addr, value, frac) => {
      ++stats.vertices;
      if (frac) { ++stats.precise; return; }
      const index = (addr & 0x001fffff) >>> 2;
      const kind = lastKind[index];
      if (!kind) return miss('never stored by the CPU (e.g. loaded by DMA)');
      if (lastVal[index] !== value) return miss('changed after the last CPU store (DMA or an untracked path)');
      const pc = lastPc[index];
      switch (kind) {
        case STORE_SB: return miss('written with SB', pc);
        case STORE_SH: return miss('written with SH (halfword)', pc);
        case STORE_SWLR: return miss('written with SWL/SWR', pc);
        case STORE_SWC2: return miss('SWC2 without a fraction', pc);
        default: return miss('SW of a register without a fraction', pc);
      }
    },

    // ?debug-pgxp: polygon vertices written to GP0 directly by the CPU
    noteDirect: (count) => { stats.direct += count; },

    report,

    // MFC2 rt, rd: read a GTE register with its fraction (value committed later
    // by the load delay; the fraction only applies while gpr[rt] === value)
    mfc2: (rt, rd) => {
      const value = gte.get(rd);
      if (rt) setGpr(rt, value, isSxy(rd) ? gte.frac(rd) | VALID : 0);
      return value;
    },

    // register move (ADDU/OR with r0): copy the fraction along
    move: (rd, rs) => {
      if (rd) setGpr(rd, gprRaw[rs], gprFrac[rs]);
    },

    // GPU: fraction for a packet word read from RAM at addr (& 0x1fffff)
    fracAt: (addr, value) => memFracAt((addr & 0x001fffff) >>> 2, value),

    reset: () => {
      memFrac.fill(0);
      gprFrac.fill(0);
    },
  };

  // pgxpMemFrac / pgxpGprFrac are read directly by recompiled code
  return { pgxp, pgxpMemFrac: memFrac, pgxpGprFrac: gprFrac };
})
