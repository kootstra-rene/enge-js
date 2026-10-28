mdlr('[test]enge:psx:test-machine', ({ include, test }) => {

  const { describe, it, expect, beforeEach, after } = test;

  const { createMachine } = include('enge:psx:test-machine');
  const { assemble } = include('enge:psx:test-asm');

  describe('test assembler', () => {

    // reference encodings from GNU as (mipsel, -mips1)
    it('should encode like GNU as', async () => {
      const { words } = assemble(`
        start: lw    $a1, 0($a0)
               move  $v0, $a1
               jr    $ra
               nop
               addiu $sp, $sp, -32
               sll   $t0, $t1, 3
               bne   $t0, $zero, start
               lui   $at, 0x1f80
               li    $t0, 0x12345678
               mtc0  $t0, $12
               rfe
               lwc2  $0, 4($a0)
               jal   start
               .word 0xdeadbeef
      `, 0x1000);
      expect(words.map(w => w.toString(16))).to.eql([
        '8c850000', 'a01025', '3e00008', '0', '27bdffe0', '940c0', '1500fff9', '3c011f80',
        '3c081234', '35085678', '40886000', '42000010', 'c8800004', 'c000400', 'deadbeef',
      ]);
    });

    it('should resolve %hi/%lo and forward labels', async () => {
      const { words, labels } = assemble(`
        lui   $t0, %hi(data)
        addiu $t0, $t0, %lo(data)
        .space 0x8000
        data: .word 1
      `, 0x80010000);
      expect(labels.data).to.eql(0x80018008);
      expect([words[0], words[1]].map(w => w.toString(16))).to.eql(['3c088002', '25088008']);
    });

  });

  describe('test machine', () => {

    // createMachine() disposes the previous machine
    let m;
    beforeEach(async () => { m = createMachine(); });
    after(async () => { m.dispose(); });

    it('should call assembled code and return v0/v1', async () => {
      const { labels } = m.asm(0x80010000, `
        sum:  addu $v0, $a0, $a1
              jr   $ra
              subu $v1, $a0, $a1
      `);
      expect(m.call(labels.sum, 7, 5)).to.eql({ v0: 12, v1: 2 });
    });

    it('should let idle time pass', async () => {
      const start = m.clock;
      m.idle(1000);
      expect(m.clock - start >= 1000 && m.clock - start < 1016).to.be.true;
    });

    it('should upload, fill and read back VRAM through the GPU ports', async () => {
      m.write32(0x1f801810, 0x020000ff);  // fill 16x1 at 0,0 with red (bgr15 001Fh)
      m.write32(0x1f801810, 0x00000000);
      m.write32(0x1f801810, 0x00010010);
      m.write32(0x1f801810, 0xc0000000);  // VRAM -> CPU 2x1 at 0,0
      m.write32(0x1f801810, 0x00000000);
      m.write32(0x1f801810, 0x00010002);
      expect(m.read32(0x1f801810) >>> 0).to.eql(0x001f001f);
    });

    it('should restore the globals it replaced', async () => {
      const gpu = m.gpu;
      m.dispose();
      expect(globalThis.gpu !== gpu).to.be.true;
      m = createMachine();
    });

  });

})
