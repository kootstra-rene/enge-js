mdlr('[test]enge:psx:gpu', ({ include, test }) => {

  const { describe, it, expect, beforeEach, before, after } = test;

  const { stubWindow } = include('enge:psx:test-window');
  let restoreWindow;

  // Ported from ps1-tests gpu/gp0-e1 and gpu/gpustat
  // (https://github.com/JaCzekanski/ps1-tests, MIT); every case listed here
  // passes on real hardware according to the tests' psx.log.

  const globalNames = ['psx', 'cpu', 'ram', 'renderer', 'nextPrimitive', 'abort', 'hex'];
  const savedGlobals = {};

  const E1_MASK = 0b1000011111111111; // GPUSTAT bits 0-10 and 15

  let gpu;

  const gp0 = word => gpu.wr32r1810(word >> 0);
  const gp1 = word => gpu.wr32r1814(word >> 0);
  const stat = () => gpu.rd32r1814() >>> 0;

  const writeE1 = value => gp0(0xe1000000 | value);
  const allowTextureDisable = allow => gp1(0x09000000 | (allow ? 1 : 0));

  // POLY_FT4 (GP0 2Ch) 32x32 at 0,0 with the given texpage
  const drawTexturedPolygon = texpage => {
    gp0(0x2c808080);
    gp0(0x00000000); gp0(0x00000000);                  // xy0, clut | uv0
    gp0(0x00200000); gp0((texpage << 16) | 0x00ff);    // xy1, tpage | uv1
    gp0(0x00000020); gp0(0x0000ff00);                  // xy2, uv2
    gp0(0x00200020); gp0(0x0000ffff);                  // xy3, uv3
  };

  before(async () => {
    for (const name of globalNames) savedGlobals[name] = globalThis[name];
    restoreWindow = stubWindow({ location: { search: '' } });
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    globalThis.hex = (value, length) => (value >>> 0).toString(16).padStart(length || 8, '0');
    globalThis.renderer = new Proxy({}, { get: () => () => {} });
    globalThis.nextPrimitive = () => {}; // renderer hook
  });

  after(async () => {
    restoreWindow();
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  beforeEach(async () => {
    globalThis.psx = { clock: 0, addEvent: () => ({}), setEvent: () => {}, unsetEvent: () => {}, updateEvent: () => {} };
    globalThis.cpu = { istat: 0, raiseIrq(mask) { this.istat |= mask; } };
    globalThis.ram = new DataView(new ArrayBuffer(2 * 1024 * 1024));
    ({ gpu } = include('enge:psx:gpu'));
    globalThis.gpu = gpu;
    gp1(0x00000000); // reset, as ResetGraph does
  });

  describe('GP0(E1h) draw mode and GP1(09h) texture disable', () => {

    it('should write zeros to the E1 bits', async () => {
      allowTextureDisable(false);
      writeE1(0x000);
      expect(stat() & E1_MASK).to.eql(0);
    });

    it('should write ones to bits 0-10', async () => {
      allowTextureDisable(false);
      writeE1(0xfff);
      expect(stat() & E1_MASK).to.eql(0b0000011111111111);
    });

    it('should write the texture disable bit to bit 15 when allowed', async () => {
      allowTextureDisable(true);
      writeE1(0xfff);
      expect(stat() & E1_MASK).to.eql(0b1000011111111111);
    });

    it('should ignore the texture disable bit when not allowed', async () => {
      allowTextureDisable(false);
      writeE1(1 << 11);
      expect(stat() & 0x8000).to.eql(0);
    });

    it('should write the texture disable bit when allowed', async () => {
      allowTextureDisable(true);
      writeE1(1 << 11);
      expect(stat() & 0x8000).to.eql(0x8000);
    });

    it('should keep the texture disable bit when it is no longer allowed', async () => {
      allowTextureDisable(true);
      writeE1(1 << 11);
      allowTextureDisable(false);
      expect(stat() & 0x8000).to.eql(0x8000);
    });

    it('should clear the texture disable bit on the next E1 write once not allowed', async () => {
      allowTextureDisable(true);
      writeE1(1 << 11);
      allowTextureDisable(false);
      writeE1(0);
      expect(stat() & 0x8000).to.eql(0);
    });

  });

  describe('textured polygon texpage', () => {

    it('should copy texpage bits 0-8 into GPUSTAT', async () => {
      allowTextureDisable(false);
      writeE1(0x000);
      drawTexturedPolygon(0xffff);
      expect(stat() & E1_MASK).to.eql(0b0000000111111111);
    });

    it('should copy the texture disable bit when allowed', async () => {
      allowTextureDisable(true);
      writeE1(0x000);
      drawTexturedPolygon(0xffff);
      expect(stat() & E1_MASK).to.eql(0b1000000111111111);
    });

    it('should not change dither and draw-to-display (bits 9-10)', async () => {
      allowTextureDisable(true);
      writeE1(0xfff);
      drawTexturedPolygon(0x0000);
      expect(stat() & E1_MASK).to.eql(0b0000011000000000);
    });

  });

  describe('GPUSTAT DMA bits on an idle GPU', () => {

    // bit 25 DMA request, 26 ready for command, 27 ready to send VRAM,
    // 28 ready for DMA block, 29-30 DMA direction
    const dmaBits = () => {
      const s = stat();
      return { request: (s >> 25) & 1, cmd: (s >> 26) & 1, vram: (s >> 27) & 1, block: (s >> 28) & 1, direction: (s >> 29) & 3 };
    };

    it('should report ready and no DMA request with DMA off', async () => {
      gp1(0x04000000);
      expect(dmaBits()).to.eql({ request: 0, cmd: 1, vram: 0, block: 1, direction: 0 });
    });

    it('should request DMA in FIFO direction', async () => {
      gp1(0x04000001);
      expect(dmaBits()).to.eql({ request: 1, cmd: 1, vram: 0, block: 1, direction: 1 });
    });

    it('should mirror ready-for-DMA-block in the CPU to GP0 direction', async () => {
      gp1(0x04000002);
      expect(dmaBits()).to.eql({ request: 1, cmd: 1, vram: 0, block: 1, direction: 2 });
    });

  });

  describe('GPUSTAT DMA bits during VRAM transfers', () => {

    const dmaBits = () => {
      const s = stat();
      return { request: (s >> 25) & 1, cmd: (s >> 26) & 1, vram: (s >> 27) & 1, block: (s >> 28) & 1, direction: (s >> 29) & 3 };
    };

    // GP0(A0h) 2x2 at 0,0: four pixels in two data words
    const startUpload = () => { gp0(0xa0000000); gp0(0x00000000); gp0(0x00020002); };
    // GP0(C0h) 2x2 at 0,0: four pixels in two GPUREAD words
    const startReadback = () => { gp0(0xc0000000); gp0(0x00000000); gp0(0x00020002); };

    it('should stay ready for a DMA block while GP0(A0h) waits for its data', async () => {
      gp1(0x04000002);
      startUpload();
      expect(dmaBits()).to.eql({ request: 1, cmd: 0, vram: 0, block: 1, direction: 2 });
    });

    it('should be ready for commands again once the GP0(A0h) data has arrived', async () => {
      gp1(0x04000002);
      startUpload();
      gp0(0x00000000); gp0(0x00000000);
      expect(dmaBits()).to.eql({ request: 1, cmd: 1, vram: 0, block: 1, direction: 2 });
    });

    it('should not be ready for a DMA block while GP0(C0h) data waits in GPUREAD', async () => {
      gp1(0x04000003);
      startReadback();
      expect(dmaBits()).to.eql({ request: 1, cmd: 1, vram: 1, block: 0, direction: 3 });
    });

    it('should be ready for a DMA block once the GP0(C0h) data has been read', async () => {
      gp1(0x04000003);
      startReadback();
      gpu.rd32r1810(); gpu.rd32r1810();
      expect(dmaBits()).to.eql({ request: 0, cmd: 1, vram: 0, block: 1, direction: 3 });
    });

    it('should keep the DMA direction on GP1(01h)', async () => {
      gp1(0x04000002);
      gp1(0x01000000);
      expect(dmaBits()).to.eql({ request: 1, cmd: 1, vram: 0, block: 1, direction: 2 });
    });

    it('should end a pending GP0(A0h) transfer on GP1(01h)', async () => {
      startUpload();
      gp1(0x01000000);
      writeE1(0x00f);                                    // a command, not pixel data
      expect(stat() & 0x0f).to.eql(0x0f);
      expect(dmaBits().cmd).to.eql(1);
    });

    it('should end a pending GP0(C0h) readback on GP1(01h)', async () => {
      startReadback();
      gp1(0x01000000);
      expect(dmaBits().vram).to.eql(0);
    });

  });

})
