'use strict';

var createFunction = function(pc, code, jumps) {
  const lines = [
    "  return function $" + hex(pc).toUpperCase() + "(psx) { \n    " + code.replace(/[\r\n]/g, '\n    ') + "\n  }"
  ];

  const points = [...new Set(jumps || [])];

  points.forEach(addr => {
    lines.unshift(`  const _${hex(addr)} = getCacheEntry(0x${hex(addr)});`);
  });
  var generator = new Function(lines.join('\n'));
  return generator();
}

var rec = {
  'compile02' : function (rec, opc) {
                  rec.stop = true;
                  rec.jump = true;
                  rec.branchTarget = (rec.pc & 0xF0000000) | ((opc & 0x03FFFFFF) << 2);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': j       $' + hex(rec.branchTarget) + '\n' +
                         `target = _${hex(rec.branchTarget)};`;
                },

  'compile03' : function (rec, opc) {
                  rec.stop = true;
                  rec.jump = true;
                  rec.branchTarget = (rec.pc & 0xF0000000) | ((opc & 0x03FFFFFF) << 2);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': jal     $' + hex(rec.branchTarget) + '\n' +
                         `target = _${hex(rec.branchTarget)};\n` +
                         rec.reg(31) + ' = 0x' + hex(rec.pc + 8);
                },

  'compile04' : function (rec, opc) {
                  rec.stop = true;
                  rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': beq     r' + rec.rs + ', r' + rec.rt + ', $' + hex(opc, 4) + '\n' +
                         `target = ((${rec.getRS()} >> 0) === (${rec.getRT()} >> 0)) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};`;
                },

  'compile05' : function (rec, opc) {
                  rec.stop = true;
                  rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bne     r' + rec.rs + ', r' + rec.rt + ', $' + hex(opc, 4) + '\n' +
                         `target = ((${rec.getRS()} >> 0) !== (${rec.getRT()} >> 0)) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};`;
                },

  'compile06' : function (rec, opc) {
                  rec.stop = true;
                  rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': blez    r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         `target = ((${rec.getRS()} >> 0) <= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};`;
                },

  'compile07' : function (rec, opc) {
                  rec.stop = true;
                  rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bgtz    r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         `target = ((${rec.getRS()} >> 0) > 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};`;
                },

  'compile08' : function (rec, opc) { var mips = 'addi    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, ((opc << 16) >> 16) + ' + ' + rec.getRS());
                },

  'compile09' : function (rec, opc) { var mips = 'addiu   r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, ((opc << 16) >> 16) + ' + ' + rec.getRS());
                },

  'compile0A' : function (rec, opc) { var mips = 'slti    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, '(' + rec.getRS() + ' >> 0) < (' + ((opc << 16) >> 16) + ' >> 0)');
                },

  'compile0B' : function (rec, opc) { var mips = 'sltiu   r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, '(' + rec.getRS() + ' >>> 0) < (' + ((opc << 16) >> 16) + ' >>> 0)');
                },

  'compile0C' : function (rec, opc) { var mips = 'andi    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, rec.getRS() + ' & 0x' + hex(opc, 4));
                },

  'compile0D' : function (rec, opc) { var mips = 'ori     r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  if (rec.isConstRS()) {
                    let value = ((opc << 16) >>> 16) | rec.getConstRS();
                    return rec.setReg(mips, rec.rt, value, true);
                  }
                  return rec.setReg(mips, rec.rt, rec.getRS() + ' | 0x' + hex(opc, 4));
                },

  'compile0E' : function (rec, opc) { var mips = 'xori    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, rec.getRS() + ' ^ 0x' + hex(opc, 4));
                },

  'compile0F' : function (rec, opc) { var mips = 'lui     r' + rec.rt + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, '0x' + hex((opc & 0xffff) << 16), true);
                },

  'compile20' : function (rec, opc) { var mips = 'lb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  if (rec.isConstRS()) {
                    const addr = rec.getConstRS() & 0x01ffffff;
                    if (addr < 0x00800000) {
                      rec.cycles += 5;
                      return rec.setReg(mips, rec.rt, `map8[(${rec.getOF(opc)} & 0x001fffff) >> 0]`);
                    }
                  }
                  return rec.setReg(mips, rec.rt, '(memRead8(' + rec.getOF(opc) + ') << 24) >> 24');
                },

  'compile21' : function (rec, opc) { var mips = 'lh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  if (rec.isConstRS()) {
                    const addr = rec.getConstRS() & 0x01ffffff;
                    if (addr < 0x00800000) {
                      rec.cycles += 5;
                      return rec.setReg(mips, rec.rt, `map16[(${rec.getOF(opc)} & 0x001fffff) >> 1]`);
                    }
                  }
                  return rec.setReg(mips, rec.rt, '(memRead16 (' + rec.getOF(opc) + ') << 16) >> 16');
                },

  'compile22' : function (rec, opc) {
                  var command = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': lwl     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                'cpu.lwl(' + rec.rt + ', ' + rec.getOF(opc) + ');';
                  return command;
                },

  'compile23' : function (rec, opc) { var mips = 'lw      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  if (rec.isConstRS()) {
                    const addr = rec.getConstRS() & 0x01ffffff;
                    if (addr < 0x00800000) {
                      rec.cycles += 5;
                      return rec.setReg(mips, rec.rt, `map[(${rec.getOF(opc)} & 0x001fffff) >> 2]`);
                    }
                  }
                  return rec.setReg(mips, rec.rt, 'memRead32(' + rec.getOF(opc) + ')');
                },

  'compile24' : function (rec, opc) { var mips = 'lbu     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  if (rec.isConstRS()) {
                    const addr = rec.getConstRS() & 0x01ffffff;
                    if (addr < 0x00800000) {
                      rec.cycles += 5;
                      return rec.setReg(mips, rec.rt, `map8[(${rec.getOF(opc)} & 0x001fffff) >> 0] & 0xff`);
                    }
                  }
                  return rec.setReg(mips, rec.rt, 'memRead8(' + rec.getOF(opc) + ') & 0xff');
                },

  'compile25' : function (rec, opc) { var mips = 'lhu     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  if (rec.isConstRS()) {
                    const addr = rec.getConstRS() & 0x01ffffff;
                    if (addr < 0x00800000) {
                      rec.cycles += 5;
                      return rec.setReg(mips, rec.rt, `map16[(${rec.getOF(opc)} & 0x001fffff) >> 1] & 0xffff`);
                    }
                  }
                  return rec.setReg(mips, rec.rt, 'memRead16(' + rec.getOF(opc) + ') & 0xffff');
                },

  'compile26' : function (rec, opc) {
                  var command = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': lwr     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                'cpu.lwr(' + rec.rt + ', ' + rec.getOF(opc) + ')';
                  return command;
                },

  'compile28' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'memWrite8(' + rec.getOF(opc) + ', ' + rec.getRT() + ');';
                },

  'compile29' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'memWrite16(' + rec.getOF(opc) + ', ' + rec.getRT() + ');';
                },

  'compile2A' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': swl     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'cpu.swl(' + rec.rt + ', ' + rec.getOF(opc) + ');';
                },

  'compile2B' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sw      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'memWrite32(' + rec.getOF(opc) + ', ' + rec.getRT() + ');';
                },

  'compile2E' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': swr     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'cpu.swr(' + rec.rt + ', ' + rec.getOF(opc) + ');';
                },

  'compile32' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': lwc2    r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'gte.set(' + rec.rt + ', memRead32(' + rec.getOF(opc) + '))';
                },

  'compile3A' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': swc2    r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'memWrite32(' + rec.getOF(opc) + ', gte.get(' + rec.rt + '));';
                },

  'compile40' : function (rec, opc) { var mips = 'sll     r' + rec.rd + ', r' + rec.rt + ', $' + ((opc >> 6) & 0x1F);
                  if (opc === 0) return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': nop';
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' << ' + ((opc >> 6) & 0x1f));
                },

  'compile42' : function (rec, opc) { var mips = 'srl     r' + rec.rd + ', r' + rec.rt + ', $' + ((opc >> 6) & 0x1f);
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' >>> ' + ((opc >> 6) & 0x1f));
                },

  'compile43' : function (rec, opc) { var mips = 'sra     r' + rec.rd + ', r' + rec.rt + ', $' + ((opc >> 6) & 0x1f);
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' >> ' + ((opc >> 6) & 0x1f));
                },

  'compile44' : function (rec, opc) { var mips = 'sllv    r' + rec.rd + ', r' + rec.rt + ', r' + rec.rs;
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' << (' + rec.getRS() + ' & 0x1f)');
                },

  'compile46' : function (rec, opc) { var mips = 'srlv    r' + rec.rd + ', r' + rec.rt + ', r' + rec.rs;
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' >>> (' + rec.getRS() + ' & 0x1f)');
                },

  'compile47' : function (rec, opc) { var mips = 'srav    r' + rec.rd + ', r' + rec.rt + ', r' + rec.rs;
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' >> (' + rec.getRS() + ' & 0x1f)');
                },

  'compile48' : function (rec, opc) {
                  rec.stop = true;
                  rec.jump = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': jr      r' + rec.rs + '\n' +
                         'target = getCacheEntry(' + rec.getRS() + ');';
                },

  'compile49' : function (rec, opc) {
                  rec.stop = true;
                  rec.jump = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': jalr    r' + rec.rs + ', r' + rec.rd + '\n' +
                         (rec.rd ? (rec.reg(rec.rd) + ' = 0x' + hex(rec.pc + 8) + '\n') : '') +
                         'target = getCacheEntry(' + rec.getRS() + ');';
                },

  'compile4C' : function (rec, opc) {
                  rec.stop = true;
                  rec.syscall = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': syscall\n' +
                         'target = cpuException(8 << 2, 0x' + hex(rec.pc) + ');';
                },

  'compile4D' : function (rec, opc) {
                  rec.stop = true;
                  rec.break = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': break\n' +
                         'target = cpuException(9 << 2, 0x' + hex(rec.pc) + ');';
                },

  'compile50' : function (rec, opc) { var mips = 'mfhi     r' + rec.rd;
                  return rec.setReg(mips, rec.rd, 'cpu.hi');
                },

  'compile51' : function (rec, opc) {
                  var command = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': mthi     r' + rec.rs + '\n' +
                                'cpu.hi = ' + rec.getRS() + ';';
                  return command;
                },

  'compile52' : function (rec, opc) { var mips = 'mflo     r' + rec.rd;
                  return rec.setReg(mips, rec.rd, 'cpu.lo');
                },

  'compile53' : function (rec, opc) {
                  var command = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': mtlo     r' + rec.rs + '\n' +
                                'cpu.lo = ' + rec.getRS() + ';';
                  return command;
                },

  'compile58' : function (rec, opc) {
                  var command =  '// ' + hex(rec.pc) + ': ' + hex(opc) + ': mult    r' + rec.rs + ', r' + rec.rt + '\n' +
                                 'cpu.mult(' + rec.getRS() + ', ' + rec.getRT() + ');';
                  return command;
                },

  'compile59' : function (rec, opc) {
                  var command =  '// ' + hex(rec.pc) + ': ' + hex(opc) + ': multu   r' + rec.rs + ', r' + rec.rt + '\n' +
                                 'cpu.multu(' + rec.getRS() + ', ' + rec.getRT() + ');';
                  return command;
                },

  'compile5A' : function (rec, opc) {
                  var command =  '// ' + hex(rec.pc) + ': ' + hex(opc) + ': div     r' + rec.rs + ', r' + rec.rt + '\n' +
                                 'cpu.div('+ rec.getRS() + ', '+ rec.getRT() + ')';
                  return command;
                },

  'compile5B' : function (rec, opc) {
                  var command =  '// ' + hex(rec.pc) + ': ' + hex(opc) + ': divu    r' + rec.rs + ', r' + rec.rt + '\n' +
                                 'cpu.divu('+ rec.getRS() + ', '+ rec.getRT() + ')';
                  return command;
                },

  'compile60' : function (rec, opc) { var mips = 'add     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, rec.getRS() + ' + ' + rec.getRT());
                },

  'compile61' : function (rec, opc) { var mips = 'addu    r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, rec.getRS() + ' + ' + rec.getRT());
                },

  'compile62' : function (rec, opc) { var mips = 'sub     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, rec.getRS() + ' - ' + rec.getRT());
                },

  'compile63' : function (rec, opc) { var mips = 'subu    r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, rec.getRS() + ' - ' + rec.getRT());
                },

  'compile64' : function (rec, opc) { var mips = 'and     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, rec.getRS() + ' & ' + rec.getRT());
                },

  'compile65' : function (rec, opc) { var mips = 'or      r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, rec.getRS() + ' | ' + rec.getRT());
                },

  'compile66' : function (rec, opc) { var mips = 'xor     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, rec.getRS() + ' ^ ' + rec.getRT());
                },

  'compile67' : function (rec, opc) { var mips = 'nor     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, '~(' + rec.getRS() + ' | ' + rec.getRT() + ')');
                },

  'compile6A' : function (rec, opc) { var mips = 'slt     r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, '((' + rec.getRS() + ' >> 0) < (' + rec.getRT() + ' >> 0)) ? 1 : 0');
                },

  'compile6B' : function (rec, opc) { var mips = 'sltu    r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, '((' + rec.getRS() + ' >>> 0) < (' + rec.getRT() + ' >>> 0)) ? 1 : 0');
                },

  'compile80' : function (rec, opc) {
                  rec.stop = true;
                  rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bltz    r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         `target = ((${rec.getRS()} >> 0) < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};`;
                },

  'compile81' : function (rec, opc) {
                  rec.stop = true;
                  rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bgez    r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         `target = ((${rec.getRS()} >> 0) >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};`;
                },

  'compile90' : function (rec, opc) {
                  rec.stop = true;
                  rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bltzal  r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         `target = ((${rec.getRS()} >> 0) < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};` +
                         rec.reg(31) + ' = 0x' + hex(rec.pc + 8) + '\n';
                },

  'compile91' : function (rec, opc) {
                  rec.stop = true;
                  rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bgezal  r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         `target = ((${rec.getRS()} >> 0) >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};` +
                         rec.reg(31) + ' = 0x' + hex(rec.pc + 8) + '\n';
                },

  'compileA0' : function (rec, opc) { var mips = 'mfc0    r' + rec.rt + ', r' + rec.rd + '\n';
                  return rec.setReg(mips, rec.rt, 'cpu.getCtrl(' + rec.rd + ')');
                },

  'compileA4' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': mtc0    r' + rec.rt + ', r' + rec.rd + '\n' +
                         'cpu.setCtrl(' + rec.rd + ', ' + rec.getRT() + ');';
                },

  'compileB0' : function (rec, opc) { // simplicity
                  return '//' + hex(rec.pc) + ': rfe\n' +
                         'cpu.rfe();';
                },

  'compileC0' : function (rec, opc) { var mips = 'mfc2    r' + rec.rt + ', r' + rec.rd;
                  return rec.setReg(mips, rec.rt, 'gte.get(' + rec.rd + ')');
                },

  'compileC2' : function (rec, opc) { var mips = 'cfc2    r' + rec.rt + ', r' + rec.rd;
                  return rec.setReg(mips, rec.rt, 'gte.get(' + (32 + rec.rd) + ')');
                },

  'compileC4' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': mtc2    r' + rec.rt + ', r' + rec.rd + '\n' +
                         'gte.set(' + rec.rd + ', ' + rec.getRT() + ');';
                },

  'compileC6' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': ctc2    r' + rec.rt + ', r' + rec.rd + '\n' +
                         'gte.set(' + (32 + rec.rd) + ', ' + rec.getRT() + ');';
                },

  'compileD0' : function (rec, opc) {
                  rec.cycles += gte.cycles(opc & 0x1ffffff);
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': cop2    0x' + hex(opc & 0x1ffffff) + '\n' +
                         'gte.command(0x' + hex(opc & 0x1ffffff) + ')';
                },

  'invalid'   : function (rec, opc) {
                  rec.stop = true;
                  rec.syscall = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': invalid instruction\n' +
                         'target = cpuException(4 << 2, 0x' + hex(rec.pc) + ');';
                },
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

