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
  // frac byte: bits 0-1 x fraction, bits 2-3 y fraction, bit 4 = valid.

  const params = new URLSearchParams(window.location.search);
  const enabled = params.has('pgxp');
  // ?pgxp&debug-pgxp: report every emulated second how many polygon vertices
  // are precise, and why the others are not (see noteVertex)
  const debug = enabled && params.has('debug-pgxp');

  const VALID = 0x10;
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
  const wordAt = (addr) => addr < 0x00800000 ? map[(addr & 0x001fffff) >>> 2] : map[addr >>> 2];

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
      setMem(addr, value, gte.frac(rt) | VALID);
      if (debug) pgxp.noteStore(STORE_SWC2, addr, pgxp.pc);
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
      if (rt) setGpr(rt, value, gte.frac(rd) | VALID);
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
