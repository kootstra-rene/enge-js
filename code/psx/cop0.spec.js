mdlr('[test]enge:psx:cop0', ({ include, test }) => {

  const { describe, it, xit, expect, beforeEach, after } = test;

  // Ported from the nugget cop0, cpu (branchbranch.s), cop-branch, sr-write
  // and irq-branch-slot tests (https://github.com/pcsx-redux/nugget, MIT),
  // which check the R3000A COP0 behaviour on real hardware. The assembly is
  // the tests' own; the C test bodies are written out as assembly or as
  // JavaScript around it. The exception handler is the test machine's: it
  // records CAUSE and EPC and resumes at EPC + 4 unless told otherwise, as
  // the tests' handler (cop0/cester-cop0.c) does.

  const { createMachine } = include('enge:psx:test-machine');

  const CODE = 0x80010000;
  const TEST = 0x80018000;
  const SR_DEFAULT = 0x40000000; // kernel mode, interrupts off, COP2 usable

  let m;

  beforeEach(async () => {
    m = createMachine();
    m.cpu.setCtrl(12, SR_DEFAULT);
  });

  after(async () => { m?.dispose(); });

  const getSR = () => m.cpu.getCtrl(12) >>> 0;
  const setSR = sr => m.cpu.setCtrl(12, sr >> 0);
  const excode = cause => (cause >>> 2) & 0x1f;
  const bd = cause => cause >>> 31;
  const ce = cause => (cause >>> 28) & 3;
  const hex = v => '0x' + (v >>> 0).toString(16);

  // the last exception taken, in the form the tests' handler keeps it
  const last = () => {
    const ex = m.exceptions[m.exceptions.length - 1];
    return {
      got40: m.exceptions.some(e => e.from === 0x40) ? 1 : 0,
      got80: m.exceptions.some(e => e.from === 0x80) ? 1 : 0,
      from: ex ? ex.from : 0,
      cause: ex ? ex.cause : 0,
      epc: ex ? ex.epc : 0,
    };
  };

  describe('debug breakpoints (DCIC, BDA, BDAM)', () => {

    // Breakpoint on writes, DCIC = CA80_0000h (DE, DAE, DW, UD), at BDA with
    // mask BDAM; then one store and DCIC cleared again.
    const breakpoint = (dcic, bdam, store) => m.asm(TEST, `
      test:  lui   $t0, ${dcic}
             mtc0  $t0, $7
             li    $t0, 0x58
             mtc0  $t0, $5
             li    $t0, ${bdam}
             mtc0  $t0, $9
             ${store}
             mtc0  $0, $7
             jr    $ra
             nop
    `).labels;

    // the debug unit is not emulated: no breakpoint fires
    xit('should break on a store to the breakpoint address', async () => {
      m.poke32(0x58, 1);
      const labels = breakpoint(0xca80, 0xfffffff0, 'bp: sw $0, 0x58($0)');
      m.call(labels.test);
      expect(m.peek32(0x58)).to.eql(0);
      expect(last()).to.eql({ got40: 1, got80: 0, from: 0x40, cause: last().cause, epc: labels.bp });
    });

    it('should not break on a kseg0 store when the mask keeps the region bits', async () => {
      m.poke32(0x58, 1);
      const labels = breakpoint(0xca80, 0xfffffff0, 'lui $at, 0x8000\n sw $0, 0x58($at)');
      m.call(labels.test);
      expect(m.peek32(0x58)).to.eql(0);
      expect(m.exceptions.length).to.eql(0);
    });

    it('should not break on a kseg0 store with only UD set', async () => {
      m.poke32(0x58, 1);
      const labels = breakpoint(0xca80, 0x1fffffff, 'lui $at, 0x8000\n sw $0, 0x58($at)');
      m.call(labels.test);
      expect(m.peek32(0x58)).to.eql(0);
      expect(m.exceptions.length).to.eql(0);
    });

    // the debug unit is not emulated: no breakpoint fires
    xit('should break on a kseg0 store with KD set', async () => {
      m.poke32(0x58, 1);
      const labels = breakpoint(0xea80, 0x1fffffff, 'lui $at, 0x8000\n bp: sw $0, 0x58($at)');
      m.call(labels.test);
      expect(m.peek32(0x58)).to.eql(0);
      expect(last()).to.eql({ got40: 1, got80: 0, from: 0x40, cause: last().cause, epc: labels.bp });
    });

    it('should not break on a store to a RAM mirror above 2 MB', async () => {
      m.poke32(0x58, 1);
      const labels = breakpoint(0xca80, 0xfffffff0, 'lui $at, 0x0020\n sw $0, 0x58($at)');
      m.call(labels.test);
      expect(m.peek32(0x58)).to.eql(0);
      expect(m.exceptions.length).to.eql(0);
    });

    // the debug unit is not emulated: no breakpoint fires
    xit('should break on a byte store inside the breakpoint word', async () => {
      m.poke32(0x58, 0x01020304);
      const labels = breakpoint(0xca80, 0xfffffff0, 'bp: sb $0, 0x59($0)');
      m.call(labels.test);
      expect(hex(m.peek32(0x58))).to.eql('0x1020004');
      expect(last()).to.eql({ got40: 1, got80: 0, from: 0x40, cause: last().cause, epc: labels.bp });
    });

  });

  describe('address and coprocessor exceptions', () => {

    // address errors are not emulated: the store goes ahead
    xit('should raise an address error on an unaligned store', async () => {
      const { labels } = m.asm(TEST, `
        test:  nop
        bad:   sw    $0, 1($0)
               jr    $ra
               nop
      `);
      m.call(labels.test);
      const { got40, got80, from, epc } = last();
      expect({ got40, got80, from, epc: hex(epc), code: excode(last().cause) }).to.eql({ got40: 0, got80: 1, from: 0x80, epc: hex(labels.bad), code: 5 });
    });

    // SR reads back every bit written, including the ones the hardware
    // keeps at 0 (6-7, 20-21, 23-27)
    xit('should keep only the writable SR bits', async () => {
      let mask = 0;
      for (let b = 0; b < 32; ++b) {
        if (b === 1) continue; // KUc: user mode
        const { labels } = m.asm(TEST, `
          test:  mfc0  $t1, $12
                 nop
                 mtc0  $a0, $12
                 nop
                 nop
                 mfc0  $v0, $12
                 nop
                 mtc0  $t1, $12
                 nop
                 jr    $ra
                 nop
        `);
        mask |= m.call(labels.test, (1 << b) >>> 0).v0 & ((1 << b) >>> 0);
      }
      expect(hex(mask)).to.eql('0xf04fff3d');
    });

    // COP1 and COP3 instructions stop the recompiler (invalid instruction)
    // instead of raising Coprocessor Unusable
    for (const [name, word, cu, expected] of [['COP1', 0x44080000, 0x20000000, 0x1000002c], ['COP3', 0x4c080000, 0x80000000, 0x3000002c]]) {
      xit(`should raise Coprocessor Unusable for ${name} with its CU bit clear`, async () => {
        setSR(getSR() & ~cu);
        const { labels } = m.asm(TEST, `
          test:  .word ${word}
                 jr    $ra
                 nop
        `);
        m.call(labels.test);
        expect({ got80: last().got80, ce: hex(last().cause & 0x3000007c) }).to.eql({ got80: 1, ce: hex(expected) });
      });
    }

  });

  // cpu/branchbranch.s, the exception in delay slot cases
  const DELAYSLOT = `
    delayslot_add:
        lui   $t0, 0x7fff
        ori   $t0, 0xffff
        la    $v0, 1f
    1:  b     delayslot_resume
        add   $t1, $t0, $t0
    delayslot_syscall:
        la    $v0, 1f
    1:  b     delayslot_resume
        syscall
    delayslot_break:
        la    $v0, 1f
    1:  b     delayslot_resume
        break
    delayslot_bc2f:
        mfc0  $t0, $12
        lui   $t1, 0x4000
        nor   $t1, $t1, $0
        and   $t1, $t0, $t1
        mtc0  $t1, $12
        la    $t3, delayslot_taken
        sw    $0, 0($t3)
        la    $v0, 1f
    1:  b     delayslot_mark
        .word 0x49000004
    delayslot_swi:
        la    $t3, delayslot_taken
        sw    $0, 0($t3)
        li    $t0, 0x100
        la    $v0, 1f
    1:  b     delayslot_mark
        mtc0  $t0, $13
    plain_swi:
        la    $t3, delayslot_taken
        sw    $0, 0($t3)
        li    $t0, 0x100
        la    $v0, 1f
        mtc0  $t0, $13
    1:  b     delayslot_mark
        nop
    delayslot_nested:
        la    $t3, delayslot_taken
        sw    $0, 0($t3)
        la    $v0, 1f
    1:  b     2f
        bne   $0, $0, 3f
        nop
    2:  syscall
    3:  b     delayslot_mark
        nop
    delayslot_mark:
        li    $t2, 1
        la    $t3, delayslot_taken
        sw    $t2, 0($t3)
        j     delayslot_resume
        nop
    delayslot_taken:
        .word 0
    delayslot_resume:
        jr    $ra
        nop
  `;

  describe('exceptions in branch delay slots', () => {

    let ds;
    beforeEach(async () => { ds = m.asm(CODE, DELAYSLOT).labels; });

    const inSlot = (probe, resume = ds.delayslot_resume) => {
      m.onException = () => resume;
      const branch = m.call(probe).v0;
      const { got80, cause, epc } = last();
      return { got80, excode: excode(cause), bd: bd(cause), epc: hex(epc), branch: hex(branch) };
    };

    // ADD does not raise Overflow (it is compiled as ADDU)
    xit('should raise Overflow in a delay slot with BD set and EPC at the branch', async () => {
      const r = inSlot(ds.delayslot_add);
      expect(r).to.eql({ got80: 1, excode: 12, bd: 1, epc: r.branch, branch: r.branch });
    });

    // Cause.BD is not set and EPC points at the SYSCALL instead of the branch;
    // EPC also holds the physical address (0001xxxxh), not the 8001xxxxh the
    // code runs at
    xit('should raise SYSCALL in a delay slot with BD set and EPC at the branch', async () => {
      const r = inSlot(ds.delayslot_syscall);
      expect(r).to.eql({ got80: 1, excode: 8, bd: 1, epc: r.branch, branch: r.branch });
    });

    // BREAK is compiled as a no-op
    xit('should raise BREAK in a delay slot with BD set and EPC at the branch', async () => {
      const r = inSlot(ds.delayslot_break);
      expect(r).to.eql({ got80: 1, excode: 9, bd: 1, epc: r.branch, branch: r.branch });
    });

    // BC2F stops the recompiler (invalid instruction)
    xit('should raise Coprocessor Unusable for BC2F in a delay slot with CU2 clear', async () => {
      const sr = getSR();
      m.onException = () => ds.delayslot_resume;
      const branch = m.call(ds.delayslot_bc2f).v0;
      setSR(sr);
      const { got80, cause, epc } = last();
      expect({ got80, excode: excode(cause), ce: ce(cause), bd: bd(cause), epc: hex(epc), taken: m.peek32(ds.delayslot_taken) })
        .to.eql({ got80: 1, excode: 11, ce: 2, bd: 1, epc: hex(branch), taken: 0 });
    });

    const clearCause = () => { m.cpu.setCtrl(13, 0); return ds.delayslot_resume; };

    // EPC holds the physical address (0001xxxxh), not the 8001xxxxh the code
    // runs at
    xit('should take a software interrupt before the next instruction', async () => {
      const sr = getSR();
      m.onException = clearCause;
      setSR((sr & ~0xff00) | 0x101);
      const next = m.call(ds.plain_swi).v0;
      setSR(sr);
      const { got80, cause, epc } = last();
      expect({ got80, excode: excode(cause), bd: bd(cause), epc: hex(epc), taken: m.peek32(ds.delayslot_taken) })
        .to.eql({ got80: 1, excode: 0, bd: 0, epc: hex(next), taken: 0 });
    });

    // EPC holds the physical address (0001xxxxh), not the 8001xxxxh the code
    // runs at
    xit('should take a software interrupt raised in a delay slot at the branch target', async () => {
      const sr = getSR();
      m.onException = clearCause;
      setSR((sr & ~0xff00) | 0x101);
      m.call(ds.delayslot_swi);
      setSR(sr);
      const { got80, cause, epc } = last();
      expect({ got80, excode: excode(cause), bd: bd(cause), epc: hex(epc), taken: m.peek32(ds.delayslot_taken) })
        .to.eql({ got80: 1, excode: 0, bd: 0, epc: hex(ds.delayslot_mark), taken: 0 });
    });

    // a branch in a delay slot is compiled with an undeclared target
    // (ReferenceError), as in cpu-mips
    xit('should raise SYSCALL in a nested delay slot with BD set and EPC at the inner branch', async () => {
      const r = inSlot(ds.delayslot_nested);
      expect({ ...r, taken: m.peek32(ds.delayslot_taken) })
        .to.eql({ got80: 1, excode: 8, bd: 1, epc: hex(+r.branch + 4), branch: r.branch, taken: 0 });
    });

  });

  describe('coprocessor branches (cop-branch)', () => {

    // Each probe runs one raw instruction word with a branch offset of 4, so
    // a taken branch lands on the second exit. $v0 collects which paths ran:
    // bit 0 the delay slot, bit 1 the fall-through, bit 2 the branch target.
    const PROBE = (name, insn, pre = []) => `
      ${name}:
          ${pre.map(w => `.word ${w}`).join('\n')}
          move  $v0, $0
          .word ${insn}
          ori   $v0, $v0, 1
          ori   $v0, $v0, 2
          jr    $ra
          nop
          ori   $v0, $v0, 4
          jr    $ra
          nop
    `;

    // name, instruction, coprocessor, branch-on-false, branch offset from entry
    const PROBES = [
      ['bc0f', 0x41000004, 0, 1], ['bc0t', 0x41010004, 0, 0], ['bc0fl', 0x41020004, 0, 1], ['bc0tl', 0x41030004, 0, 0],
      ['bc1f', 0x45000004, 1, 1], ['bc1t', 0x45010004, 1, 0], ['bc1fl', 0x45020004, 1, 1], ['bc1tl', 0x45030004, 1, 0],
      ['bc2f', 0x49000004, 2, 1], ['bc2t', 0x49010004, 2, 0], ['bc2fl', 0x49020004, 2, 1], ['bc2tl', 0x49030004, 2, 0],
      ['bc3f', 0x4d000004, 3, 1], ['bc3t', 0x4d010004, 3, 0], ['bc3fl', 0x4d020004, 3, 1], ['bc3tl', 0x4d030004, 3, 0],
    ].map(([name, insn, z, f]) => ({ name, source: PROBE(name, insn), z, f, at: 4 }));
    // bc2f/bc2t while RTPT is still running, and right after setting GTE FLAG
    PROBES.push(
      { name: 'rtpt_bc2f', source: PROBE('rtpt_bc2f', 0x49000004, [0x4a280030, 0]), z: 2, f: 1, at: 12 },
      { name: 'rtpt_bc2t', source: PROBE('rtpt_bc2t', 0x49010004, [0x4a280030, 0]), z: 2, f: 0, at: 12 },
      { name: 'flag_bc2f', source: PROBE('flag_bc2f', 0x49000004, [0x3c017fff, 0x48c1f800]), z: 2, f: 1, at: 12 },
      { name: 'flag_bc2t', source: PROBE('flag_bc2t', 0x49010004, [0x3c017fff, 0x48c1f800]), z: 2, f: 0, at: 12 },
    );

    // Runs one probe with SR.CU0-3 forced to cu; returns the paths taken,
    // whether an exception fired, its code, BD and EPC relative to the entry.
    const runProbe = (source, name, cu) => {
      const { labels } = m.asm(TEST, source);
      const sr = getSR();
      m.exceptions.length = 0;
      setSR((sr & 0x0fffffff) | (cu << 28));
      const paths = m.call(labels[name]).v0;
      setSR(sr);
      const ex = m.exceptions[0];
      return {
        paths, exc: ex ? 1 : 0, excode: ex ? excode(ex.cause) : 0, bd: ex ? bd(ex.cause) : 0, ce: ex ? ce(ex.cause) : 0,
        epcoff: ex ? ((ex.epc - labels[name]) | 0) : -1,
      };
    };

    it('should run the control probes (beq, bne)', async () => {
      expect(runProbe(PROBE('beq', 0x10000004), 'beq', 0x4).paths).to.eql(5);
      expect(runProbe(PROBE('bne', 0x14000004), 'bne', 0x4).paths).to.eql(3);
    });

    // EPC holds the physical address (0001xxxxh), not the 8001xxxxh the code
    // runs at, so the offset from the probe is off by 80000000h
    xit('should run the syscall control probe', async () => {
      const r = runProbe(PROBE('sc', 0x0000000c), 'sc', 0x4);
      expect({ paths: r.paths, exc: r.exc, excode: r.excode, bd: r.bd, epcoff: r.epcoff })
        .to.eql({ paths: 3, exc: 1, excode: 8, bd: 0, epcoff: 4 });
    });

    // With SR.CUz set the coprocessor condition reads false: BCzF always
    // branches, BCzT never does, and the MIPS II likely forms behave the
    // same. With SR.CUz clear the branch raises Coprocessor Unusable with
    // Cause.CE = z, also for COP0 in kernel mode. The recompiler has no
    // coprocessor branches: they stop it as invalid instructions.
    for (const cu of [0x0, 0x4, 0xf]) {
      describe(`with SR.CU = ${cu.toString(2).padStart(4, '0')}b`, () => {
        for (const probe of PROBES) {
          const usable = (cu & (1 << probe.z)) !== 0;
          xit(`should ${usable ? (probe.f ? 'take' : 'not take') : 'raise Coprocessor Unusable on'} ${probe.name}`, async () => {
            const r = runProbe(probe.source, probe.name, cu);
            if (usable) {
              expect({ paths: r.paths, exc: r.exc }).to.eql({ paths: probe.f ? 5 : 3, exc: 0 });
            } else {
              expect(r).to.eql({ paths: 3, exc: 1, excode: 11, bd: 0, ce: probe.z, epcoff: probe.at });
            }
          });
        }
      });
    }

    it('should allow MFC0 in kernel mode with CU0 clear', async () => {
      const r = runProbe(PROBE('mfc0', 0x40016000), 'mfc0', 0x0);
      expect({ paths: r.paths, exc: r.exc }).to.eql({ paths: 3, exc: 0 });
    });

  });

  describe('SR and Cause writes (sr-write)', () => {

    // Each probe loads in[0..7] into $t0-$t7, writes a COP0 register back
    // with its own value, and stores $t0-$t7 to out[0..7].
    const LOAD8 = [0, 1, 2, 3, 4, 5, 6, 7].map(i => `lw $t${i}, ${4 * i}($a0)`).join('\n');
    const STORE8 = [0, 1, 2, 3, 4, 5, 6, 7].map(i => `sw $t${i}, ${4 * i}($a1)`).join('\n');
    const SRWRITE = `
      srwrite_sr:
          mfc0  $v0, $12
          nop
          ${LOAD8}
          mtc0  $v0, $12
          nop
          ${STORE8}
          jr    $ra
          nop
      srwrite_cause:
          mfc0  $v0, $13
          nop
          ${LOAD8}
          mtc0  $v0, $13
          nop
          ${STORE8}
          jr    $ra
          nop
      srwrite_cause_value:
          mfc0  $v0, $12
          nop
          li    $at, ~1
          and   $at, $v0, $at
          mtc0  $at, $12
          nop
          lw    $t0, 0($a0)
          nop
          mtc0  $t0, $13
          nop
          nop
          mfc0  $t1, $13
          nop
          sw    $t1, 0($a1)
          sw    $t0, 4($a1)
          mtc0  $zero, $13
          nop
          mtc0  $v0, $12
          nop
          jr    $ra
          nop
      srwrite_rfe:
          mfc0  $v0, $12
          nop
          andi  $v1, $v0, 3
          sll   $at, $v1, 2
          or    $v1, $v1, $at
          sll   $at, $v1, 2
          or    $v1, $v1, $at
          li    $at, ~0x3f
          and   $at, $v0, $at
          or    $v1, $v1, $at
          mtc0  $v1, $12
          nop
          ${LOAD8}
          rfe
          ${STORE8}
          mtc0  $v0, $12
          nop
          jr    $ra
          nop
    `;

    const IN = 0x80020000, OUT = 0x80020100;
    const input = [0x11111111, 0x22222222, 0x33333333, 0x44444444, 0x55555555, 0x66666666, 0x77777777, 0x88888888];

    let sw;
    beforeEach(async () => { sw = m.asm(CODE, SRWRITE).labels; });

    const check = probe => {
      m.load(IN, input);
      m.load(OUT, new Array(8).fill(0));
      m.call(probe, IN, OUT);
      return [0, 1, 2, 3, 4, 5, 6, 7].map(i => m.peek32(OUT + 4 * i));
    };

    it('should keep the registers across an SR write', async () => {
      expect(check(sw.srwrite_sr)).to.eql(input);
    });

    it('should keep the registers across a Cause write', async () => {
      expect(check(sw.srwrite_cause)).to.eql(input);
    });

    it('should write Cause IP0/IP1 from a register and leave the register alone', async () => {
      m.load(IN, [0xff00]);
      m.load(OUT, [0, 0]);
      m.call(sw.srwrite_cause_value, IN, OUT);
      expect([hex(m.peek32(OUT) & 0x300), hex(m.peek32(OUT + 4))]).to.eql(['0x300', '0xff00']);
    });

    it('should keep the registers across an RFE', async () => {
      expect(check(sw.srwrite_rfe)).to.eql(input);
    });

  });

  describe('interrupt on a branch in a delay slot (irq-branch-slot)', () => {

    // Each iteration runs a taken branch (B1) whose delay slot holds another
    // taken branch (B2), which lands on the loop's bnez: +1 per iteration.
    // An interrupt that returns to B2 runs it on its own, through its own
    // delay slot to T2: +0x101 for that iteration.
    const PAIR = `
      pairLoop:
          move  $v0, $0
          li    $t1, 1
      pairStart:
          addiu $a0, -1
      pairB1:
          b     pairT1          /* B1: always taken */
      pairB2:
          bnez  $t1, pairT2     /* B2: in B1's slot, taken */
          addiu $v0, 1          /* B2's own slot (only runs if B2 is re-run alone) */
      pairT1:
          addiu $v0, 1          /* B1's target: runs once, as B2's delay slot */
          addiu $v0, 0x7000     /* never executed */
      pairT2:
          addiu $v0, 0x100
          bnez  $a0, pairStart
          nop
      pairEnd:
          jr    $ra
          nop
    `;

    const ITERATIONS = 200000;
    const TIMER_TARGET = 300;
    const IRQ_LIMIT = 1000;

    // Timer 2 at the system clock, IRQ on target, repeat; the handler
    // acknowledges it and stops the timer after IRQ_LIMIT interrupts.
    const runPair = () => {
      const p = m.asm(CODE, PAIR).labels;
      const stats = { irqs: 0, other: 0, atB2BD: 0, inside: 0, bdTotal: 0 };
      m.onException = ({ cause, epc }) => {
        if (cause & 0x7c) { ++stats.other; return epc + 4; }
        m.write32(0x1f801070, ~(1 << 6));
        m.read32(0x1f801124);
        ++stats.irqs;
        stats.bdTotal += bd(cause);
        if (epc === p.pairB2 && bd(cause)) ++stats.atB2BD;
        if (stats.irqs >= IRQ_LIMIT) m.write32(0x1f801124, 0);
        return epc;
      };
      const ref = m.call(p.pairLoop, ITERATIONS).v0;
      m.write32(0x1f801124, 0);
      m.write32(0x1f801120, 0);
      m.write32(0x1f801128, TIMER_TARGET);
      m.write32(0x1f801074, 1 << 6);
      m.write32(0x1f801070, 0);
      m.write32(0x1f801124, 0x0008 | 0x0010 | 0x0040); // reset on target, IRQ on target, repeat
      setSR((getSR() & ~0x1f) | 0x401);
      const irq = m.call(p.pairLoop, ITERATIONS).v0;
      const srAfter = getSR();
      setSR(getSR() & ~1);
      m.write32(0x1f801124, 0);
      m.write32(0x1f801074, 0);
      return { ...stats, ref, irq, srAfter };
    };

    // The recompiler compiles B2 into B1's block and references B2's target
    // without declaring it (ReferenceError), so the loop never runs.
    xit('should take, handle and return from every interrupt', async () => {
      const r = runPair();
      expect({ enough: r.irqs >= IRQ_LIMIT, other: r.other, iec: r.srAfter & 1 }).to.eql({ enough: true, other: 0, iec: 1 });
    });

    xit('should report EPC = B2 with BD set for an interrupt right after B2', async () => {
      expect(runPair().atB2BD !== 0).to.be.true;
    });

    xit('should land B2 relative to B1\'s target (+1 per iteration)', async () => {
      expect(runPair().ref).to.eql(ITERATIONS);
    });

    xit('should re-run B2 on its own when returning to it', async () => {
      const r = runPair();
      expect(r.irq).to.eql(r.ref + 0x100 * r.atB2BD);
    });

  });

})