const recmap = new Map();
for (let i = 0; i < 256; ++i) {
  recmap.set(i, rec[`compile${hex(i, 2).toUpperCase()}`])
}

function compileInstruction(state, lines) {
  const iwordIndex = getCacheIndex(state.pc);
  var opcode = map[iwordIndex];
  var opc    = 0;
  switch ((opcode >>> 26) & 0x3f) {
    default  :  opc = 0x00 + ((opcode >>> 26) & 0x3f);  break;
    case 0x00:  opc = 0x40 + ((opcode >>>  0) & 0x3f);  break;
    case 0x01:  opc = 0x80 + ((opcode >>> 16) & 0x1f);  break;
    case 0x10:  opc = 0xA0 + ((opcode >>> 21) & 0x1f);  break;
    case 0x12:  opc = 0xC0 + ((opcode >>> 21) & 0x1f);  break;
  }

  state.rd = (opcode >>> 11) & 0x1F;
  state.rs = (opcode >>> 21) & 0x1F;
  state.rt = (opcode >>> 16) & 0x1F;

  try {
    lines.push((recmap.get(opc) || rec.invalid)(state, opcode));
  }
  catch (e) {
    console.log(lines.join('\n'));
    console.log(e);
    abort('compileInstruction: $'+hex(opc,2));
  }
}

