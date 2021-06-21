'use strict';

const gte = {
  v0  : new Float64Array(4),
  v1  : new Float64Array(4),
  v2  : new Float64Array(4),

  ll  : new Float64Array(9),
  lc  : new Float64Array(9),
  rt  : new Float64Array(9),
  zr  : new Float64Array(9),

  bk  : new Float64Array(3),
  fc  : new Float64Array(3),
  tr  : new Float64Array(3),

  sx  : new Float64Array(3),
  sy  : new Float64Array(3),
  sz  : new Float64Array(4),

  ir  : new Float64Array(4),
  mac : new Float64Array(4),
  rgb : new Float64Array(4),

  zsf3: 0.0,
  zsf4: 0.0,
  regs: new Int32Array(64),
  flag: new Int32Array(32),
  lzcr: 0,

  sf  : 0,
  lm  : 0,

  lim: function(value, lowerBound, lowerBit, upperBound, upperBit) {
    if (value < lowerBound) { this.regs[0x3f] |= this.flag[lowerBit]; return lowerBound; }
    if (value > upperBound) { this.regs[0x3f] |= this.flag[upperBit]; return upperBound; }
    return value;
  },

  countLeadingZeros: function(value) {
    if (value & 0x80000000) {
      value ^= 0xFFFFFFFF;
    }
    if (value === 0) {
      this.lzcr = 32;
    }
    else {
      for (var idx = 31; (value & (1 << idx)) === 0 && idx >= 0; --idx);
      this.lzcr = 31 - idx;
    }
  },

  get: function(regId) {
    // console.log('get', hex(regId, 2));

    switch (regId) {
      case 0x00:  return this.regs[regId];
      case 0x01:  return (this.v0[3] << 16) >> 16;
      case 0x02:  return this.regs[regId];
      case 0x03:  return (this.v1[3] << 16) >> 16;
      case 0x04:  return this.regs[regId];
      case 0x05:  return (this.v2[3] << 16) >> 16;
      case 0x06:  return this.regs[regId];
      case 0x07:  return (this.regs[regId] << 16) >>> 16;
      case 0x08:  return (this.ir[0] << 16) >> 16;
      case 0x09:  return (this.ir[1] << 16) >> 16;
      case 0x0a:  return (this.ir[2] << 16) >> 16;
      case 0x0b:  return (this.ir[3] << 16) >> 16;
      case 0x0c:  return (this.sx[0] & 0xffff) | (this.sy[0] << 16);
      case 0x0d:  return (this.sx[1] & 0xffff) | (this.sy[1] << 16);
      case 0x0e:  return (this.sx[2] & 0xffff) | (this.sy[2] << 16);
      case 0x0f:  return (this.sx[2] & 0xffff) | (this.sy[2] << 16);
      case 0x10:  return (this.sz[0] << 16) >>> 16;
      case 0x11:  return (this.sz[1] << 16) >>> 16;
      case 0x12:  return (this.sz[2] << 16) >>> 16;
      case 0x13:  return (this.sz[3] << 16) >>> 16;
      case 0x14:  return this.rgb[0];
      case 0x15:  return this.rgb[1];
      case 0x16:  return this.rgb[2];
      case 0x17:  return this.regs[regId];
      case 0x18:  return this.mac[0];
      case 0x19:  return this.mac[1];
      case 0x1a:  return this.mac[2];
      case 0x1b:  return this.mac[3];
      case 0x1c:  //return this.regs[regId] & 0x7fff;
      case 0x1d:  var value = 0;
                  value |= ((this.ir[1] >> 7) <<  0);
                  value |= ((this.ir[2] >> 7) <<  5);
                  value |= ((this.ir[3] >> 7) << 10);
                  return value;
      case 0x1e:  return this.regs[regId];
      case 0x1f:  return this.lzcr;
      case 0x20:  return this.regs[regId];
      case 0x21:  return this.regs[regId];
      case 0x22:  return this.regs[regId];
      case 0x23:  return this.regs[regId];
      case 0x24:  return this.regs[regId];
      case 0x25:  return this.regs[regId];
      case 0x26:  return this.regs[regId];
      case 0x27:  return this.regs[regId];
      case 0x28:  return this.regs[regId];
      case 0x29:  return this.regs[regId];
      case 0x2a:  return this.regs[regId];
      case 0x2b:  return this.regs[regId];
      case 0x2c:  return this.regs[regId];
      case 0x2d:  return this.regs[regId];
      case 0x2e:  return this.regs[regId];
      case 0x2f:  return this.regs[regId];
      case 0x30:  return this.regs[regId];
      case 0x31:  return this.regs[regId];
      case 0x32:  return this.regs[regId];
      case 0x33:  return this.regs[regId];
      case 0x34:  return this.regs[regId];
      case 0x35:  return this.regs[regId];
      case 0x36:  return this.regs[regId];
      case 0x37:  return this.regs[regId];
      case 0x38:  return this.regs[regId];
      case 0x39:  return this.regs[regId];
      case 0x3a:  return (this.regs[regId] << 16) >> 16;
      case 0x3b:  return this.regs[regId];
      case 0x3c:  return this.regs[regId];
      case 0x3d:  return this.regs[regId];
      case 0x3e:  return this.regs[regId];
      case 0x3f:  return this.regs[regId];
      default  :  abort('get gte.r'+hex(regId,2)+' not yet implemented')
    }
  },

  set: function(regId, data) {
    var data = data >> 0;
    // this.regs[0x3f] = 0;
    this.regs[regId] = data;
    // console.log('set', hex(regId, 2), hex(data));

    switch (regId) {
      case 0x00:  this.v0[1] = (data << 16) >> 16;  this.v0[2] = (data << 0) >> 16; break;
      case 0x01:  this.v0[3] = (data << 16) >> 16;                                  break;
      case 0x02:  this.v1[1] = (data << 16) >> 16;  this.v1[2] = (data << 0) >> 16; break;
      case 0x03:  this.v1[3] = (data << 16) >> 16;                                  break;
      case 0x04:  this.v2[1] = (data << 16) >> 16;  this.v2[2] = (data << 0) >> 16; break;
      case 0x05:  this.v2[3] = (data << 16) >> 16;  break;
      case 0x06:  this.rgb[3] = data; break;
      case 0x07:  break;
      // case 0x07:  this.regs[regId] = (data << 16) >>> 16;   break;
      case 0x08:  this.ir[0] = (data << 16) >> 16;  break;
      case 0x09:  this.ir[1] = (data << 16) >> 16;  break;
      case 0x0a:  this.ir[2] = (data << 16) >> 16;  break;
      case 0x0b:  this.ir[3] = (data << 16) >> 16;  break;
      case 0x0c:  this.sx[0] = (data << 16) >> 16;  this.sy[0] = (data << 0) >> 16; break;
      case 0x0d:  this.sx[1] = (data << 16) >> 16;  this.sy[1] = (data << 0) >> 16; break;
      case 0x0e:  this.sx[2] = (data << 16) >> 16;  this.sy[2] = (data << 0) >> 16; break;
      case 0x0f:  this.sx[0] = this.sx[1];          this.sy[0] = this.sy[1];
                  this.sx[1] = this.sx[2];          this.sy[1] = this.sy[2];
                  this.sx[2] = (data << 16) >> 16;  this.sy[2] = (data << 0) >> 16;
                  break;
      case 0x10:  this.sz[0] =  (data << 16) >>> 16; break;
      case 0x11:  this.sz[1] =  (data << 16) >>> 16; break;
      case 0x12:  this.sz[2] =  (data << 16) >>> 16; break;
      case 0x13:  this.sz[3] =  (data << 16) >>> 16; break;
      case 0x14:  this.rgb[0] = data; break;
      case 0x15:  this.rgb[1] = data; break;
      case 0x16:  this.rgb[2] = data; break;
      case 0x17:  break;
      case 0x18:  this.mac[0] = (data << 0) >> 0;  break;
      case 0x19:  this.mac[1] = (data << 0) >> 0;  break;
      case 0x1a:  this.mac[2] = (data << 0) >> 0;  break;
      case 0x1b:  this.mac[3] = (data << 0) >> 0;  break;
      case 0x1c:  this.ir[1]  = (data & 0x001f) << 7;
                  this.ir[2]  = (data & 0x03e0) << 2;
                  this.ir[3]  = (data & 0x7c00) >> 3;
                  break;
      case 0x1d:  break; // readonly
      case 0x1e:  this.countLeadingZeros(data); break;
      case 0x1f:  break; // readonly
      case 0x20:  this.rt[0] = (data << 16) >> 16;  this.rt[1] = (data << 0) >> 16; break;
      case 0x21:  this.rt[2] = (data << 16) >> 16;  this.rt[3] = (data << 0) >> 16; break;
      case 0x22:  this.rt[4] = (data << 16) >> 16;  this.rt[5] = (data << 0) >> 16; break;
      case 0x23:  this.rt[6] = (data << 16) >> 16;  this.rt[7] = (data << 0) >> 16; break;
      case 0x24:  this.regs[regId] = this.rt[8] = (data << 16) >> 16;  break;
      case 0x25:  this.tr[0] = (data << 0) >> 0;  break;
      case 0x26:  this.tr[1] = (data << 0) >> 0;  break;
      case 0x27:  this.tr[2] = (data << 0) >> 0;  break;
      case 0x28:  this.ll[0] = (data << 16) >> 16;  this.ll[1] = (data << 0) >> 16; break;
      case 0x29:  this.ll[2] = (data << 16) >> 16;  this.ll[3] = (data << 0) >> 16; break;
      case 0x2a:  this.ll[4] = (data << 16) >> 16;  this.ll[5] = (data << 0) >> 16; break;
      case 0x2b:  this.ll[6] = (data << 16) >> 16;  this.ll[7] = (data << 0) >> 16; break;
      case 0x2c:  this.regs[regId] = this.ll[8] = (data << 16) >> 16;  break;
      case 0x2d:  this.bk[0] = (data << 0) >> 0;  break;
      case 0x2e:  this.bk[1] = (data << 0) >> 0;  break;
      case 0x2f:  this.bk[2] = (data << 0) >> 0;  break;
      case 0x30:  this.lc[0] = (data << 16) >> 16;  this.lc[1] = (data << 0) >> 16; break;
      case 0x31:  this.lc[2] = (data << 16) >> 16;  this.lc[3] = (data << 0) >> 16; break;
      case 0x32:  this.lc[4] = (data << 16) >> 16;  this.lc[5] = (data << 0) >> 16; break;
      case 0x33:  this.lc[6] = (data << 16) >> 16;  this.lc[7] = (data << 0) >> 16; break;
      case 0x34:  this.regs[regId] = this.lc[8] = (data << 16) >> 16;  break;
      case 0x35:  this.fc[0] = (data << 0) >> 0;  break;
      case 0x36:  this.fc[1] = (data << 0) >> 0;  break;
      case 0x37:  this.fc[2] = (data << 0) >> 0;  break;
      // case 0x38:  break;
      // case 0x39:  break;
      // case 0x3a:  break;
      // case 0x3b:  break;
      // case 0x3c:  break;
      case 0x38:  this.regs[regId] = (data << 0) >> 0;      break;
      case 0x39:  this.regs[regId] = (data << 0) >> 0;      break;
      case 0x3a:  this.regs[regId] = (data << 16) >>> 16;   break;
      case 0x3b:  this.regs[regId] = (data << 16) >> 16;    break;
      case 0x3c:  this.regs[regId] = (data << 0) >> 0;      break;
      case 0x3d:  this.regs[regId] = this.zsf3 = (data << 16) >> 16;    break;
      case 0x3e:  this.regs[regId] = this.zsf4 = (data << 16) >> 16;    break;
      case 0x3f:  this.regs[regId] = data & 0x7ffff000;    
                  if (this.regs[regId] & 0x7f87e000) {
                    this.regs[regId] |= 0x80000000;
                  }
                  break;
      default  :  abort('gte.set(r'+hex(regId,2)+', '+hex(data)+') not yet implemented')
    }
  },

  limit: function(bit) {
    const ir  = this.ir;
    const mac = this.mac;
    const lm  = bit ? 0.0 : -32768.0;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    ir[1] = this.lim(mac[1], lm, 24, 32767.0, 24);
    ir[2] = this.lim(mac[2], lm, 23, 32767.0, 23);
    ir[3] = this.lim(mac[3], lm, 22, 32767.0, 22);

    // todo: update irgb/orgb
  },

  depthCue: function() {
    const fc  = this.fc;
    const ir  = this.ir;
    const mac = this.mac;
    const sf  = this.sf ? 4096.0 : 1.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    ir[1] = ((fc[0] * 4096.0) - mac[1]) / sf;
    ir[2] = ((fc[1] * 4096.0) - mac[2]) / sf;
    ir[3] = ((fc[2] * 4096.0) - mac[3]) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    ir[1] = this.lim(ir[1], -32768.0, 24, 32767.0, 24);
    ir[2] = this.lim(ir[2], -32768.0, 23, 32767.0, 23);
    ir[3] = this.lim(ir[3], -32768.0, 22, 32767.0, 22);
    // todo: update irgb/orgb
  },

  interpolate: function() {
    const ir  = this.ir;
    const mac = this.mac;
    const sf  = this.sf ? 4096.0 : 1.0;

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    mac[1] = (mac[1] + (ir[1] * ir[0])) / sf;
    mac[2] = (mac[2] + (ir[2] * ir[0])) / sf;
    mac[3] = (mac[3] + (ir[3] * ir[0])) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.limit(this.lm);
  },

  transform: function(add, mat, vec) {
    const ir  = this.ir;
    const mac = this.mac;
    const sf  = this.sf ? 4096.0 : 1.0;

    // if (add !== this.zr && add.length !== 3) return abort('invalid transform');
    // if (mat.length !== 9) return abort('invalid transform');
    // if (vec.length !== 4) return abort('invalid transform');

    // [MAC1,MAC2,MAC3] = (Tx*1000h + Mx*Vx) SAR (sf*12)
    mac[1] = ((add[0] * 4096.0) + (mat[0] * vec[1]) + (mat[1] * vec[2]) + (mat[2] * vec[3])) / sf;
    mac[2] = ((add[1] * 4096.0) + (mat[3] * vec[1]) + (mat[4] * vec[2]) + (mat[5] * vec[3])) / sf;
    mac[3] = ((add[2] * 4096.0) + (mat[6] * vec[1]) + (mat[7] * vec[2]) + (mat[8] * vec[3])) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.limit(this.lm);
  },

  updateColorFifo: function() {
    const mac = this.mac;
    const rgb = this.rgb;

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    const c = this.rgb[3] >>> 24;
    const r = this.lim((mac[1] / 16.0), 0.0, 21, 255.0, 21);
    const g = this.lim((mac[2] / 16.0), 0.0, 20, 255.0, 20);
    const b = this.lim((mac[3] / 16.0), 0.0, 19, 255.0, 19);

    rgb[0] = rgb[1];
    rgb[1] = rgb[2];
    rgb[2] = (c << 24) | (b << 16) | (g << 8) | (r << 0);
  },

  avsz3: function() {
    const sz  = this.sz;
    const mac = this.mac;
    const zsf3 = this.zsf3;

    // MAC0 = ZSF3*(SZ1+SZ2+SZ3)
    mac[0] = zsf3 * (sz[1] + sz[2] + sz[3]);
    if (mac[0] > (0x7fffffff >> 0)) this.regs[0x3f] |= this.flag[16];
    if (mac[0] < (0x80000000 >> 0)) this.regs[0x3f] |= this.flag[15];
    // OTZ  =  MAC0/1000h
    this.regs[0x07] = gte.lim(mac[0] / 4096.0, 0.0, 18, 65535.0, 18);
  },

  avsz4: function() {
    const sz  = this.sz;
    const mac = this.mac;
    const zsf4 = this.zsf4;

    // MAC0 =  ZSF4*(SZ0+SZ1+SZ2+SZ3)
    mac[0] = zsf4 * (sz[0] + sz[1] + sz[2] + sz[3]);
    if (mac[0] > (0x7fffffff >> 0)) this.regs[0x3f] |= this.flag[16];
    if (mac[0] < (0x80000000 >> 0)) this.regs[0x3f] |= this.flag[15];
    // OTZ  =  MAC0/1000h
    this.regs[0x07] = gte.lim(mac[0] / 4096.0, 0.0, 18, 65535.0, 18);
  },

  cc: function() { // todo: validate
    const zr  = this.zr;
    const ll  = this.ll;
    const bk  = this.bk;
    const lc  = this.lc;
    const ir  = this.ir;
    const mac = this.mac;
    const rgb = this.rgb[3];
    const sf  = this.sf ? 4096.0 : 1.0;

    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.transform(bk, lc, ir);

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb >>  0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb >>  8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb >> 16) & 0xff) * ir[3]) * 16.0;

    // [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
    mac[1] = mac[1] / sf;
    mac[2] = mac[2] / sf;
    mac[3] = mac[3] / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.limit(this.lm);

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  cdp: function() { // todo: validate
    const zr  = this.zr;
    const ll  = this.ll;
    const bk  = this.bk;
    const lc  = this.lc;
    const ir  = this.ir;
    const mac = this.mac;
    const rgb = this.rgb[3];
    const sf  = this.sf ? 4096.0 : 1.0;

    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.transform(bk, lc, ir);

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb >>  0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb >>  8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb >> 16) & 0xff) * ir[3]) * 16.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.interpolate();

    // [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
    mac[1] = mac[1] / sf;
    mac[2] = mac[2] / sf;
    mac[3] = mac[3] / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.limit(this.lm);

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  dcpl: function() {
    const mac = this.mac;
    const ir  = this.ir;
    const rgb = this.rgb[3];

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb >>  0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb >>  8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb >> 16) & 0xff) * ir[3]) * 16.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  dpcs: function(rgb) {
    const mac = this.mac;

    // [MAC1,MAC2,MAC3] = [R,G,B] SHL 16
    mac[1] = ((rgb >>  0) & 0xff) * 65536.0;
    mac[2] = ((rgb >>  8) & 0xff) * 65536.0;
    mac[3] = ((rgb >> 16) & 0xff) * 65536.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  gpf: function() {
    const mac = this.mac;

    // [MAC1,MAC2,MAC3] = [0,0,0]
    mac[1] = 0.0;
    mac[2] = 0.0;
    mac[3] = 0.0;

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  gpl: function() {
    const ir = this.ir;
    const mac = this.mac;
    const sf  = this.sf ? 4096.0 : 1.0;

    // [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SHL (sf*12)
    mac[1] = mac[1] * sf;
    mac[2] = mac[2] * sf;
    mac[3] = mac[3] * sf;

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  intpl: function() {
    const mac = this.mac;
    const ir  = this.ir;

    // [MAC1,MAC2,MAC3] = [IR1,IR2,IR3] SHL 12
    mac[1] = ir[1] * 4096.0;
    mac[2] = ir[2] * 4096.0;
    mac[3] = ir[3] * 4096.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  mvmva: function(commandId) {
    switch ((commandId >> 17) & 0x3) {
      case 0: var mat = this.rt;  break;
      case 1: var mat = this.ll;  break;
      case 2: var mat = this.lc;  break;
      case 3: var mat = this.zr;  break;
    }

    switch ((commandId >> 15) & 0x3) {
      case 0: var vec = this.v0;  break;
      case 1: var vec = this.v1;  break;
      case 2: var vec = this.v2;  break;
      case 3: var vec = this.ir;  break;
    }

    switch ((commandId >> 13) & 0x3) {
      case 0: var add = this.tr;  break;
      case 1: var add = this.bk;  break;
      case 2: var add = this.fc;  abort('faulty'); break;
      case 3: var add = this.zr;  break;
    }

    this.transform(add, mat, vec);
  },

  nccs: function(vec) {
    const zr  = this.zr;
    const ll  = this.ll;
    const bk  = this.bk;
    const lc  = this.lc;
    const ir  = this.ir;
    const mac = this.mac;
    const rgb = this.rgb[3];
    const sf  = this.sf ? 4096.0 : 1.0;

    // [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.transform(zr, ll, vec);

    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.transform(bk, lc, ir);

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb >>  0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb >>  8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb >> 16) & 0xff) * ir[3]) * 16.0;

    // [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
    mac[1] = mac[1] / sf;
    mac[2] = mac[2] / sf;
    mac[3] = mac[3] / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.limit(this.lm);

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  ncds: function(vec) {
    const zr  = this.zr;
    const ll  = this.ll;
    const bk  = this.bk;
    const lc  = this.lc;
    const ir  = this.ir;
    const mac = this.mac;
    const rgb = this.rgb[3];

    // [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.transform(zr, ll, vec);

    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.transform(bk, lc, ir);

    // [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
    mac[1] = (((rgb >>  0) & 0xff) * ir[1]) * 16.0;
    mac[2] = (((rgb >>  8) & 0xff) * ir[2]) * 16.0;
    mac[3] = (((rgb >> 16) & 0xff) * ir[3]) * 16.0;

    // [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.depthCue();

    // [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.interpolate();

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  nclip: function() {
    const mac = this.mac;
    const sx  = this.sx;
    const sy  = this.sy;

    // MAC0 = SX0*SY1 + SX1*SY2 + SX2*SY0 - SX0*SY2 - SX1*SY0 - SX2*SY1
    mac[0] = sx[0] * (sy[1] - sy[2]) + sx[1] * (sy[2] - sy[0]) + sx[2] * (sy[0] - sy[1]);
    if (mac[0] > (0x7fffffff >> 0)) this.regs[0x3f] |= this.flag[16];
    if (mac[0] < (0x80000000 >> 0)) this.regs[0x3f] |= this.flag[15];
  },

  ncs: function(vec) {
    const zr  = this.zr;
    const ll  = this.ll;
    const bk  = this.bk;
    const lc  = this.lc;
    const ir  = this.ir;
    
    // [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.transform(zr, ll, vec);

    // [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.transform(bk, lc, ir);

    // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
    this.updateColorFifo();
  },

  op: function() {
    const mac = this.mac;
    const ir  = this.ir;
    const rt  = this.rt;
    const sf  = this.sf ? 4096.0 : 1.0;

    // [MAC1,MAC2,MAC3] = [IR3*D2-IR2*D3, IR1*D3-IR3*D1, IR2*D1-IR1*D2] SAR (sf*12)
    mac[1] = ((ir[3] * rt[4]) - (ir[2] * rt[8])) / sf;
    mac[2] = ((ir[1] * rt[8]) - (ir[3] * rt[0])) / sf;
    mac[3] = ((ir[2] * rt[0]) - (ir[1] * rt[4])) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.limit(this.lm);
  },

  rtps: function(vec) {
    // if (!this.sf) abort('not supported');

    const tr  = this.tr;
    const rt  = this.rt;
    const mac = this.mac;
    const ir  = this.ir;
    const h   = this.regs[0x3a] & 0xffff;
    const ofx = this.regs[0x38];
    const ofy = this.regs[0x39];
    const dqa = this.regs[0x3b];
    const dqb = this.regs[0x3c];
    const sx  = this.sx;
    const sy  = this.sy;
    const sz  = this.sz;
    const sf  = this.sf ? 4096.0 : 1.0;

    // [MAC1,MAC2,MAC3] = (TR*1000h + RT*Vx) SAR (sf*12)
    mac[1] = ((tr[0] * 4096.0) + (rt[0] * vec[1]) + (rt[1] * vec[2]) + (rt[2] * vec[3])) / sf;
    if (mac[1] > 8796093022207) this.regs[0x3f] |= this.flag[30];
    if (mac[1] < -8796093022208) this.regs[0x3f] |= this.flag[27];
    mac[2] = ((tr[1] * 4096.0) + (rt[3] * vec[1]) + (rt[4] * vec[2]) + (rt[5] * vec[3])) / sf;
    if (mac[2] > 8796093022207) this.regs[0x3f] |= this.flag[29];
    if (mac[2] < -8796093022208) this.regs[0x3f] |= this.flag[26];
    mac[3] = ((tr[2] * 4096.0) + (rt[6] * vec[1]) + (rt[7] * vec[2]) + (rt[8] * vec[3])) / sf;
    if (mac[3] > 8796093022207) this.regs[0x3f] |= this.flag[28];
    if (mac[3] < -8796093022208) this.regs[0x3f] |= this.flag[25];

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.limit(this.lm);

    sx[0] = sx[1];
    sx[1] = sx[2];

    sy[0] = sy[1];
    sy[1] = sy[2];

    sz[0] = sz[1];
    sz[1] = sz[2];
    sz[2] = sz[3];
    let zs3 = mac[3] / (this.sf ? 1.0 : 4096.0);
    sz[3] = this.lim(zs3, 0.0, 18, 65535.0, 18);

    let hsz3 = 131072.0;
    hsz3 = ((h * 131072.0 / sz[3]) + 1.0) / 2.0;
    if (hsz3 > 131071.0) {
      this.regs[0x3f] |= this.flag[17];
      hsz3 = 131071.0;
    }
    mac[0] = (hsz3 * ir[1]) + ofx; sx[2] = mac[0] / 65536.0;
    if (mac[0] > (0x7fffffff >> 0)) this.regs[0x3f] |= this.flag[16];
    if (mac[0] < (0x80000000 >> 0)) this.regs[0x3f] |= this.flag[15];
    mac[0] = (hsz3 * ir[2]) + ofy; sy[2] = mac[0] / 65536.0;
    if (mac[0] > (0x7fffffff >> 0)) this.regs[0x3f] |= this.flag[16];
    if (mac[0] < (0x80000000 >> 0)) this.regs[0x3f] |= this.flag[15];
    mac[0] = (hsz3 * dqa) + dqb;   ir[0] = mac[0] / 4096.0;
    if (mac[0] > (0x7fffffff >> 0)) this.regs[0x3f] |= this.flag[16];
    if (mac[0] < (0x80000000 >> 0)) this.regs[0x3f] |= this.flag[15];

    sx[2] = this.lim(sx[2], -1024.0, 14, 1023.0, 14);
    sy[2] = this.lim(sy[2], -1024.0, 13, 1023.0, 13);
    ir[0] = this.lim(ir[0], 0.0, 12, 4096.0, 12);

    let cx = (sx[2] >>> 0) & 0xfff;
    let cy = (sy[2] >>> 0) & 0xfff;
    let ci = (cy << 12) | cx;

    if (settings.naiveResolutionImprovement) {
      let map = gte.coords.get(ci);
      if (map) {
        map.x = sx[2];
        map.y = sy[2];
        map.z = sz[3];
        map.frame = gpu.internalFrame;
      }
      else {
        gte.coords.set(ci, Object.seal({x:sx[2], y:sy[2], z:sz[3], id: ci, frame: gpu.internalFrame}));
      }
    }
  },

  sqr: function() {
    const mac = this.mac;
    const ir  = this.ir;
    const sf  = this.sf ? 4096.0 : 1.0;

    //[MAC1,MAC2,MAC3] = [IR1*IR1,IR2*IR2,IR3*IR3] SHR (sf*12)
    mac[1] = (ir[1] * ir[1]) / sf;
    mac[2] = (ir[2] * ir[2]) / sf;
    mac[3] = (ir[3] * ir[3]) / sf;

    // [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
    this.limit(this.lm);
  },

  command: function(commandId) {
    this.sf = (commandId >> 19) & 0x1;
    this.lm = (commandId >> 10) & 0x1;

    this.regs[0x3f] = 0;

    switch (commandId & 0x3f) {
      case 0x01:  this.rtps(this.v0);     break;
      case 0x06:  this.nclip();           break;
      case 0x0c:  this.op();              break;
      case 0x10:  this.dpcs(this.rgb[3]); break;
      case 0x11:  this.intpl();           break;
      case 0x12:  this.mvmva(commandId);  break;
      case 0x13:  this.ncds(this.v0);     break;
      case 0x14:  this.cdp();             break;
      case 0x16:  this.ncds(this.v0);     this.ncds(this.v1);     this.ncds(this.v2);     break;
      case 0x1b:  this.nccs(this.v0);     break;
      case 0x1c:  this.cc();              break;
      case 0x1e:  this.ncs(this.v0);      break;
      case 0x20:  this.ncs(this.v0);      this.ncs(this.v1);      this.ncs(this.v2);      break;
      case 0x28:  this.sqr();             break;
      case 0x29:  this.dcpl();            break;
      case 0x2a:  this.dpcs(this.rgb[0]); this.dpcs(this.rgb[0]); this.dpcs(this.rgb[0]); break;
      case 0x2d:  this.avsz3();           break;
      case 0x2e:  this.avsz4();           break;
      case 0x30:  this.rtps(this.v0);     this.rtps(this.v1);     this.rtps(this.v2);     break;
      case 0x3d:  this.gpf();             break;
      case 0x3e:  this.gpl();             break;
      case 0x3f:  this.nccs(this.v0);     this.nccs(this.v1);     this.nccs(this.v2);     break;
      default  :  //abort('gte.$'+hex(commandId,5)+' not yet implemented')
    }
  },

  cycles: function(commandId) { //return 0;
    switch (commandId & 0x3f) {
      case 0x01:  return 15;
      case 0x06:  return 8;
      case 0x0C:  return 6;
      case 0x10:  return 8;
      case 0x11:  return 8;
      case 0x12:  return 8;
      case 0x13:  return 19;
      case 0x14:  return 13;
      case 0x16:  return 44;
      case 0x1b:  return 17;
      case 0x1c:  return 11;
      case 0x1e:  return 14;
      case 0x20:  return 30;
      case 0x28:  return 5;
      case 0x29:  return 8;
      case 0x2a:  return 17;
      case 0x2d:  return 5;
      case 0x2e:  return 6;
      case 0x30:  return 23;
      case 0x3d:  return 5;
      case 0x3e:  return 5;
      case 0x3f:  return 39;
      default  :  //abort('gte.$'+hex(commandId,5)+' has no cycles')
                  return 5;
    }
  }
}

// flag bits
for (var i = 0; i <= 31; ++i) {
  gte.flag[i] = (1 << i);
}

for (var i = 23; i <= 30; ++i) {
  gte.flag[i] |= 0x80000000;
}

for (var i = 13; i <= 18; ++i) {
  gte.flag[i] |= 0x80000000;
}

gte.coords = new Map();
gte.frame = 0;

gte.clear = (frame) => {
  gte.coords.forEach((v, k, m) => {
    if (v && v.frame <= frame) {
      // object pool for v? 
      m.delete(k);
    }
  });
}
Object.seal(gte);