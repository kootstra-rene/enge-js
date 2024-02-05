mdlr('enge:psx:gte', m => {

  let lm;
  let sf;
  let isf;
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

  const lim = (value, lowerBound, lowerBit, upperBound, upperBit) => {
    if (value < lowerBound) { regs[0x3f] |= flag[lowerBit]; return lowerBound; }
    if (value > upperBound) { regs[0x3f] |= flag[upperBit]; return upperBound; }
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

  const limit = (bit) => {
    const lm = bit ? 0.0 : -32768.0;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    ir[1] = lim(mac[1], lm, 24, 32767.0, 24);
    ir[2] = lim(mac[2], lm, 23, 32767.0, 23);
    ir[3] = lim(mac[3], lm, 22, 32767.0, 22);
  };

  const overflow = () => {
    if (mac[0] > (0x7fffffff >> 0)) regs[0x3f] |= flag[16];
    if (mac[0] < (0x80000000 >> 0)) regs[0x3f] |= flag[15];
  }

  const depthCue = () => {
    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    ir[1] = ((fc[0] * 4096.0) - mac[1]) / sf;
    ir[2] = ((fc[1] * 4096.0) - mac[2]) / sf;
    ir[3] = ((fc[2] * 4096.0) - mac[3]) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    ir[1] = lim(ir[1], -32768.0, 24, 32767.0, 24);
    ir[2] = lim(ir[2], -32768.0, 23, 32767.0, 23);
    ir[3] = lim(ir[3], -32768.0, 22, 32767.0, 22);
  };

  const interpolate = () => {
    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    mac[1] = (mac[1] + (ir[1] * ir[0])) / sf;
    mac[2] = (mac[2] + (ir[2] * ir[0])) / sf;
    mac[3] = (mac[3] + (ir[3] * ir[0])) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    limit(lm);
  };

  const transform = (add, mat, vec) => {
    // [MAC1,MAC2,MAC3] = (Tx*1000h + Mx*Vx) SAR (sf*12)
    mac[1] = ((add[0] * 4096.0) + (mat[0] * vec[1]) + (mat[1] * vec[2]) + (mat[2] * vec[3])) / sf;
    mac[2] = ((add[1] * 4096.0) + (mat[3] * vec[1]) + (mat[4] * vec[2]) + (mat[5] * vec[3])) / sf;
    mac[3] = ((add[2] * 4096.0) + (mat[6] * vec[1]) + (mat[7] * vec[2]) + (mat[8] * vec[3])) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    limit(lm);
  };

  const updateColorFifo = () => {
    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    const c = rgb[3] >>> 24;
    const r = lim((mac[1] / 16.0), 0.0, 21, 255.0, 21);
    const g = lim((mac[2] / 16.0), 0.0, 20, 255.0, 20);
    const b = lim((mac[3] / 16.0), 0.0, 19, 255.0, 19);

    rgb[0] = rgb[1];
    rgb[1] = rgb[2];
    rgb[2] = (c << 24) | (b << 16) | (g << 8) | (r << 0);
  };

  /// COMMANDS

  const avsz3 = () => {
    // MAC0 = ZSF3*(SZ1+SZ2+SZ3)
    mac[0] = zsf3 * (sz[1] + sz[2] + sz[3]);
    overflow();
    // OTZ  =  MAC0/1000h
    regs[0x07] = lim(mac[0] / 4096.0, 0.0, 18, 65535.0, 18);
  };

  const avsz4 = () => {
    // MAC0 =  ZSF4*(SZ0+SZ1+SZ2+SZ3)
    mac[0] = zsf4 * (sz[0] + sz[1] + sz[2] + sz[3]);
    overflow();
    // OTZ  =  MAC0/1000h
    regs[0x07] = lim(mac[0] / 4096.0, 0.0, 18, 65535.0, 18);
  };

  const cc = () => { // todo: validate
    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    transform(bk, lc, ir);

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

    // [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
    mac[1] = mac[1] / sf;
    mac[2] = mac[2] / sf;
    mac[3] = mac[3] / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    limit(lm);

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const cdp = () => { // todo: validate
    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    transform(bk, lc, ir);

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    interpolate();

    // [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
    mac[1] = mac[1] / sf;
    mac[2] = mac[2] / sf;
    mac[3] = mac[3] / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    limit(lm);

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const dcpl = () => {
    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const dpcs = (rgb) => {
    // [MAC1,MAC2,MAC3] = [R,G,B] SHL 16
    mac[1] = ((rgb >> 0) & 0xff) * 65536.0;
    mac[2] = ((rgb >> 8) & 0xff) * 65536.0;
    mac[3] = ((rgb >> 16) & 0xff) * 65536.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const gpf = () => {
    // [MAC1,MAC2,MAC3] = [0,0,0]
    mac[1] = 0.0;
    mac[2] = 0.0;
    mac[3] = 0.0;

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const gpl = () => {
    // [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SHL (sf*12)
    mac[1] = mac[1] * sf;
    mac[2] = mac[2] * sf;
    mac[3] = mac[3] * sf;

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const intpl = () => {
    // [MAC1,MAC2,MAC3] = [IR1,IR2,IR3] SHL 12
    mac[1] = ir[1] * 4096.0;
    mac[2] = ir[2] * 4096.0;
    mac[3] = ir[3] * 4096.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const mvmva = (commandId) => {
    const mat = $mat[(commandId >> 17) & 3];
    const vec = $vec[(commandId >> 15) & 3];
    const add = $add[(commandId >> 13) & 3];

    transform(add, mat, vec);
  };

  const nccs = (vec) => {
    // [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    transform(zr, ll, vec);

    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    transform(bk, lc, ir);

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

    // [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
    mac[1] = mac[1] / sf;
    mac[2] = mac[2] / sf;
    mac[3] = mac[3] / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    limit(lm);

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const ncds = (vec) => {
    // [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    transform(zr, ll, vec);

    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    transform(bk, lc, ir);

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const nclip = () => {
    // MAC0 = SX0*SY1 + SX1*SY2 + SX2*SY0 - SX0*SY2 - SX1*SY0 - SX2*SY1
    mac[0] = sx[0] * (sy[1] - sy[2]) + sx[1] * (sy[2] - sy[0]) + sx[2] * (sy[0] - sy[1]);
    overflow();
  };

  const ncs = (vec) => {
    // [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    transform(zr, ll, vec);

    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    transform(bk, lc, ir);

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    updateColorFifo();
  };

  const op = () => {
    // [MAC1,MAC2,MAC3] = [IR3*D2-IR2*D3, IR1*D3-IR3*D1, IR2*D1-IR1*D2] SAR (sf*12)
    mac[1] = ((ir[3] * rt[4]) - (ir[2] * rt[8])) / sf;
    mac[2] = ((ir[1] * rt[8]) - (ir[3] * rt[0])) / sf;
    mac[3] = ((ir[2] * rt[0]) - (ir[1] * rt[4])) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    limit(lm);
  };

  const MAXRTPS = 8796093022207;
  const MINRTPS = -8796093022208;

  const rtps = (vec) => {
    const h = regs[0x3a] & 0xffff;
    const ofx = regs[0x38];
    const ofy = regs[0x39];
    const dqa = regs[0x3b];
    const dqb = regs[0x3c];

    // [MAC1,MAC2,MAC3] = (TR*1000h + RT*Vx) SAR (sf*12)
    mac[1] = ((tr[0] * 4096.0) + (rt[0] * vec[1]) + (rt[1] * vec[2]) + (rt[2] * vec[3])) / sf;
    if (mac[1] > MAXRTPS) regs[0x3f] |= flag[30];
    if (mac[1] < MINRTPS) regs[0x3f] |= flag[27];
    mac[2] = ((tr[1] * 4096.0) + (rt[3] * vec[1]) + (rt[4] * vec[2]) + (rt[5] * vec[3])) / sf;
    if (mac[2] > MAXRTPS) regs[0x3f] |= flag[29];
    if (mac[2] < MINRTPS) regs[0x3f] |= flag[26];
    mac[3] = ((tr[2] * 4096.0) + (rt[6] * vec[1]) + (rt[7] * vec[2]) + (rt[8] * vec[3])) / sf;
    if (mac[3] > MAXRTPS) regs[0x3f] |= flag[28];
    if (mac[3] < MINRTPS) regs[0x3f] |= flag[25];

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    limit(lm);

    sx[0] = sx[1];
    sx[1] = sx[2];

    sy[0] = sy[1];
    sy[1] = sy[2];

    sz[0] = sz[1];
    sz[1] = sz[2];
    sz[2] = sz[3];
    let zs3 = mac[3] / isf;
    sz[3] = lim(zs3, 0.0, 18, 65535.0, 18);

    let hsz3 = 131072.0;
    hsz3 = ((h * 131072.0 / sz[3]) + 1.0) / 2.0;
    if (hsz3 > 131071.0) {
      regs[0x3f] |= flag[17];
      hsz3 = 131071.0;
    }
    mac[0] = (hsz3 * ir[1]) + ofx; sx[2] = mac[0] / 65536.0;
    overflow();
    mac[0] = (hsz3 * ir[2]) + ofy; sy[2] = mac[0] / 65536.0;
    overflow();
    mac[0] = (hsz3 * dqa) + dqb; ir[0] = mac[0] / 4096.0;
    overflow();

    sx[2] = lim(sx[2], -1024.0, 14, 1023.0, 14);
    sy[2] = lim(sy[2], -1024.0, 13, 1023.0, 13);
    ir[0] = lim(ir[0], 0.0, 12, 4096.0, 12);
  };

  const sqr = () => {
    //[MAC1,MAC2,MAC3] = [IR1*IR1,IR2*IR2,IR3*IR3] SHR (sf*12)
    mac[1] = (ir[1] * ir[1]) / sf;
    mac[2] = (ir[2] * ir[2]) / sf;
    mac[3] = (ir[3] * ir[3]) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    limit(lm);
  };

  const s16lo = data => (data << 16) >> 16;
  const s16hi = data => (data << 0) >> 16;
  const s32 = data => (data << 0) >> 0;
  const u16lo = data => (data << 16) >>> 16;

  const gte = {
    get: (regId) => {
      switch (regId) {
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
        case 0x1d: let value = 0;
          value |= ((ir[1] >> 7) << 0);
          value |= ((ir[2] >> 7) << 5);
          value |= ((ir[3] >> 7) << 10);
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
      sf = (commandId >> 19) & 0x1 ? 4096.0 : 1.0;
      isf = (commandId >> 19) & 0x1 ? 1.0 : 4096.0;
      lm = (commandId >> 10) & 0x1;

      regs[0x3f] = 0;

      switch (commandId & 0x3f) {
        case 0x01: rtps(v0); break;
        case 0x06: nclip(); break;
        case 0x0c: op(); break;
        case 0x10: dpcs(rgb[3]); break;
        case 0x11: intpl(); break;
        case 0x12: mvmva(commandId); break;
        case 0x13: ncds(v0); break;
        case 0x14: cdp(); break;
        case 0x16: ncds(v0); ncds(v1); ncds(v2); break;
        case 0x1b: nccs(v0); break;
        case 0x1c: cc(); break;
        case 0x1e: ncs(v0); break;
        case 0x20: ncs(v0); ncs(v1); ncs(v2); break;
        case 0x28: sqr(); break;
        case 0x29: dcpl(); break;
        case 0x2a: dpcs(rgb[0]); dpcs(rgb[0]); dpcs(rgb[0]); break;
        case 0x2d: avsz3(); break;
        case 0x2e: avsz4(); break;
        case 0x30: rtps(v0); rtps(v1); rtps(v2); break;
        case 0x3d: gpf(); break;
        case 0x3e: gpl(); break;
        case 0x3f: nccs(v0); nccs(v1); nccs(v2); break;
        default: abort(hex(commandId, 5));
      }
    },

    cycles: (commandId) => $cycles.get(commandId & 0x3f) || 5
  };

  // flag bits
  for (var i = 0; i <= 31; ++i) {
    flag[i] = (1 << i);
  }

  for (var i = 23; i <= 30; ++i) {
    flag[i] |= 0x80000000;
  }

  for (var i = 13; i <= 18; ++i) {
    flag[i] |= 0x80000000;
  }

  return { gte };
})