var state = {
  'pc'    : 0,
  'rt'    : 0,
  'rs'    : 0,
  'rd'    : 0,
  'stop'  : false,
  'break': false,
  'syscall': false,
  'cause': false,
  'sr': false,
  'cycles': 0,
  'const' : new Uint8Array(32),
  'cdata' : new Int32Array(32),
  entry: null,
  branchTarget: 0,
  jump: false,

  reg: function(r) {
    return r ? 'gpr[' + r + ']' : '0';
  },
  getRS: function() {
    const r = this.rs;
    if (this.const[r]) return `0x${hex(this.cdata[r])}`;
    return `${this.reg(r)}`;
  },
  getRT: function() {
    const r = this.rt;
    if (this.const[r]) return `0x${hex(this.cdata[r])}`;
    return `${this.reg(r)}`;
  },
  getOF: function(opcode) {
    const offset = ((opcode << 16) >> 16);
    const r = this.rs;
    if (this.const[r]) {
      return `(0x${hex(offset + this.cdata[r])} >>> 0)`;
    }
    if (!offset) return `(${this.reg(this.rs)} >>> 0)`;
    return `((${offset} + ${this.reg(this.rs)}) >>> 0)`;
  },
  isConstRS: function() {
    return this.const[this.rs];
  },
  getConstRS: function() {
    return this.cdata[this.rs];
  },
  setReg: function(mips, nr, value, isconst) {
    const iword = map[(this.pc & 0x01ffffff) >>> 2];
    let command =  '// ' + hex(this.pc) + ': ' + hex(iword) + ': ' + mips;

    // isconst = false;

    if (nr) {
      this.const[nr] = 0;
      if (isconst) {
        this.const[nr] = 1;
        this.cdata[nr] = value;
      }
    }
    if (!isconst) {
      command += ('\n' + ((nr) ? this.reg(nr) + ' = ' : '') + `${value};`);
    }
    return command;
  },
  clear: function() {
    this.branchTarget = 0;
    this.jump = false;
    this.stop = false;
    this.break = false;
    this.syscall = false;
    this.cause = false;
    this.sr = false;
    this.cycles = 0;

    this.const.fill(0);
    this.const[0] = 1;
  }
};

