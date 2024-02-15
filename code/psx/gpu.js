mdlr('enge:psx:gpu', m => {

  const $renderer = renderer;
  const [drawLine, drawTriangle, drawRectangle, setDrawAreaOF] = [$renderer.drawLine, $renderer.drawTriangle, $renderer.drawRectangle, $renderer.setDrawAreaOF].map(a => a.bind($renderer));

  const missing = new Set;
  const handlers = [];

  const dmaBuffer = new Int32Array(4096);

  const renderTexture = (data, cb) => {
    const packetId = data[0] >>> 24;

    if ((packetId & 6) === 6) {
      data[0] |= 0x80000000;
      cb();

      nextPrimitive();
      data[0] &= ~0x02000000;
      cb();
    }
    else {
      cb();
    }
  }

  const packetSizes = [
    0x01, 0x01, 0x03, 0x01, 0x01, 0x01, 0x01, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x04, 0x04, 0x04, 0x04, 0x07, 0x07, 0x07, 0x07, 0x05, 0x05, 0x05, 0x05, 0x09, 0x09, 0x09, 0x09,
    0x06, 0x06, 0x06, 0x06, 0x09, 0x09, 0x09, 0x09, 0x08, 0x08, 0x08, 0x08, 0x0C, 0x0C, 0x0C, 0x0C,

    0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
    0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05,
    0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x02, 0x02, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00,
    0x02, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x02, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03,

    0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
    0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
    0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
    0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,

    0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
    0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
    0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
  ];

  let dmaIndex = 0;

  let gpu = {
    dispB: 256,
    dispL: 0,
    dispR: 0,
    dispT: 16,
    dispX: 0,
    dispY: 0,
    dispW: 0,
    drawAreaX1: 0,
    drawAreaX2: 0,
    drawAreaY1: 0,
    drawAreaY2: 0,
    heights: [1, 2, 1, 2],
    hline: 0,
    img: { w: 0, h: 0, x: 0, y: 0, index: 0, pixelCount: 0, buffer: new Uint16Array(1024 * 512) },
    info: new Uint32Array(16),
    maxheights: [240, 480, 256, 512],
    maxwidths: [256, 368, 320, 368, 512, 368, 640, 368],
    packetSize: 0,
    result: 2,
    status: 0x14802000,
    tp: 0,
    transferTotal: 0,
    twin: 0,
    tx: 0,
    txflip: 0,
    ty: 0,
    tyflip: 0,
    widths: [10, 7, 8, 7, 5, 7, 4, 7],
    frame: 0,
    internalFrame: 0,
    updated: false,

    cyclesToDotClock: function (cycles) {
      switch ((gpu.status >> 16) & 7) {
        case 0: return +(cycles * 11.0 / 7.0 / 10.0);
        case 1: return +(cycles * 11.0 / 7.0 / 7.0);
        case 2: return +(cycles * 11.0 / 7.0 / 8.0);
        case 3: return +(cycles * 11.0 / 7.0 / 7.0);
        case 4: return +(cycles * 11.0 / 7.0 / 5.0);
        case 5: return +(cycles * 11.0 / 7.0 / 7.0);
        case 6: return +(cycles * 11.0 / 7.0 / 4.0);
        case 7: return +(cycles * 11.0 / 7.0 / 7.0);
      }
    },

    getDisplayArea: function () {
      if ((gpu.status >> 20) & 1) {
        var t = gpu.dispT % 256; var b = Math.min(gpu.dispB, 314);
      }
      else {
        var t = gpu.dispT % 240; var b = Math.min(gpu.dispB, 263);
      }
      var dispH = b - t;
      var dispW = gpu.dispR - gpu.dispL;

      var maxwidth = gpu.maxwidths[(gpu.status >> 16) & 7];
      var width = dispW / gpu.widths[(gpu.status >> 16) & 7];
      width = Math.min(maxwidth, (width + 2) & ~3);

      var maxheight = gpu.maxheights[(gpu.status >> 19) & 3];
      var height = gpu.heights[(gpu.status >> 19) & 3] * dispH;
      height = Math.min(maxheight, height);

      return { x: gpu.dispX, y: gpu.dispY, w: width, h: height };
    },

    onScanLine: function (scanline) {
      gpu.hline = scanline;
      let interlaced = gpu.status & (1 << 22);
      let PAL = ((gpu.status >> 20) & 1) ? true : false;
      let vsync = PAL ? 314 : 263;
      let halfheight = (gpu.dispB - gpu.dispT) >> 1;
      let center = PAL ? 163 : 136;
      let vblankend = center - halfheight;
      let vblankbegin = center + halfheight;
      if (vblankbegin > vsync) vblankbegin = vsync;
      if (vblankend < 0) vblankend = 0;

      if (interlaced) {
        if ((gpu.frame & 1) === 1) {
          gpu.status |= 0x80000000;
        }
        else {
          gpu.status &= 0x7fffffff;
        }
      }
      else {
        const oddLine = gpu.hline + (gpu.frame & 1); // toggle even/odd on every frame
        if ((oddLine & 1) === 1) {
          gpu.status |= 0x80000000;
        }
        else {
          gpu.status &= 0x7fffffff;
        }
      }
      if (gpu.hline === vblankbegin) {
        renderer.onVBlankBegin();
      }
      if (gpu.hline === vblankend) {
        renderer.onVBlankEnd();
      }
      if ((gpu.hline >= vblankbegin) || (gpu.hline < vblankend)) {
        // always even during vlbank.
        gpu.status &= 0x7fffffff;
      }
      if (++gpu.hline >= vsync) {
        if (gpu.updated) {
          ++gpu.internalFrame;
        }
        gpu.updated = false;
        cpu.istat |= 0x0001;
        gpu.hline = 0;
        ++gpu.frame;
      }
    },

    rd32r1810: function () {
      if (gpu.rR1814 & 0x08000000) {
        abort('gpu.rd32r1810 not implemented');
      }
      return gpu.result;
    },

    rd32r1814: function () {
      return gpu.status;
    },

    wr32r1810: data => {
      if (gpu.status & 0x10000000) {
        dmaBuffer[dmaIndex++] = data;

        if (dmaIndex === 1) {
          gpu.packetSize = packetSizes[data >>> 24];
        }

        if (dmaIndex === gpu.packetSize) {
          var packetId = dmaBuffer[0] >>> 24;
          nextPrimitive();
          handlers[packetId].call(gpu, dmaBuffer);
          dmaIndex = 0;
        }
      }
      else {
        gpu.img.buffer[gpu.img.index++] = (data >>> 0) & 0xffff;
        if (--gpu.transferTotal <= 0) { gpu.imgTransferComplete(gpu.img); return; }

        gpu.img.buffer[gpu.img.index++] = (data >>> 16) & 0xffff;
        if (--gpu.transferTotal <= 0) { gpu.imgTransferComplete(gpu.img); return; }
      }
    },

    wr32r1814: data => {
      switch (data >>> 24) {
        case 0x00: gpu.status = 0x14820000;
          dmaIndex = 0;
          /*
            GP1(01h)      ;clear fifo
            GP1(02h)      ;ack irq (0)
            GP1(03h)      ;display off (1)
            GP1(04h)      ;dma off (0)
            GP1(05h)      ;display address (0)
            GP1(06h)      ;display x1,x2 (x1=200h, x2=200h+256*10)
            GP1(07h)      ;display y1,y2 (y1=010h, y2=010h+240)
            GP1(08h)      ;display mode 320x200 NTSC (0)
            GP0(E1h..E6h) ;rendering attributes (0)
          */

          gpu.dispL = 512;
          gpu.dispR = 512 + 2560;
          gpu.dispW = 320;
          gpu.dispT = 16;
          gpu.dispB = 256;
          gpu.dispX = 0;
          gpu.dispY = 0;
          gpu.pcktE1([0]);
          gpu.pcktE2([0]);
          gpu.pcktE3([0]);
          gpu.pcktE4([0]);
          gpu.pcktE5([0]);
          gpu.pcktE6([0]);
          renderer.updateDrawArea?.call(renderer);
          break;
        case 0x01: gpu.status |= 0x70000000;
          dmaIndex = 0;
          break;
        case 0x02: break;
        case 0x03: gpu.status &= 0xFF7FFFFF;
          gpu.status |= ((data & 0x01) << 0x17);
          break;
        case 0x04: gpu.status &= 0x9FFFFFFF;
          gpu.status |= ((data & 0x03) << 0x1D);
          break;
        case 0x05: gpu.dispX = (data >> 0) & 0x3FF;
          gpu.dispY = (data >> 10) & 0x1FF;
          break;
        case 0x06: gpu.dispL = (data >> 0) & 0xFFF;
          gpu.dispR = (data >> 12) & 0xFFF;
          var dispW = gpu.dispR - gpu.dispL;

          var maxwidth = gpu.maxwidths[(gpu.status >> 16) & 7];
          var width = dispW / gpu.widths[(gpu.status >> 16) & 7];
          gpu.dispW = Math.min(maxwidth, (width + 2) & ~3);
          break;
        case 0x07: gpu.dispT = (data >> 0) & 0x3FF;
          gpu.dispB = (data >> 10) & 0x3FF;
          if (gpu.dispB < gpu.dispT) gpu.dispB += 288;
          break;
        case 0x08:
          gpu.status &= 0xFF80FFFF;
          gpu.status |= ((data & 0x3F) << 0x11);
          gpu.status |= ((data & 0x40) ? 0x010000 : 0x000000);
          break;
        case 0x10:
          gpu.result = gpu.info[data & 0xf];
          break;
        case 0x40: break; // ???
        default: console.warn('gpu.cmnd' + hex(data >>> 24, 2));
      }
      // gpu.updateTexturePage();
    },

    invalidPacketHandler: data => {
      // abort('gpu.' + gpu.getPacketHandlerName(data));
    },

    updateTexturePage: function (bitfield) {
      if (bitfield !== undefined) gpu.status = (gpu.status & ~0x9FF) | (bitfield & 0x9FF);

      gpu.tx = ((gpu.status >>> 0) & 15) << 6;
      gpu.ty = ((gpu.status >>> 4) & 1) << 8;
      gpu.tp = ((gpu.status >>> 7) & 3);
      switch (gpu.tp) {
        case 0: gpu.tx <<= 2; break;
        case 1: gpu.tx <<= 1; break;
        case 2: gpu.tx <<= 0; break;
        case 3: gpu.tx <<= 0; break;
      }
    },

    pckt00: data => {
      // intentionally left blank
    },

    // Clear Cache
    pckt01: data => {
      gpu.status = (gpu.status | 0x10000000) & ~0x08000000;
    },

    // Framebuffer Rectangle draw
    pckt02: data => {
      renderer.fillRectangle(data);
    },

    pckt03: data => {
      // intentionally left blank
    },
    pckt04: data => {
      // intentionally left blank
    },
    pckt05: data => {
      // intentionally left blank
    },
    pckt08: data => {
      // intentionally left blank
    },
    pckt09: data => {
      // intentionally left blank
    },

    pckt0D: data => {
      // intentionally left blank
    },

    // Monochrome 3 point polygon
    pckt20: data => {
      drawTriangle(data, 0, 1, 0, 2, 0, 3);
    },

    // Textured 3 point polygon
    pckt24: data => {
      gpu.updateTexturePage(data[4] >>> 16);

      renderTexture(data, () => {
        drawTriangle(data, 0, 1, 0, 3, 0, 5, gpu.tx, gpu.ty, 2, 4, 6, data[2] >>> 16);
      });
    },

    // Monochrome 4 point polygon
    pckt28: data => {
      drawTriangle(data, 0, 1, 0, 2, 0, 3);
      drawTriangle(data, 0, 2, 0, 3, 0, 4);
    },

    // Textured 4 point polygon
    pckt2C: data => {
      gpu.updateTexturePage(data[4] >>> 16);

      renderTexture(data, () => {
        drawTriangle(data, 0, 1, 0, 3, 0, 5, gpu.tx, gpu.ty, 2, 4, 6, data[2] >>> 16);
        drawTriangle(data, 0, 3, 0, 5, 0, 7, gpu.tx, gpu.ty, 4, 6, 8, data[2] >>> 16);
      });
    },

    // Gradated 3 point polygon
    pckt30: data => {
      drawTriangle(data, 0, 1, 2, 3, 4, 5);
    },

    // Gradated textured 3 point polygon
    pckt34: data => {
      gpu.updateTexturePage(data[5] >>> 16);

      renderTexture(data, () => {
        drawTriangle(data, 0, 1, 3, 4, 6, 7, gpu.tx, gpu.ty, 2, 5, 8, data[2] >>> 16);
      });
    },

    // Gradated 4 point polygon
    pckt38: data => {
      drawTriangle(data, 0, 1, 2, 3, 4, 5);
      drawTriangle(data, 2, 3, 4, 5, 6, 7);
    },

    // Gradated textured 4 point polygon
    pckt3C: data => {
      gpu.updateTexturePage(data[5] >>> 16);

      renderTexture(data, () => {
        drawTriangle(data, 0, 1, 3, 4, 6, 7, gpu.tx, gpu.ty, 2, 5, 8, data[2] >>> 16);
        drawTriangle(data, 3, 4, 6, 7, 9, 10, gpu.tx, gpu.ty, 5, 8, 11, data[2] >>> 16);
      });
    },

    // Monochrome line
    pckt40: data => {
      drawLine(data, 0, 1, 0, 2);
    },

    // Monochrome polyline
    pckt48: function (data, size) {
      for (var i = 2; i < size; i += 1) {
        drawLine(data, 0, i - 1, 0, i);
      }
    },

    // Gradated line
    pckt50: data => {
      drawLine(data, 0, 1, 2, 3);
    },

    // Gradated polyline
    pckt58: function (data, size) {
      for (var i = 3; i < size; i += 2) {
        drawLine(data, i - 3, i - 2, i - 1, i);
      }
    },

    // Rectangle
    pckt60: data => {
      drawRectangle([data[0], data[1], data[2]], 0, 0, 0 >>> 0);
    },

    // Sprite
    pckt64: data => {
      const tx = (data[2] >>> 0) & 255;
      const ty = (data[2] >>> 8) & 255;

      renderTexture(data, () => {
        drawRectangle([data[0], data[1], data[3]], tx, ty, data[2] >>> 16);
      });
    },

    // Dot
    pckt68: data => {
      drawRectangle([data[0], data[1], 0x00010001], 0, 0, 0 >>> 0);
    },

    // 8*8 rectangle
    pckt70: data => {
      drawRectangle([data[0], data[1], 0x00080008], 0, 0, 0 >>> 0);
    },

    // 8*8 sprite
    pckt74: data => {
      const tx = (data[2] >>> 0) & 255;
      const ty = (data[2] >>> 8) & 255;

      renderTexture(data, () => {
        drawRectangle([data[0], data[1], 0x00080008], tx, ty, data[2] >>> 16);
      });
    },

    // 16*16 rectangle
    pckt78: data => {
      drawRectangle([data[0], data[1], 0x00100010], 0, 0, 0 >>> 0);
    },

    // 16*16 sprite
    pckt7C: data => {
      const tx = (data[2] >>> 0) & 255;
      const ty = (data[2] >>> 8) & 255;

      renderTexture(data, () => {
        drawRectangle([data[0], data[1], 0x00100010], tx, ty, data[2] >>> 16);
      });
    },

    // Move image in framebuffer
    pckt80: data => {
      if (data[1] !== data[2]) {
        var sx = (data[1] >> 0);
        var sy = (data[1] >> 16);
        var dx = (data[2] >> 0);
        var dy = (data[2] >> 16);
        var w = (data[3] >> 0);
        var h = (data[3] >> 16);
        w = ((w - 1) & 0x3ff) + 1;
        h = ((h - 1) & 0x1ff) + 1;
        dx = (dx & 0x3ff);
        dy = (dy & 0x1ff);
        sx = (sx & 0x3ff);
        sy = (sy & 0x1ff);
        if (w * h) renderer.moveImage(sx, sy, dx, dy, w, h);
      }
    },

    // Send image to frame buffer
    pcktA0: data => {
      gpu.status &= ~0x10000000;
      var x = ((data[1] << 16) >>> 16);
      var y = ((data[1] << 0) >>> 16);
      var w = ((data[2] << 16) >>> 16);
      var h = ((data[2] << 0) >>> 16);

      gpu.img.w = ((w - 1) & 0x3ff) + 1;
      gpu.img.h = ((h - 1) & 0x1ff) + 1;
      gpu.img.x = (x & 0x3ff);
      gpu.img.y = (y & 0x1ff);
      gpu.img.index = 0;
      gpu.transferTotal = ((gpu.img.w * gpu.img.h) + 1) & ~1;
      gpu.img.pixelCount = gpu.transferTotal;
    },

    // Copy image from frame buffer
    pcktC0: data => {
      gpu.status |= 0x08000000;
      var x = ((data[1] << 16) >>> 16);
      var y = ((data[1] << 0) >>> 16);
      var w = ((data[2] << 16) >>> 16);
      var h = ((data[2] << 0) >>> 16);

      gpu.img.w = ((w - 1) & 0x3ff) + 1;
      gpu.img.h = ((h - 1) & 0x1ff) + 1;
      gpu.img.x = (x & 0x3ff);
      gpu.img.y = (y & 0x1ff);
      gpu.img.index = 0;
      gpu.transferTotal = ((gpu.img.w * gpu.img.h) + 1) & ~1;
      gpu.img.pixelCount = gpu.transferTotal;

      renderer.loadImage(gpu.img.x, gpu.img.y, gpu.img.w, gpu.img.h, gpu.img.buffer);
    },

    // Draw mode setting
    pcktE1: data => {
      gpu.status = (gpu.status & 0xfffff800) | (data[0] & 0x7ff);
      gpu.txflip = (data[0] >>> 12) & 1;
      gpu.tyflip = (data[0] >>> 13) & 1;
      gpu.updateTexturePage();
    },

    // Texture window setting
    pcktE2: data => {
      gpu.info[2] = data[0] & 0x000fffff;

      var maskx = ((data[0] >> 0) & 0x1f) << 3;
      var masky = ((data[0] >> 5) & 0x1f) << 3;
      var offsx = ((data[0] >> 10) & 0x1f) << 3;
      var offsy = ((data[0] >> 15) & 0x1f) << 3;

      // Texcoord = (Texcoord AND (NOT (Mask*8))) OR ((Offset AND Mask)*8)
      const twin = (maskx << 0) + (masky << 8) + (offsx << 16) + (offsy << 24);
      gpu.twin = twin;

    },
    // Set drawing area top left
    pcktE3: data => {
      gpu.info[3] = data[0] & 0x000fffff;
      gpu.drawAreaX1 = (data[0] << 22) >>> 22;
      gpu.drawAreaY1 = (data[0] << 12) >>> 22;

      renderer.setDrawAreaTL(gpu.drawAreaX1, gpu.drawAreaY1);
    },

    // Set drawing area bottom right
    pcktE4: data => {
      gpu.info[4] = data[0] & 0x000fffff;

      gpu.drawAreaX2 = (data[0] << 22) >>> 22;
      gpu.drawAreaY2 = (data[0] << 12) >>> 22;

      renderer.setDrawAreaBR(gpu.drawAreaX2, gpu.drawAreaY2);
    },

    // Drawing offset
    pcktE5: (data) => {
      gpu.info[5] = data[0] & 0x003fffff;

      const drawOffsetX = (data[0] << 21) >> 21;
      const drawOffsetY = (data[0] << 11) >> 22;

      setDrawAreaOF(drawOffsetX, drawOffsetY);
    },

    // Mask setting
    pcktE6: data => {
      gpu.status &= 0xffffe7ff;
      gpu.status |= ((data[0] & 3) << 11);
    },

    imgTransferComplete: function (img) {
      renderer.storeImage(gpu.img);
      gpu.status |= 0x10000000;
    },

    dmaTransferMode0200: function (addr, blck) {
      if (!(addr & 0x007fffff)) return 0x10;
      var transferSize = (blck >> 16) * (blck & 0xFFFF) << 1;
      // clearCodeCache( addr, transferSize << 1); // optimistice assumption (performance reasons)

      gpu.transferTotal -= transferSize;

      const img = gpu.img;
      while (--transferSize >= 0) {
        const data = gpu.img.buffer[img.index++];
        map16[(addr & 0x001fffff) >>> 1] = data;
        addr += 2;
      }

      if (gpu.transferTotal <= 0) {
        gpu.status &= ~0x08000000;
      }

      return (blck >> 16) * (blck & 0xFFFF);
    },

    dmaTransferMode0201: function (addr, blck) {
      if (!(addr & 0x007fffff)) return 0x10;
      if ((addr & ~3) === 0) {
        return (blck >> 16) * (blck & 0xFFFF);
      }
      var transferSize = (blck >> 16) * (blck & 0xFFFF) << 1;
      gpu.transferTotal -= transferSize;

      const img = gpu.img;
      while (--transferSize >= 0) {
        const data = map16[(addr & 0x001fffff) >>> 1];
        img.buffer[img.index++] = data;
        addr += 2;
      }

      if (gpu.transferTotal <= 0) {
        gpu.imgTransferComplete(gpu.img);
        gpu.updated = true;
      }

      return (blck >> 16) * (blck & 0xFFFF);
    },

    dmaTransferMode0401: function (addr, blck) {
      if (!(addr & 0x007fffff)) return 0x10;
      if (dmaIndex !== 0) abort('not implemented')
      if ((addr & ~3) === 0) {
        return (blck >> 16) * (blck & 0xFFFF);
      }

      const seen = new Set();
      const data = dmaBuffer;
      let words = 0;
      for (; ;) {
        addr = addr & 0x001fffff;
        // seen.add(addr);
        let header = ram.getInt32(addr, true);
        dma.r10e0n = header;
        let nitem = header >>> 24;

        addr = addr + 4; ++words;

        while (nitem > 0) {
          if (seen.has(addr)) return words;
          seen.add(addr);
          const packetWord = ram.getInt32(addr, true) >>> 0;
          const packetId = packetWord >>> 24;
          if (packetSizes[packetId] === 0) {
            if (missing.has(packetId)) return words;
            missing.add(packetId);

            console.warn('invalid packetId:', hex(packetId, 2), hex(header), hex(packetWord));
            return words;
          }
          else if (((packetId >= 0x48) && (packetId < 0x50)) || ((packetId >= 0x58) && (packetId < 0x60))) {
            let i = 0;
            for (; i < 4096; ++i) {
              const value = ram.getInt32(addr, true);
              addr += 4; --nitem; ++words;

              if (value === 0x55555555) break;
              if (value === 0x50005000) break;
              data[i] = value;
            }
            if (nitem < 0) return words;
            nextPrimitive();
            handlers[packetId].call(gpu, data, i);
            gpu.updated = true;
          }
          else {
            for (var i = 0; i < packetSizes[packetId]; ++i) {
              data[i] = ram.getInt32(addr, true);
              addr += 4; --nitem;
              ++words;
            }
            if (nitem < 0) return words;
            nextPrimitive();
            handlers[packetId].call(gpu, data, 0);
            gpu.updated = true;
          }
        }
        if (header & 0x00800000) { break; } //end dma transfer
        // if (!nnext || (nnext == 0x001fffff)) break;
        addr = header & 0x001fffff;
      }

      return words;
    },

    dmaLinkedListMode0002: function (addr, blck) {
      if (!addr) return;
      if ((addr & ~3) === 0) {
        //return (blck >> 16) * (blck & 0xFFFF);
        throw 43;
      }
      if (blck >= 0x10000) abort('unexpected blck size');
      if (blck === 0) blck = 0x10000;
      addr = addr & 0x001fffff;
      let transferSize = blck;

      while (--blck >= 1) {
        const next = (addr - 4) & 0x001fffff;
        ram.setInt32(addr, next, true);
        addr = next;
      }
      ram.setInt32(addr, 0x00ffffff, true);

      // clearCodeCache(addr, transferSize << 2); // optimistice assumption (performance reasons)
      return transferSize;
    },
  }

  gpu.pckt21 = gpu.pckt20;
  gpu.pckt22 = gpu.pckt20;
  gpu.pckt23 = gpu.pckt20;

  gpu.pckt25 = gpu.pckt24;
  gpu.pckt26 = gpu.pckt24;
  gpu.pckt27 = gpu.pckt24;

  gpu.pckt29 = gpu.pckt28;
  gpu.pckt2A = gpu.pckt28;
  gpu.pckt2B = gpu.pckt28;

  gpu.pckt2D = gpu.pckt2C;
  gpu.pckt2E = gpu.pckt2C;
  gpu.pckt2F = gpu.pckt2C;

  gpu.pckt31 = gpu.pckt30;
  gpu.pckt32 = gpu.pckt30;
  gpu.pckt33 = gpu.pckt30;

  gpu.pckt35 = gpu.pckt34;
  gpu.pckt36 = gpu.pckt34;
  gpu.pckt37 = gpu.pckt34;

  gpu.pckt39 = gpu.pckt38;
  gpu.pckt3A = gpu.pckt38;
  gpu.pckt3B = gpu.pckt38;

  gpu.pckt3D = gpu.pckt3C;
  gpu.pckt3E = gpu.pckt3C;
  gpu.pckt3F = gpu.pckt3C;

  gpu.pckt41 = gpu.pckt40;
  gpu.pckt42 = gpu.pckt40;
  gpu.pckt43 = gpu.pckt40;
  gpu.pckt44 = gpu.pckt40;
  gpu.pckt45 = gpu.pckt40;
  gpu.pckt46 = gpu.pckt40;
  gpu.pckt47 = gpu.pckt40;

  gpu.pckt49 = gpu.pckt48;
  gpu.pckt4A = gpu.pckt48;
  gpu.pckt4B = gpu.pckt48;
  gpu.pckt4C = gpu.pckt48;
  gpu.pckt4D = gpu.pckt48;
  gpu.pckt4E = gpu.pckt48;
  gpu.pckt4F = gpu.pckt48;

  gpu.pckt51 = gpu.pckt50;
  gpu.pckt52 = gpu.pckt50;
  gpu.pckt53 = gpu.pckt50;
  gpu.pckt54 = gpu.pckt50;
  gpu.pckt55 = gpu.pckt50;
  gpu.pckt56 = gpu.pckt50;
  gpu.pckt57 = gpu.pckt50;

  gpu.pckt59 = gpu.pckt58;
  gpu.pckt5A = gpu.pckt58;
  gpu.pckt5B = gpu.pckt58;
  gpu.pckt5C = gpu.pckt58;
  gpu.pckt5D = gpu.pckt58;
  gpu.pckt5E = gpu.pckt58;
  gpu.pckt5F = gpu.pckt58;

  gpu.pckt61 = gpu.pckt60;
  gpu.pckt62 = gpu.pckt60;
  gpu.pckt63 = gpu.pckt60;

  gpu.pckt65 = gpu.pckt64;
  gpu.pckt66 = gpu.pckt64;
  gpu.pckt67 = gpu.pckt64;

  gpu.pckt69 = gpu.pckt68;
  gpu.pckt6A = gpu.pckt68;
  gpu.pckt6B = gpu.pckt68;

  gpu.pckt71 = gpu.pckt70;
  gpu.pckt72 = gpu.pckt70;
  gpu.pckt73 = gpu.pckt70;

  gpu.pckt75 = gpu.pckt74;
  gpu.pckt76 = gpu.pckt74;
  gpu.pckt77 = gpu.pckt74;

  gpu.pckt79 = gpu.pckt78;
  gpu.pckt7A = gpu.pckt78;
  gpu.pckt7B = gpu.pckt78;

  gpu.pckt7D = gpu.pckt7C;
  gpu.pckt7E = gpu.pckt7C;
  gpu.pckt7F = gpu.pckt7C;

  for (let i = 0; i < 256; ++i) {
    var packetHandlerName = 'pckt' + hex(i, 2).toUpperCase();
    handlers[i] = gpu[packetHandlerName] || gpu.invalidPacketHandler;
  }

  for (let i = 0x81; i <= 0x9f; ++i) {
    handlers[i] = gpu.pckt80;
  }
  for (let i = 0xA1; i <= 0xbf; ++i) {
    handlers[i] = gpu.pcktA0;
  }
  for (let i = 0xC1; i <= 0xdf; ++i) {
    handlers[i] = gpu.pcktC0;
  }

  gpu.info[7] = 2;
  gpu.info[8] = 0;

  return { gpu };
})