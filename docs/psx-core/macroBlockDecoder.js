'use strict';

var video = {

  iq: new Int32Array(64*4),
  decoded: new Uint8Array(64*6*4),

  zscan: [
     0 , 1 , 8, 16,  9,  2,  3, 10,
    17, 24, 32, 25, 18, 11,  4,  5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13,  6,  7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
  ],

  aanscales: [
    0x4000, 0x58c5, 0x539f, 0x4b42, 0x4000, 0x3249, 0x22a3, 0x11a8,
    0x58c5, 0x7b21, 0x73fc, 0x6862, 0x58c5, 0x45bf, 0x300b, 0x187e,
    0x539f, 0x73fc, 0x6d41, 0x6254, 0x539f, 0x41b3, 0x2d41, 0x1712,
    0x4b42, 0x6862, 0x6254, 0x587e, 0x4b42, 0x3b21, 0x28ba, 0x14c3,
    0x4000, 0x58c5, 0x539f, 0x4b42, 0x4000, 0x3249, 0x22a3, 0x11a8,
    0x3249, 0x45bf, 0x41b3, 0x3b21, 0x3249, 0x2782, 0x1b37, 0x0de0,
    0x22a3, 0x300b, 0x2d41, 0x28ba, 0x22a3, 0x1b37, 0x12bf, 0x098e,
    0x11a8, 0x187e, 0x1712, 0x14c3, 0x11a8, 0x0de0, 0x098e, 0x04df,
  ],

  SCALERC256: function(y, x) {
    var c = 128 + y + (x >> 10);
    return (c < 0) ? 0 : ((c > 255) ? 255 : c) >>> 0;
  },

  iqtab_reset: function() {
    this.iq.fill(0);
  },

  iqtab_init: function(tab, addr, size) {
    addr = addr & 0x001fffff; // ram always
    for (let i = 0; i < size; ++i) {
      let q = map.getInt8(addr + i) & 0xff;
      tab[i] = (q * this.aanscales[ this.zscan[i] ]) >> 12;
    }
  },

  icdt: function (blk, o) {
    let z10, z11, z12, z13;

    var oo = o;
    for (let i = 0; i < 8; ++i, ++o) {
      z10 = blk[o +  0] + blk[o + 32];
      z11 = blk[o +  0] - blk[o + 32];
      z13 = blk[o + 16] + blk[o + 48];
      z12 = blk[o + 16] - blk[o + 48];
      z12 = ((z12 * 362) >> 8) - z13;

      let tmp0 = z10 + z13;
      let tmp3 = z10 - z13;
      let tmp1 = z11 + z12;
      let tmp2 = z11 - z12;

      z13 = blk[o + 24] + blk[o + 40];
      z10 = blk[o + 24] - blk[o + 40]; 
      z11 = blk[o +  8] + blk[o + 56];
      z12 = blk[o +  8] - blk[o + 56];
      let z5 = ((z12 - z10) * 473) >> 8; 

      let tmp7 = z11 + z13; 
      let tmp6 = (((z10 * 669) >> 8) + z5) - tmp7;
      let tmp5 = (((z11 - z13) * 362) >> 8) - tmp6;
      let tmp4 = (((z12 * 277) >> 8) - z5) + tmp5; 

      blk[o +  0] = (tmp0 + tmp7) >> 0; 
      blk[o + 56] = (tmp0 - tmp7) >> 0;
      blk[o +  8] = (tmp1 + tmp6) >> 0;
      blk[o + 48] = (tmp1 - tmp6) >> 0;
      blk[o + 16] = (tmp2 + tmp5) >> 0;
      blk[o + 40] = (tmp2 - tmp5) >> 0;
      blk[o + 32] = (tmp3 + tmp4) >> 0;
      blk[o + 24] = (tmp3 - tmp4) >> 0;
    }

    o = oo;
    for (i = 0; i < 8; i++, o += 8) {
      z10 = blk[o + 0] + blk[o + 4];
      z11 = blk[o + 0] - blk[o + 4];
      z13 = blk[o + 2] + blk[o + 6];
      z12 = blk[o + 2] - blk[o + 6];
      z12 = ((z12 * 362) >> 8) - z13;

      let tmp0 = z10 + z13;
      let tmp3 = z10 - z13;
      let tmp1 = z11 + z12;
      let tmp2 = z11 - z12;
      
      z13 = blk[o + 3] + blk[o + 5];
      z10 = blk[o + 3] - blk[o + 5];
      z11 = blk[o + 1] + blk[o + 7];
      z12 = blk[o + 1] - blk[o + 7];
      let z5 = ((z12 - z10) * 473) >> 8; 

      let tmp7 = z11 + z13; 
      let tmp6 = (((z10 * 669) >> 8) + z5) - tmp7;
      let tmp5 = (((z11 - z13) * 362) >> 8) - tmp6;
      let tmp4 = (((z12 * 277) >> 8) - z5) + tmp5; 

      blk[o + 0] = (tmp0 + tmp7) >> 5;
      blk[o + 7] = (tmp0 - tmp7) >> 5;
      blk[o + 1] = (tmp1 + tmp6) >> 5;
      blk[o + 6] = (tmp1 - tmp6) >> 5;
      blk[o + 2] = (tmp2 + tmp5) >> 5;
      blk[o + 5] = (tmp2 - tmp5) >> 5;
      blk[o + 4] = (tmp3 + tmp4) >> 5;
      blk[o + 3] = (tmp3 - tmp4) >> 5;
    }
  },

  rl2blk: function(blk, addr) {
    var rl;
    var iqtab = this.iq;

    blk.fill(0);

    for (let i = 0; i < 6; i++) {
      var o = 64 * i;

      rl = map.getInt16(addr) & 0xffff;
      addr += 2;

      blk[o] = iqtab[0] * ((rl << 22) >> 22);

      let k = 0;
      const q_scale = rl >> 10;

      for (;;) {
        rl =  map.getInt16(addr) & 0xffff;
        addr += 2;

        if (rl === 0xfe00) break;
        k += ((rl >> 10) + 1); 
        if (k >= 64) break;

        let val = (iqtab[k] * q_scale * ((rl << 22) >> 22)) >> 3;
        blk[o + this.zscan[k]] = val;
      }

      if ((k + 1) == 0) {
        for (let i = 0; i < MDEC_BLOCK_NUM; ++i) {
          blk.raw[o + i] = blk.raw[o] >> 5;
        }
        continue;
      }

      this.icdt(blk, o);
    }
    return addr;
  },

  putquadrgb15: function(addr, blk, o, Cr, Cb) {
    var Y, R, G, B, r, g, b, a = mdc.STP;

    // PSX
    // R = (1433 * Cr) >> 0;
    // G = ((-351 * Cb) - (728 * Cr)) >> 0;
    // B = (1807 * Cb) >> 0; 

    // // JPEG
    R = (1436 * Cr) >> 0;
    G = ((-352 * Cb) - (731 * Cr)) >> 0;
    B = (1815 * Cb) >> 0; 

    Y = blk[o+0] << 0;
    r = this.SCALERC256(Y, R) >>> 3;
    g = this.SCALERC256(Y, G) >>> 3;
    b = this.SCALERC256(Y, B) >>> 3;
    map.setInt16(addr +  0, a | (b << 10) | (g << 5) | r);

    Y = blk[o+1] << 0;
    r = this.SCALERC256(Y, R) >>> 3;
    g = this.SCALERC256(Y, G) >>> 3;
    b = this.SCALERC256(Y, B) >>> 3;
    map.setInt16(addr +  2, a | (b << 10) | (g << 5) | r);

    Y = blk[o+8] << 0;
    r = this.SCALERC256(Y, R) >>> 3;
    g = this.SCALERC256(Y, G) >>> 3;
    b = this.SCALERC256(Y, B) >>> 3;
    map.setInt16(addr + 32, a | (b << 10) | (g << 5) | r);

    Y = blk[o+9] << 0;
    r = this.SCALERC256(Y, R) >>> 3;
    g = this.SCALERC256(Y, G) >>> 3;
    b = this.SCALERC256(Y, B) >>> 3;
    map.setInt16(addr + 34, a | (b << 10) | (g << 5) | r);
  },

  yuv2rgb15: function(blk, addr) {
    var x, y;
    var ro = 0;
    var bo = 64;
    var yo = 64 * 2;
  
    for (y = 0; y < 16; y += 2, ro += 8, bo += 8, yo += 16, addr += 64) {
      if (y == 8) yo += 64;

      this.putquadrgb15(addr +  0, blk, yo +  0, blk[ro + 0], blk[bo + 0]);
      this.putquadrgb15(addr +  4, blk, yo +  2, blk[ro + 1], blk[bo + 1]);
      this.putquadrgb15(addr +  8, blk, yo +  4, blk[ro + 2], blk[bo + 2]);
      this.putquadrgb15(addr + 12, blk, yo +  6, blk[ro + 3], blk[bo + 3]);
      this.putquadrgb15(addr + 16, blk, yo + 64, blk[ro + 4], blk[bo + 4]);
      this.putquadrgb15(addr + 20, blk, yo + 66, blk[ro + 5], blk[bo + 5]);
      this.putquadrgb15(addr + 24, blk, yo + 68, blk[ro + 6], blk[bo + 6]);
      this.putquadrgb15(addr + 28, blk, yo + 70, blk[ro + 7], blk[bo + 7]);
    }
  },

  putquadrgb24: function(map, addr, blk, o, Cr, Cb) {
    var Y, R, G, B;

    // PSX
    // R = (1433 * Cr) >> 0;
    // G = ((-351 * Cb) - (728 * Cr)) >> 0;
    // B = (1807 * Cb) >> 0; 

    // JPEG
    R = (1436 * Cr) >> 0;
    G = ((-352 * Cb) - (731 * Cr)) >> 0;
    B = (1815 * Cb) >> 0; 

    // if ((addr + 0) >= mdc.end) return;
    Y = blk[o+0] << 0;
    map[addr +  0] = this.SCALERC256(Y, R);
    map[addr +  1] = this.SCALERC256(Y, G);
    map[addr +  2] = this.SCALERC256(Y, B);

    // if ((addr + 3) >= mdc.end) return;
    Y = blk[o+1] << 0;
    map[addr +  3] = this.SCALERC256(Y, R);
    map[addr +  4] = this.SCALERC256(Y, G);
    map[addr +  5] = this.SCALERC256(Y, B);

    // if ((addr + 48) >= mdc.end) return;
    Y = blk[o+8] << 0;
    map[addr + 48] = this.SCALERC256(Y, R);
    map[addr + 49] = this.SCALERC256(Y, G);
    map[addr + 50] = this.SCALERC256(Y, B);

    // if ((addr + 51) >= mdc.end) return;
    Y = blk[o+9] << 0;
    map[addr + 51] = this.SCALERC256(Y, R);
    map[addr + 52] = this.SCALERC256(Y, G);
    map[addr + 53] = this.SCALERC256(Y, B);
  },

  yuv2rgb24: function(blk, addr) {
    if (addr & 3) abort('alignment');

    var x, y;
    var ro = 0;
    var bo = 64;
    var yo = 64 * 2;
  
    var buf = this.decoded;
    // buf.fill(0);
    var base = addr;
    addr = 0;
    for (y = 0; y < 16; y += 2, ro += 8, bo += 8, yo += 16, addr += 96) {
      if (y == 8) yo += 64;

      this.putquadrgb24(buf, addr +  0, blk, yo +  0, blk[ro + 0], blk[bo + 0]);
      this.putquadrgb24(buf, addr +  6, blk, yo +  2, blk[ro + 1], blk[bo + 1]);
      this.putquadrgb24(buf, addr + 12, blk, yo +  4, blk[ro + 2], blk[bo + 2]);
      this.putquadrgb24(buf, addr + 18, blk, yo +  6, blk[ro + 3], blk[bo + 3]);
      this.putquadrgb24(buf, addr + 24, blk, yo + 64, blk[ro + 4], blk[bo + 4]);
      this.putquadrgb24(buf, addr + 30, blk, yo + 66, blk[ro + 5], blk[bo + 5]);
      this.putquadrgb24(buf, addr + 36, blk, yo + 68, blk[ro + 6], blk[bo + 6]);
      this.putquadrgb24(buf, addr + 42, blk, yo + 70, blk[ro + 7], blk[bo + 7]);
    }
    for (var i = 0; i < 768; i += 4) {
      // if ((base + i) >= mdc.end) break;
      var v = buf[i+0] | (buf[i+1] << 8) | (buf[i+2] << 16) | (buf[i+3] << 24);
      map[((base + i) & 0x001fffff) >> 2] = v;
    }
  },
}

