mdlr('enge:psx:gte', ({ include }) => {

  let lm;
  let sf;
  let isf;
  let rsf = 1.0; // 1 / sf
  let zsf3 = 0.0;
  let zsf4 = 0.0;
  let lzcr = 0;

  const v0 = new Int32Array(4);
  const v1 = new Int32Array(4);
  const v2 = new Int32Array(4);

  const ll = new Int32Array(9);
  const lc = new Int32Array(9);
  const rt = new Int32Array(9);
  const zr = new Int32Array(9);

  const bk = new Int32Array(3);
  const fc = new Int32Array(3);
  const tr = new Int32Array(3);

  const rgb = new Int32Array(4);

  const ir = new Float64Array(4);
  const mac = new Float64Array(4);

  const regs = new Int32Array(64);
  const flag = new Int32Array(32);

  const sx = new Int32Array(3);
  const sy = new Int32Array(3);
  const sz = new Int32Array(4);

  const $mat = [rt, ll, lc, zr];
  const $vec = [v0, v1, v2, ir];
  const $add = [tr, bk, fc, zr];

  const $cycles = new Map([
    [0x01, 15],
    [0x06, 8],
    [0x0c, 6],
    [0x10, 8],
    [0x11, 8],
    [0x12, 8],
    [0x13, 19],
    [0x14, 13],
    [0x16, 44],
    [0x1b, 17],
    [0x1c, 11],
    [0x1e, 14],
    [0x20, 30],
    // [0x28, 5],
    [0x29, 8],
    [0x2a, 17],
    // [0x2d, 5],
    [0x2e, 6],
    [0x30, 23],
    // [0x3d, 5],
    // [0x3e, 5],
    [0x3f, 39],
  ]);

  // --- arithmetic helpers -------------------------------------------------
  // All values are integers held in doubles (exact up to 2^53). MAC1..3 sums
  // are 44 bit on the hardware: every partial sum is checked for overflow and
  // wrapped to 44 bits, the shifted result is stored as a 32 bit register.

  const P43 = 8796093022208.0;   // 2^43
  const P44 = 17592186044416.0;  // 2^44

  // check and wrap a MACn (n = 1..3) intermediate to 44 bits
  const chk = (n, value) => {
    if (value >= P43) { regs[0x3f] |= flag[31 - n]; }
    else if (value < -P43) { regs[0x3f] |= flag[28 - n]; }
    else return value;
    return value - Math.floor((value + P43) * (1.0 / P44)) * P44;
  };

  // SAR (sf*12), result truncated to the 32 bit MAC register
  // (multiplying by a power-of-two reciprocal is exact and faster than dividing)
  const shift = (value) => Math.floor(value * rsf) | 0;

  const lim = (value, lowerBound, lowerBit, upperBound, upperBit) => {
    if (value < lowerBound) { regs[0x3f] |= flag[lowerBit]; return lowerBound; }
    if (value > upperBound) { regs[0x3f] |= flag[upperBit]; return upperBound; }
    return value;
  };

  // IRn = saturate(value), flag bits 24..22
  const setIr = (n, value, lm) => {
    ir[n] = lim(value, lm ? 0 : -0x8000, 25 - n, 0x7fff, 25 - n);
  };

  // MAC0 is 32 bit: flag 16 (positive) / 15 (negative) overflow
  const setMac0 = (value) => {
    if (value > 2147483647.0) regs[0x3f] |= flag[16];
    else if (value < -2147483648.0) regs[0x3f] |= flag[15];
    mac[0] = value | 0;
    return value;
  };

  const countLeadingZeros = (value) => {
    if (value & 0x80000000) {
      value ^= 0xFFFFFFFF;
    }
    if (value === 0) {
      lzcr = 32;
    }
    else {
      for (var idx = 31; (value & (1 << idx)) === 0 && idx >= 0; --idx);
      lzcr = 31 - idx;
    }
  };

  // UNR division table used by the hardware divider
  const unrTable = new Uint8Array(257);
  for (let i = 0; i < 257; ++i) {
    unrTable[i] = Math.max(0, Math.floor((Math.floor(0x40000 / (i + 0x100)) + 1) / 2) - 0x101);
  }

  // (H * 20000h / SZ3 + 1) / 2 as computed by the hardware, flag 17 on overflow
  const divide = (h, sz3) => {
    if (h >= sz3 * 2) {
      regs[0x3f] |= flag[17];
      return 0x1ffff;
    }
    const z = Math.clz32(sz3) - 16;
    const n = h * (1 << z);
    let d = sz3 << z;
    const u = unrTable[(d - 0x7fc0) >> 7] + 0x101;
    d = (0x2000080 - d * u) >> 8;
    d = (0x0000080 + d * u) >> 8;
    return Math.min(0x1ffff, Math.floor((n * d + 0x8000) * (1.0 / 65536.0)));
  };

  // MACn = (add*1000h + row . vec), 44 bit checked, unshifted
  const row = (n, add, m0, m1, m2, x, y, z) => {
    let sum = chk(n, add * 4096.0);
    sum = chk(n, sum + m0 * x);
    sum = chk(n, sum + m1 * y);
    return chk(n, sum + m2 * z);
  };

  const transform = (add, mat, vec) => {
    // vec may be IR, which is overwritten below
    const x = vec[1], y = vec[2], z = vec[3];

    // [MAC1,MAC2,MAC3] = (Tx*1000h + Mx*Vx) SAR (sf*12)
    mac[1] = shift(row(1, add[0], mat[0], mat[1], mat[2], x, y, z));
    mac[2] = shift(row(2, add[1], mat[3], mat[4], mat[5], x, y, z));
    mac[3] = shift(row(3, add[2], mat[6], mat[7], mat[8], x, y, z));

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    setIr(1, mac[1], lm); setIr(2, mac[2], lm); setIr(3, mac[3], lm);
  };

  // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4 (unshifted products)
  const colorProducts = (out) => {
    out[1] = chk(1, ((rgb[3] & 0xff) * 16.0) * ir[1]);
    out[2] = chk(2, (((rgb[3] >> 8) & 0xff) * 16.0) * ir[2]);
    out[3] = chk(3, (((rgb[3] >> 16) & 0xff) * 16.0) * ir[3]);
  };

  // [MAC1..3] = products SAR (sf*12), [IR1..3] = [MAC1..3]
  const store = (p) => {
    mac[1] = shift(p[1]); mac[2] = shift(p[2]); mac[3] = shift(p[3]);
    setIr(1, mac[1], lm); setIr(2, mac[2], lm); setIr(3, mac[3], lm);
  };

  // depth cue on unshifted products p:
  //   [IR1..3] = ((FC SHL 12) - p) SAR (sf*12), saturated signed (lm=0)
  //   [MAC1..3] = (p + IR*IR0) SAR (sf*12), [IR1..3] = [MAC1..3]
  const depthCue = (p) => {
    for (let n = 1; n <= 3; ++n) {
      const d = chk(n, chk(n, fc[n - 1] * 4096.0) - p[n]);
      setIr(n, shift(d), 0);
    }
    for (let n = 1; n <= 3; ++n) {
      mac[n] = shift(chk(n, p[n] + ir[n] * ir[0]));
    }
    setIr(1, mac[1], lm); setIr(2, mac[2], lm); setIr(3, mac[3], lm);
  };

  const updateColorFifo = () => {
    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    const c = rgb[3] >>> 24;
    const r = lim(mac[1] >> 4, 0, 21, 255, 21);
    const g = lim(mac[2] >> 4, 0, 20, 255, 20);
    const b = lim(mac[3] >> 4, 0, 19, 255, 19);

    rgb[0] = rgb[1];
    rgb[1] = rgb[2];
    rgb[2] = (c << 24) | (b << 16) | (g << 8) | (r << 0);
  };

  const products = new Float64Array(4);

  /// COMMANDS

  const avsz3 = () => {
    // MAC0 = ZSF3*(SZ1+SZ2+SZ3), OTZ = MAC0/1000h
    const v = setMac0(zsf3 * (sz[1] + sz[2] + sz[3]));
    regs[0x07] = lim(Math.floor(v / 4096.0), 0, 18, 0xffff, 18);
  };

  const avsz4 = () => {
    // MAC0 = ZSF4*(SZ0+SZ1+SZ2+SZ3), OTZ = MAC0/1000h
    const v = setMac0(zsf4 * (sz[0] + sz[1] + sz[2] + sz[3]));
    regs[0x07] = lim(Math.floor(v / 4096.0), 0, 18, 0xffff, 18);
  };

  const ncs = (vec) => {
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3] = (LLM*V) SAR (sf*12)
    transform(zr, ll, vec);
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    transform(bk, lc, ir);
    updateColorFifo();
  };

  const nccs = (vec) => {
    transform(zr, ll, vec);
    cc();
  };

  const cc = () => {
    transform(bk, lc, ir);
    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4 SAR (sf*12)
    colorProducts(products);
    store(products);
    updateColorFifo();
  };

  const ncds = (vec) => {
    transform(zr, ll, vec);
    cdp();
  };

  const cdp = () => {
    transform(bk, lc, ir);
    colorProducts(products);
    depthCue(products);
    updateColorFifo();
  };

  const dcpl = () => {
    colorProducts(products);
    depthCue(products);
    updateColorFifo();
  };

  const dpcs = (color) => {
    // [MAC1,MAC2,MAC3] = [R,G,B] SHL 16
    products[1] = (color & 0xff) * 65536.0;
    products[2] = ((color >> 8) & 0xff) * 65536.0;
    products[3] = ((color >> 16) & 0xff) * 65536.0;
    depthCue(products);
    updateColorFifo();
  };

  const intpl = () => {
    // [MAC1,MAC2,MAC3] = [IR1,IR2,IR3] SHL 12
    products[1] = ir[1] * 4096.0;
    products[2] = ir[2] * 4096.0;
    products[3] = ir[3] * 4096.0;
    depthCue(products);
    updateColorFifo();
  };

  const gpf = () => {
    // [MAC1,MAC2,MAC3] = (IR*IR0) SAR (sf*12)
    products[1] = chk(1, ir[1] * ir[0]);
    products[2] = chk(2, ir[2] * ir[0]);
    products[3] = chk(3, ir[3] * ir[0]);
    store(products);
    updateColorFifo();
  };

  const gpl = () => {
    // [MAC1,MAC2,MAC3] = ((MAC SHL (sf*12)) + IR*IR0) SAR (sf*12)
    products[1] = chk(1, chk(1, mac[1] * sf) + ir[1] * ir[0]);
    products[2] = chk(2, chk(2, mac[2] * sf) + ir[2] * ir[0]);
    products[3] = chk(3, chk(3, mac[3] * sf) + ir[3] * ir[0]);
    store(products);
    updateColorFifo();
  };

  const garbage = new Int32Array(9);

  const mvmva = (commandId) => {
    const mx = (commandId >> 17) & 3;
    const vx = (commandId >> 15) & 3;
    const tx = (commandId >> 13) & 3;

    let mat = $mat[mx];
    if (mx === 3) {
      // reserved matrix: [-R*10h, R*10h, IR0; RT13 x3; RT22 x3]
      const r = (rgb[3] & 0xff) * 16;
      garbage[0] = -r; garbage[1] = r; garbage[2] = ir[0];
      garbage[3] = garbage[4] = garbage[5] = rt[2];
      garbage[6] = garbage[7] = garbage[8] = rt[4];
      mat = garbage;
    }
    const vec = $vec[vx];
    const add = $add[tx];

    if (tx !== 2) {
      transform(add, mat, vec);
      return;
    }

    // far color translation is bugged: (FC*1000h + Mx1*Vx1) only sets flags,
    // the result is (Mx2*Vx2 + Mx3*Vx3) SAR (sf*12)
    const x = vec[1], y = vec[2], z = vec[3];
    for (let n = 1; n <= 3; ++n) {
      const m = (n - 1) * 3;
      const first = chk(n, chk(n, fc[n - 1] * 4096.0) + mat[m] * x);
      lim(shift(first), lm ? 0 : -0x8000, 25 - n, 0x7fff, 25 - n);
      mac[n] = shift(chk(n, chk(n, mat[m + 1] * y) + mat[m + 2] * z));
    }
    setIr(1, mac[1], lm); setIr(2, mac[2], lm); setIr(3, mac[3], lm);
  };

  const nclip = () => {
    // MAC0 = SX0*SY1 + SX1*SY2 + SX2*SY0 - SX0*SY2 - SX1*SY0 - SX2*SY1
    setMac0(sx[0] * sy[1] + sx[1] * sy[2] + sx[2] * sy[0] - sx[0] * sy[2] - sx[1] * sy[0] - sx[2] * sy[1]);
  };

  const op = () => {
    // [MAC1,MAC2,MAC3] = [IR3*D2-IR2*D3, IR1*D3-IR3*D1, IR2*D1-IR1*D2] SAR (sf*12)
    const x = ir[1], y = ir[2], z = ir[3];
    mac[1] = shift(chk(1, chk(1, z * rt[4]) - y * rt[8]));
    mac[2] = shift(chk(2, chk(2, x * rt[8]) - z * rt[0]));
    mac[3] = shift(chk(3, chk(3, y * rt[0]) - x * rt[4]));
    setIr(1, mac[1], lm); setIr(2, mac[2], lm); setIr(3, mac[3], lm);
  };

  const rtps = (vec, last) => {
    const h = regs[0x3a] & 0xffff;
    const ofx = regs[0x38];
    const ofy = regs[0x39];
    const dqa = regs[0x3b];
    const dqb = regs[0x3c];
    const x = vec[1], y = vec[2], z = vec[3];

    // [MAC1,MAC2,MAC3] = (TR*1000h + RT*Vx) SAR (sf*12)
    mac[1] = shift(row(1, tr[0], rt[0], rt[1], rt[2], x, y, z));
    mac[2] = shift(row(2, tr[1], rt[3], rt[4], rt[5], x, y, z));
    const sum3 = row(3, tr[2], rt[6], rt[7], rt[8], x, y, z);
    mac[3] = shift(sum3);

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]; the IR3 flag is based on MAC3 SAR 12
    // even when sf=0, while the IR3 value saturates as usual
    setIr(1, mac[1], lm); setIr(2, mac[2], lm);
    const z12 = Math.floor(sum3 * (1.0 / 4096.0));
    if (z12 < -0x8000 || z12 > 0x7fff) regs[0x3f] |= flag[22];
    ir[3] = mac[3] < (lm ? 0 : -0x8000) ? (lm ? 0 : -0x8000) : mac[3] > 0x7fff ? 0x7fff : mac[3];

    // SZ3 = MAC3 SAR ((1-sf)*12), taken from the full 44 bit sum: with sf=0
    // the 32 bit MAC3 register may already have wrapped
    sz[0] = sz[1]; sz[1] = sz[2]; sz[2] = sz[3];
    sz[3] = lim(z12, 0, 18, 0xffff, 18);

    const n = divide(h, sz[3]);

    // MAC0 = n*IR1 + OFX, SX2 = MAC0/10000h; MAC0 = n*IR2 + OFY, SY2 = MAC0/10000h
    const mx = setMac0(n * ir[1] + ofx);
    const my = setMac0(n * ir[2] + ofy);
    sx[0] = sx[1]; sx[1] = sx[2];
    sy[0] = sy[1]; sy[1] = sy[2];
    sx[2] = lim(Math.floor(mx * (1.0 / 65536.0)), -0x400, 14, 0x3ff, 14);
    sy[2] = lim(Math.floor(my * (1.0 / 65536.0)), -0x400, 13, 0x3ff, 13);

    if (last) {
      // MAC0 = n*DQA + DQB, IR0 = MAC0/1000h
      const d = setMac0(n * dqa + dqb);
      ir[0] = lim(Math.floor(d * (1.0 / 4096.0)), 0, 12, 0x1000, 12);
    }
  };

  const sqr = () => {
    // [MAC1,MAC2,MAC3] = [IR1*IR1,IR2*IR2,IR3*IR3] SAR (sf*12)
    mac[1] = shift(chk(1, ir[1] * ir[1]));
    mac[2] = shift(chk(2, ir[2] * ir[2]));
    mac[3] = shift(chk(3, ir[3] * ir[3]));
    setIr(1, mac[1], lm); setIr(2, mac[2], lm); setIr(3, mac[3], lm);
  };

  const s16lo = data => (data << 16) >> 16;
  const s16hi = data => (data << 0) >> 16;
  const s32 = data => (data << 0) >> 0;
  const u16lo = data => (data << 16) >>> 16;
  const sat5 = data => data < 0 ? 0 : data > 0x1f ? 0x1f : data;

  const gte = {
    get: (regId) => {
      switch (regId) {
        case 0x01: // VZ0..VZ2 read back sign-extended
        case 0x03:
        case 0x05: return s16lo(regs[regId]);
        case 0x07: return u16lo(regs[regId]);
        case 0x08: return s16lo(ir[0]);
        case 0x09: return s16lo(ir[1]);
        case 0x0a: return s16lo(ir[2]);
        case 0x0b: return s16lo(ir[3]);
        case 0x0c: return (sx[0] & 0xffff) | (sy[0] << 16);
        case 0x0d: return (sx[1] & 0xffff) | (sy[1] << 16);
        case 0x0e: return (sx[2] & 0xffff) | (sy[2] << 16);
        case 0x0f: return (sx[2] & 0xffff) | (sy[2] << 16);
        case 0x10: return u16lo(sz[0]);
        case 0x11: return u16lo(sz[1]);
        case 0x12: return u16lo(sz[2]);
        case 0x13: return u16lo(sz[3]);
        case 0x14: return rgb[0];
        case 0x15: return rgb[1];
        case 0x16: return rgb[2];
        case 0x18: return mac[0];
        case 0x19: return mac[1];
        case 0x1a: return mac[2];
        case 0x1b: return mac[3];
        case 0x1c: // IRGB and ORGB both read IR1..IR3 / 0x80, saturated to 0..0x1f
        case 0x1d: let value = 0;
          value |= (sat5(ir[1] >> 7) << 0);
          value |= (sat5(ir[2] >> 7) << 5);
          value |= (sat5(ir[3] >> 7) << 10);
          return value;
        case 0x1f: return lzcr;
        case 0x3a: return s16lo(regs[regId]);
        default: return regs[regId];
      }
    },

    set: (regId, data) => {
      regs[regId] = data;

      switch (regId) {
        case 0x00: v0[1] = s16lo(data); v0[2] = s16hi(data); break;
        case 0x01: v0[3] = s16lo(data); break;
        case 0x02: v1[1] = s16lo(data); v1[2] = s16hi(data); break;
        case 0x03: v1[3] = s16lo(data); break;
        case 0x04: v2[1] = s16lo(data); v2[2] = s16hi(data); break;
        case 0x05: v2[3] = s16lo(data); break;
        case 0x06: rgb[3] = data; break;
        case 0x07: break;
        case 0x08: ir[0] = s16lo(data); break;
        case 0x09: ir[1] = s16lo(data); break;
        case 0x0a: ir[2] = s16lo(data); break;
        case 0x0b: ir[3] = s16lo(data); break;
        case 0x0c: sx[0] = s16lo(data); sy[0] = s16hi(data); break;
        case 0x0d: sx[1] = s16lo(data); sy[1] = s16hi(data); break;
        case 0x0e: sx[2] = s16lo(data); sy[2] = s16hi(data); break;
        case 0x0f: sx[0] = sx[1]; sy[0] = sy[1];
          sx[1] = sx[2]; sy[1] = sy[2];
          sx[2] = s16lo(data); sy[2] = s16hi(data);
          break;
        case 0x10: sz[0] = u16lo(data); break;
        case 0x11: sz[1] = u16lo(data); break;
        case 0x12: sz[2] = u16lo(data); break;
        case 0x13: sz[3] = u16lo(data); break;
        case 0x14: rgb[0] = data; break;
        case 0x15: rgb[1] = data; break;
        case 0x16: rgb[2] = data; break;
        case 0x17: break;
        case 0x18: mac[0] = s32(data); break;
        case 0x19: mac[1] = s32(data); break;
        case 0x1a: mac[2] = s32(data); break;
        case 0x1b: mac[3] = s32(data); break;
        case 0x1c: ir[1] = (data & 0x001f) << 7;
          ir[2] = (data & 0x03e0) << 2;
          ir[3] = (data & 0x7c00) >> 3;
          break;
        case 0x1d: break; // readonly
        case 0x1e: countLeadingZeros(data); break;
        case 0x1f: break; // readonly
        case 0x20: rt[0] = s16lo(data); rt[1] = s16hi(data); break;
        case 0x21: rt[2] = s16lo(data); rt[3] = s16hi(data); break;
        case 0x22: rt[4] = s16lo(data); rt[5] = s16hi(data); break;
        case 0x23: rt[6] = s16lo(data); rt[7] = s16hi(data); break;
        case 0x24: regs[regId] = rt[8] = s16lo(data); break;
        case 0x25: tr[0] = s32(data); break;
        case 0x26: tr[1] = s32(data); break;
        case 0x27: tr[2] = s32(data); break;
        case 0x28: ll[0] = s16lo(data); ll[1] = s16hi(data); break;
        case 0x29: ll[2] = s16lo(data); ll[3] = s16hi(data); break;
        case 0x2a: ll[4] = s16lo(data); ll[5] = s16hi(data); break;
        case 0x2b: ll[6] = s16lo(data); ll[7] = s16hi(data); break;
        case 0x2c: regs[regId] = ll[8] = s16lo(data); break;
        case 0x2d: bk[0] = s32(data); break;
        case 0x2e: bk[1] = s32(data); break;
        case 0x2f: bk[2] = s32(data); break;
        case 0x30: lc[0] = s16lo(data); lc[1] = s16hi(data); break;
        case 0x31: lc[2] = s16lo(data); lc[3] = s16hi(data); break;
        case 0x32: lc[4] = s16lo(data); lc[5] = s16hi(data); break;
        case 0x33: lc[6] = s16lo(data); lc[7] = s16hi(data); break;
        case 0x34: regs[regId] = lc[8] = s16lo(data); break;
        case 0x35: fc[0] = s32(data); break;
        case 0x36: fc[1] = s32(data); break;
        case 0x37: fc[2] = s32(data); break;
        case 0x38: regs[regId] = s32(data); break;
        case 0x39: regs[regId] = s32(data); break;
        case 0x3a: regs[regId] = u16lo(data); break;
        case 0x3b: regs[regId] = s16lo(data); break;
        case 0x3c: regs[regId] = s32(data); break;
        case 0x3d: regs[regId] = zsf3 = s16lo(data); break;
        case 0x3e: regs[regId] = zsf4 = s16lo(data); break;
        case 0x3f: regs[regId] = data & 0x7ffff000;
          if (regs[regId] & 0x7f87e000) {
            regs[regId] |= 0x80000000;
          }
          break;
        default: abort(hex(regId, 2));
      }
    },

    command: (commandId) => {
      sf = (commandId >> 19) & 1 ? 4096.0 : 1.0;
      isf = (commandId >> 19) & 1 ? 1.0 : 4096.0;
      rsf = 1.0 / sf;
      lm = (commandId >> 10) & 1;

      regs[0x3f] = 0;

      $command.get(commandId & 0x3f)(commandId);
    },

    cycles: (commandId) => $cycles.get(commandId & 0x3f) || 5
  };

  const f1 = f => { f(v0) };
  const f3 = f => { f(v0); f(v1); f(v2) };

  const $command = new Map([
    [0x01, _ => rtps(v0, true)],
    [0x06, _ => nclip()],
    [0x0c, _ => op()],
    [0x10, _ => dpcs(rgb[3])],
    [0x11, _ => intpl()],
    [0x12, _ => mvmva(_)],
    [0x13, _ => f1(ncds)],
    [0x14, _ => cdp()],
    [0x16, _ => f3(ncds)],
    [0x1b, _ => f1(nccs)],
    [0x1c, _ => cc()],
    [0x1e, _ => f1(ncs)],
    [0x20, _ => f3(ncs)],
    [0x28, _ => sqr()],
    [0x29, _ => dcpl()],
    [0x2a, _ => {dpcs(rgb[0]); dpcs(rgb[0]); dpcs(rgb[0])}],
    [0x2d, _ => avsz3()],
    [0x2e, _ => avsz4()],
    [0x30, _ => { rtps(v0, false); rtps(v1, false); rtps(v2, true); }],
    [0x3d, _ => gpf()],
    [0x3e, _ => gpl()],
    [0x3f, _ => f3(nccs)],
  ]);

  // flag bits
  for (let i = 0; i <= 31; ++i) {
    flag[i] = (1 << i);
  }

  for (let i = 23; i <= 30; ++i) {
    flag[i] |= 0x80000000;
  }

  for (let i = 13; i <= 18; ++i) {
    flag[i] |= 0x80000000;
  }

  return { gte };
})
