mdlr('[test]enge:psx:gpu-timing', ({ include, test }) => {

  const { describe, it, expect, before, after } = test;

  // GPU DMA paced by the drawing time. The GPU takes words from its 16-word
  // FIFO only as it draws, so a linked-list DMA to it ends (and raises its
  // IRQ) when the GPU starts the last primitive, not when the list has been
  // read: libgpu's DMA IRQ handler starts the next queued transfer once
  // GPUSTAT.26 is set, which then happens one primitive later rather than a
  // whole frame later.

  const { createMachine } = include('enge:psx:test-machine');

  const D2_MADR = 0x1f8010a0, D2_BCR = 0x1f8010a4, D2_CHCR = 0x1f8010a8, DPCR = 0x1f8010f0;
  const GPU_DATA = 0x1f801810, GPU_STATUS = 0x1f801814;
  const LIST = 0x80100000;

  // flat triangle 0,0 200,0 0,200: (46 setup + 20000 pixels) / 2
  const TRIANGLE_CYCLES = (46 + 20000) / 2;

  let m, result;

  before(async () => {
    m = createMachine();
    const r32 = a => m.read32(a) >>> 0;
    m.write32(GPU_STATUS, 0x00000000);
    for (const v of [0xe1000600, 0xe3000000, 0xe4000000 | 319 | (239 << 10), 0xe5000000]) m.write32(GPU_DATA, v);
    m.write32(GPU_STATUS, 0x04000002);
    m.idleUntil(() => (r32(GPU_STATUS) & 0x04000000) !== 0, 10000);

    // three nodes, one triangle each
    for (let k = 0; k < 3; k++) {
      const next = k < 2 ? (LIST + (k + 1) * 32) & 0xffffff : 0xffffff;
      m.load(LIST + k * 32, [(4 << 24) | next, 0x20ff0000, 0, 200, 200 << 16]);
    }
    m.write32(DPCR, r32(DPCR) | 0x00000800);
    m.write32(D2_MADR, LIST & 0xffffff);
    m.write32(D2_BCR, 0);
    m.write32(D2_CHCR, 0x01000401);

    const dmaCycles = m.idleUntil(() => (r32(D2_CHCR) & 0x01000000) === 0, 1000000, 8);
    const stat = r32(GPU_STATUS);
    const idleAfter = m.idleUntil(() => (r32(GPU_STATUS) & 0x04000000) !== 0, 1000000, 8);
    result = { dmaCycles, stat, idleAfter };
  });

  after(async () => { m?.dispose(); });

  describe('linked-list DMA to the GPU', () => {

    it('should not complete before the GPU starts the last primitive', async () => {
      expect(result.dmaCycles >= 2 * TRIANGLE_CYCLES).to.be.true;
    });

    it('should complete before the last primitive is drawn', async () => {
      expect(result.dmaCycles < 3 * TRIANGLE_CYCLES).to.be.true;
    });

    it('should leave the GPU drawing and ready for a DMA block at completion', async () => {
      expect({ cmd: (result.stat >>> 26) & 1, dma: (result.stat >>> 28) & 1 }).to.eql({ cmd: 0, dma: 1 });
    });

    it('should leave the GPU idle within one primitive after completion', async () => {
      expect(result.idleAfter > 0 && result.idleAfter <= TRIANGLE_CYCLES).to.be.true;
    });

  });

})