var mdc = {
  r1820: 0,
  r1824: 0x80040000,
  decodingCyclesRemaining: -1,
  rl: 0,
  STP: 0,
  end: 0,
  block: new Int32Array(6*64),

  rd32r1820: function() {
    return mdc.r1820;
  },

  wr32r1820: function(data) {
    // console.log('wr32r1820:', hex(data));
    mdc.r1820 = data;
  },

  rd32r1824: function() {
    return mdc.r1824;
  },

  wr32r1824: function(data) {
    // console.log('wr32r1824:', hex(data));

    if (data & 0x80000000) {
      mdc.r1820 = 0;
      mdc.r1824 = 0x80040000;
      mdc.decodingCyclesRemaining = -1;
    }
  },

  dmaTransferMode0201: function(addr, blck) {
    addr = addr & 0x001fffff; // ram always
    //console.log("[mdec-in] addr:"+hex(addr)+" blck:"+hex(blck));

    const transferSize = (blck >>> 16) * (blck & 0xffff);

    switch (mdc.r1820 >>> 29) {
      case 0x0:
      case 0x1:
        mdc.rl = addr;
        break;

      case 0x2:
        video.iqtab_init(video.iq, addr, transferSize << 2);
        break;

      case 0x3:
        console.log("[mdec-in] scale table: NYI");
        break;

      default:
        console.log('not implemented', mdc.r1820 >>> 29);
    }

    return transferSize;
  },

  dmaTransferMode0200: function(addr, blck) {
    addr = addr & 0x001fffff; // ram always
    var numberOfWords = (blck >>> 16) * (blck & 0xffff);
    var blockSize = ((mdc.r1820 & 0x08000000) ? 16*16 : 24*16) << 1;
    clearCodeCache( addr, numberOfWords << 2);

    var blk = mdc.block;
    var end = addr + (numberOfWords << 2);
    mdc.end = end;
    var decodedMacroBlocks = 0;
    var depth = (mdc.r1820 >>> 27) & 3;
    while (addr < end) {
      mdc.STP = (mdc.r1820 & (1 << 25)) ? 0x8000 : 0x0000;
      mdc.rl = video.rl2blk(blk, mdc.rl);
      switch (depth) {
        case 2: video.yuv2rgb24(blk, addr);
                break;
        case 3: video.yuv2rgb15(blk, addr);
                break;
        default://console.error('unsupported depth', depth);
                break;
      }
      decodedMacroBlocks += 6;
      addr += blockSize;
    }

    if (mdc.r1820 & 0x08000000) {
      mdc.decodingCyclesRemaining += ((33868800 / 9000) * decodedMacroBlocks);
    }
    else {
      mdc.decodingCyclesRemaining += ((33868800 / 6000) * decodedMacroBlocks);
    }
    mdc.decodingCyclesRemaining += (numberOfWords * 0x110) / 0x100;

    return numberOfWords;
  },

  update: function(cycles) {
    if (mdc.decodingCyclesRemaining > 0) {
      mdc.decodingCyclesRemaining -= cycles;
      if (mdc.decodingCyclesRemaining <= 0) {
        mdc.decodingCyclesRemaining = -1;
        mdc.r1824 &= ~(1 << 29);
      }
    }
  }
}

Object.seal(video);
Object.seal(mdc);