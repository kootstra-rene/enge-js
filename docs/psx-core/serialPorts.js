(scope => {

	'use strict';

	log = () => { }

	var joy = {
		baud: 0x0088,
		data: 0,

		r1044: 0, // JOY_STAT
		r104a: 0, // JOY_CTRL

		command: 0,
		devices: [
			{
				id: 0, lo: 0xff, hi: 0xff, data: new Uint8Array(128 * 1024), addr: 0, checkSum: 0,
				mode: 0x00,
				response: [],
				received: [],
				initMemCard: function () {
					this.mode = 0x00;
					this.response = [];
					this.received = [];
				},
				initController: function () {
					this.mode = 0x00;
					this.response = [];
					this.received = [];
				},
				buildMemCardResponse: function (byte) {
					this.mode = byte;
					switch (byte) {
						case 0x52: this.response.push(0x00, 0x5a, 0x5d, 0x00, -1, 0x5c, -1, -1, -1);
							for (let i = 0; i < 128; ++i) {
								this.response.push(-1);
							}
							this.response.push(-1);
							this.response.push(0x47);
							break;
						case 0x57: this.response.push(0x00, 0x5a, 0x5d, -1, -1);
							for (let i = 0; i < 128; ++i) {
								this.response.push(-1);
							}
							this.response.push(-1);
							this.response.push(0x5c);
							this.response.push(0x5d);
							this.response.push(0x47);
							break;
						default: this.response.push(0xff);
							break;
					}
				},
				buildControllerResponse: function (byte) {
					this.mode = byte;
					switch (byte) {
						case 0x42: this.response.push(0x41, 0x5a, this.lo, this.hi/*, 0x00, 0x00, 0x00, 0x00*/);
							break;
						case 0x43:  // todo: Exit/Enter configuration
							this.response.push(0xff);
							break;
						default: return abort(`unknown subCommand: $${hex(byte, 2)}`);
							break;
					}
				},
				sendReceiveByte: function (byte) {
					if (this.response.length <= 0) console.log(`#${this.id}: reading unexpected in mode $${hex(this.mode, 2)}`);
					let data = this.response.shift() || 0;

					if (this.mode === 0x52) {
						if (data === -1) {
							let dataIndex = this.received.length;
							switch (true) {
								case (dataIndex === 4):
									data = this.received[3];
									break;
								case (dataIndex === 6):
									data = 0x5d;
									break;
								case (dataIndex === 7):
									data = this.received[3];
									this.checkSum = data;
									break;
								case (dataIndex === 8):
									this.addr = (this.received[3] << 8) | this.received[4];
									data = this.received[4];
									this.checkSum ^= data;
									break;

								case (dataIndex >= 9 && dataIndex < 137):
									let offset = (this.addr * 128) + dataIndex - 9;
									data = this.data[offset];
									this.checkSum ^= data;
									break;

									break;
								case (dataIndex === 137):
									data = this.checkSum & 0xff;
									break;

								default:
									debugger;
							}
						}
					}
					if (this.mode === 0x57) {
						if (data === -1) {
							let dataIndex = this.received.length;
							switch (true) {
								case (dataIndex === 3):
									data = this.received[3];
									this.checkSum = data;
									break;
								case (dataIndex === 4):
									data = this.received[3];
									this.checkSum ^= data;
									this.addr = (data << 8) | byte;
									break;
								case (dataIndex >= 5 && dataIndex < 133):
									let offset = (this.addr * 128) + dataIndex - 5;
									data = this.data[offset - 1];
									this.data[offset] = byte;
									this.checkSum ^= byte;
									break;
								case (dataIndex === 133):
									// todo: check checksum
									data = this.data[132];
									const base64text = Base64.encode(this.data);
									localStorage.setItem('card1', base64text);
									break;
								default: debugger;
							}
						}
					}

					this.received.push(byte);
					return data & 0xff;
				},
				hasMore: function () {
					return this.response.length > 0;
				}
			},
			{
				id: 1, lo: 0xff, hi: 0xff, data: new Uint8Array(128 * 1024), addr: 0, checkSum: 0,
				mode: 0x00,
				response: [],
				received: [],
				initMemCard: function () {
					this.mode = 0x00;
					this.response = [];
					this.received = [];
				},
				initController: function () {
					this.mode = 0x00;
					this.response = [];
					this.received = [];
				},
				buildMemCardResponse: function (byte) {
					this.mode = byte;
					switch (byte) {
						case 0x52: this.response.push(0x00, 0x5a, 0x5d, 0x00, -1, 0x5c, -1, -1, -1);
							for (let i = 0; i < 128; ++i) {
								this.response.push(-1);
							}
							this.response.push(-1);
							this.response.push(0x47);
							break;
						case 0x57: this.response.push(0x00, 0x5a, 0x5d, -1, -1);
							for (let i = 0; i < 128; ++i) {
								this.response.push(-1);
							}
							this.response.push(-1);
							this.response.push(0x5c);
							this.response.push(0x5d);
							this.response.push(0x47);
							break;
						default: this.response.push(0xff);
							break;
					}
				},
				buildControllerResponse: function (byte) {
					this.mode = byte;
					switch (byte) {
						case 0x42: this.response.push(0x41, 0x5a, this.lo, this.hi/*, 0x00, 0x00, 0x00, 0x00*/);
							break;
						case 0x43:  // todo: Exit/Enter configuration
							this.response.push(0xff);
							break;
						default: return abort(`unknown subCommand: $${hex(byte, 2)}`);
							break;
					}
				},
				sendReceiveByte: function (byte) {
					if (this.response.length <= 0) console.log(`#${this.id}: reading unexpected in mode $${hex(this.mode, 2)}`);
					let data = this.response.shift() || 0;

					if (this.mode === 0x52) {
						if (data === -1) {
							let dataIndex = this.received.length;
							switch (true) {
								case (dataIndex === 4):
									data = this.received[3];
									break;
								case (dataIndex === 6):
									data = 0x5d;
									break;
								case (dataIndex === 7):
									data = this.received[3];
									this.checkSum = data;
									break;
								case (dataIndex === 8):
									this.addr = (this.received[3] << 8) | this.received[4];
									data = this.received[4];
									this.checkSum ^= data;
									break;

								case (dataIndex >= 9 && dataIndex < 137):
									let offset = (this.addr * 128) + dataIndex - 9;
									data = this.data[offset];
									this.checkSum ^= data;
									break;

									break;
								case (dataIndex === 137):
									data = this.checkSum & 0xff;
									break;

								default:
									debugger;
							}
						}
					}
					if (this.mode === 0x57) {
						if (data === -1) {
							let dataIndex = this.received.length;
							switch (true) {
								case (dataIndex === 3):
									data = this.received[3];
									this.checkSum = data;
									break;
								case (dataIndex === 4):
									data = this.received[3];
									this.checkSum ^= data;
									this.addr = (data << 8) | byte;
									break;
								case (dataIndex >= 5 && dataIndex < 133):
									let offset = (this.addr * 128) + dataIndex - 5;
									data = this.data[offset - 1];
									this.data[offset] = byte;
									this.checkSum ^= byte;
									break;
								case (dataIndex === 133):
									// todo: check checksum
									data = this.data[132];
									const base64text = Base64.encode(this.data);
									localStorage.setItem('card2', base64text);
									break;
								default: debugger;
							}
						}
					}

					this.received.push(byte);
					return data & 0xff;
				},
				hasMore: function () {
					return this.response.length > 0;
				}
			}
		],

		rd08r1040: function () {
			if (this.r1044 & 0x0002) {
				this.r1044 &= ~0x0002; // JOY_STAT.RX = 0
			}
			return this.data;
		},

		rd16r1044: function () {
			return this.r1044;
		},

		rd16r104a: function () {
			return this.r104a;
		},

		rd16r104e: function () {
			return this.baud;
		},

		wr08r1040: function (data) {
			let device = null;
			if ((this.r104a & 0x0002) === 0x0000) {
				abort('should not receive byte for device null');
			}
			if ((this.r104a & 0x0002) === 0x0002) {
				device = (this.r104a & 0x2000) ? this.devices[1] : this.devices[0];
			}

			switch (this.command) {
				case 0x00: if (!device) {
					return this.setResult(0xff, true);
				}
					this.setResult(0xff, false);
					this.command = data & 0xff;
					if (this.command === 0x81) device.initMemCard();
					if (this.command === 0x01) device.initController();
					break;

				case 0x01: device.buildControllerResponse(data & 0xff);
					this.command = 0x02;
				case 0x02: {
					let byte = device.sendReceiveByte(data & 0xff);
					let more = device.hasMore();
					this.setResult(byte, !more);
				} break;

				case 0x81: device.buildMemCardResponse(data & 0xff);
					this.command = 0x82;
				case 0x82: {
					let byte = device.sendReceiveByte(data & 0xff);
					let more = device.hasMore();
					this.setResult(byte, !more);
				} break;

				case 0x83: return this.setResult(0xff, true); // no memcard for now

				default: console.warn('unknown command state:', hex(this.command, 4), ' device:', device.id);
					break;
			}
		},

		wr16r1048: function (data) {
			if (data !== 0xd) abort(`invalid JOY_MODE: $${hex(data, 4)}`);
		},

		wr16r104a: function (data) {
			this.r104a = data & ~(0x0010 | 0x0040); //  mask out write-only bits

			if ((data & 0x0040) || !(this.r104a & 0x0002)) {
				//  reset when pad is not selected or reset is requested

				let device = null;
				if ((this.r104a & 0x0002) === 0x0002) {
					device.initController();
					device.initMemCard();
				}

				psx.unsetEvent(this.eventIRQ);
				this.command = 0;
				this.r1044 = 0x0005;
			}

			if ((data & 0x0010)) {
				this.r1044 &= ~(0x0200); // JOY_STAT.IRQ = 0
			}
		},

		wr16r104e: function (data) {
			if (data !== 0x88) abort(`invalid JOY_BAUD: $${hex(data, 4)}`);
			this.baud = data & 0xffff;
		},

		setResult: function (data, last) {
			this.r1044 |= 0x0002; // JOY_STAT.RX = 1
			this.data = data & 0xff;

			if (!last) {
				psx.setEvent(this.eventIRQ, (this.baud * 8) >>> 0);
			}
		},

		eventIRQ: null,

		completeIRQ: function (self, clock) {
			this.r1044 |= 0x0200; // JOY_STAT.IRQ = 1;
			cpu.istat |= 0x0080; // todo: should take care of edge triggering
			psx.unsetEvent(self);
		},
	}

	scope.joy = Object.seal(joy);
	
})(window);