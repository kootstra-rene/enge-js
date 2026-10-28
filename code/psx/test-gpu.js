mdlr('enge:psx:test-gpu', () => {

  // GPU helpers for the specs, on a test machine (enge:psx:test-machine):
  // common/hardware/gpu.h and the raster helpers of the nugget GPU tests
  // (tests/gpu-raster-phase1/raster-helpers.h), with the same names, so the
  // ported test bodies read like the originals. Polling loops wait in
  // emulated time and give up after `POLL_CYCLES`.
  //
  //   const g = gpuHelpers(m);
  //   g.rasterReset();
  //   g.rasterFillRect(0, 0, 16, 1, g.RASTER_SENTINEL);
  //   g.rasterReadPixel(0, 0);  // 0xdead

  const POLL_CYCLES = 1000000;

  const GPU_DATA = 0x1f801810, GPU_STATUS = 0x1f801814;
  const IREG = 0x1f801070, IMASK = 0x1f801074;
  const DPCR = 0x1f8010f0, DICR = 0x1f8010f4;
  const MADR = ch => 0x1f801080 + 16 * ch, BCR = ch => MADR(ch) + 4, CHCR = ch => MADR(ch) + 8;

  const RASTER_DRAW_AREA_X1 = 0, RASTER_DRAW_AREA_Y1 = 0;
  const RASTER_DRAW_AREA_X2 = 1024, RASTER_DRAW_AREA_Y2 = 512;
  const RASTER_SENTINEL = 0xdead;

  const xy = (x, y) => (((y & 0xffff) << 16) | (x & 0xffff)) >>> 0;

  const rasterCmdColor = (r5, g5, b5) => (((r5 & 0x1f) << 3) | (((g5 & 0x1f) << 3) << 8) | (((b5 & 0x1f) << 3) << 16)) >>> 0;
  const rasterVram555 = (r5, g5, b5) => ((r5 & 0x1f) | ((g5 & 0x1f) << 5) | ((b5 & 0x1f) << 10));

  // display mode fields (gpu.h)
  const HR_256 = 0, HR_320 = 1, HR_512 = 2, HR_640 = 3;
  const VR_240 = 0, VR_480 = 1;
  const VM_NTSC = 0, VM_PAL = 1;
  const CD_15BITS = 0, CD_24BITS = 1;
  const VI_OFF = 0, VI_ON = 1;
  const HRE_NORMAL = 0, HRE_368 = 1;

  const gpuHelpers = (m) => {
    const r32 = addr => m.read32(addr) >>> 0;
    const w32 = (addr, value) => m.write32(addr, value >> 0);

    // while (cond()) {} with a cycle budget; true when the condition cleared
    const pollWhile = (cond, cycles = POLL_CYCLES) => m.idleUntil(() => !cond(), cycles, 16) >= 0;

    const g = {
      GPU_DATA, GPU_STATUS, IREG, IMASK, DPCR, DICR, MADR, BCR, CHCR,
      RASTER_DRAW_AREA_X1, RASTER_DRAW_AREA_Y1, RASTER_DRAW_AREA_X2, RASTER_DRAW_AREA_Y2,
      RASTER_SENTINEL,
      HR_256, HR_320, HR_512, HR_640, VR_240, VR_480, VM_NTSC, VM_PAL, CD_15BITS, CD_24BITS, VI_OFF, VI_ON, HRE_NORMAL, HRE_368,
      rasterCmdColor, rasterVram555,
      RASTER_CMD_RED: rasterCmdColor(0x1f, 0, 0), RASTER_VRAM_RED: rasterVram555(0x1f, 0, 0),
      RASTER_CMD_GREEN: rasterCmdColor(0, 0x1f, 0), RASTER_VRAM_GREEN: rasterVram555(0, 0x1f, 0),
      RASTER_CMD_BLUE: rasterCmdColor(0, 0, 0x1f), RASTER_VRAM_BLUE: rasterVram555(0, 0, 0x1f),
      RASTER_CMD_WHITE: rasterCmdColor(0x1f, 0x1f, 0x1f), RASTER_VRAM_WHITE: rasterVram555(0x1f, 0x1f, 0x1f),

      gpuStatus: () => r32(GPU_STATUS),
      gpuRead: () => r32(GPU_DATA),
      gpuWrite: v => w32(GPU_DATA, v),
      pollWhile,

      // gpu.h
      waitGPU: () => pollWhile(() => (r32(GPU_STATUS) & 0x04000000) === 0),
      sendGPUData: v => { g.waitGPU(); w32(GPU_DATA, v); },
      sendGPUStatus: v => w32(GPU_STATUS, v),
      setDisplayMode: ({ hResolution = HR_320, vResolution = VR_240, videoMode = VM_NTSC, colorDepth = CD_15BITS, videoInterlace = VI_OFF, hResolutionExtended = HRE_NORMAL } = {}) =>
        g.sendGPUStatus(0x08000000 | hResolution | (vResolution << 2) | (videoMode << 3) | (colorDepth << 4) | (videoInterlace << 5) | (hResolutionExtended << 6)),
      setDisplayArea: (x, y) => g.sendGPUStatus(0x05000000 | x | (y << 10)),
      setHorizontalRange: (x1, x2) => g.sendGPUStatus(0x06000000 | (x1 + 0x260) | ((x1 + x2 + 0x260) << 12)),
      setVerticalRange: (y1, y2) => g.sendGPUStatus(0x07000000 | y1 | (y2 << 10)),
      setDrawingArea: (x1, y1, x2, y2) => {
        g.sendGPUData(0xe3000000 | x1 | (y1 << 10));
        g.sendGPUData(0xe4000000 | (x2 - 1) | ((y2 - 1) << 10));
      },
      setDrawingOffset: (x, y) => g.sendGPUData(0xe5000000 | (x & 0x7ff) | ((y & 0x7ff) << 11)),
      fastFill: ({ c: { r = 0, g: gg = 0, b = 0 } = {}, x, y, w, h }) => g.send(0x02000000 | r | (gg << 8) | (b << 16), x | (y << 16), w | (h << 16)),
      enableDisplay: () => g.sendGPUStatus(0x03000000),
      disableDisplay: () => g.sendGPUStatus(0x03000001),

      // raster-helpers.h
      rasterFullReset() {
        w32(IMASK, 0);
        w32(IREG, 0);
        for (let i = 0; i < 7; ++i) { w32(CHCR(i), 0); w32(BCR(i), 0); w32(MADR(i), 0); }
        w32(DPCR, 0x800);
        w32(DICR, r32(DICR));
        w32(DICR, 0);
        w32(GPU_STATUS, 0);
        g.setDisplayMode({ hResolution: HR_320, vResolution: VR_240, videoMode: VM_NTSC, colorDepth: CD_15BITS, videoInterlace: VI_OFF, hResolutionExtended: HRE_NORMAL });
        g.setHorizontalRange(0, 0xa00);
        g.setVerticalRange(16, 255);
        g.setDisplayArea(0, 0);
        g.sendGPUStatus(0x04000001);
        g.setDrawingArea(RASTER_DRAW_AREA_X1, RASTER_DRAW_AREA_Y1, RASTER_DRAW_AREA_X2, RASTER_DRAW_AREA_Y2);
        g.setDrawingOffset(0, 0);
        g.sendGPUData(0xe2000000);
        g.sendGPUData(0xe6000000);
        g.sendGPUData(0xe1000400);
      },
      rasterReset() {
        g.sendGPUStatus(0x00000000);
        g.sendGPUStatus(0x04000001);
        g.setDrawingArea(RASTER_DRAW_AREA_X1, RASTER_DRAW_AREA_Y1, RASTER_DRAW_AREA_X2, RASTER_DRAW_AREA_Y2);
        g.setDrawingOffset(0, 0);
        g.sendGPUData(0xe2000000);
        g.sendGPUData(0xe6000000);
        g.sendGPUData(0xe1000400);
      },
      rasterStreamPace: idx => { if ((idx & 7) === 0) pollWhile(() => (r32(GPU_STATUS) & 0x02000000) === 0); },
      rasterFillRect(x, y, w, h, value) {
        g.waitGPU();
        w32(GPU_DATA, 0xa0000000);
        w32(GPU_DATA, xy(x, y));
        w32(GPU_DATA, xy(w, h));
        const doubled = (value | (value << 16)) >>> 0;
        const words = (w * h) >> 1;
        for (let i = 0; i < words; ++i) {
          g.rasterStreamPace(i);
          w32(GPU_DATA, doubled);
        }
      },
      rasterReadPixel(x, y) {
        g.waitGPU();
        w32(GPU_DATA, 0xc0000000);
        w32(GPU_DATA, xy(x, y));
        w32(GPU_DATA, xy(2, 1));
        pollWhile(() => (r32(GPU_STATUS) & 0x08000000) === 0);
        return r32(GPU_DATA) & 0xffff;
      },
      rasterReadStrip(x, y, w, dst = new Array(w).fill(0)) {
        g.waitGPU();
        w32(GPU_DATA, 0xc0000000);
        w32(GPU_DATA, xy(x, y));
        w32(GPU_DATA, xy(w, 1));
        const words = (w + 1) >> 1;
        for (let i = 0; i < words; ++i) {
          pollWhile(() => (r32(GPU_STATUS) & 0x08000000) === 0);
          const word = r32(GPU_DATA);
          dst[i * 2] = word & 0xffff;
          if (i * 2 + 1 < w) dst[i * 2 + 1] = word >>> 16;
        }
        return dst;
      },
      rasterClearTestRegion: (x, y, w, h) => g.rasterFillRect(x, y, w, h, RASTER_SENTINEL),

      // primitives: one waitGPU() before the command, none between words
      send(...words) {
        g.waitGPU();
        for (const word of words) w32(GPU_DATA, word >>> 0);
      },
      rasterFlatTri: (c, x0, y0, x1, y1, x2, y2) => g.send(0x20000000 | (c & 0xffffff), xy(x0, y0), xy(x1, y1), xy(x2, y2)),
      rasterFlatTriSemi: (c, x0, y0, x1, y1, x2, y2) => g.send(0x22000000 | (c & 0xffffff), xy(x0, y0), xy(x1, y1), xy(x2, y2)),
      rasterFlatQuad: (c, x0, y0, x1, y1, x2, y2, x3, y3) => g.send(0x28000000 | (c & 0xffffff), xy(x0, y0), xy(x1, y1), xy(x2, y2), xy(x3, y3)),
      rasterFlatQuadSemi: (c, x0, y0, x1, y1, x2, y2, x3, y3) => g.send(0x2a000000 | (c & 0xffffff), xy(x0, y0), xy(x1, y1), xy(x2, y2), xy(x3, y3)),
      rasterFlatRect: (c, x, y, w, h) => g.send(0x60000000 | (c & 0xffffff), xy(x, y), xy(w, h)),
      rasterFlatRectSemi: (c, x, y, w, h) => g.send(0x62000000 | (c & 0xffffff), xy(x, y), xy(w, h)),
      rasterFlatLine: (c, x0, y0, x1, y1) => g.send(0x40000000 | (c & 0xffffff), xy(x0, y0), xy(x1, y1)),
      rasterFlatLineSemi: (c, x0, y0, x1, y1) => g.send(0x42000000 | (c & 0xffffff), xy(x0, y0), xy(x1, y1)),
      rasterGouraudLine: (c0, x0, y0, c1, x1, y1) => g.send(0x50000000 | (c0 & 0xffffff), xy(x0, y0), c1 & 0xffffff, xy(x1, y1)),
      rasterFlatPolyline3: (c, x0, y0, x1, y1, x2, y2) => g.send(0x48000000 | (c & 0xffffff), xy(x0, y0), xy(x1, y1), xy(x2, y2), 0x55555555),
      rasterGouraudTri: (c0, x0, y0, c1, x1, y1, c2, x2, y2) =>
        g.send(0x30000000 | (c0 & 0xffffff), xy(x0, y0), c1 & 0xffffff, xy(x1, y1), c2 & 0xffffff, xy(x2, y2)),
      rasterSetAbr: abr => g.sendGPUData(0xe1000400 | ((abr & 3) << 5)),
      rasterSetMaskCtrl: (setMask, checkMask) => g.sendGPUData(0xe6000000 | (setMask & 1) | ((checkMask & 1) << 1)),
      rasterSetDither: on => g.sendGPUData(on ? 0xe1000600 : 0xe1000400),
      rasterFlushPrimitive: () => g.waitGPU(),
    };
    return g;
  };

  return { gpuHelpers, xy };
})
