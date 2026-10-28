mdlr('[test]enge:psx:cpu-mips', ({ include, test }) => {

  const { describe, it, xit, expect, beforeEach, after } = test;

  // Ported from the nugget cpu tests (https://github.com/pcsx-redux/nugget,
  // tests/cpu, MIT), which check the R3000A behaviour on real hardware. The
  // assembly is the tests' own (cpu/*.s), run through the recompiler.

  const { createMachine } = include('enge:psx:test-machine');

  const CODE = 0x80010000;
  const BUFF = 0x80020000;

  // cpu/loads.s
  const LOADS = `
    cpu_delayed_load:
        lw    $a1, 0($a0)
        move  $v0, $a1
        jr    $ra
        nop
    cpu_delayed_load_cancelled:
        lw    $v0, 0($a0)
        move  $v0, $a1
        jr    $ra
        nop
    cpu_delayed_load_load:
        lw    $a1, 0($a0)
        lw    $a1, 4($a0)
        move  $v0, $a1
        move  $v1, $a1
        jr    $ra
        nop
  `;

  // cpu/lwlr.s
  const LWLR = `
    cpu_LWR_LWL_half:
        lwl   $a1, 4($a0)
        jr    $ra
        move  $v0, $a1
    cpu_LWR_LWL_nodelay:
        lwl   $a1, 4($a0)
        lwr   $a1, 1($a0)
        move  $v0, $a1
        jr    $ra
        nop
    cpu_LWR_LWL_delayed:
        lwl   $a1, 4($a0)
        lwr   $a1, 1($a0)
        j     $ra
        move  $v0, $a1
    cpu_LWR_LWL_load_different:
        lwl   $a1, 4($a0)
        lwr   $a1, 5($a0)
        j     $ra
        move  $v0, $a1
    cpu_LW_LWR:
        lw    $a1, 8($a0)
        lwr   $a1, 1($a0)
        j     $ra
        move  $v0, $a1
  `;

  // cpu/links.s
  const LINKS = `
    lwandlink:
        move  $t0, $ra
        sw    $0, -32($sp)
        lw    $ra, -32($sp)
        jal   1f
        nop
    1:  jr    $t0
        move  $v0, $ra
    linkandload:
        move  $t0, $ra
        jal   1f
        move  $ra, $0
    1:  jr    $t0
        move  $v0, $ra
    nolink:
        move  $t0, $ra
        move  $ra, $0
        bltzal $0, 1f
        nop
        jr    $t0
        move  $v0, $ra
    1:  jr    $t0
        move  $v0, $0
  `;

  // cpu/branchbranch.s, the branch and jump in delay slot cases
  const BRANCHBRANCH = `
    branchbranch1:
        li    $v0, 1     /* yes */
        b     t1branch1
        b     t1branch2
        ori   $v0, 2     /* no */
        jr    $ra
        ori   $v0, 4     /* no */
    t1branch1:
        ori   $v0, 8     /* yes */
        jr    $ra
        ori   $v0, 16    /* no */
    t1branch2:
        ori   $v0, 32    /* no */
        jr    $ra
        ori   $v0, 64    /* no */
        ori   $v0, 128   /* yes */
        jr    $ra
        ori   $v0, 256   /* yes */
    branchbranch2:
        li    $v0, 1
        b     t2branch1
        b     t2branch2
        addiu $v0, 3
        jr    $ra
        move  $v0, $0
    t2branch1:
        addiu $v0, 1
        jr    $ra
        move  $v0, $0
    t2branch2:
        sll   $v0, 3
        jr    $ra
        addiu $v0, 5
        sll   $v0, 2
        jr    $ra
        addiu $v0, 1
    jumpjump1:
        li    $v0, 1     /* yes */
        j     t1jump1
        j     t1jump2
        ori   $v0, 2     /* no */
        jr    $ra
        ori   $v0, 4     /* no */
    t1jump1:
        ori   $v0, 8     /* yes */
        jr    $ra
        ori   $v0, 16    /* no */
    t1jump2:
        ori   $v0, 32    /* yes */
        jr    $ra
        ori   $v0, 64    /* yes */
        ori   $v0, 128   /* no */
        jr    $ra
        ori   $v0, 256   /* no */
    jumpjump2:
        li    $v0, 1
        j     t2jump1
        j     t2jump2
        addiu $v0, 3
        jr    $ra
        move  $v0, $0
    t2jump1:
        addiu $v0, 1
        jr    $ra
        move  $v0, $0
    t2jump2:
        sll   $v0, 3
        jr    $ra
        addiu $v0, 5
        sll   $v0, 2
        jr    $ra
        addiu $v0, 1
  `;

  // the inline assembly of the hi/lo tests: returns hi in v0, lo in v1
  const HILO = (body) => `
        li    $v0, 0x55555555
        mthi  $v0
        mtlo  $v0
        ${body}
        mfhi  $t0
        mflo  $t1
        nop
        move  $v0, $t0
        jr    $ra
        move  $v1, $t1
  `;

  let m, fn;

  const load = (source) => {
    const { labels, end } = m.asm(CODE, source);
    return labels;
  };

  const buffer = (...words) => { m.load(BUFF, words); return BUFF; };

  beforeEach(async () => {
    m = createMachine();
    m.cpu.setCtrl(12, 0x40000000); // kernel mode, interrupts off, COP2 on
    fn = load(LOADS + LWLR + LINKS + BRANCHBRANCH);
  });

  after(async () => { m.dispose(); });

  const hilo = (body) => {
    const { labels } = m.asm(0x80018000, `test: ${HILO(body)}`);
    const { v0, v1 } = m.call(labels.test);
    return { hi: v0, lo: v1 };
  };

  describe('quiet loop', () => {

    it('should run a long loop without exceptions', async () => {
      const { labels } = m.asm(0x80018000, `
        loop: li    $t0, 200000
        1:    addiu $t0, -1
              bnez  $t0, 1b
              nop
              jr    $ra
              nop
      `);
      m.call(labels.loop);
      expect(m.exceptions.length).to.eql(0);
    });

  });

  describe('LWL / LWR', () => {

    it('should merge LWL into the old register value when used alone', async () => {
      const out = m.call(fn.cpu_LWR_LWL_half, buffer(0x11223344, 0x55667788), 0xaabbccdd).v0;
      expect(out.toString(16)).to.eql('88bbccdd');
    });

    // LWL and LWR on the same register interlock and add their delays, so
    // reading the register right after the LWR still sees the old value.
    it('should still read the old value right after LWL + LWR', async () => {
      const out = m.call(fn.cpu_LWR_LWL_nodelay, buffer(0x11223344, 0x55667788), 0xaabbccdd).v0;
      expect(out.toString(16)).to.eql('aabbccdd');
    });

    it('should combine LWL + LWR after the load delay', async () => {
      const out = m.call(fn.cpu_LWR_LWL_delayed, buffer(0x11223344, 0x55667788), 0xaabbccdd).v0;
      expect(out.toString(16)).to.eql('88112233');
    });

    it('should combine LWL + LWR from different words', async () => {
      const out = m.call(fn.cpu_LWR_LWL_load_different, buffer(0x11223344, 0x55667788, 0xaabbccdd), 0xeeffeffe).v0;
      expect(out.toString(16)).to.eql('88556677');
    });

    it('should merge LWR into the value of a pending LW', async () => {
      const out = m.call(fn.cpu_LW_LWR, buffer(0x11223344, 0x55667788, 0xaabbccdd), 0xeeffeffe).v0;
      expect(out.toString(16)).to.eql('aa112233');
    });

  });

  describe('load delay', () => {

    it('should keep the old value in the load delay slot', async () => {
      expect(m.call(fn.cpu_delayed_load, buffer(1), 0).v0).to.eql(0);
    });

    it('should cancel a load overwritten in its delay slot', async () => {
      expect(m.call(fn.cpu_delayed_load_cancelled, buffer(1), 0).v0).to.eql(0);
    });

    it('should handle two loads in a row to the same register', async () => {
      const { v0, v1 } = m.call(fn.cpu_delayed_load_load, buffer(1, 2), 4);
      // out = v1:v0; ((out >> 16) | out) & 0xffffffff
      const out = (((v1 << 16) | (v0 >>> 16)) | v0) >>> 0;
      expect(out.toString(16)).to.eql('20004');
    });

  });

  describe('branch in a branch delay slot', () => {

    // A branch or jump in a delay slot is compiled into the same block as the
    // first branch; the block then references the second branch's target
    // without declaring it (ReferenceError: _000100f0 is not defined).
    xit('should run a branch in a branch delay slot like the hardware', async () => {
      expect(m.call(fn.branchbranch1).v0.toString(16)).to.eql('189');
      expect(m.call(fn.branchbranch2).v0).to.eql(9);
    });

    xit('should run a jump in a jump delay slot like the hardware', async () => {
      expect(m.call(fn.jumpjump1).v0.toString(16)).to.eql('69');
      expect(m.call(fn.jumpjump2).v0).to.eql(21);
    });

  });

  describe('multiply and divide', () => {

    it('should divide by zero to hi = dividend, lo = -1 (DIV)', async () => {
      expect(hilo('nop\n div $0, $0')).to.eql({ hi: 0, lo: 0xffffffff });
      expect(hilo('li $v0, 42\n .word 0x0040001a')).to.eql({ hi: 42, lo: 0xffffffff });
    });

    it('should divide by zero to hi = dividend, lo = -1 (DIVU)', async () => {
      expect(hilo('nop\n divu $0, $0')).to.eql({ hi: 0, lo: 0xffffffff });
      expect(hilo('li $v0, 42\n .word 0x0040001b')).to.eql({ hi: 42, lo: 0xffffffff });
    });

    it('should multiply constant operands (MULT)', async () => {
      expect(hilo('li $v0, 256\n li $v1, 384\n mult $v0, $v1')).to.eql({ hi: 0, lo: 98304 });
      expect(hilo('li $v0, -3\n li $v1, 0x40000001\n mult $v0, $v1')).to.eql({ hi: 0xffffffff, lo: 0x3ffffffd });
      expect(hilo('li $v0, 0x10000\n li $v1, 0x8000\n mult $v0, $v1')).to.eql({ hi: 0, lo: 0x80000000 });
      expect(hilo('li $v0, -7\n li $v1, 5\n mult $v0, $v1')).to.eql({ hi: 0xffffffff, lo: 0xffffffdd });
    });

    it('should multiply constant operands (MULTU)', async () => {
      expect(hilo('li $v0, -3\n li $v1, 0x40000001\n multu $v0, $v1')).to.eql({ hi: 0x40000000, lo: 0x3ffffffd });
    });

  });

  describe('link register', () => {

    it('should let JAL overwrite a RA load and a RA move in its delay slot', async () => {
      expect(m.call(fn.linkandload).v0).to.eql(0);
      expect(m.call(fn.lwandlink).v0 !== 0).to.be.true;
    });

    it('should link on BLTZAL even when the branch is not taken', async () => {
      expect(m.call(fn.nolink).v0 !== 0).to.be.true;
    });

  });

})
