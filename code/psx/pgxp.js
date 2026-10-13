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

  const enabled = new URLSearchParams(window.location.search).has('pgxp');

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
    },

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
