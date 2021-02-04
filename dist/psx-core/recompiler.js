'use strict';

var createFunction = function(pc, code) {
  //return new Function("map", "cpu", "gte", code.replace(/[\r\n]/g, '\n  '));
  var generator = new Function("return function dyn" + hex(pc).toUpperCase() + "(map, cpu, gte){ \n  " + code.replace(/[\r\n]/g, '\n  ') + "\n}");
  return generator();
}

var rec = {
  'compile02' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = (rec.pc & 0xF0000000) | ((opc & 0x03FFFFFF) << 2);
                  // var jmp = (opc & 0x01FFFFFF) << 2;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': j       $' + hex(jmp) + '\n' +
                         'var pc = 0x' + hex(jmp);
                },

  'compile03' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = (rec.pc & 0xF0000000) | ((opc & 0x03FFFFFF) << 2);
                  // var jmp = (opc & 0x01FFFFFF) << 2;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': jal     $' + hex(jmp) + '\n' +
                         'var pc = 0x' + hex(jmp) + '\n' +
                         rec.reg(31) + ' = 0x' + hex(rec.pc + 8);
                },

  'compile04' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = rec.pc + 4 + 4 * opc.asInt16();
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': beq     r' + rec.rs + ', r' + rec.rt + ', $' + hex(opc, 4) + '\n' +
                         'var pc = (' + rec.getRS() + ' === ' + rec.getRT() + ') ? 0x' + hex(jmp) + ' : 0x' + hex(rec.pc + 8) + ';';
                },

  'compile05' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = rec.pc + 4 + 4 * opc.asInt16();
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bne     r' + rec.rs + ', r' + rec.rt + ', $' + hex(opc, 4) + '\n' +
                         'var pc = (' + rec.getRS() + ' !== ' + rec.getRT() + ') ? 0x' + hex(jmp) + ' : 0x' + hex(rec.pc + 8) + ';';
                },

  'compile06' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = rec.pc + 4 + 4 * opc.asInt16();
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': blez    r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         'var pc = (' + rec.getRS() + ' <= 0) ? 0x' + hex(jmp) + ' : 0x' + hex(rec.pc + 8) + ';';
                },

  'compile07' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = rec.pc + 4 + 4 * opc.asInt16();
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bgtz    r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         'var pc = (' + rec.getRS() + ' > 0) ? 0x' + hex(jmp) + ' : 0x' + hex(rec.pc + 8) + ';';
                },

  'compile08' : function (rec, opc) { var mips = 'addi    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, opc.asInt16() + ' + ' + rec.getRS());
                },

  'compile09' : function (rec, opc) { var mips = 'addiu   r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, opc.asInt16() + ' + ' + rec.getRS());
                },

  'compile0A' : function (rec, opc) { var mips = 'slti    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, '(' + rec.getRS() + ' >> 0) < (' + opc.asInt16() + ' >> 0)');
                },

  'compile0B' : function (rec, opc) { var mips = 'sltiu   r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, '(' + rec.getRS() + ' >>> 0) < (' + opc.asInt16() + ' >>> 0)');
                },

  'compile0C' : function (rec, opc) { var mips = 'andi    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, rec.getRS() + ' & 0x' + hex(opc, 4));
                },

  'compile0D' : function (rec, opc) { var mips = 'ori     r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, rec.getRS() + ' | 0x' + hex(opc, 4));
                },

  'compile0E' : function (rec, opc) { var mips = 'xori    r' + rec.rt + ', r' + rec.rs + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, rec.getRS() + ' ^ 0x' + hex(opc, 4));
                },

  'compile0F' : function (rec, opc) { var mips = 'lui     r' + rec.rt + ', $' + hex(opc, 4);
                  return rec.setReg(mips, rec.rt, '0x' + hex((opc & 0xffff) << 16), true);
                },

  'compile20' : function (rec, opc) { var mips = 'lb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  rec.cycles += 3;
                  var addr = rec.getOFconst(opc);
                  var index = rec.addr2index(addr);
                  if (addr && index) {
                    var mips = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': lb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                    switch (addr & 3) {
                      case 0: return rec.setReg(mips, rec.rt, '(map[' + index +'] << 24) >> 24');
                      case 1: return rec.setReg(mips, rec.rt, '(map[' + index +'] << 16) >> 24');
                      case 2: return rec.setReg(mips, rec.rt, '(map[' + index +'] << 8) >> 24');
                      case 3: return rec.setReg(mips, rec.rt, '(map[' + index +'] << 0) >> 24');
                    }
                  }
                  else if (addr) {
                    // console.warn('lb:', '0x'+hex(addr));
                  }
                  return rec.setReg(mips, rec.rt, '(memRead8(' + rec.getOF(opc) + ') << 24) >> 24;');
                },

  'compile21' : function (rec, opc) { var mips = 'lh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  rec.cycles += 3;
                  var addr = rec.getOFconst(opc);
                  var index = rec.addr2index(addr);
                  if (addr && index) {
                    var mips = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': lh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                    switch (addr & 3) {
                      case 0: return rec.setReg(mips, rec.rt, '(map[' + index +'] << 16) >> 16');
                      case 2: return rec.setReg(mips, rec.rt, '(map[' + index +'] << 0) >> 16');
                      default:abort('unaligned write: ' + hex(index));
                    }
                  }
                  else if (addr) {
                    // console.warn('lh:', '0x'+hex(addr));
                  }
                  return rec.setReg(mips, rec.rt, '(memRead16 (' + rec.getOF(opc) + ') << 16) >> 16;');
                },

  'compile22' : function (rec, opc) {
                  rec.cycles += 3;
                  var command = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': lwl     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                'cpu.lwl(' + rec.rt + ', ' + rec.getOF(opc) + ');';
                  return command;
                },

  'compile23' : function (rec, opc) { var mips = 'lw      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  rec.cycles += 3;
                  var addr = rec.getOFconst(opc);
                  var index = rec.addr2index(addr);
                  if (addr && index) {
                    return rec.setReg(mips, rec.rt, 'map[' + index +']');
                  }
                  else if (addr) {
                    // console.warn('lw:', '0x'+hex(addr));
                  }
                  return rec.setReg(mips, rec.rt, 'memRead32(' + rec.getOF(opc) + ') >> 0');
                },

  'compile24' : function (rec, opc) { var mips = 'lbu     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  rec.cycles += 3;
                  var addr = rec.getOFconst(opc);
                  var index = rec.addr2index(addr);
                  if (addr && index) {
                    var mips = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': lbu     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                    switch (addr & 3) {
                      case 0: return rec.setReg(mips, rec.rt, '(map[' + index +'] >> 0) & 0xff');
                      case 1: return rec.setReg(mips, rec.rt, '(map[' + index +'] >> 8) & 0xff');
                      case 2: return rec.setReg(mips, rec.rt, '(map[' + index +'] >> 16) & 0xff');
                      case 3: return rec.setReg(mips, rec.rt, '(map[' + index +'] >> 24) & 0xff');
                    }
                  }
                  else if (addr) {
                    // console.warn('lbu:', '0x'+hex(addr));
                  }
                  return rec.setReg(mips, rec.rt, 'memRead8u(' + rec.getOF(opc) + ') & 0xff');
                },

  'compile25' : function (rec, opc) { var mips = 'lhu     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')';
                  rec.cycles += 3;
                  var addr = rec.getOFconst(opc);
                  var index = rec.addr2index(addr);
                  if (addr && index) {
                    switch (addr & 3) {
                      case 0: return rec.setReg(mips, rec.rt, '(map[' + index +'] >> 0) & 0xffff');
                      case 2: return rec.setReg(mips, rec.rt, '(map[' + index +'] >> 16) & 0xffff');
                      default:abort('unaligned write: ' + hex(index));
                    }
                  }
                  else if (addr) {
                    // console.warn('lhu:', '0x'+hex(addr));
                  }
                  return rec.setReg(mips, rec.rt, 'memRead16u(' + rec.getOF(opc) + ') & 0xffff');
                },

  'compile26' : function (rec, opc) {
                  var command = '// ' + hex(rec.pc) + ': ' + hex(opc) + ': lwr     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                'cpu.lwr(' + rec.rt + ', ' + rec.getOF(opc) + ')';
                  rec.cycles += 3;
                  return command;
                },

  'compile28' : function (rec, opc) {
                  var addr = rec.getOFconst(opc);
                  var index = rec.addr2index(addr);
                  if (false && addr && index) { // disabled because it does not clear code cache
                    switch (addr & 3) {
                      case 0: return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                     'map[' + index +'] = (map[' + index +'] & 0xffffff00) | (('+rec.getRT()+' & 0xff) << 0);\ncache['+index+'] = null;';
                      case 1: return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                     'map[' + index +'] = (map[' + index +'] & 0xffff00ff) | (('+rec.getRT()+' & 0xff) << 8);\ncache['+index+'] = null;';
                      case 2: return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                     'map[' + index +'] = (map[' + index +'] & 0xff00ffff) | (('+rec.getRT()+' & 0xff) << 16);\ncache['+index+'] = null;';
                      case 3: return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                     'map[' + index +'] = (map[' + index +'] & 0x00ffffff) | (('+rec.getRT()+' & 0xff) << 24);\ncache['+index+'] = null;';
                    }
                  }
                  else if (addr) {
                    // console.warn('sb:', '0x'+hex(addr));
                  }
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sb      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'memWrite8(' + rec.getOF(opc) + ', ' + rec.getRT() + ');';
                },

  'compile29' : function (rec, opc) {
                  var addr = rec.getOFconst(opc);
                  var index = rec.addr2index(addr);
                  if (false && addr && index) { // disabled because it does not clear code cache
                    switch (addr & 3) {
                      case 0: return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                     'map[' + index +'] = (map[' + index +'] & 0xffff0000) | (('+rec.getRT()+' & 0xffff) << 0);\ncache['+index+'] = null;';
                      case 2: return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                                     'map[' + index +'] = (map[' + index +'] & 0x0000ffff) | (('+rec.getRT()+' & 0xffff) << 16);\ncache['+index+'] = null;';
                      default:abort('unaligned write: ' + hex(index));
                    }
                  }
                  else if (addr) {
                    // console.warn('sh:', '0x'+hex(addr));
                  }
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': sh      r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'memWrite16(' + rec.getOF(opc) + ', ' + rec.getRT() + ');';
                },

  'compile2A' : function (rec, opc) {
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': swl     r' + rec.rt + ', $' + hex(opc, 4) + '(r' + rec.rs + ')\n' +
                         'cpu.swl(' + rec.rt + ', ' + rec.getOF(opc) + ');';
                },

  'compile2B' : function (rec, opc) {
                  var addr = rec.getOFconst(opc);
                  var index = rec.addr2index(addr);
                  if (false && addr && index) { // disabled because it does not clear code cache
                    return 'map[' + index +'] = '+rec.getRT()+';\ncache['+index+'] = null;\nclear';
                  }
                  else if (addr) {
                    // console.warn('sw:', '0x'+hex(addr));
                  }
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
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' << (' + rec.getRS() + ' & 0x1f);');
                },

  'compile46' : function (rec, opc) { var mips = 'srlv    r' + rec.rd + ', r' + rec.rt + ', r' + rec.rs;
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' >>> (' + rec.getRS() + ' & 0x1f);');
                },

  'compile47' : function (rec, opc) { var mips = 'srav    r' + rec.rd + ', r' + rec.rt + ', r' + rec.rs;
                  return rec.setReg(mips, rec.rd, rec.getRT() + ' >> (' + rec.getRS() + ' & 0x1f);');
                },

  'compile48' : function (rec, opc) {
                  rec.stop = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': jr      r' + rec.rs + '\n' +
                         'var pc = ' + rec.getRS() + ';';
                },

  'compile49' : function (rec, opc) {
                  rec.stop = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': jalr    r' + rec.rs + ', r' + rec.rd + '\n' +
                         rec.reg(rec.rd) + ' = 0x' + hex(rec.pc + 8) + '\n' +
                         'var pc = ' + rec.getRS() + ';';
                },

  'compile4C' : function (rec, opc) {
                  rec.stop = true;
                  rec.syscall = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': syscall\n' +
                         'cpuException(8 << 2, 0x' + hex(rec.pc) + ');';
                },

  'compile4D' : function (rec, opc) {
                  rec.stop = true;
                  rec.break = true;
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': break\n' +
                         'cpuException(9 << 2, 0x' + hex(rec.pc) + ');';
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
                  return rec.setReg(mips, rec.rd, '(' + rec.getRS() + ' >> 0) < (' + rec.getRT() + ' >> 0)');
                },

  'compile6B' : function (rec, opc) { var mips = 'sltu    r' + rec.rd + ', r' + rec.rs + ', r' + rec.rt;
                  return rec.setReg(mips, rec.rd, '(' + rec.getRS() + ' >>> 0) < (' + rec.getRT() + ' >>> 0)');
                },

  'compile80' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = rec.pc + 4 + 4 * opc.asInt16();
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bltz    r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         'var pc = (' + rec.getRS() + ' < 0) ? 0x' + hex(jmp) + ' : 0x' + hex(rec.pc + 8) + ';';
                },

  'compile81' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = rec.pc + 4 + 4 * opc.asInt16();
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bgez    r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         'var pc = (' + rec.getRS() + ' >= 0) ? 0x' + hex(jmp) + ' : 0x' + hex(rec.pc + 8) + ';';
                },

  'compile90' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = rec.pc + 4 + 4 * opc.asInt16();
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bltzal  r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         'var pc = (' + rec.getRS() + ' < 0) ? 0x' + hex(jmp) + ' : 0x' + hex(rec.pc + 8) + ';' +
                         rec.reg(31) + ' = 0x' + hex(rec.pc + 8) + '\n';
                },

  'compile91' : function (rec, opc) {
                  rec.stop = true;
                  var jmp = rec.pc + 4 + 4 * opc.asInt16();
                  return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': bgezal  r' + rec.rs + ', $' + hex(opc, 4) + '\n' +
                         'var pc = (' + rec.getRS() + ' >= 0) ? 0x' + hex(jmp) + ' : 0x' + hex(rec.pc + 8) + ';' +
                         rec.reg(31) + ' = 0x' + hex(rec.pc + 8) + '\n';
                },

  'compileA0' : function (rec, opc) { var mips = 'mfc0    r' + rec.rt + ', r' + rec.rd + '\n';
                  return rec.setReg(mips, rec.rt, 'cpu.getCtrl(' + rec.rd + ');');
                },

  'compileA4' : function (rec, opc) {
                  if (rec.rd === 12) { // cause requires special handling
                    rec.stop = true;
                    rec.cause = true;
                    return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': mtc0    r' + rec.rt + ', r' + rec.rd + '\n' +
                           'cpu.setCtrl(' + rec.rd + ', ' + rec.getRT() + ');\n' + 
                           'var pc = 0x' + hex(rec.pc + 8) + ';';
                  }
                  else
                  if (rec.rd === 13) { // sr requires special handling
                    rec.stop = true;
                    rec.sr = true;
                    return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': mtc0    r' + rec.rt + ', r' + rec.rd + '\n' +
                           'cpu.setCtrl(' + rec.rd + ', ' + rec.getRT() + ');\n' + 
                           'var pc = 0x' + hex(rec.pc + 4) + ';';
                  }
                  else {
                    return '// ' + hex(rec.pc) + ': ' + hex(opc) + ': mtc0    r' + rec.rt + ', r' + rec.rd + '\n' +
                           'cpu.setCtrl(' + rec.rd + ', ' + rec.getRT() + ');';
                  }
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

var compileInstruction = function(state, lines) {
  var opc    = 0;
  var opcode = memRead32(state.pc & 0x01ffffff);
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

  var compiler = 'compile' + hex(opc, 2).toUpperCase();
  try {
    lines.push(rec[compiler](state, opcode));
    // if ((state.pc|0) === (0x80041a00|0)) lines.push('debugger;')
  }
  catch (e) {
    console.log(compiler);
    console.log(lines.join('\n'));
    // abort('compileInstruction');
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

  reg: function(r) {
    return 'gpr[' + r + ']';
  },
  getRS: function() {
    if (this.const[this.rs]) {
      return '' + this.cdata[this.rs];
    }
    return '' + this.reg(this.rs);
  },
  getRT: function() {
    if (this.const[this.rt]) {
      return '' + this.cdata[this.rt];
    }
    return '' + this.reg(this.rt);
  },
  getOF: function(opcode) {
    return '((' + opcode.asInt16() + ' + ' + this.reg(this.rs) + ') & 0x01ffffff)';
  },
  getOFconst: function(opcode) {
    if (this.const[this.rs]) {
      return (opcode.asInt16() + this.cdata[this.rs]) & 0x01ffffff;
    }
    return undefined;
  },
  addr2index: function(addr) {
    if (addr) {
      if (addr < 0x00800000) {
        return (addr & 0x001fffff) >>> 2;
      }
      if ((addr >= 0x01800000) && (addr < 0x01801000)) {
        return (addr & 0x01ffffff) >>> 2;
      }
      if ((addr >= 0x01C00000) && (addr < 0x01C80000)) {
        return (addr & 0x01ffffff) >>> 2;
      }
    }
    return undefined;
  },
  setReg: function(mips, nr, value, isconst) {
    var command =  '// ' + hex(this.pc) + ': ' + hex(memRead32(this.pc & 0x01ffffff)) + ': ' + mips + '\n' +
                   ((nr) ? this.reg(nr) + ' = ' : '') + value + ';';
    if (nr) {
      this.const[nr] = 0;
      if (isconst) { // constant folding
        this.cdata[nr] = value;
        this.const[nr] = 1;
      }
    }
    return command;
  },
  clear: function() {
    this.stop = false;
    this.break = false;
    this.syscall = false;
    this.cause = false;
    this.sr = false;
    this.cycles = 0;

    this.const.fill(0);
    this.cdata.fill(0);
  }
};

function compileBlock(pc) {
  state.clear();
  state.pc = pc;

  var lines = [];
  state.const[0] = 1;
  state.cdata[0] = 0;


  while (!state.stop) {
    compileInstruction(state, lines);
    state.cycles += 1;
    state.pc += 4;

    // if (!state.stop && state.cycles >= 32) { // ~1us
    //   lines.push('var pc = 0x' + hex(state.pc) + ';');
    //   console.log('large function at $'+pc.toString(16)+' with '+state.cycles);
    //   break;
    // }
  }

  if (state.stop && (!state.break && !state.syscall && !state.sr)) {
    compileInstruction(state, lines);
    state.cycles += 1;
  }

  if (!state.break && !state.syscall) lines.push('cpu.pc = pc;');
  if (pc === 0xa0 || pc === 0xb0 || pc === 0xc0) {
    lines.unshift(`trace(${pc}, gpr[9]);`);
  }
  lines.unshift('const gpr = cpu.gpr;');

  var cycles = state.cycles;
  lines.push('return ' + cycles + ';');
  return createFunction(pc, lines.join('\n'));;
}

Object.seal(state);
Object.seal(rec);
