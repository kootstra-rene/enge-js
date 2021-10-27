(scope => {

	'use strict';

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

	const gte = Object.seal({
		sx: new Int32Array(3),
		sy: new Int32Array(3),
		sz: new Int32Array(4),

		zsf3: 0.0,
		zsf4: 0.0,
		lzcr: 0,

		sf: 0,
		lm: 0,

		lim: function (value, lowerBound, lowerBit, upperBound, upperBit) {
			if (value < lowerBound) { regs[0x3f] |= flag[lowerBit]; return lowerBound; }
			if (value > upperBound) { regs[0x3f] |= flag[upperBit]; return upperBound; }
			return value;
		},

		countLeadingZeros: function (value) {
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

		get: function (regId) {
			switch (regId) {
				case 0x00: return regs[regId];
				case 0x01: return (v0[3] << 16) >> 16;
				case 0x02: return regs[regId];
				case 0x03: return (v1[3] << 16) >> 16;
				case 0x04: return regs[regId];
				case 0x05: return (v2[3] << 16) >> 16;
				case 0x06: return regs[regId];
				case 0x07: return (regs[regId] << 16) >>> 16;
				case 0x08: return (ir[0] << 16) >> 16;
				case 0x09: return (ir[1] << 16) >> 16;
				case 0x0a: return (ir[2] << 16) >> 16;
				case 0x0b: return (ir[3] << 16) >> 16;
				case 0x0c: return (this.sx[0] & 0xffff) | (this.sy[0] << 16);
				case 0x0d: return (this.sx[1] & 0xffff) | (this.sy[1] << 16);
				case 0x0e: return (this.sx[2] & 0xffff) | (this.sy[2] << 16);
				case 0x0f: return (this.sx[2] & 0xffff) | (this.sy[2] << 16);
				case 0x10: return (this.sz[0] << 16) >>> 16;
				case 0x11: return (this.sz[1] << 16) >>> 16;
				case 0x12: return (this.sz[2] << 16) >>> 16;
				case 0x13: return (this.sz[3] << 16) >>> 16;
				case 0x14: return rgb[0];
				case 0x15: return rgb[1];
				case 0x16: return rgb[2];
				case 0x17: return regs[regId];
				case 0x18: return mac[0];
				case 0x19: return mac[1];
				case 0x1a: return mac[2];
				case 0x1b: return mac[3];
				case 0x1d: var value = 0;
					value |= ((ir[1] >> 7) << 0);
					value |= ((ir[2] >> 7) << 5);
					value |= ((ir[3] >> 7) << 10);
					return value;
				case 0x1e: return regs[regId];
				case 0x1f: return this.lzcr;
				case 0x20: return regs[regId];
				case 0x21: return regs[regId];
				case 0x22: return regs[regId];
				case 0x23: return regs[regId];
				case 0x24: return regs[regId];
				case 0x25: return regs[regId];
				case 0x26: return regs[regId];
				case 0x27: return regs[regId];
				case 0x28: return regs[regId];
				case 0x29: return regs[regId];
				case 0x2a: return regs[regId];
				case 0x2b: return regs[regId];
				case 0x2c: return regs[regId];
				case 0x2d: return regs[regId];
				case 0x2e: return regs[regId];
				case 0x2f: return regs[regId];
				case 0x30: return regs[regId];
				case 0x31: return regs[regId];
				case 0x32: return regs[regId];
				case 0x33: return regs[regId];
				case 0x34: return regs[regId];
				case 0x35: return regs[regId];
				case 0x36: return regs[regId];
				case 0x37: return regs[regId];
				case 0x38: return regs[regId];
				case 0x39: return regs[regId];
				case 0x3a: return (regs[regId] << 16) >> 16;
				case 0x3b: return regs[regId];
				case 0x3c: return regs[regId];
				case 0x3d: return regs[regId];
				case 0x3e: return regs[regId];
				case 0x3f: return regs[regId];
				default: abort('get gte.r' + hex(regId, 2) + ' not yet implemented')
			}
		},

		set: function (regId, data) {
			regs[regId] = data;

			switch (regId) {
				case 0x00: v0[1] = (data << 16) >> 16; v0[2] = (data << 0) >> 16; break;
				case 0x01: v0[3] = (data << 16) >> 16; break;
				case 0x02: v1[1] = (data << 16) >> 16; v1[2] = (data << 0) >> 16; break;
				case 0x03: v1[3] = (data << 16) >> 16; break;
				case 0x04: v2[1] = (data << 16) >> 16; v2[2] = (data << 0) >> 16; break;
				case 0x05: v2[3] = (data << 16) >> 16; break;
				case 0x06: rgb[3] = data; break;
				case 0x07: break;
				case 0x08: ir[0] = (data << 16) >> 16; break;
				case 0x09: ir[1] = (data << 16) >> 16; break;
				case 0x0a: ir[2] = (data << 16) >> 16; break;
				case 0x0b: ir[3] = (data << 16) >> 16; break;
				case 0x0c: this.sx[0] = (data << 16) >> 16; this.sy[0] = (data << 0) >> 16; break;
				case 0x0d: this.sx[1] = (data << 16) >> 16; this.sy[1] = (data << 0) >> 16; break;
				case 0x0e: this.sx[2] = (data << 16) >> 16; this.sy[2] = (data << 0) >> 16; break;
				case 0x0f: this.sx[0] = this.sx[1]; this.sy[0] = this.sy[1];
					this.sx[1] = this.sx[2]; this.sy[1] = this.sy[2];
					this.sx[2] = (data << 16) >> 16; this.sy[2] = (data << 0) >> 16;
					break;
				case 0x10: this.sz[0] = (data << 16) >>> 16; break;
				case 0x11: this.sz[1] = (data << 16) >>> 16; break;
				case 0x12: this.sz[2] = (data << 16) >>> 16; break;
				case 0x13: this.sz[3] = (data << 16) >>> 16; break;
				case 0x14: rgb[0] = data; break;
				case 0x15: rgb[1] = data; break;
				case 0x16: rgb[2] = data; break;
				case 0x17: break;
				case 0x18: mac[0] = (data << 0) >> 0; break;
				case 0x19: mac[1] = (data << 0) >> 0; break;
				case 0x1a: mac[2] = (data << 0) >> 0; break;
				case 0x1b: mac[3] = (data << 0) >> 0; break;
				case 0x1c: ir[1] = (data & 0x001f) << 7;
					ir[2] = (data & 0x03e0) << 2;
					ir[3] = (data & 0x7c00) >> 3;
					break;
				case 0x1d: break; // readonly
				case 0x1e: this.countLeadingZeros(data); break;
				case 0x1f: break; // readonly
				case 0x20: rt[0] = (data << 16) >> 16; rt[1] = (data << 0) >> 16; break;
				case 0x21: rt[2] = (data << 16) >> 16; rt[3] = (data << 0) >> 16; break;
				case 0x22: rt[4] = (data << 16) >> 16; rt[5] = (data << 0) >> 16; break;
				case 0x23: rt[6] = (data << 16) >> 16; rt[7] = (data << 0) >> 16; break;
				case 0x24: regs[regId] = rt[8] = (data << 16) >> 16; break;
				case 0x25: tr[0] = (data << 0) >> 0; break;
				case 0x26: tr[1] = (data << 0) >> 0; break;
				case 0x27: tr[2] = (data << 0) >> 0; break;
				case 0x28: ll[0] = (data << 16) >> 16; ll[1] = (data << 0) >> 16; break;
				case 0x29: ll[2] = (data << 16) >> 16; ll[3] = (data << 0) >> 16; break;
				case 0x2a: ll[4] = (data << 16) >> 16; ll[5] = (data << 0) >> 16; break;
				case 0x2b: ll[6] = (data << 16) >> 16; ll[7] = (data << 0) >> 16; break;
				case 0x2c: regs[regId] = ll[8] = (data << 16) >> 16; break;
				case 0x2d: bk[0] = (data << 0) >> 0; break;
				case 0x2e: bk[1] = (data << 0) >> 0; break;
				case 0x2f: bk[2] = (data << 0) >> 0; break;
				case 0x30: lc[0] = (data << 16) >> 16; lc[1] = (data << 0) >> 16; break;
				case 0x31: lc[2] = (data << 16) >> 16; lc[3] = (data << 0) >> 16; break;
				case 0x32: lc[4] = (data << 16) >> 16; lc[5] = (data << 0) >> 16; break;
				case 0x33: lc[6] = (data << 16) >> 16; lc[7] = (data << 0) >> 16; break;
				case 0x34: regs[regId] = lc[8] = (data << 16) >> 16; break;
				case 0x35: fc[0] = (data << 0) >> 0; break;
				case 0x36: fc[1] = (data << 0) >> 0; break;
				case 0x37: fc[2] = (data << 0) >> 0; break;
				case 0x38: regs[regId] = (data << 0) >> 0; break;
				case 0x39: regs[regId] = (data << 0) >> 0; break;
				case 0x3a: regs[regId] = (data << 16) >>> 16; break;
				case 0x3b: regs[regId] = (data << 16) >> 16; break;
				case 0x3c: regs[regId] = (data << 0) >> 0; break;
				case 0x3d: regs[regId] = this.zsf3 = (data << 16) >> 16; break;
				case 0x3e: regs[regId] = this.zsf4 = (data << 16) >> 16; break;
				case 0x3f: regs[regId] = data & 0x7ffff000;
					if (regs[regId] & 0x7f87e000) {
						regs[regId] |= 0x80000000;
					}
					break;
				default: abort('gte.set(r' + hex(regId, 2) + ', ' + hex(data) + ') not yet implemented')
			}
		},

		limit: function (bit) {
			const lm = bit ? 0.0 : -32768.0;

			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			ir[1] = this.lim(mac[1], lm, 24, 32767.0, 24);
			ir[2] = this.lim(mac[2], lm, 23, 32767.0, 23);
			ir[3] = this.lim(mac[3], lm, 22, 32767.0, 22);

			// todo: update irgb/orgb
		},

		depthCue: function () {
			const sf = this.sf ? 4096.0 : 1.0;

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

		interpolate: function () {
			const sf = this.sf ? 4096.0 : 1.0;

			// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
			mac[1] = (mac[1] + (ir[1] * ir[0])) / sf;
			mac[2] = (mac[2] + (ir[2] * ir[0])) / sf;
			mac[3] = (mac[3] + (ir[3] * ir[0])) / sf;

			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.limit(this.lm);
		},

		transform: function (add, mat, vec) {
			const sf = this.sf ? 4096.0 : 1.0;

			// [MAC1,MAC2,MAC3] = (Tx*1000h + Mx*Vx) SAR (sf*12)
			mac[1] = ((add[0] * 4096.0) + (mat[0] * vec[1]) + (mat[1] * vec[2]) + (mat[2] * vec[3])) / sf;
			mac[2] = ((add[1] * 4096.0) + (mat[3] * vec[1]) + (mat[4] * vec[2]) + (mat[5] * vec[3])) / sf;
			mac[3] = ((add[2] * 4096.0) + (mat[6] * vec[1]) + (mat[7] * vec[2]) + (mat[8] * vec[3])) / sf;

			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.limit(this.lm);
		},

		updateColorFifo: function () {
			// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
			const c = rgb[3] >>> 24;
			const r = this.lim((mac[1] / 16.0), 0.0, 21, 255.0, 21);
			const g = this.lim((mac[2] / 16.0), 0.0, 20, 255.0, 20);
			const b = this.lim((mac[3] / 16.0), 0.0, 19, 255.0, 19);

			rgb[0] = rgb[1];
			rgb[1] = rgb[2];
			rgb[2] = (c << 24) | (b << 16) | (g << 8) | (r << 0);
		},

		avsz3: function () {
			const sz = this.sz;
			const zsf3 = this.zsf3;

			// MAC0 = ZSF3*(SZ1+SZ2+SZ3)
			mac[0] = zsf3 * (sz[1] + sz[2] + sz[3]);
			if (mac[0] > (0x7fffffff >> 0)) regs[0x3f] |= flag[16];
			if (mac[0] < (0x80000000 >> 0)) regs[0x3f] |= flag[15];
			// OTZ  =  MAC0/1000h
			regs[0x07] = gte.lim(mac[0] / 4096.0, 0.0, 18, 65535.0, 18);
		},

		avsz4: function () {
			const sz = this.sz;
			const zsf4 = this.zsf4;

			// MAC0 =  ZSF4*(SZ0+SZ1+SZ2+SZ3)
			mac[0] = zsf4 * (sz[0] + sz[1] + sz[2] + sz[3]);
			if (mac[0] > (0x7fffffff >> 0)) regs[0x3f] |= flag[16];
			if (mac[0] < (0x80000000 >> 0)) regs[0x3f] |= flag[15];
			// OTZ  =  MAC0/1000h
			regs[0x07] = gte.lim(mac[0] / 4096.0, 0.0, 18, 65535.0, 18);
		},

		cc: function () { // todo: validate
			const sf = this.sf ? 4096.0 : 1.0;

			// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.transform(bk, lc, ir);

			// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
			mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
			mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
			mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

			// [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
			mac[1] = mac[1] / sf;
			mac[2] = mac[2] / sf;
			mac[3] = mac[3] / sf;

			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.limit(this.lm);

			// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
			this.updateColorFifo();
		},

		cdp: function () { // todo: validate
			const sf = this.sf ? 4096.0 : 1.0;

			// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.transform(bk, lc, ir);

			// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
			mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
			mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
			mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

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

		dcpl: function () {
			// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
			mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
			mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
			mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

			// [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.depthCue();

			// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.interpolate();

			// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
			this.updateColorFifo();
		},

		dpcs: function (rgb) {
			// [MAC1,MAC2,MAC3] = [R,G,B] SHL 16
			mac[1] = ((rgb >> 0) & 0xff) * 65536.0;
			mac[2] = ((rgb >> 8) & 0xff) * 65536.0;
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

		gpf: function () {
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

		gpl: function () {
			const sf = this.sf ? 4096.0 : 1.0;

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

		intpl: function () {
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

		mvmva: function (commandId) {
			switch ((commandId >> 17) & 0x3) {
				case 0: var mat = rt; break;
				case 1: var mat = ll; break;
				case 2: var mat = lc; break;
				case 3: var mat = zr; break;
			}

			switch ((commandId >> 15) & 0x3) {
				case 0: var vec = v0; break;
				case 1: var vec = v1; break;
				case 2: var vec = v2; break;
				case 3: var vec = ir; break;
			}

			switch ((commandId >> 13) & 0x3) {
				case 0: var add = tr; break;
				case 1: var add = bk; break;
				case 2: var add = fc; abort('faulty'); break;
				case 3: var add = zr; break;
			}

			this.transform(add, mat, vec);
		},

		nccs: function (vec) {
			const sf = this.sf ? 4096.0 : 1.0;

			// [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.transform(zr, ll, vec);

			// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.transform(bk, lc, ir);

			// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
			mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
			mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
			mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

			// [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
			mac[1] = mac[1] / sf;
			mac[2] = mac[2] / sf;
			mac[3] = mac[3] / sf;

			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.limit(this.lm);

			// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
			this.updateColorFifo();
		},

		ncds: function (vec) {
			// [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.transform(zr, ll, vec);

			// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.transform(bk, lc, ir);

			// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
			mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
			mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
			mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;

			// [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.depthCue();

			// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.interpolate();

			// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
			this.updateColorFifo();
		},

		nclip: function () {
			const sx = this.sx;
			const sy = this.sy;

			// MAC0 = SX0*SY1 + SX1*SY2 + SX2*SY0 - SX0*SY2 - SX1*SY0 - SX2*SY1
			mac[0] = sx[0] * (sy[1] - sy[2]) + sx[1] * (sy[2] - sy[0]) + sx[2] * (sy[0] - sy[1]);
			if (mac[0] > (0x7fffffff >> 0)) regs[0x3f] |= flag[16];
			if (mac[0] < (0x80000000 >> 0)) regs[0x3f] |= flag[15];
		},

		ncs: function (vec) {
			// [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.transform(zr, ll, vec);

			// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.transform(bk, lc, ir);

			// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
			this.updateColorFifo();
		},

		op: function () {
			const sf = this.sf ? 4096.0 : 1.0;

			// [MAC1,MAC2,MAC3] = [IR3*D2-IR2*D3, IR1*D3-IR3*D1, IR2*D1-IR1*D2] SAR (sf*12)
			mac[1] = ((ir[3] * rt[4]) - (ir[2] * rt[8])) / sf;
			mac[2] = ((ir[1] * rt[8]) - (ir[3] * rt[0])) / sf;
			mac[3] = ((ir[2] * rt[0]) - (ir[1] * rt[4])) / sf;

			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.limit(this.lm);
		},

		rtps: function (vec) {
			// if (!this.sf) abort('not supported');

			const h = regs[0x3a] & 0xffff;
			const ofx = regs[0x38];
			const ofy = regs[0x39];
			const dqa = regs[0x3b];
			const dqb = regs[0x3c];
			const sx = this.sx;
			const sy = this.sy;
			const sz = this.sz;
			const sf = this.sf ? 4096.0 : 1.0;

			// [MAC1,MAC2,MAC3] = (TR*1000h + RT*Vx) SAR (sf*12)
			mac[1] = ((tr[0] * 4096.0) + (rt[0] * vec[1]) + (rt[1] * vec[2]) + (rt[2] * vec[3])) / sf;
			if (mac[1] > 8796093022207) regs[0x3f] |= flag[30];
			if (mac[1] < -8796093022208) regs[0x3f] |= flag[27];
			mac[2] = ((tr[1] * 4096.0) + (rt[3] * vec[1]) + (rt[4] * vec[2]) + (rt[5] * vec[3])) / sf;
			if (mac[2] > 8796093022207) regs[0x3f] |= flag[29];
			if (mac[2] < -8796093022208) regs[0x3f] |= flag[26];
			mac[3] = ((tr[2] * 4096.0) + (rt[6] * vec[1]) + (rt[7] * vec[2]) + (rt[8] * vec[3])) / sf;
			if (mac[3] > 8796093022207) regs[0x3f] |= flag[28];
			if (mac[3] < -8796093022208) regs[0x3f] |= flag[25];

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
				regs[0x3f] |= flag[17];
				hsz3 = 131071.0;
			}
			mac[0] = (hsz3 * ir[1]) + ofx; sx[2] = mac[0] / 65536.0;
			if (mac[0] > (0x7fffffff >> 0)) regs[0x3f] |= flag[16];
			if (mac[0] < (0x80000000 >> 0)) regs[0x3f] |= flag[15];
			mac[0] = (hsz3 * ir[2]) + ofy; sy[2] = mac[0] / 65536.0;
			if (mac[0] > (0x7fffffff >> 0)) regs[0x3f] |= flag[16];
			if (mac[0] < (0x80000000 >> 0)) regs[0x3f] |= flag[15];
			mac[0] = (hsz3 * dqa) + dqb; ir[0] = mac[0] / 4096.0;
			if (mac[0] > (0x7fffffff >> 0)) regs[0x3f] |= flag[16];
			if (mac[0] < (0x80000000 >> 0)) regs[0x3f] |= flag[15];

			sx[2] = this.lim(sx[2], -1024.0, 14, 1023.0, 14);
			sy[2] = this.lim(sy[2], -1024.0, 13, 1023.0, 13);
			ir[0] = this.lim(ir[0], 0.0, 12, 4096.0, 12);
		},

		sqr: function () {
			const sf = this.sf ? 4096.0 : 1.0;

			//[MAC1,MAC2,MAC3] = [IR1*IR1,IR2*IR2,IR3*IR3] SHR (sf*12)
			mac[1] = (ir[1] * ir[1]) / sf;
			mac[2] = (ir[2] * ir[2]) / sf;
			mac[3] = (ir[3] * ir[3]) / sf;

			// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
			this.limit(this.lm);
		},

		command: function (commandId) {
			this.sf = (commandId >> 19) & 0x1;
			this.lm = (commandId >> 10) & 0x1;

			regs[0x3f] = 0;

			switch (commandId & 0x3f) {
				case 0x01: this.rtps(v0); break;
				case 0x06: this.nclip(); break;
				case 0x0c: this.op(); break;
				case 0x10: this.dpcs(rgb[3]); break;
				case 0x11: this.intpl(); break;
				case 0x12: this.mvmva(commandId); break;
				case 0x13: this.ncds(v0); break;
				case 0x14: this.cdp(); break;
				case 0x16: this.ncds(v0); this.ncds(v1); this.ncds(v2); break;
				case 0x1b: this.nccs(v0); break;
				case 0x1c: this.cc(); break;
				case 0x1e: this.ncs(v0); break;
				case 0x20: this.ncs(v0); this.ncs(v1); this.ncs(v2); break;
				case 0x28: this.sqr(); break;
				case 0x29: this.dcpl(); break;
				case 0x2a: this.dpcs(rgb[0]); this.dpcs(rgb[0]); this.dpcs(rgb[0]); break;
				case 0x2d: this.avsz3(); break;
				case 0x2e: this.avsz4(); break;
				case 0x30: this.rtps(v0); this.rtps(v1); this.rtps(v2); break;
				case 0x3d: this.gpf(); break;
				case 0x3e: this.gpl(); break;
				case 0x3f: this.nccs(v0); this.nccs(v1); this.nccs(v2); break;
				default: abort('gte.$' + hex(commandId, 5) + ' not yet implemented')
			}
		},

		cycles: function (commandId) {
			switch (commandId & 0x3f) {
				case 0x01: return 15;
				case 0x06: return 8;
				case 0x0C: return 6;
				case 0x10: return 8;
				case 0x11: return 8;
				case 0x12: return 8;
				case 0x13: return 19;
				case 0x14: return 13;
				case 0x16: return 44;
				case 0x1b: return 17;
				case 0x1c: return 11;
				case 0x1e: return 14;
				case 0x20: return 30;
				case 0x28: return 5;
				case 0x29: return 8;
				case 0x2a: return 17;
				case 0x2d: return 5;
				case 0x2e: return 6;
				case 0x30: return 23;
				case 0x3d: return 5;
				case 0x3e: return 5;
				case 0x3f: return 39;
				default: abort('gte.$' + hex(commandId, 5) + ' has no cycles')
					return 5;
			}
		}
	});

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

	scope.gte = Object.seal(gte);

})(window);
