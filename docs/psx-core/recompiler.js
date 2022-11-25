(scope => {

	'use strict';

	function createFunction(pc, code, jumps) {
		const lines = [
			"  return function $" + hex(pc).toUpperCase() + "(psx) { ++calls;\n    " + code.replace(/[\r\n]/g, '\n    ') + "\n  }"
		];
		lines.unshift('');

		const points = [...new Set(jumps || [])];
		points.forEach(addr => {
			lines.unshift(`  const _${hex(addr)} = getCacheEntry(0x${hex(addr)});`);
		});
		lines.unshift(`'use strict;'`);
		var generator = new Function(lines.join('\n'));
		return generator();
	}

	const rec = {
		'compile02': function (rec, opc) {
			rec.stop = true;
			rec.jump = true;
			rec.skipNext = true;
			rec.branchTarget = (opc & 0x007FFFFF) << 2;
			const mips = 'j       $' + hex(rec.branchTarget);
			const code = rec.setReg(mips, 0, `target = _${hex(rec.branchTarget)}`);
			return code;
		},

		'compile03': function (rec, opc) {
			rec.stop = true;
			rec.jump = true;
			rec.branchTarget = (opc & 0x007FFFFF) << 2;
			const mips = 'jal     $' + hex(rec.branchTarget);
			const code = rec.setReg(mips, 0, `target = _${hex(rec.branchTarget)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
			ConstantFolding.resetConst(31);
			return code;
		},

		'compile04': function (rec, opc) {
			rec.stop = true;
			rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
			const mips = 'beq     r' + rec.rs + ', r' + rec.rt + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, 0, `target = (${rec.getRS()} === ${rec.getRT()}) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
			return code;
		},

		'compile05': function (rec, opc) {
			rec.stop = true;
			rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
			const mips = 'bne     r' + rec.rs + ', r' + rec.rt + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, 0, `target = (${rec.getRS()} !== ${rec.getRT()}) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
			return code;
		},

		'compile06': function (rec, opc) {
			rec.stop = true;
			rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
			const mips = 'blez    r' + rec.rs + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, 0, `target = (${rec.getRS()} <= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
			return code;
		},

		'compile07': function (rec, opc) {
			rec.stop = true;
			rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
			const mips = 'bgtz    r' + rec.rs + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, 0, `target = (${rec.getRS()} > 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
			return code;
		},

		'compile08': function (rec, opc) {
			const mips = 'addi    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
			if (ConstantFolding.isConst(rec.rs)) {
				const immediate = (opc << 16) >> 16;
				const value = ConstantFolding.getConst(rec.rs) + immediate;
				const code = rec.setReg(mips, rec.rt, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rt, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rt, ((opc << 16) >> 16) + ' + ' + rec.getRS());
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile09': function (rec, opc) {
			const mips = 'addiu   r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
			if (ConstantFolding.isConst(rec.rs)) {
				const immediate = (opc << 16) >> 16;
				const value = ConstantFolding.getConst(rec.rs) + immediate;
				const code = rec.setReg(mips, rec.rt, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rt, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rt, ((opc << 16) >> 16) + ' + ' + rec.getRS());
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile0A': function (rec, opc) {
			const mips = 'slti    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, rec.rt, '(' + rec.getRS() + ' < ' + ((opc << 16) >> 16) + ') ? 1 : 0');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile0B': function (rec, opc) {
			const mips = 'sltiu   r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, rec.rt, '((' + rec.getRS() + ' >>> 0) < (' + ((opc << 16) >> 16) + ' >>> 0)) ? 1 : 0');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile0C': function (rec, opc) {
			const mips = 'andi    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
			if (ConstantFolding.isConst(rec.rs)) {
				const immediate = ((opc << 16) >>> 16);
				const value = ConstantFolding.getConst(rec.rs) & immediate;
				const code = rec.setReg(mips, rec.rt, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rt, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rt, rec.getRS() + ' & 0x' + hex(opc, 4));
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile0D': function (rec, opc) {
			const mips = 'ori     r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
			if (ConstantFolding.isConst(rec.rs)) {
				const immediate = ((opc << 16) >>> 16);
				const value = ConstantFolding.getConst(rec.rs) | immediate;
				const code = rec.setReg(mips, rec.rt, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rt, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rt, rec.getRS() + ' | 0x' + hex(opc, 4));
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile0E': function (rec, opc) {
			const mips = 'xori    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
			if (ConstantFolding.isConst(rec.rs)) {
				const immediate = ((opc << 16) >>> 16);
				const value = ConstantFolding.getConst(rec.rs) ^ immediate;
				const code = rec.setReg(mips, rec.rt, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rt, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rt, rec.getRS() + ' ^ 0x' + hex(opc, 4));
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile0F': function (rec, opc) {
			const mips = 'lui     r' + rec.rt + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, rec.rt, '0x' + hex((opc & 0xffff) << 16), true);
			ConstantFolding.setConst(rec.rt, (opc & 0xffff) << 16);
			return code;
		},

		'compile20': function (rec, opc) {
			const mips = 'lb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, rec.rt, '(memRead8(' + rec.getOF(opc) + ') << 24) >> 24');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile21': function (rec, opc) {
			const mips = 'lh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, rec.rt, '(memRead16 (' + rec.getOF(opc) + ') << 16) >> 16');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile22': function (rec, opc) {
			const mips = 'lwl     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, 0, 'cpu.lwl(' + rec.rt + ', ' + rec.getOF(opc) + ')');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile23': function (rec, opc) {
			const mips = 'lw      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			if (ConstantFolding.isConst(rec.rs)) {
				const offset = ((opc << 16) >> 16);
				const address = (ConstantFolding.getConst(rec.rs) + offset) & 0x01ffffff;
				if (address <= 0x00800000) {
					rec.cycles += 5;
					const code = rec.setReg(mips, rec.rt, `ram.getInt32(0x${hex(address & 0x001fffff)}, true)`);
					ConstantFolding.resetConst(rec.rt);
					return code;
				}
			}
			const code = rec.setReg(mips, rec.rt, 'memRead32(' + rec.getOF(opc) + ')');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile24': function (rec, opc) {
			const mips = 'lbu     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			if (ConstantFolding.isConst(rec.rs)) {
				const offset = ((opc << 16) >> 16);
				const address = (ConstantFolding.getConst(rec.rs) + offset) & 0x01ffffff;
				if (address <= 0x00800000) {
					rec.cycles += 5;
					const code = rec.setReg(mips, rec.rt, `ram.getUint8(0x${hex(address & 0x001fffff)})`);
					ConstantFolding.resetConst(rec.rt);
					return code;
				}
			}
			const code = rec.setReg(mips, rec.rt, 'memRead8(' + rec.getOF(opc) + ') & 0xff');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile25': function (rec, opc) {
			const mips = 'lhu     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, rec.rt, 'memRead16(' + rec.getOF(opc) + ') & 0xffff');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile26': function (rec, opc) {
			const mips = 'lwr     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, 0, 'cpu.lwr(' + rec.rt + ', ' + rec.getOF(opc) + ')');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compile28': function (rec, opc) {
			const mips = 'sb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, 0, 'memWrite8(' + rec.getOF(opc) + ', ' + rec.getRT() + ')');
			return code;
		},

		'compile29': function (rec, opc) {
			const mips = 'sh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, 0, 'memWrite16(' + rec.getOF(opc) + ', ' + rec.getRT() + ')');
			return code;
		},

		'compile2A': function (rec, opc) {
			const mips = 'swl     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, 0, 'cpu.swl(' + rec.rt + ', ' + rec.getOF(opc) + ')');
			return code;
		},

		'compile2B': function (rec, opc) {
			const mips = 'sw      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			if (ConstantFolding.isConst(rec.rs)) {
				const offset = ((opc << 16) >> 16);
				const address = (ConstantFolding.getConst(rec.rs) + offset) & 0x01ffffff;
				if (address <= 0x00800000) {
					const code = rec.setReg(mips, 0, `map[(0x${hex(address & 0x001fffff)} | cpu.forceWriteBits) >> 2] = ${rec.getRT()}`);
					ConstantFolding.resetConst(rec.rt);
					return code;
				}
			}
			const code = rec.setReg(mips, 0, `memWrite32(${rec.getOF(opc)}, ${rec.getRT()})`);
			return code;
		},

		'compile2E': function (rec, opc) {
			const mips = 'swr     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, 0, 'cpu.swr(' + rec.rt + ', ' + rec.getOF(opc) + ')');
			return code;
		},

		'compile32': function (rec, opc) {
			const mips = 'lwc2    r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, 0, 'gte.set(' + rec.rt + ', memRead32(' + rec.getOF(opc) + '))');
			return code;
		},

		'compile3A': function (rec, opc) {
			const mips = 'swc2    r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
			const code = rec.setReg(mips, 0, 'memWrite32(' + rec.getOF(opc) + ', gte.get(' + rec.rt + '))');
			return code;
		},

		'compile40': function (rec, opc) {
			if (opc === 0) return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': nop';
			const mips = 'sll     r' + rec.rd + ', r' + rec.rt + ', $' + ((opc >> 6) & 0x1F);
			const code = rec.setReg(mips, rec.rd, rec.getRT() + ' << ' + ((opc >> 6) & 0x1f));
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile42': function (rec, opc) {
			const mips = 'srl     r' + rec.rd + ', r' + rec.rt + ', $' + ((opc >> 6) & 0x1f);
			const code = rec.setReg(mips, rec.rd, rec.getRT() + ' >>> ' + ((opc >> 6) & 0x1f));
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile43': function (rec, opc) {
			const mips = 'sra     r' + rec.rd + ', r' + rec.rt + ', $' + ((opc >> 6) & 0x1f);
			const code = rec.setReg(mips, rec.rd, rec.getRT() + ' >> ' + ((opc >> 6) & 0x1f));
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile44': function (rec, opc) {
			const mips = 'sllv    r' + rec.rd + ', r' + rec.rt + ', r' + rec.rs;
			const code = rec.setReg(mips, rec.rd, rec.getRT() + ' << (' + rec.getRS() + ' & 0x1f)');
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile46': function (rec, opc) {
			const mips = 'srlv    r' + rec.rd + ', r' + rec.rt + ', r' + rec.rs;
			ConstantFolding.resetConst(rec.rd);
			const code = rec.setReg(mips, rec.rd, rec.getRT() + ' >>> (' + rec.getRS() + ' & 0x1f)');
			return code;
		},

		'compile47': function (rec, opc) {
			const mips = 'srav    r' + rec.rd + ', r' + rec.rt + ', r' + rec.rs;
			const code = rec.setReg(mips, rec.rd, rec.getRT() + ' >> (' + rec.getRS() + ' & 0x1f)');
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile48': function (rec, opc) {
			rec.stop = true;
			rec.jump = true;
			rec.skipNext = true;
			const mips = 'jr      r' + rec.rs;
			if (ConstantFolding.isConst(rec.rs)) {
				rec.branchTarget = ConstantFolding.getConst(rec.rs) & 0x01ffffff;
				const code = rec.setReg(mips, 0, `target = _${hex(rec.branchTarget)}`);
				return code;
			}
			const code = rec.setReg(mips, 0, 'target = getCacheEntry(' + rec.getRS() + ')');
			return code;
		},

		'compile49': function (rec, opc) {
			rec.stop = true;
			rec.jump = true;
			const mips = 'jalr    r' + rec.rs + ', r' + rec.rd;
			const code = rec.setReg(mips, rec.rd, '0x' + hex(rec.pc + 8) + ';\ntarget = getCacheEntry(' + rec.getRS() + ')');
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile4C': function (rec, opc) {
			rec.stop = true;
			rec.syscall = true;
			const mips = 'syscall';
			const code = rec.setReg(mips, 0, 'target = cpuException(8 << 2, 0x' + hex(rec.pc) + ')');
			return code;
		},

		'compile4D': function (rec, opc) {
			return '//break';
			// rec.stop = true;
			// rec.break = true;
			// return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': break\n' +
			// 	'target = cpuException(9 << 2, 0x' + hex(rec.pc) + ');';
		},

		'compile50': function (rec, opc) {
			const mips = 'mfhi     r' + rec.rd;
			const code = rec.setReg(mips, rec.rd, 'cpu.hi');
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile51': function (rec, opc) {
			const mips = 'mthi     r' + rec.rs;
			const code = rec.setReg(mips, 0, 'cpu.hi = ' + rec.getRS());
			return code;
		},

		'compile52': function (rec, opc) {
			const mips = 'mflo     r' + rec.rd;
			const code = rec.setReg(mips, rec.rd, 'cpu.lo');
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile53': function (rec, opc) {
			const mips = 'mtlo     r' + rec.rs;
			const code = rec.setReg(mips, 0, 'cpu.lo = ' + rec.getRS());
			return code;
		},

		'compile58': function (rec, opc) {
			const mips = 'mult    r' + rec.rs + ', r' + rec.rt;
			const code = rec.setReg(mips, 0, 'cpu.mult(' + rec.getRS() + ', ' + rec.getRT() + ')');
			rec.cycles += 8;
			return code;
		},

		'compile59': function (rec, opc) {
			const mips = 'multu   r' + rec.rs + ', r' + rec.rt;
			const code = rec.setReg(mips, 0, 'cpu.multu(' + rec.getRS() + ', ' + rec.getRT() + ')');
			rec.cycles += 8;
			return code;
		},

		'compile5A': function (rec, opc) {
			const mips = 'div     r' + rec.rs + ', r' + rec.rt;
			const code = rec.setReg(mips, 0, 'cpu.div(' + rec.getRS() + ', ' + rec.getRT() + ')');
			rec.cycles += 35;
			return code;
		},

		'compile5B': function (rec, opc) {
			const mips = 'divu    r' + rec.rs + ', r' + rec.rt;
			const code = rec.setReg(mips, 0, 'cpu.divu(' + rec.getRS() + ', ' + rec.getRT() + ')');
			rec.cycles += 35;
			return code;
		},

		'compile60': function (rec, opc) {
			const mips = 'add     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			if (ConstantFolding.isConst(rec.rs) && ConstantFolding.isConst(rec.rt)) {
				const value = ConstantFolding.getConst(rec.rs) + ConstantFolding.getConst(rec.rt);
				const code = rec.setReg(mips, rec.rd, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rd, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rd, rec.getRS() + ' + ' + rec.getRT());
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile61': function (rec, opc) {
			const mips = 'addu    r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			if (ConstantFolding.isConst(rec.rs) && ConstantFolding.isConst(rec.rt)) {
				const value = ConstantFolding.getConst(rec.rs) + ConstantFolding.getConst(rec.rt);
				const code = rec.setReg(mips, rec.rd, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rd, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rd, rec.getRS() + ' + ' + rec.getRT());
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile62': function (rec, opc) {
			const mips = 'sub     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			if (ConstantFolding.isConst(rec.rs) && ConstantFolding.isConst(rec.rt)) {
				const value = ConstantFolding.getConst(rec.rs) - ConstantFolding.getConst(rec.rt);
				const code = rec.setReg(mips, rec.rd, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rd, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rd, rec.getRS() + ' - ' + rec.getRT());
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile63': function (rec, opc) {
			const mips = 'subu    r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			if (ConstantFolding.isConst(rec.rs) && ConstantFolding.isConst(rec.rt)) {
				const value = ConstantFolding.getConst(rec.rs) - ConstantFolding.getConst(rec.rt);
				const code = rec.setReg(mips, rec.rd, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rd, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rd, rec.getRS() + ' - ' + rec.getRT());
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile64': function (rec, opc) {
			const mips = 'and     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			if (ConstantFolding.isConst(rec.rs) && ConstantFolding.isConst(rec.rt)) {
				const value = ConstantFolding.getConst(rec.rs) & ConstantFolding.getConst(rec.rt);
				const code = rec.setReg(mips, rec.rd, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rd, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rd, rec.getRS() + ' & ' + rec.getRT());
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile65': function (rec, opc) {
			const mips = 'or      r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			if (ConstantFolding.isConst(rec.rs) && ConstantFolding.isConst(rec.rt)) {
				const value = ConstantFolding.getConst(rec.rs) | ConstantFolding.getConst(rec.rt);
				const code = rec.setReg(mips, rec.rd, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rd, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rd, rec.getRS() + ' | ' + rec.getRT());
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile66': function (rec, opc) {
			const mips = 'xor     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			if (ConstantFolding.isConst(rec.rs) && ConstantFolding.isConst(rec.rt)) {
				const value = ConstantFolding.getConst(rec.rs) ^ ConstantFolding.getConst(rec.rt);
				const code = rec.setReg(mips, rec.rd, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rd, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rd, rec.getRS() + ' ^ ' + rec.getRT());
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile67': function (rec, opc) {
			const mips = 'nor     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			if (ConstantFolding.isConst(rec.rs) && ConstantFolding.isConst(rec.rt)) {
				const value = ~(ConstantFolding.getConst(rec.rs) | ConstantFolding.getConst(rec.rt));
				const code = rec.setReg(mips, rec.rd, `0x${hex(value)}`);
				ConstantFolding.setConst(rec.rd, value);
				return code;
			}
			const code = rec.setReg(mips, rec.rd, '~(' + rec.getRS() + ' | ' + rec.getRT() + ')');
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile6A': function (rec, opc) {
			const mips = 'slt     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			const code = rec.setReg(mips, rec.rd, '(' + rec.getRS() + ' < ' + rec.getRT() + ') ? 1 : 0');
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile6B': function (rec, opc) {
			const mips = 'sltu    r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
			const code = rec.setReg(mips, rec.rd, '((' + rec.getRS() + ' >>> 0) < (' + rec.getRT() + ' >>> 0)) ? 1 : 0');
			ConstantFolding.resetConst(rec.rd);
			return code;
		},

		'compile80': function (rec, opc) {
			rec.stop = true;
			rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
			const mips = 'bltz    r' + rec.rs + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, 0, `target = (${rec.getRS()} < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
			return code;
		},

		'compile81': function (rec, opc) {
			rec.stop = true;
			rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
			const mips = 'bgez    r' + rec.rs + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, 0, `target = (${rec.getRS()} >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
			return code;
		},

		'compile90': function (rec, opc) {
			rec.stop = true;
			rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
			const mips = 'bltzal  r' + rec.rs + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, 0, `target = (${rec.getRS()} < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
			ConstantFolding.resetConst(31);
			return code;
		},

		'compile91': function (rec, opc) {
			rec.stop = true;
			rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
			const mips = 'bgezal  r' + rec.rs + ', $' + hex(opc, 4);
			const code = rec.setReg(mips, 0, `target = (${rec.getRS()} >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
			ConstantFolding.resetConst(31);
			return code;
		},

		'compileA0': function (rec, opc) {
			const mips = 'mfc0    r' + rec.rt + ', r' + rec.rd;
			const code = rec.setReg(mips, rec.rt, 'cpu.getCtrl(' + rec.rd + ')');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compileA4': function (rec, opc) {
			const mips = 'mtc0    r' + rec.rt + ', r' + rec.rd
			const code = rec.setReg(mips, 0, 'cpu.setCtrl(' + rec.rd + ', ' + rec.getRT() + ')');
			return code;
		},

		'compileB0': function (rec, opc) { // simplicity
			const mips = 'rfe'
			const code = rec.setReg(mips, 0, 'cpu.rfe()');
			return code;
		},

		'compileC0': function (rec, opc) {
			const mips = 'mfc2    r' + rec.rt + ', r' + rec.rd;
			const code = rec.setReg(mips, rec.rt, 'gte.get(' + rec.rd + ')');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compileC2': function (rec, opc) {
			const mips = 'cfc2    r' + rec.rt + ', r' + rec.rd;
			const code = rec.setReg(mips, rec.rt, 'gte.get(' + (32 + rec.rd) + ')');
			ConstantFolding.resetConst(rec.rt);
			return code;
		},

		'compileC4': function (rec, opc) {
			const mips = 'mtc2    r' + rec.rt + ', r' + rec.rd;
			const code = rec.setReg(mips, 0, 'gte.set(' + rec.rd + ', ' + rec.getRT() + ')');
			return code;
		},

		'compileC6': function (rec, opc) {
			const mips = 'ctc2    r' + rec.rt + ', r' + rec.rd;
			const code = rec.setReg(mips, 0, 'gte.set(' + (32 + rec.rd) + ', ' + rec.getRT() + ')');
			return code;
		},

		'compileD0': function (rec, opc) {
			rec.cycles += gte.cycles(opc & 0x1ffffff);
			const mips = 'cop2    0x' + hex(opc & 0x1ffffff);
			const code = rec.setReg(mips, 0, 'gte.command(0x' + hex(opc & 0x1ffffff) + ')');
			return code;
		},
		'invalid': (rec, opc) => {
			abort('invalid instruction');
		}
	}
	rec.compileD1 = rec.compileD0;
	rec.compileD2 = rec.compileD0;
	rec.compileD3 = rec.compileD0;
	rec.compileD4 = rec.compileD0;
	rec.compileD5 = rec.compileD0;
	rec.compileD6 = rec.compileD0;
	rec.compileD7 = rec.compileD0;
	rec.compileD8 = rec.compileD0;
	rec.compileD9 = rec.compileD0;
	rec.compileDA = rec.compileD0;
	rec.compileDB = rec.compileD0;
	rec.compileDC = rec.compileD0;
	rec.compileDD = rec.compileD0;
	rec.compileDE = rec.compileD0;
	rec.compileDF = rec.compileD0;

	const recmap = new Array(256);
	for (let i = 0; i < 256; ++i) {
		recmap[i] = rec[`compile${hex(i, 2).toUpperCase()}`] || rec.invalid;
	}

	function compileInstruction(state, lines, delaySlot) {
		const iwordIndex = getCacheIndex(state.pc);
		const opcode = map[iwordIndex >> 2];
		var opc = 0;
		switch ((opcode >>> 26) & 0x3f) {
			default: opc = 0x00 + ((opcode >>> 26) & 0x3f); break;
			case 0x00: opc = 0x40 + ((opcode >>> 0) & 0x3f); break;
			case 0x01: opc = 0x80 + ((opcode >>> 16) & 0x1f); break;
			case 0x10: opc = 0xA0 + ((opcode >>> 21) & 0x1f); break;
			case 0x12: opc = 0xC0 + ((opcode >>> 21) & 0x1f); break;
		}

		state.rd = (opcode >>> 11) & 0x1F;
		state.rs = (opcode >>> 21) & 0x1F;
		state.rt = (opcode >>> 16) & 0x1F;

		lines.push(recmap[opc](state, opcode));
	}

	const state = {
		'pc': 0,
		'rt': 0,
		'rs': 0,
		'rd': 0,
		'stop': false,
		'break': false,
		'syscall': false,
		'cause': false,
		'sr': false,
		'cycles': 0,
		'skipNext': false,
		entry: null,
		branchTarget: 0,
		jump: false,
		entryPC: 0,

		reg: function (r) {
			return r ? 'gpr[' + r + ']' : '0';
		},
		getRS: function () {
			if (ConstantFolding.isConst(this.rs)) {
				const value = ConstantFolding.getConst(this.rs);
				if (value < -127 || value > 127) {
					return `(0x${hex(value)}|0)`;
				}
				return `${value}`;
			}
			return `${this.reg(this.rs)}`;
		},
		getRT: function () {
			if (ConstantFolding.isConst(this.rt)) {
				const value = ConstantFolding.getConst(this.rt);
				if (value < -127 || value > 127) {
					return `(0x${hex(value)}|0)`;
				}
				return `${value}`;
			}
			return `${this.reg(this.rt)}`;
		},
		getOF: function (opcode) {
			const offset = ((opcode << 16) >> 16);
			if (ConstantFolding.isConst(this.rs)) {
				return `0x${hex((offset + ConstantFolding.getConst(this.rs)) & 0x01ffffff)}`;
			}
			if (offset) {
				return `(${offset} + ${this.reg(this.rs)}) & 0x01ffffff`;
			}
			return `${this.reg(this.rs)} & 0x01ffffff`;
		},
		setReg: function (mips, nr, value) {
			const iword = map[getCacheIndex(this.pc) >>> 2];
			let command = '// ' + hex(this.pc) + ': ' + hex(iword) + ': ' + mips;
			if (value) command += ('\n' + ((nr) ? this.reg(nr) + ' = ' : '') + `${value};`);
			return command;
		},
		clear: function () {
			this.branchTarget = 0;
			this.jump = false;
			this.stop = false;
			this.break = false;
			this.syscall = false;
			this.cause = false;
			this.sr = false;
			this.cycles = 0;
			this.skipNext = false;
		}
	};

	function compileBlockLines(entry) {
		const pc = entry.pc >>> 0;
		state.clear();
		state.pc = pc;
		state.entryPC = pc;
		state.entry = entry;

		const lines = [];
		ConstantFolding.resetState();

		// todo: limit the amount of cycles per block
		while (!state.stop && state.cycles < 2048) {
			compileInstruction(state, lines, false);
			state.cycles += 1;
			state.pc += 4;
		}

		if (!state.stop && state.cycles >= 64) {
			state.branchTarget = (state.pc >>> 0) & 0x01ffffff;
			state.skipNext = true;
			state.jump = true;
			const code = state.setReg('*snip*', 0, `target = _${hex(state.branchTarget)}`);
			lines.push(code);

			// console.log('abort', lines);
			// debugger;
		}

		if (state.stop && (!state.break && !state.syscall && !state.sr)) {
			compileInstruction(state, lines, true);
			state.cycles += 1;
			state.pc += 4;
		}

		if (pc === 0xa0 || pc === 0xb0 || pc === 0xc0) {
			lines.unshift(`trace(${pc}, gpr[9]);`);
		}
		lines.push('psx.clock += ' + state.cycles + ';');

		return lines;
	}

	function compileBlock(entry) {
		const pc = entry.pc >>> 0;
		let lines = compileBlockLines(entry).join('\n').split('\n');

		entry.jump = getCacheEntry(state.branchTarget);
		entry.next = state.skipNext ? null : getCacheEntry(state.pc);

		let jumps = [
			state.branchTarget >>> 0,
			state.skipNext ? 0 : state.pc >>> 0,
			pc
		].filter(a => a !== null || a !== undefined);

		if (lines.length >= 6) {
			const lineIndex = lines[0].indexOf('8fa20010');
			if (-1 !== lineIndex) {
				if (lineIndex === lines[2].indexOf('00000000') &&
					lineIndex === lines[3].indexOf('2442ffff') &&
					lineIndex === lines[5].indexOf('afa20010') &&
					lineIndex === lines[7].indexOf('8fa20010') &&
					lineIndex === lines[9].indexOf('00000000')
				) {
					const asm = lines.filter((a, i) => i < 10 && -1 !== a.indexOf('//')).join('\n');
					console.log(`HLE detected @$${hex(pc)}...`);
					lines.splice(0, 10, ['gpr[2] = --map[((16 + gpr[29]) & 0x001ffffc) >>> 2];']);
					lines.push('psx.clock += 10;');
					lines.unshift(asm);
				}
			}
		}
		
		entry.text = lines.join('\n');
		if (!entry.opt) {
			lines.push(`if (this.count >= 1000) {`);
			lines.push('  CodeTrace.optimise(this);');
			lines.push('}');
		}
		lines.push(' ');
		lines.push(`this.clock = psx.clock;`);
		lines.push(`++this.count;`);
		lines.push(' ');
		lines.push('return target;');
		lines.unshift(`const gpr = cpu.gpr; let target = _${hex(pc)};\n`);

		if (pc < 0x00200000) {
			lines.unshift(`if (!fastCache[${pc}]) { return invalidateCache(this); }`);
			fastCache[pc] = 1;
		}
		return createFunction(pc, lines.filter(a => a).join('\n'), jumps);
	}


	const cached = new Map();
	const fastCache = new Uint8Array(0x00200000);
	fastCache.fill(0);

	Object.seal(state);
	Object.seal(rec);
	Object.seal(cached);

	function getCacheIndex(pc) {
		let ipc = pc & 0x01ffffff;
		if (ipc < 0x800000) ipc &= 0x1fffff;
		return ipc;
	}

	let clears = 0;
	function clearCodeCache(addr, size) {
		const ibase = getCacheIndex(addr);
		if (ibase >= 0x00200000) return;

		fastCache.fill(0, ibase, ibase+size);
		++clears;
	}

	function lazyCompile() {
		if (this.loop.length) {
			const set = new Set();
			const prolog = [];
			const sections = [];
			for (let i = 0; i < this.loop.length; ++i) {
				let block = this.loop[i];
				set.add(block.pc);
				sections.push(block.text);
				sections.push(`_${hex(block.pc)}.clock = psx.clock;`);
				sections.push(`++_${hex(block.pc)}.count;`);
				sections.push('');
				let nextpc = (i + 1) < this.loop.length ? this.loop[i + 1].pc : this.pc;
				sections.push(`if (psx.clock >= psx.eventClock) break;`)
				sections.push(`if (target !== _${hex(nextpc)}) break;`)
				if (block.jump) set.add(block.jump.pc);
				if (block.next) set.add(block.next.pc);
				if (block.pc < 0x00200000) prolog.push(`if (!fastCache[${block.pc}]) { return resetCacheEntry(_${hex(this.pc)}); }\n`);
				sections.push('');
				this.code = null;
				fastCache[block.pc] = 1;
			}
			// console.log(set);
			let code = prolog.join('');
			code += `\nconst gpr = cpu.gpr; let target = _${hex(this.pc)};\nfor (;;) {\n`;
			code += sections.join('\n');
			code += '\n}\nreturn target;';
			this.code = createFunction(this.pc, code, [...set]);
			this.jump = this;
			return this;
		}
		this.code = compileBlock(this);
		return this;
	}

	function getCacheEntry(pc) {
		const lutIndex = getCacheIndex(pc);
		let entry = cached.get(lutIndex);

		if (!entry) {
			cached.set(lutIndex, entry = CacheEntryFactory.createCacheEntry(lutIndex));
			entry.code = lazyCompile;
		}
		return entry;
	}

	scope.getCacheEntry = getCacheEntry;
	scope.clearCodeCache = clearCodeCache;
	scope.vector = null;
	scope.fastCache = fastCache;
	scope.cached = cached;

	scope.invalidateCache = entry => {
		// console.log(`recompiling @${hex(entry.pc)}`); 
		entry.code = lazyCompile;
		entry.count = 0 >>> 0;
		entry.clock = 0 >>> 0;
		entry.opt = false;
		return entry;
	}

	scope.resetCacheEntry = entry => {
		entry.code = lazyCompile;
		entry.count = 0 >>> 0;
		entry.clock = 0 >>> 0;
		entry.opt = false;
		entry.loop = [];
		return entry;
	}

	const ConstantFolding = {
		values: new Int32Array(32),
		state: new Int8Array(32),
		resetState: function () {
			this.state.fill(0);
		},
		isConst: function (regId) {
			return !regId || this.state[regId];
		},
		getConst: function (regId) {
			return !regId ? 0 : this.values[regId];
		},
		setConst: function (regId, value) {
			if (regId) {
				this.values[regId] = value;
				this.state[regId] = 1;
			}
		},
		resetConst: function (regId) {
			this.state[regId] = 0;
		},
	};

	const CacheEntryFactory = {
		createCacheEntry: pc => Object.seal({
			pc: pc >>> 0,
			code: null,
			jump: null,
			next: null,
			count: 0 >>> 0,
			clock: 0 >>> 0,
			opt: false,
			text: '',
			loop: [],

		})
	};

	const TRACE_SIZE = 1024;
	const MAX_BLOCKSIZE = 8;

	scope.CodeTrace = {
		loop: [],
		history: new Array(TRACE_SIZE),
		index: 0,
		add: function (entry) {
			this.index = (this.index + 1) % TRACE_SIZE;
			this.history[this.index] = entry;
		},
		detectLoop: function (entry) {
			for (let i = 1; i <= MAX_BLOCKSIZE; ++i) {
				const index = (this.index - i + TRACE_SIZE) % TRACE_SIZE;
				if (this.history[index].opt) return 0;
				if (!this.history[index].jump || !this.history[index].next) return 0;
				if (this.history[index] === entry) {
					return i;
				}
			}
			return 0;
		},
		optimise: function (entry) {
			if ((psx.clock - entry.clock) < 1024) {
				const loopSize = CodeTrace.detectLoop(entry);
				if (loopSize) {
					const startIndex = (this.index - loopSize + TRACE_SIZE) % TRACE_SIZE;
					const blocks = [];
					for (let i = 0; i < loopSize; ++i) {
						const e = this.history[(startIndex + i) % TRACE_SIZE];
						blocks.push(e);
					}
					entry.loop = blocks;
				}
			}
			invalidateCache(entry);
			entry.opt = true;
		}
	};

	scope.stats = scope.stats || {};
	scope.stats.top = (seconds = 1, top = 25) => {
		const sinceClock = psx.clock - 33868800 * seconds;
		const codeBlocks = [...cached.values()].filter(a => a.clock > sinceClock);
		const count = codeBlocks.reduce((a, b) => a + b.count, 0);
		codeBlocks.sort((a, b) => b.count - a.count).slice(0, top).forEach(a => {
			console.log(`$${hex(a.pc)}\t${(a.count / count).toFixed(3)}\t`, { code: a.code }, `\t${a.count}`);
		});
	}

	scope.calls = 0;
	const cyclesPerTrace = 33868800;
	const local = window.location.href.indexOf('file://') === 0;
	let prevCounter = 0;
	let prevFpsCounter = 0;
	let prevFpsRenderCounter = 0;

	psx.addEvent(0, self => {
		const renderCounter = renderer.fpsRenderCounter - prevFpsRenderCounter;
		prevFpsRenderCounter = renderer.fpsRenderCounter;

		if (local) console.log(`${calls} ${(cyclesPerTrace / calls).toFixed(1)} ${clears} ${context.counter-prevCounter}/${renderer.fpsCounter-prevFpsCounter}/${renderCounter}`);
		psx.setEvent(self, cyclesPerTrace);
		prevCounter = context.counter;
		prevFpsCounter = renderer.fpsCounter;
		clears = 0;
		calls = 0;
	});

})(window);