function compileBlockLines(entry) {
  const pc = entry.pc >>> 0;
  state.clear();
  state.pc = pc;
  state.entry = entry;

  const lines = [];

  // todo: limit the amount of cycles per block
  while (!state.stop) {
    compileInstruction(state, lines);
    state.cycles += 1;
    state.pc += 4;
  }

  if (state.stop && (!state.break && !state.syscall && !state.sr)) {
    compileInstruction(state, lines);
    state.cycles += 1;
    state.pc += 4;
  }

  if (pc === 0xa0 || pc === 0xb0 || pc === 0xc0) {
    lines.unshift(`trace(${pc}, gpr[9]);`);
  }

  let hasConstants = false;
  for (let i = 1; i < 32; ++i) {
    if (state.const[i]) {
      if (!hasConstants) {
        lines.push('// flush constants');
        hasConstants = true;
      }
      lines.push(`gpr[${i}] = 0x${hex(state.cdata[i])} >> 0;`)
    }
  }

  // debug-only: lines.push('++this.calls;this.clock = psx.clock;');
  return lines;
}

function compileBlock(entry) {
  const pc = entry.pc >>> 0;
  let lines = compileBlockLines(entry);
  entry.jump = getCacheEntry(state.branchTarget);
  entry.next = getCacheEntry(state.pc);

  let cycles = state.cycles;

  let jumps = [
    state.branchTarget >>> 0,
    state.pc >>> 0,
    pc >>> 0
  ];
  let other = getCacheEntry(state.branchTarget);
  if (other && other.pc !== pc && other.jump && other.jump.pc === pc) {
    let otherEntry = {
      pc: other.pc >>> 0,
      calls: 0,
      clock: 0,
      addr: hex(pc),
      code: null,
      jump: null,
      next: null,
    };
    let otherLines = compileBlockLines(otherEntry);
    let combinedLines = [];
    // console.log('level 2 (jump-jump)', hex(pc), hex(other.pc));
    combinedLines.push(...lines);
    combinedLines.push('psx.clock += ' + (cycles) + ';');
    combinedLines.push(`if (target === _${hex(entry.next.pc)}) break;\n`);
    combinedLines.push(...otherLines);
    combinedLines.push('psx.clock += ' + (state.cycles) + ';');
    combinedLines.push(`if (target === _${hex(state.pc)}) break;`);
    combinedLines.unshift(`while(psx.clock < psx.eventClock) {`);
    combinedLines.push('}');
    combinedLines.push('return psx.handleEvents(target);');
    // console.log('>', combinedLines.join('\n'));
    lines = combinedLines;
    jumps.push(
      state.branchTarget >>> 0,
      state.pc >>> 0
    );
  }
  else
  if (entry.jump.pc === (pc >>> 0)) {
    // console.log('level 1', hex(pc));
    lines.unshift(`while (psx.clock < psx.eventClock) {`);
    lines.push('psx.clock += ' + cycles + ';');
    lines.push(`if (target === _${hex(state.pc)}) break;`);
    lines.push('}');
    lines.push('return psx.handleEvents(target);');
  }
  else {
    // console.log('level 0', hex(pc));
    lines.push('if((psx.clock += ' + cycles + ') >= psx.eventClock) {');
    lines.push('  return psx.handleEvents(target);');
    lines.push('}');
    lines.push('return target;');
  }

  lines.unshift(`const gpr = cpu.gpr; let target = _${hex(pc)};`);

  return createFunction(pc, lines.filter(a => a).join('\n'), jumps);
}


