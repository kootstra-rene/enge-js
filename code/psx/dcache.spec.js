mdlr('[test]enge:psx:dcache', ({ include, test }) => {

  const { it, xit, expect, before, after } = test;

  // Ported from the nugget data cache tests (https://github.com/pcsx-redux/
  // nugget, tests/dcache, MIT), verified on real hardware. With the BIU
  // (FFFE0130h) set to DS without RAM, the scratchpad works as a data cache:
  // a KSEG0 load fills the scratchpad word at (address / 4) & FFh with the
  // loaded value. The probe routines are the tests' own (probe.s). Only the
  // cases with assertions are ported; the others print what they observe.

  const { createMachine } = include('enge:psx:test-machine');

  const BIU_BASE = 0x0001e900, BIT_RAM = 1 << 3, BIT_DS = 1 << 7;
  const DBLKSZ = n => (n & 3) << 4;
  const BIU_NORMAL = BIU_BASE | BIT_RAM | BIT_DS;
  const BIU_DS_ONLY = dblksz => BIU_BASE | BIT_DS | DBLKSZ(dblksz);
  const SCRATCHPAD_BASE = 0x1f800000, SCRATCHPAD_WORDS = 256;
  const TEST_DATA_KSEG0 = 0x80100000, TEST_DATA_WORDS = 1024;
  const BASE_PATTERN = 0x5a000000;
  const SP_SLOT_FOR_WORD = wi => wi & 0xff;
  const DUMP = 0x80180000; // s_dump

  const probe = `
    .set BIU_CONFIG, 0xfffe0130
    .set BIU_BUS_CTRL,    0x0001e000
    .set BIU_ICACHE_BITS, 0x00000900
    .set BIU_BASE,        0x0001e900
    .set BIU_NORMAL,      0x0001e988
    .set SR_ISC,     0x00010000
    .set SR_SWC,     0x00020000
    .set SR_ISC_SWC, 0x00030000
        .set noreorder
    dcache_get_biu:
        move  $t5, $ra
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        lui   $t0, %hi(BIU_CONFIG)
        lw    $v0, %lo(BIU_CONFIG)($t0)
        jr    $t5
        nop
    dcache_set_biu:
        move  $t5, $ra
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $a0, %lo(BIU_CONFIG)($t6)
        jr    $t5
        nop
    dcache_run_reads:
        addiu $sp, $sp, -16
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        move  $t0, $s1
        move  $t2, $s2
    2:
        lw    $t1, 0($t0)
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addiu $t0, $t0, 4
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        move  $v0, $t1
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        jr    $ra
        addiu $sp, $sp, 16
    dcache_run_reads_strided:
        addiu $sp, $sp, -20
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        sw    $s3, 16($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        move  $s3, $a3
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        move  $t0, $s1
        move  $t2, $s2
    2:
        lw    $t1, 0($t0)
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addu  $t0, $t0, $s3
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        move  $v0, $t1
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        lw    $s3, 16($sp)
        jr    $ra
        addiu $sp, $sp, 20
    dcache_run_reads_swc:
        addiu $sp, $sp, -16
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        li    $t0, SR_SWC
        mtc0  $t0, $12
        nop
        nop
        move  $t0, $s1
        move  $t2, $s2
    2:
        lw    $t1, 0($t0)
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addiu $t0, $t0, 4
        mtc0  $0, $12
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        move  $v0, $t1
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        jr    $ra
        addiu $sp, $sp, 16
    dcache_run_reads_drained:
        addiu $sp, $sp, -20
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        sw    $s3, 16($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        move  $s3, $a3
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        move  $t0, $s1
        move  $t2, $s2
    2:
        lw    $t1, 0($t0)
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addiu $t0, $t0, 4
        move  $t2, $s3
        beqz  $t2, 4f
        nop
    3:
        addiu $t2, $t2, -1
        bnez  $t2, 3b
        nop
    4:
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        move  $v0, $t1
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        lw    $s3, 16($sp)
        jr    $ra
        addiu $sp, $sp, 20
    dcache_run_writes:
        addiu $sp, $sp, -20
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        sw    $s3, 16($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        move  $s3, $a3
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        move  $t0, $s1
        move  $t2, $s2
        li    $t3, 0
    2:
        xor   $t1, $s3, $t3
        sw    $t1, 0($t0)
        addiu $t3, $t3, 1
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addiu $t0, $t0, 4
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        lw    $s3, 16($sp)
        jr    $ra
        addiu $sp, $sp, 20
    dcache_run_byte_reads:
        addiu $sp, $sp, -16
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        move  $t0, $s1
        move  $t2, $s2
    2:
        lb    $t1, 0($t0)
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addiu $t0, $t0, 1
        nop
        nop
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        move  $v0, $t1
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        jr    $ra
        addiu $sp, $sp, 16
    dcache_run_half_reads:
        addiu $sp, $sp, -16
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        move  $t0, $s1
        move  $t2, $s2
    2:
        lh    $t1, 0($t0)
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addiu $t0, $t0, 2
        nop
        nop
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        move  $v0, $t1
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        jr    $ra
        addiu $sp, $sp, 16
    dcache_run_writes_at_sp_addr:
        addiu $sp, $sp, -20
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        sw    $s3, 16($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        move  $s3, $a3
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        li    $t0, 0x1f800000
        addu  $t0, $t0, $s1
        move  $t2, $s2
        li    $t3, 0
    2:
        xor   $t1, $s3, $t3
        sw    $t1, 0($t0)
        addiu $t3, $t3, 1
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addiu $t0, $t0, 4
        nop
        nop
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        lw    $s3, 16($sp)
        jr    $ra
        addiu $sp, $sp, 20
    dcache_run_reads_at_sp_addr:
        addiu $sp, $sp, -16
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        sw    $s2, 12($sp)
        move  $s0, $a0
        move  $s1, $a1
        move  $s2, $a2
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        mfc0  $t7, $12
        mtc0  $0, $12
        nop
        nop
        lui   $t6, %hi(BIU_CONFIG)
        sw    $s0, %lo(BIU_CONFIG)($t6)
        li    $t0, 0x1f800000
        addu  $t0, $t0, $s1
        move  $t2, $s2
    2:
        lw    $t1, 0($t0)
        addiu $t2, $t2, -1
        bnez  $t2, 2b
        addiu $t0, $t0, 4
        nop
        nop
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        move  $v0, $t1
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        lw    $s2, 12($sp)
        jr    $ra
        addiu $sp, $sp, 16
    dcache_zero_scratchpad:
        move  $t5, $ra
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        li    $t0, 0x1f800000
        li    $t1, 0x1f800400
    2:
        sw    $0, 0($t0)
        addiu $t0, $t0, 4
        bne   $t0, $t1, 2b
        nop
        jr    $t5
        nop
    dcache_dump_scratchpad:
        move  $t5, $ra
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        li    $t0, 0x1f800000
        li    $t1, 0x1f800400
        move  $t2, $a0
    2:
        lw    $t3, 0($t0)
        nop
        sw    $t3, 0($t2)
        addiu $t0, $t0, 4
        bne   $t0, $t1, 2b
        addiu $t2, $t2, 4
        jr    $t5
        nop
    dcache_fill_pattern:
        move  $t5, $ra
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        li    $t0, 0x1fffffff
        and   $t0, $a0, $t0
        li    $t1, 0xa0000000
        or    $t0, $t0, $t1
        move  $t1, $a1
        move  $t2, $a2
        li    $t3, 0
    2:
        xor   $t4, $t2, $t3
        sw    $t4, 0($t0)
        addiu $t3, $t3, 1
        addiu $t0, $t0, 4
        bne   $t3, $t1, 2b
        nop
        jr    $t5
        nop
  `;

  let m, p;
  before(async () => {
    m = createMachine();
    p = m.asm(0x80010000, probe).labels;
    // the BIOS sets the BIU at boot (and syscall_flushCache leaves it so);
    // the test machine runs no BIOS
    m.call(p.dcache_set_biu, BIU_NORMAL);
    m.call(p.dcache_fill_pattern, TEST_DATA_KSEG0, TEST_DATA_WORDS, BASE_PATTERN);
  });
  after(async () => {
    if (m) m.call(p.dcache_set_biu, BIU_NORMAL);
    m?.dispose();
  });

  const hex = v => (v >>> 0).toString(16).padStart(8, '0');
  const dump = () => {
    m.call(p.dcache_dump_scratchpad, DUMP);
    return Array.from({ length: SCRATCHPAD_WORDS }, (_, i) => m.peek32(DUMP + 4 * i) >>> 0);
  };
  const zero = () => m.call(p.dcache_zero_scratchpad);
  const drained = (biu, src, count, nops) => m.call(p.dcache_run_reads_drained, biu, src, count, nops);
  const nonzero = d => d.filter(v => v !== 0).length;

  // the BIU reads back as set
  it('a01_baseline_biu', async () => {
    expect(hex(m.call(p.dcache_get_biu).v0)).to.eql(hex(BIU_NORMAL));
  });

  it('b02_sp_after_zero', async () => {
    zero();
    expect(nonzero(dump())).to.eql(0);
  });

  // 256 consecutive loads fill every scratchpad word with the word at the
  // same index
  // enge has no data cache mode: loads with the BIU set to DS only leave the
  // scratchpad as it is
  xit('h01_mapping_full_sweep', async () => {
    zero();
    drained(BIU_DS_ONLY(0), TEST_DATA_KSEG0, SCRATCHPAD_WORDS, 64);
    const d = dump();
    let matches = 0;
    for (let wi = 0; wi < SCRATCHPAD_WORDS; wi++) if (d[SP_SLOT_FOR_WORD(wi)] === ((BASE_PATTERN ^ wi) >>> 0)) matches++;
    expect(matches).to.eql(SCRATCHPAD_WORDS);
  });

  // loads 16 bytes apart fill only the first word of each line
  // (no data cache mode)
  xit('i01_stride16_at_offset_zero', async () => {
    zero();
    m.call(p.dcache_run_reads_strided, BIU_DS_ONLY(0), TEST_DATA_KSEG0, 64, 16);
    const d = dump();
    let at_offset_zero = 0, others = 0;
    d.forEach((v, i) => { if (v) { if ((i & 3) === 0) at_offset_zero++; else others++; } });
    expect({ at_offset_zero, others }).to.eql({ at_offset_zero: 64, others: 0 });
  });

  // the slot is chosen by the address bits alone: 0x80200000 lands where
  // 0x80100000 does, with its own value
  // (no data cache mode)
  xit('m01_address_aliasing', async () => {
    m.write32(0x00200000, 0xa5a5a5a5);
    zero();
    drained(BIU_DS_ONLY(0), TEST_DATA_KSEG0, 1, 64);
    const a = dump()[0];
    zero();
    drained(BIU_DS_ONLY(0), 0x80200000, 1, 64);
    const b = dump()[0];
    expect([a, b].map(hex)).to.eql([hex(BASE_PATTERN ^ 0), hex(0xa5a5a5a5)]);
  });

  it('n01_volatile_write_to_sp0', async () => {
    m.write32(SCRATCHPAD_BASE, 0xcafebabe);
    const readback = m.read32(SCRATCHPAD_BASE);
    const dumped = dump()[0];
    m.write32(SCRATCHPAD_BASE, 0);
    expect([readback, dumped].map(hex)).to.eql(['cafebabe', 'cafebabe']);
  });

  it('n02_zero_then_volatile_write_sp0', async () => {
    zero();
    m.write32(SCRATCHPAD_BASE, 0xdeadbeef);
    const dumped = dump()[0];
    m.write32(SCRATCHPAD_BASE, 0);
    expect(hex(dumped)).to.eql('deadbeef');
  });

})
