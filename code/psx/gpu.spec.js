mdlr('[test]enge:psx:gpu', ({ include, test }) => {

  const { describe, it, expect, beforeEach, before, after } = test;

  // Ported from ps1-tests gpu/gp0-e1 and gpu/gpustat
  // (https://github.com/JaCzekanski/ps1-tests, MIT); every case listed here
  // passes on real hardware according to the tests' psx.log.

  const globalNames = ['window', 'psx', 'cpu', 'ram', 'renderer', 'nextPrimitive', 'abort', 'hex'];
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
    globalThis.window = { location: { search: '' } };
    globalThis.abort = message => { throw new Error(`abort: ${message}`); };
    globalThis.hex = (value, length) => (value >>> 0).toString(16).padStart(length || 8, '0');
    globalThis.renderer = new Proxy({}, { get: () => () => {} });
    globalThis.nextPrimitive = () => {}; // renderer hook
  });

  after(async () => {
    for (const name of globalNames) {
      if (savedGlobals[name] === undefined) delete globalThis[name];
      else globalThis[name] = savedGlobals[name];
    }
  });

  beforeEach(async () => {
    globalThis.psx = { clock: 0, addEvent: () => ({}), setEvent: () => {}, unsetEvent: () => {}, updateEvent: () => {} };
    globalThis.cpu = { istat: 0 };
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

  describe('GPUSTAT ready for command (bit 26) while drawing', () => {

    const cmdReady = () => (stat() >> 26) & 1;
    const dmaReady = () => (stat() >> 28) & 1;

    // drawing area 0,0 - 319,239
    const setDrawArea = () => { gp0(0xe3000000); gp0(0xe4000000 | (239 << 10) | 319); };

    // POLY_F3 (GP0 20h): triangle with the given corner points
    const drawTriangle = (x0, y0, x1, y1, x2, y2) => {
      gp0(0x20ff0000);
      gp0((y0 << 16) | x0); gp0((y1 << 16) | x1); gp0((y2 << 16) | x2);
    };

    it('should clear bit 26 and keep bit 28 set right after a polygon', async () => {
      setDrawArea();
      drawTriangle(0, 0, 100, 0, 0, 100);
      expect(cmdReady()).to.eql(0);
      expect(dmaReady()).to.eql(1); // the DrawSync(1) "done" state Dukes of Hazzard waits for
    });

    it('should set bit 26 again once the draw time has passed', async () => {
      setDrawArea();
      drawTriangle(0, 0, 100, 0, 0, 100); // 5000 pixels
      psx.clock = 5000 * 7 / 11 - 1;
      expect(cmdReady()).to.eql(0);
      psx.clock = 5000 * 7 / 11;
      expect(cmdReady()).to.eql(1);
    });

    it('should add the draw time of consecutive primitives', async () => {
      setDrawArea();
      drawTriangle(0, 0, 100, 0, 0, 100);
      drawTriangle(0, 0, 100, 0, 0, 100);
      psx.clock = 5000 * 7 / 11;
      expect(cmdReady()).to.eql(0);
      psx.clock = 2 * 5000 * 7 / 11;
      expect(cmdReady()).to.eql(1);
    });

    it('should not count pixels outside the drawing area', async () => {
      gp0(0xe3000000); gp0(0xe4000000 | (9 << 10) | 9); // 10x10
      drawTriangle(0, 0, 1000, 0, 0, 500);
      psx.clock = 100 * 7 / 11;
      expect(cmdReady()).to.eql(1);
    });

    it('should be busy after a fill', async () => {
      gp0(0x02000000); gp0(0x00000000); gp0((240 << 16) | 320);
      psx.clock = (46 + (320 / 8 + 9) * 240) * 7 / 11 - 1;
      expect(cmdReady()).to.eql(0);
      psx.clock += 1;
      expect(cmdReady()).to.eql(1);
    });

    it('should not be busy after drawing mode commands', async () => {
      setDrawArea();
      gp0(0xe1000000); gp0(0xe5000000);
      expect(cmdReady()).to.eql(1);
    });

    it('should be ready again after GP1(00h) reset', async () => {
      setDrawArea();
      drawTriangle(0, 0, 100, 0, 0, 100);
      gp1(0x00000000);
      expect(cmdReady()).to.eql(1);
    });

  });

})
