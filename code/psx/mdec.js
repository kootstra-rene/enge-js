mdlr('enge:psx:mdec', m => {

  const iq = new Int32Array(128);

  const scale = new Uint8Array(3 * 256);
  const SCALERC256 = (y, x) => {
    return scale[256 + 128 + y + x];
  };
  const SCALERC32 = (y, x) => {
    return SCALERC256(y,x)>>>3;
  };

  const zscan = [
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
  ];

  const aanscales = [
    0x4000, 0x58c5, 0x539f, 0x4b42, 0x4000, 0x3249, 0x22a3, 0x11a8,
    0x58c5, 0x7b21, 0x73fc, 0x6862, 0x58c5, 0x45bf, 0x300b, 0x187e,
    0x539f, 0x73fc, 0x6d41, 0x6254, 0x539f, 0x41b3, 0x2d41, 0x1712,
    0x4b42, 0x6862, 0x6254, 0x587e, 0x4b42, 0x3b21, 0x28ba, 0x14c3,
    0x4000, 0x58c5, 0x539f, 0x4b42, 0x4000, 0x3249, 0x22a3, 0x11a8,
    0x3249, 0x45bf, 0x41b3, 0x3b21, 0x3249, 0x2782, 0x1b37, 0x0de0,
    0x22a3, 0x300b, 0x2d41, 0x28ba, 0x22a3, 0x1b37, 0x12bf, 0x098e,
    0x11a8, 0x187e, 0x1712, 0x14c3, 0x11a8, 0x0de0, 0x098e, 0x04df,
  ];

  const iqtab_init = (addr, size) => {
    for (let i = 0; i < size; ++i) {
      const q = map8[((addr + i) & 0x001fffff) >>> 0] & 0xff;
      iq[i] = (q * aanscales[zscan[i & 63]]) >> 12;
    }
  };

  const icdt = (blk, o) => {
    let z10, z11, z12, z13;

    let oo = o;
    for (let i = 8; i > 0; --i, o += 8) {
      z10 = (blk[o + 0] + blk[o + 4]) >> 0;
      z11 = (blk[o + 0] - blk[o + 4]) >> 0;
      z13 = (blk[o + 2] + blk[o + 6]) >> 0;
      z12 = (blk[o + 2] - blk[o + 6]) >> 0;
      z12 = (((z12 * 362) >> 8) - z13) >> 0;

      const tmp0 = (z10 + z13) >> 0;
      const tmp3 = (z10 - z13) >> 0;
      const tmp1 = (z11 + z12) >> 0;
      const tmp2 = (z11 - z12) >> 0;

      z13 = (blk[o + 3] + blk[o + 5]) >> 0;
      z10 = (blk[o + 3] - blk[o + 5]) >> 0;
      z11 = (blk[o + 1] + blk[o + 7]) >> 0;
      z12 = (blk[o + 1] - blk[o + 7]) >> 0;
      const z5 = ((z12 - z10) * 473) >> 8;

      const tmp7 = (z11 + z13) >> 0;
      const tmp6 = ((((z10 * 669) >> 8) + z5) - tmp7) >> 0;
      const tmp5 = ((((z11 - z13) * 362) >> 8) - tmp6) >> 0;
      const tmp4 = ((((z12 * 277) >> 8) - z5) + tmp5) >> 0;

      blk[o + 0] = (tmp0 + tmp7) >> 5;
      blk[o + 1] = (tmp1 + tmp6) >> 5;
      blk[o + 2] = (tmp2 + tmp5) >> 5;
      blk[o + 3] = (tmp3 - tmp4) >> 5;
      blk[o + 4] = (tmp3 + tmp4) >> 5;
      blk[o + 5] = (tmp2 - tmp5) >> 5;
      blk[o + 6] = (tmp1 - tmp6) >> 5;
      blk[o + 7] = (tmp0 - tmp7) >> 5;
    }

    o = oo;
    for (let i = 8; i > 0; --i, ++o) {
      z10 = (blk[o + 0] + blk[o + 32]) >> 0;
      z11 = (blk[o + 0] - blk[o + 32]) >> 0;
      z13 = (blk[o + 16] + blk[o + 48]) >> 0;
      z12 = (blk[o + 16] - blk[o + 48]) >> 0;
      z12 = (((z12 * 362) >> 8) - z13) >> 0;

      const tmp0 = (z10 + z13) >> 0;
      const tmp3 = (z10 - z13) >> 0;
      const tmp1 = (z11 + z12) >> 0;
      const tmp2 = (z11 - z12) >> 0;

      z13 = (blk[o + 24] + blk[o + 40]) >> 0;
      z10 = (blk[o + 24] - blk[o + 40]) >> 0;
      z11 = (blk[o + 8] + blk[o + 56]) >> 0;
      z12 = (blk[o + 8] - blk[o + 56]) >> 0;
      const z5 = ((z12 - z10) * 473) >> 8;

      const tmp7 = (z11 + z13) >> 0;
      const tmp6 = ((((z10 * 669) >> 8) + z5) - tmp7) >> 0;
      const tmp5 = ((((z11 - z13) * 362) >> 8) - tmp6) >> 0;
      const tmp4 = ((((z12 * 277) >> 8) - z5) + tmp5) >> 0;

      blk[o + 0] = (tmp0 + tmp7) >> 0;
      blk[o + 8] = (tmp1 + tmp6) >> 0;
      blk[o + 16] = (tmp2 + tmp5) >> 0;
      blk[o + 24] = (tmp3 - tmp4) >> 0;
      blk[o + 32] = (tmp3 + tmp4) >> 0;
      blk[o + 40] = (tmp2 - tmp5) >> 0;
      blk[o + 48] = (tmp1 - tmp6) >> 0;
      blk[o + 56] = (tmp0 - tmp7) >> 0;
    }
  };

  const rl2blk = (blk, addr) => {
    blk.fill(0);

    let base = (addr & 0x001fffff) >>> 1;

    for (let i = 0; i < 6; ++i) {
      const iqoff = i >= 2 ? 0 : 64;
      const o = 64 * i;

      const rl = map16[base++] & 0xffff;

      const q = rl >> 10;
      const dc = ((rl << 22) >> 22);
      let k = 0;
      blk[o] = iq[iqoff] * dc;

      for (; ;) {
        const rl = map16[base++] & 0xffff;

        k += ((rl >> 10) + 1);
        if (k <= 63) {
          const dc = ((rl << 22) >> 22);
          const val = (iq[iqoff + k] * q * dc) >> 3;
          blk[o + zscan[k]] = val;
        }
        if (k > 63) break;
      }

      icdt(blk, o);
    }
    return base << 1;
  };

  const putquadrgb15 = (addr, blk, o, Cr, Cb) => {
    const R = ((1433 * Cr)) >> 10;
    const G = ((-351 * Cb) - (728 * Cr)) >> 10;
    const B = ((1807 * Cb)) >> 10;

    const base = (addr & 0x001fffff) >>> 0;
    const memory = map16;

    let Y, r, g, b, a = mdc.STP;

    Y = blk[o + 0] << 0;
    r = SCALERC32(Y, R);
    g = SCALERC32(Y, G);
    b = SCALERC32(Y, B);
    memory[(base + 0) >>> 1] = a | (b << 10) | (g << 5) | r;

    Y = blk[o + 1] << 0;
    r = SCALERC32(Y, R);
    g = SCALERC32(Y, G);
    b = SCALERC32(Y, B);
    memory[(base + 2) >>> 1] = a | (b << 10) | (g << 5) | r;

    Y = blk[o + 8] << 0;
    r = SCALERC32(Y, R);
    g = SCALERC32(Y, G);
    b = SCALERC32(Y, B);
    memory[(base + 32) >>> 1] = a | (b << 10) | (g << 5) | r;

    Y = blk[o + 9] << 0;
    r = SCALERC32(Y, R);
    g = SCALERC32(Y, G);
    b = SCALERC32(Y, B);
    memory[(base + 34) >>> 1] = a | (b << 10) | (g << 5) | r;
  };

  const yuv2rgb15 = (blk, addr) => {
    let y;
    let ro = 0;
    let bo = 64;
    let yo = 64 * 2;

    for (y = 0; y < 16; y += 2, ro += 8, bo += 8, yo += 16, addr += 64) {
      if (y == 8) yo += 64;

      putquadrgb15(addr + 0, blk, yo + 0, blk[ro + 0], blk[bo + 0]);
      putquadrgb15(addr + 4, blk, yo + 2, blk[ro + 1], blk[bo + 1]);
      putquadrgb15(addr + 8, blk, yo + 4, blk[ro + 2], blk[bo + 2]);
      putquadrgb15(addr + 12, blk, yo + 6, blk[ro + 3], blk[bo + 3]);
      putquadrgb15(addr + 16, blk, yo + 64, blk[ro + 4], blk[bo + 4]);
      putquadrgb15(addr + 20, blk, yo + 66, blk[ro + 5], blk[bo + 5]);
      putquadrgb15(addr + 24, blk, yo + 68, blk[ro + 6], blk[bo + 6]);
      putquadrgb15(addr + 28, blk, yo + 70, blk[ro + 7], blk[bo + 7]);
    }
  };

  const putquadrgb24 = (addr, blk, o, Cr, Cb) => {
    const R = ((1433 * Cr)) >> 10;
    const G = ((-351 * Cb) - (728 * Cr)) >> 10;
    const B = ((1807 * Cb)) >> 10;

    const base = (addr & 0x001fffff) >>> 0;
    const memory = map8;

    let Y;

    Y = blk[o + 0] << 0;
    memory[base + 0] = SCALERC256(Y, R);
    memory[base + 1] = SCALERC256(Y, G);
    memory[base + 2] = SCALERC256(Y, B);

    Y = blk[o + 1] << 0;
    memory[base + 3] = SCALERC256(Y, R);
    memory[base + 4] = SCALERC256(Y, G);
    memory[base + 5] = SCALERC256(Y, B);

    Y = blk[o + 8] << 0;
    memory[base + 48] = SCALERC256(Y, R);
    memory[base + 49] = SCALERC256(Y, G);
    memory[base + 50] = SCALERC256(Y, B);

    Y = blk[o + 9] << 0;
    memory[base + 51] = SCALERC256(Y, R);
    memory[base + 52] = SCALERC256(Y, G);
    memory[base + 53] = SCALERC256(Y, B);
  };

  const yuv2rgb24 = (blk, addr) => {
    let y;
    let ro = 0;
    let bo = 64;
    let yo = 64 * 2;

    for (y = 0; y < 16; y += 2, ro += 8, bo += 8, yo += 16, addr += 96) {
      if (y == 8) yo += 64;

      putquadrgb24(addr + 0, blk, yo + 0, blk[ro + 0], blk[bo + 0]);
      putquadrgb24(addr + 6, blk, yo + 2, blk[ro + 1], blk[bo + 1]);
      putquadrgb24(addr + 12, blk, yo + 4, blk[ro + 2], blk[bo + 2]);
      putquadrgb24(addr + 18, blk, yo + 6, blk[ro + 3], blk[bo + 3]);
      putquadrgb24(addr + 24, blk, yo + 64, blk[ro + 4], blk[bo + 4]);
      putquadrgb24(addr + 30, blk, yo + 66, blk[ro + 5], blk[bo + 5]);
      putquadrgb24(addr + 36, blk, yo + 68, blk[ro + 6], blk[bo + 6]);
      putquadrgb24(addr + 42, blk, yo + 70, blk[ro + 7], blk[bo + 7]);
    }
  };

  const mdc = {
    r1820: 0,
    r1824: 0x80040000,
    rl: 0,
    STP: 0,
    end: 0,
    block: new Int32Array(6 * 64),

    rd32r1820: () => {
      return mdc.r1820;
    },

    wr32r1820: (data) => {
      mdc.r1820 = data;
    },

    rd32r1824: () => {
      return mdc.r1824;
    },

    wr32r1824: (data) => {
      if (data & 0x80000000) {
        mdc.r1820 = 0;
        mdc.r1824 = 0x80040000;
        psx.unsetEvent(mdc.event);
      }
    },

    dmaTransferMode0201: (addr, blck) => {
      if (!(addr & 0x007fffff)) return 0x10;
      addr = addr & 0x001fffff;

      const transferSize = (blck >>> 16) * (blck & 0xffff);

      switch (mdc.r1820 >>> 29) {
        // case 0x0:
        case 0x1:
          mdc.rl = addr;
          break;

        case 0x2:
          iqtab_init(addr, transferSize << 2);
          if (mdc.r1820 !== 0x40000001) return abort();
          break;

        default:
          console.log(hex(mdc.r1820 >>> 29));
      }

      mdc.r1820 &= 0xf87fffff;
      mdc.r1820 |= (mdc.r1824 & 0x1e000000) >> 2;

      return transferSize;
    },

    dmaTransferMode0200: (addr, blck) => {
      if (!(addr & 0x007fffff)) return 0x10;

      addr = addr & 0x001fffff;
      const numberOfWords = (blck >>> 16) * (blck & 0xffff);
      // clearCodeCache(addr, numberOfWords << 2); // optimistice assumption (performance reasons)

      const blk = mdc.block;
      const end = addr + (numberOfWords << 2);
      const depth = (mdc.r1820 >>> 27) & 3;
      mdc.end = end;
      mdc.STP = (mdc.r1820 & (1 << 25)) ? 0x8000 : 0x0000;
      let decodedMacroBlocks = 0;
      while (addr < end) {
        mdc.rl = rl2blk(blk, mdc.rl);
        switch (depth) {
          case 0: // todo: implement
            addr += (4 * 16) << 1;
            break;
          case 1: // todo: implement
            addr += (8 * 16) << 1;
            break;
          case 2:
            yuv2rgb24(blk, addr);
            addr += (24 * 16) << 1;
            break;
          case 3:
            yuv2rgb15(blk, addr);
            addr += (16 * 16) << 1;
            break;
        }
        decodedMacroBlocks += 6;
      }

      // 320x240x30 = 9000 16x16 blocks
      const decodingCyclesRemaining = (PSX_SPEED / 9000) * (decodedMacroBlocks / 6);
      psx.setEvent(mdc.event, decodingCyclesRemaining >>> 0);
      return numberOfWords;
    },

    event: null,
    complete: (self, clock) => {
      dma.completeDMA1({});
      psx.unsetEvent(self);
    }
  }

  mdc.event = psx.addEvent(0, mdc.complete.bind(mdc));

  for (let i = 0; i < 256; ++i) {
    scale[0 + i] = 0;
    scale[256 + i] = i;
    scale[512 + i] = 255;
  }

  return { mdc };
})