Object.seal(state);
Object.seal(rec);


function getCodeStats(level, mostCalledItems) {
  let items = [...cache.values()].filter(a => a.code).filter(a => a.clock >= (psx.clock - 10*33868800));
  switch (level) {
    case 0: break;
    case 1: items = items.filter(a => a.jump === a);
            break;
    case 2: items = items.filter(a => a.jump !== a && a.jump.jump && a.jump.jump === a)
            break;
    case 3: items = items.filter(a => a.jump !== a && a.jump.jump && a.jump.jump.jump === a)
            break;
  }

  return items.sort((a,b) => b.calls-a.calls).slice(0,mostCalledItems||10);
}

// an array is faster but consumes much more memory, deliberatly chosen for memory here,
const cache = new Map();
Object.seal(cache);

function getCacheIndex(pc) {
  pc = pc & 0x01ffffff;
  if (pc < 0x800000) pc &= 0x1fffff;
  return pc >>> 2;
}

function clearCodeCache(addr, size) {
  const words = !size ? 4 >>> 0 : size >>> 0;

  for (let i = 0 >>> 0; i < words; i += 4) {
    const lutIndex = getCacheIndex((addr >>> 0) + i);
    let entry = cache.get(lutIndex);
    if (entry) entry.code = null;
  }
}

function getCacheEntry(pc) {
  const lutIndex = getCacheIndex(pc);
  let entry = cache.get(lutIndex);

  if (!entry) {
    cache.set(lutIndex, entry = {
      code: null,
      pc: lutIndex << 2,
      // inline: false,
      // calls: 0,
      // clock: 0,
      addr: hex(lutIndex << 2),
      jump: null,
      next: null,
    });
    Object.seal(entry);
  }
  return entry;
}

const vector = getCacheEntry(0x80000080);
