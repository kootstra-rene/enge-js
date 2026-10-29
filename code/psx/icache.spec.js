mdlr('[test]enge:psx:icache', ({ include, test }) => {

  const { describe, it, xit, expect, before, after } = test;

  // Ported from the nugget instruction cache tests (https://github.com/
  // pcsx-redux/nugget, tests/icache, MIT), verified on real hardware. The
  // cache is observed through the BIU (FFFE0130h) tag test mode with the
  // cache isolated (SR.IsC): an isolated load returns a line's tag, or one
  // of its code words. The probe routines are the tests' own (probe.s); they
  // run from KSEG1 so they do not disturb the cache they look at.
  //
  // enge has no instruction cache: code runs from RAM as it is, and a store
  // with the cache isolated goes to an unused memory location (cpu.js
  // forceWriteBits), so no tag or code word can be read back. Every case
  // that looks at the cache is skipped for that reason; the BIU register
  // reads back.

  const { createMachine } = include('enge:psx:test-machine');

  const MIPS_JR_RA = 0x03e00008, MIPS_NOP = 0x00000000;
  const TEST_AREA = 0x80100000; // s_testArea, 4 KiB aligned
  const TEST_BASE = TEST_AREA + 0x800, TEST_BASE_UNC = (TEST_BASE | 0x20000000) >>> 0;
  const TEST_LINE = 128;
  const TEST_ALT = TEST_BASE + 0x1000, TEST_ALT_UNC = (TEST_ALT | 0x20000000) >>> 0;
  const CACHE_LINE_INDEX = addr => (addr >>> 4) & 0xff;
  const TAG_VALID = x => x & 0x0f;
  const TAG_MATCH = x => (x >>> 4) & 1;
  const BIU_NORMAL = 0x0001e988, BIU_IBLKSZ_2WORD = 0x0001e888;
  const BUF = 0x80180000; // s_tagbuf / s_codebuf

  const probe = `
    .set BIU_CONFIG, 0xfffe0130
    .set BIU_TAG_IS1, 0x0001e90c
    .set BIU_IS1,     0x0001e908
    .set BIU_NORMAL,  0x0001e988
    .set SR_ISC, 0x00010000
    .set SR_SWC, 0x00020000
    .set SR_ISC_SWC, 0x00030000
        .set noreorder
    icache_read_tag_line:
        addiu $sp, $sp, -16
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        move  $s0, $a0
        move  $s1, $a1
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
        li    $t0, BIU_TAG_IS1
        sw    $t0, %lo(BIU_CONFIG)($t6)
        li    $t0, SR_ISC
        mtc0  $t0, $12
        nop
        nop
        li    $t0, 0x1ffffff0
        and   $t0, $s0, $t0
        lw    $t1, 0($t0)
        lw    $t2, 4($t0)
        lw    $t3, 8($t0)
        lw    $t4, 12($t0)
        mtc0  $0, $12
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        sw    $t1, 0($s1)
        sw    $t2, 4($s1)
        sw    $t3, 8($s1)
        sw    $t4, 12($s1)
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        jr    $ra
        addiu $sp, $sp, 16
    icache_read_code_line:
        addiu $sp, $sp, -16
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        move  $s0, $a0
        move  $s1, $a1
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
        li    $t0, BIU_IS1
        sw    $t0, %lo(BIU_CONFIG)($t6)
        li    $t0, SR_ISC
        mtc0  $t0, $12
        nop
        nop
        sll   $t0, $s0, 4
        lw    $t1, 0($t0)
        lw    $t2, 4($t0)
        lw    $t3, 8($t0)
        lw    $t4, 12($t0)
        mtc0  $0, $12
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        sw    $t1, 0($s1)
        sw    $t2, 4($s1)
        sw    $t3, 8($s1)
        sw    $t4, 12($s1)
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        jr    $ra
        addiu $sp, $sp, 16
    icache_write_tag:
        addiu $sp, $sp, -12
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        move  $s0, $a0
        move  $s1, $a1
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
        li    $t0, BIU_TAG_IS1
        sw    $t0, %lo(BIU_CONFIG)($t6)
        li    $t0, SR_ISC
        mtc0  $t0, $12
        nop
        nop
        li    $t0, 0x1ffffff0
        and   $t0, $s0, $t0
        sw    $s1, 0($t0)
        mtc0  $0, $12
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
        jr    $ra
        addiu $sp, $sp, 12
    icache_write_code_word:
        addiu $sp, $sp, -12
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        move  $s0, $a0
        move  $s1, $a1
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
        li    $t0, BIU_IS1
        sw    $t0, %lo(BIU_CONFIG)($t6)
        li    $t0, SR_ISC
        mtc0  $t0, $12
        nop
        nop
        sll   $t0, $s0, 2
        sw    $s1, 0($t0)
        mtc0  $0, $12
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
        jr    $ra
        addiu $sp, $sp, 12
    icache_flush_all_tags:
        move  $t5, $ra
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
        li    $t0, BIU_TAG_IS1
        sw    $t0, %lo(BIU_CONFIG)($t6)
        li    $t0, SR_ISC
        mtc0  $t0, $12
        nop
        nop
        li    $t0, 0
        li    $t1, 0x1000
    2:
        sw    $0, 0($t0)
        addiu $t0, 16
        bne   $t0, $t1, 2b
        nop
        mtc0  $0, $12
        nop
        nop
        li    $t0, BIU_NORMAL
        sw    $t0, %lo(BIU_CONFIG)($t6)
        mtc0  $t7, $12
        nop
        nop
        jr    $t5
        nop
    icache_read_biu:
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
    icache_fill_with_biu:
        addiu $sp, $sp, -16
        sw    $ra, 0($sp)
        sw    $s0, 4($sp)
        sw    $s1, 8($sp)
        move  $s0, $a0
        move  $s1, $a1
        li    $t0, 0xa0000000
        bal   1f
        nop
    1:
        or    $t0, $ra, $t0
        addiu $t0, 4 * 4
        jr    $t0
        nop
        lui   $t6, %hi(BIU_CONFIG)
        lw    $t7, %lo(BIU_CONFIG)($t6)
        sw    $s1, %lo(BIU_CONFIG)($t6)
        jalr  $s0
        nop
        sw    $t7, %lo(BIU_CONFIG)($t6)
        lw    $ra, 0($sp)
        lw    $s0, 4($sp)
        lw    $s1, 8($sp)
        jr    $ra
        addiu $sp, $sp, 16
  `;

  let m, p;
  before(async () => {
    m = createMachine();
    p = m.asm(0x80010000, probe).labels;
    m.call(p.icache_flush_all_tags); // syscall_flushCache()
  });
  after(async () => { m?.dispose(); });

  // stores through KSEG1, as the C code does with a volatile pointer
  const unc = base => (index, value) => m.write32((base & 0x1fffffff) + 4 * index, value);
  const buf = () => [0, 1, 2, 3].map(i => m.peek32(BUF + 4 * i) >>> 0);
  const readTag = addr => { m.call(p.icache_read_tag_line, addr, BUF); return buf(); };
  const readCode = line => { m.call(p.icache_read_code_line, line, BUF); return buf(); };
  const flush = () => m.call(p.icache_flush_all_tags);
  const writeTag = (addr, value) => m.call(p.icache_write_tag, addr, value);
  const writeCode = (index, value) => m.call(p.icache_write_code_word, index, value);
  const fill = (addr, biu) => m.call(p.icache_fill_with_biu, addr, biu);
  const run = addr => m.call(addr).v0;
  const hex = v => (v >>> 0).toString(16);

  it('test lines', async () => {
    expect([CACHE_LINE_INDEX(TEST_BASE), CACHE_LINE_INDEX(TEST_ALT)]).to.eql([TEST_LINE, TEST_LINE]);
  });

  // An instruction fetch fills the line from the fetched word to its end
  // (4-word refill), or the fetched word and the next (2-word refill).
  xit('fill_pattern', async () => {
    const u = unc(TEST_BASE_UNC);
    u(4, MIPS_NOP);
    u(5, MIPS_NOP);
    const valid = [BIU_IBLKSZ_2WORD, BIU_NORMAL].map(biu => [0, 1, 2, 3].map(word => {
      for (let i = 0; i < 4; i++) u(i, MIPS_NOP);
      u(word, MIPS_JR_RA);
      flush();
      fill(TEST_BASE + word * 4, biu);
      return TAG_VALID(readTag(TEST_BASE)[0]);
    }));
    expect(valid).to.eql([[0x3, 0xe, 0xc, 0x8], [0xf, 0xe, 0xc, 0x8]]);
  });

  // the tag holds the physical page: it matches the line's own address and
  // not one 4 KiB further on
  xit('tag_is_physical', async () => {
    for (const base of [TEST_BASE_UNC, TEST_ALT_UNC]) [MIPS_JR_RA, MIPS_NOP, MIPS_NOP, MIPS_NOP].forEach((w, i) => unc(base)(i, w));
    flush();
    run(TEST_BASE);
    const base_match = TAG_MATCH(readTag(TEST_BASE)[0]);
    flush();
    run(TEST_ALT);
    const alt_match = TAG_MATCH(readTag(TEST_BASE)[0]);
    expect({ base_match, alt_match }).to.eql({ base_match: 1, alt_match: 0 });
  });

  xit('valid_bits_controllable', async () => {
    const patterns = [0x0, 0x1, 0x2, 0x4, 0x8, 0x5, 0xa, 0xf];
    expect(patterns.map(v => { writeTag(TEST_BASE, v); return TAG_VALID(readTag(TEST_BASE)[0]); })).to.eql(patterns);
  });

  // clearing the valid bits leaves the code words in place
  xit('code_survives_invalidation', async () => {
    const code = [0xaaaa0000, 0xbbbb1111, 0xcccc2222, 0xdddd3333];
    code.forEach((w, i) => writeCode(TEST_LINE * 4 + i, w));
    writeTag(TEST_BASE, 0xf);
    writeTag(TEST_BASE, 0x0);
    expect(readCode(TEST_LINE).map(hex)).to.eql(code.map(hex));
  });

  // A write to RAM does not reach the cache: the cached copy keeps running
  // until its valid bit is cleared.
  xit('stale_cache', async () => {
    const u = unc(TEST_BASE_UNC);
    [0x24020001, MIPS_JR_RA, MIPS_NOP, MIPS_NOP].forEach((w, i) => u(i, w)); // li $v0, 1
    flush();
    const r1 = run(TEST_BASE);
    u(0, 0x24020002); // li $v0, 2
    const r2 = run(TEST_BASE);
    writeTag(TEST_BASE, 0xe);
    const r3 = run(TEST_BASE);
    expect({ r1, r2, r3 }).to.eql({ r1: 1, r2: 1, r3: 2 });
  });

  xit('ram_writes_ignore_icache', async () => {
    const u = unc(TEST_BASE_UNC);
    [MIPS_JR_RA, MIPS_NOP, 0xaaaaaaaa, 0xbbbbbbbb].forEach((w, i) => u(i, w));
    flush();
    run(TEST_BASE);
    m.write32((TEST_BASE & 0x1fffffff) + 8, 0xcccccccc); // through KSEG0
    const after_kseg0 = readCode(TEST_LINE)[2];
    u(2, 0xdddddddd);
    const after_kseg1 = readCode(TEST_LINE)[2];
    expect([after_kseg0, after_kseg1].map(hex)).to.eql(['aaaaaaaa', 'aaaaaaaa']);
  });

  xit('consecutive_fills_compose', async () => {
    const u = unc(TEST_BASE_UNC);
    [MIPS_JR_RA, MIPS_NOP, MIPS_JR_RA, MIPS_NOP].forEach((w, i) => u(i, w));
    flush();
    run(TEST_BASE + 8);
    run(TEST_BASE);
    expect(TAG_VALID(readTag(TEST_BASE)[0])).to.eql(0xf);
  });

  // a fetch from a word whose valid bit is clear refills from that word on
  xit('invalid_word_full_refill', async () => {
    const u = unc(TEST_BASE_UNC);
    [0x24020001, MIPS_JR_RA, 0xaaaa0002, 0xaaaa0003].forEach((w, i) => u(i, w));
    flush();
    run(TEST_BASE);
    [0x24020002, MIPS_JR_RA, 0xbbbb0002, 0xbbbb0003].forEach((w, i) => u(i, w));
    writeTag(TEST_BASE, 0xc);
    const r = run(TEST_BASE);
    const post_valid = TAG_VALID(readTag(TEST_BASE)[0]);
    const post_code = readCode(TEST_LINE);
    expect({ r, post_valid, word2: hex(post_code[2]) }).to.eql({ r: 2, post_valid: 0xf, word2: 'bbbb0002' });
  });

  // a tag write takes its address from the store
  xit('tag_write_sets_address', async () => {
    [MIPS_JR_RA, MIPS_NOP, MIPS_NOP, MIPS_NOP].forEach((w, i) => unc(TEST_ALT_UNC)(i, w));
    flush();
    run(TEST_ALT);
    const before = TAG_MATCH(readTag(TEST_BASE)[0]);
    writeTag(TEST_BASE, 0xf);
    const after = TAG_MATCH(readTag(TEST_BASE)[0]);
    expect({ before, after }).to.eql({ before: 0, after: 1 });
  });

  xit('iblksz_sequential', async () => {
    [MIPS_JR_RA, MIPS_NOP, MIPS_JR_RA, MIPS_NOP].forEach((w, i) => unc(TEST_BASE_UNC)(i, w));
    flush();
    fill(TEST_BASE, BIU_IBLKSZ_2WORD);
    fill(TEST_BASE + 8, BIU_IBLKSZ_2WORD);
    expect(TAG_VALID(readTag(TEST_BASE)[0])).to.eql(0xf);
  });

  // a fill for another page replaces the tag and keeps only its own words
  xit('iblksz_mismatch', async () => {
    for (const base of [TEST_BASE_UNC, TEST_ALT_UNC]) [MIPS_JR_RA, MIPS_NOP, MIPS_NOP, MIPS_NOP].forEach((w, i) => unc(base)(i, w));
    flush();
    fill(TEST_BASE, BIU_NORMAL);
    fill(TEST_ALT, BIU_IBLKSZ_2WORD);
    expect(TAG_VALID(readTag(TEST_BASE)[0])).to.eql(0x3);
  });

  it('biu_default', async () => {
    expect(hex(m.call(p.icache_read_biu).v0)).to.eql(hex(BIU_NORMAL));
  });

})
