mdlr('enge:psx:mdec', ({ include }) => {

  const mdecDebug = new URLSearchParams(window.location.search).has('debug-mdec');
  const mdecLog = (...args) => {
    if (mdecDebug) console.debug('[MDEC]', ...args);
  };

  // quantisation tables (command 2): 0-63 luminance, 64-127 colour, in zigzag order
  const iq = new Uint8Array(128);
  const iqY = iq.subarray(0, 64);
  const iqC = iq.subarray(64, 128);

  // IDCT scale table (command 3), defaults to the table every game uploads
  const scaleTable = new Int32Array([
    0x5a82, 0x5a82, 0x5a82, 0x5a82, 0x5a82, 0x5a82, 0x5a82, 0x5a82,
    0x7d8a, 0x6a6d, 0x471c, 0x18f8, 0xe707, 0xb8e3, 0x9592, 0x8275,
    0x7641, 0x30fb, 0xcf04, 0x89be, 0x89be, 0xcf04, 0x30fb, 0x7641,
    0x6a6d, 0xe707, 0x8275, 0xb8e3, 0x471c, 0x7d8a, 0x18f8, 0x9592,
    0x5a82, 0xa57d, 0xa57d, 0x5a82, 0x5a82, 0xa57d, 0xa57d, 0x5a82,
    0x471c, 0x8275, 0x18f8, 0x6a6d, 0x9592, 0xe707, 0x7d8a, 0xb8e3,
    0x30fb, 0x89be, 0x7641, 0xcf04, 0xcf04, 0x7641, 0x89be, 0x30fb,
    0x18f8, 0xb8e3, 0x6a6d, 0x8275, 0x7d8a, 0x9592, 0x471c, 0xe707,
  ].map(v => (v << 16) >> 16));

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

  const iqtab_init = (addr, size) => {
    for (let i = 0; i < size && i < 128; ++i) {
      iq[i] = map8[((addr + i) & 0x001fffff) >>> 0] & 0xff;
    }
  };

  const scaletab_init = (addr) => {
    for (let i = 0; i < 64; ++i) {
      scaleTable[i] = map16[(((addr & 0x001fffff) >>> 1) + i) & 0xfffff];
    }
  };

  const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);

  // hardware IDCT: two matrix passes with the scale table, result rounded,
  // wrapped to signed 9 bits and saturated to signed 8 bits. Sums stay below
  // 2^47 so doubles are exact.
  // Blocks are mostly zero: all-zero input columns produce all-zero temp
  // columns, so they are skipped in both passes (result is identical).
  const idctTemp = new Float64Array(64);
  const idctCols = new Int32Array(8);
  const idct = (blk) => {
    let cols = 0;
    for (let x = 0; x < 8; ++x) {
      if (!(blk[x] | blk[8 + x] | blk[16 + x] | blk[24 + x] | blk[32 + x] | blk[40 + x] | blk[48 + x] | blk[56 + x])) continue;
      idctCols[cols++] = x;

      for (let y = 0; y < 8; ++y) {
        let sum = 0;
        for (let u = 0; u < 8; ++u) {
          sum += blk[u * 8 + x] * scaleTable[u * 8 + y];
        }
        idctTemp[x + y * 8] = sum;
      }
    }

    for (let x = 0; x < 8; ++x) {
      for (let y = 0; y < 8; ++y) {
        let sum = 0;
        for (let c = 0; c < cols; ++c) {
          const u = idctCols[c];
          sum += idctTemp[u + y * 8] * scaleTable[u * 8 + x];
        }
        const v = ((Math.floor(sum / 0x100000000) + (Math.floor(sum / 0x80000000) & 1)) << 23) >> 23;
        blk[x + y * 8] = clamp(v, -128, 127);
      }
    }
  };

  // run-length decode, dequantise and IDCT one 8x8 block, returns the address after it
  const rl2blk = (blk, addr, qt) => {
    blk.fill(0);

    let base = (addr & 0x001fffff) >>> 1;

    let rl;
    do {
      rl = map16[(base++) & 0xfffff] & 0xffff;
    } while (rl === 0xfe00);

    // q = 0: coefficients are stored unquantised and in linear order
    const q = rl >>> 10;
    let k = 0;
    blk[0] = clamp(((rl << 22) >> 22) * (q ? qt[0] : 2), -0x400, 0x3ff);

    for (; ;) {
      rl = map16[(base++) & 0xfffff] & 0xffff;

      k += ((rl >>> 10) + 1);
      if (k > 63) break;

      const ac = ((rl << 22) >> 22);
      if (q) {
        blk[zscan[k]] = clamp(((ac * qt[k] * q + 4) / 8) | 0, -0x400, 0x3ff);
      }
      else {
        blk[k] = clamp(ac * 2, -0x400, 0x3ff);
      }
    }

    idct(blk);
    return base << 1;
  };

  // converts one 8x8 luminance block of a macroblock into rgb[] (0x00BBGGRR),
  // xx/yy select the quadrant of the 16x16 macroblock
  const yuv2rgb = (rgb, crBlk, cbBlk, yBlk, xx, yy, bias) => {
    for (let y = 0; y < 8; ++y) {
      for (let x = 0; x < 8; ++x) {
        const c = ((x + xx) >> 1) + ((y + yy) >> 1) * 8;
        const Cr = crBlk[c];
        const Cb = cbBlk[c];
        const R = Math.trunc(1.402 * Cr);
        const G = Math.trunc((-0.3437 * Cb) + (-0.7143 * Cr));
        const B = Math.trunc(1.772 * Cb);

        const Y = yBlk[x + y * 8];
        const r = (clamp(Y + R, -128, 127) + bias) & 0xff;
        const g = (clamp(Y + G, -128, 127) + bias) & 0xff;
        const b = (clamp(Y + B, -128, 127) + bias) & 0xff;
        rgb[(x + xx) + (y + yy) * 16] = (b << 16) | (g << 8) | r;
      }
    }
  };

  const putrgb15 = (rgb, addr, stp) => {
    const base = (addr & 0x001fffff) >>> 1;
    for (let i = 0; i < 256; ++i) {
      const c = rgb[i];
      const r = (c >>> 3) & 0x1f;
      const g = (c >>> 11) & 0x1f;
      const b = (c >>> 19) & 0x1f;
      map16[(base + i) & 0xfffff] = stp | (b << 10) | (g << 5) | r;
    }
  };

  const putrgb24 = (rgb, addr) => {
    const base = addr & 0x001fffff;
    for (let i = 0; i < 256; ++i) {
      const c = rgb[i];
      map8[(base + i * 3 + 0) & 0x1fffff] = c;
      map8[(base + i * 3 + 1) & 0x1fffff] = c >>> 8;
      map8[(base + i * 3 + 2) & 0x1fffff] = c >>> 16;
    }
  };

  const putmono8 = (yBlk, addr, bias) => {
    const base = addr & 0x001fffff;
    for (let i = 0; i < 64; ++i) {
      map8[(base + i) & 0x1fffff] = yBlk[i] + bias;
    }
  };

  // two pixels per byte, first pixel in the low nibble. The hardware rounds
  // the 8 bit value to 4 bits and saturates: min(15, (v + 8) >> 4)
  const putmono4 = (yBlk, addr, bias) => {
    const base = addr & 0x001fffff;
    for (let i = 0; i < 32; ++i) {
      const lo = Math.min(15, (((yBlk[i * 2 + 0] + bias) & 0xff) + 8) >>> 4);
      const hi = Math.min(15, (((yBlk[i * 2 + 1] + bias) & 0xff) + 8) >>> 4);
      map8[(base + i) & 0x1fffff] = (hi << 4) | lo;
    }
  };

  // FE00h halfwords between blocks are padding
  const skipPadding = () => {
    while (mdc.rl < mdc.rlEnd && (map16[(mdc.rl & 0x001fffff) >>> 1] & 0xffff) === 0xfe00) {
      mdc.rl += 2;
    }
  };

  // move on to queued input once the current decode command's data is consumed
  const nextInput = () => {
    skipPadding();
    while (mdc.rl >= mdc.rlEnd && mdc.rlQueue.length) {
      const next = mdc.rlQueue.shift();
      mdc.rl = next.addr;
      mdc.rlEnd = next.end;
      skipPadding();
    }
  };

  const mdc = {
    r1820: 0,
    r1824: 0x80040000,
    rl: 0,
    rlEnd: 0,
    rlQueue: [],
    STP: 0,
    end: 0,
    blocks: [0, 1, 2, 3, 4, 5].map(() => new Int32Array(64)),
    rgb: new Int32Array(256),

    rd32r1820: () => {
      return mdc.r1820;
    },

    wr32r1820: (data) => {
      mdecLog('cmd', hex(data >>> 0), 'prev', hex(mdc.r1820 >>> 0));
      mdc.r1820 = data;
    },

    // b31 data-out fifo empty, b29 command busy, b23-26 output format,
    // b16-18 current block, b0-15 parameter words remaining minus 1 (ffff = none)
    rd32r1824: () => {
      if (!mdc.rlEnd) return mdc.r1824; // no decode command since reset

      skipPadding();
      const words = (mdc.rlEnd - mdc.rl) >> 2;
      let status = (mdc.r1824 & 0xdfff0000) | ((mdc.r1820 >>> 2) & 0x07800000);
      status |= words > 0 ? ((words - 1) & 0xffff) : 0xffff;
      // FFIX must not reset its movie column before the final output DMA completes.
      const busy = (mdc.r1820 >>> 29) === 1 &&
        (mdc.rl < mdc.rlEnd || mdc.rlQueue.length || mdc.event.active);
      if (busy) status |= 0x20000000;
      return status;
    },

    wr32r1824: (data) => {
      mdecLog('ctrl', hex(data >>> 0));
      if (data & 0x80000000) {
        mdc.r1820 = 0;
        mdc.r1824 = 0x80040000;
        mdc.rl = mdc.rlEnd = 0;
        mdc.rlQueue.length = 0;
        psx.unsetEvent(mdc.event);
      }
    },

    dmaTransferMode0201: (addr, blck) => {
      if (!(addr & 0x007fffff)) return 0x10;
      addr = addr & 0x001fffff;

      const transferSize = (blck >>> 16) * (blck & 0xffff);

      mdecLog('dma0', {
        addr: hex(addr), blck: hex(blck >>> 0), words: transferSize,
        cmd: hex(mdc.r1820 >>> 0), firstWord: hex(map[addr >>> 2] >>> 0),
        prevRl: hex(mdc.rl >>> 0), prevRlEnd: hex(mdc.rlEnd >>> 0), queued: mdc.rlQueue.length
      });

      switch (mdc.r1820 >>> 29) {
        // case 0x0:
        case 0x1: {
          // the MDEC buffers input: games send the next frame before the
          // current one is fully decoded, so queue it instead of jumping ahead
          const end = addr + (transferSize << 2);
          skipPadding();
          if (mdc.rl < mdc.rlEnd) {
            if (mdc.rlQueue.length) {
              const next = mdc.rlQueue.shift();
              mdc.rl = next.addr;
              mdc.rlEnd = next.end;
            }
            mdc.rlQueue.push({ addr, end });
          }
          else {
            mdc.rl = addr;
            mdc.rlEnd = end;
          }
          break;
        }

        case 0x2:
          iqtab_init(addr, transferSize << 2);
          if (mdc.r1820 !== 0x40000001) return abort();
          break;

        case 0x3:
          scaletab_init(addr);
          break;

        default:
          console.log(hex(mdc.r1820 >>> 29));
      }

      return transferSize;
    },

    dmaTransferMode0200: (addr, blck) => {
      if (!(addr & 0x007fffff)) return 0x10;

      addr = addr & 0x001fffff;
      const numberOfWords = (blck >>> 16) * (blck & 0xffff);
      // clearCodeCache(addr, numberOfWords << 2); // optimistice assumption (performance reasons)

      const blocks = mdc.blocks;
      const rgb = mdc.rgb;
      const end = addr + (numberOfWords << 2);
      const depth = (mdc.r1820 >>> 27) & 3;
      const bias = (mdc.r1820 & (1 << 26)) ? 0x00 : 0x80; // signed / unsigned output
      mdc.end = end;
      mdc.STP = (mdc.r1820 & (1 << 25)) ? 0x8000 : 0x0000;
      let decodedBlocks = 0;
      const rlStart = mdc.rl;
      while (addr < end) {
        nextInput();
        if (depth < 2) {
          // monochrome: one 8x8 luminance block per macroblock
          mdc.rl = rl2blk(blocks[2], mdc.rl, iqY);
          if (depth === 0) {
            putmono4(blocks[2], addr, bias);
            addr += 32;
          }
          else {
            putmono8(blocks[2], addr, bias);
            addr += 64;
          }
          decodedBlocks += 1;
          continue;
        }

        // colour: Cr, Cb, then four luminance blocks
        mdc.rl = rl2blk(blocks[0], mdc.rl, iqC);
        mdc.rl = rl2blk(blocks[1], mdc.rl, iqC);
        for (let i = 0; i < 4; ++i) {
          mdc.rl = rl2blk(blocks[2 + i], mdc.rl, iqY);
          yuv2rgb(rgb, blocks[0], blocks[1], blocks[2 + i], (i & 1) << 3, (i & 2) << 2, bias);
        }
        if (depth === 2) {
          putrgb24(rgb, addr);
          addr += 768;
        }
        else {
          putrgb15(rgb, addr, mdc.STP);
          addr += 512;
        }
        decodedBlocks += 6;
      }
      // consume trailing padding so a finished command reports idle
      skipPadding();

      mdecLog('dma1', {
        addr: hex(end - (numberOfWords << 2)), blck: hex(blck >>> 0), words: numberOfWords,
        depth, blocks: decodedBlocks,
        cmd: hex(mdc.r1820 >>> 0), rlStart: hex(rlStart >>> 0), rlNow: hex(mdc.rl >>> 0), rlEnd: hex(mdc.rlEnd >>> 0)
      });

      // 320x240x30 = 9000 16x16 blocks
      const decodingCyclesRemaining = (PSX_SPEED / 9000) * (decodedBlocks / 6);
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

  return { mdc };
})