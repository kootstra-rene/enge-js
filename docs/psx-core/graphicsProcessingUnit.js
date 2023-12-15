(scope => {

  'use strict';

  const missing = new Set;

  var packetSizes = [
    0x01, 0x01, 0x03, 0x01, 0x01, 0x01, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
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
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ];

  const gpu = {
    dispB: 256,
    dispL: 0,
    dispR: 0,
    dispT: 16,
    dispX: 0,
    dispY: 0,
    dmaBuffer: new Int32Array(4096),
    dmaIndex: 0,
    drawOffsetX: 0,
    drawOffsetY: 0,
    handlers: [],
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

    wr32r1810: function (data) {
      if (gpu.status & 0x10000000) {
        gpu.dmaBuffer[gpu.dmaIndex++] = data;

        if (gpu.dmaIndex === 1) {
          gpu.packetSize = packetSizes[data >>> 24];
        }

        if (gpu.dmaIndex === gpu.packetSize) {
          var packetId = gpu.dmaBuffer[0] >>> 24;
          gpu.handlers[packetId].call(this, gpu.dmaBuffer);
          gpu.dmaIndex = 0;
        }
      }
      else {
        gpu.img.buffer[gpu.img.index++] = (data >>> 0) & 0xffff;
        if (--gpu.transferTotal <= 0) { gpu.imgTransferComplete(gpu.img); return; }

        gpu.img.buffer[gpu.img.index++] = (data >>> 16) & 0xffff;
        if (--gpu.transferTotal <= 0) { gpu.imgTransferComplete(gpu.img); return; }
      }
    },

    wr32r1814: function (data) {
      switch (data >>> 24) {
        case 0x00: gpu.status = 0x14802000;
          gpu.dmaIndex = 0;
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
          gpu.dispT = 16;
          gpu.dispB = 256;
          gpu.dispX = 0;
          gpu.dispY = 0;
          break;
        case 0x01: gpu.status |= 0x70000000;
          gpu.dmaIndex = 0;
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
          break;
        case 0x07: gpu.dispT = (data >> 0) & 0x3FF;
          gpu.dispB = (data >> 10) & 0x3FF;
          break;
        case 0x08: gpu.status &= 0xFF80FFFF;
          gpu.status |= ((data & 0x3F) << 0x11);
          gpu.status |= ((data & 0x40) ? 0x010000 : 0x000000);
          break;
        case 0x10:
          switch (data & 0xf) {
            case 0x02:
            case 0x03:
            case 0x04:
            case 0x05:
            case 0x07:
            case 0x08:
              gpu.result = gpu.info[data & 0xf];
              break;
          }
          break;
        case 0x40: break; // ???
        default: console.warn('gpu.cmnd' + hex(data >>> 24, 2));
      }
      gpu.updateTexturePage();
    },

    invalidPacketHandler: function (data) {
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

    handlePacket00: function (data) {
      // intentionally left blank
    },

    // Clear Cache
    handlePacket01: function (data) {
      gpu.status = (gpu.status | 0x10000000) & ~0x08000000;
    },

    // Framebuffer Rectangle draw
    handlePacket02: function (data) {
      var x = (data[1] << 16) >>> 16;
      var y = (data[1] << 0) >>> 16;
      var w = (data[2] << 16) >>> 16;
      var h = (data[2] << 0) >>> 16;
      var c = (data[0] & 0x00ffffff);

      x = (x & 0x3f0);
      y = (y & 0x1ff);
      w = ((w & 0x3ff) + 15) & ~15;
      h = (h & 0x1ff);
      if (!w && !h) return;

      renderer.clearImage(x, y, w, h, c);
    },

    handlePacket03: function (data) {
      // intentionally left blank
    },
    handlePacket04: function (data) {
      // intentionally left blank
    },
    handlePacket05: function (data) {
      // intentionally left blank
    },
    handlePacket08: function (data) {
      // intentionally left blank
    },
    handlePacket09: function (data) {
      // intentionally left blank
    },

    handlePacket0D: function (data) {
      // intentionally left blank
    },

    // Monochrome 3 point polygon
    handlePacket20: function (data) {
      renderer.drawTriangle(data, 0, 1, 0, 2, 0, 3);
    },

    // Textured 3 point polygon
    handlePacket24: function (data) {
      gpu.updateTexturePage(data[4] >>> 16);

      renderer.drawTriangle(data, 0, 1, 0, 3, 0, 5, gpu.tx, gpu.ty, 2, 4, 6, data[2] >>> 16);
    },

    // Monochrome 4 point polygon
    handlePacket28: function (data) {
      renderer.drawTriangle(data, 0, 1, 0, 2, 0, 3);
      renderer.drawTriangle(data, 0, 2, 0, 3, 0, 4);
    },

    // Textured 4 point polygon
    handlePacket2C: function (data) {
      gpu.updateTexturePage(data[4] >>> 16);

      renderer.drawTriangle(data, 0, 1, 0, 3, 0, 5, gpu.tx, gpu.ty, 2, 4, 6, data[2] >>> 16);
      renderer.drawTriangle(data, 0, 3, 0, 5, 0, 7, gpu.tx, gpu.ty, 4, 6, 8, data[2] >>> 16);
    },

    // Gradated 3 point polygon
    handlePacket30: function (data) {
      renderer.drawTriangle(data, 0, 1, 2, 3, 4, 5);
    },

    // Gradated textured 3 point polygon
    handlePacket34: function (data) {
      gpu.updateTexturePage(data[5] >>> 16);

      renderer.drawTriangle(data, 0, 1, 3, 4, 6, 7, gpu.tx, gpu.ty, 2, 5, 8, data[2] >>> 16);
    },

    // Gradated 4 point polygon
    handlePacket38: function (data) {
      renderer.drawTriangle(data, 0, 1, 2, 3, 4, 5);
      renderer.drawTriangle(data, 2, 3, 4, 5, 6, 7);
    },

    // Gradated textured 4 point polygon
    handlePacket3C: function (data) {
      gpu.updateTexturePage(data[5] >>> 16);

      renderer.drawTriangle(data, 0, 1, 3, 4, 6, 7, gpu.tx, gpu.ty, 2, 5, 8, data[2] >>> 16);
      renderer.drawTriangle(data, 3, 4, 6, 7, 9, 10, gpu.tx, gpu.ty, 5, 8, 11, data[2] >>> 16);
    },

    // Monochrome line
    handlePacket40: function (data) {
      // renderer.drawLine(data, 0, 1, 0, 2);
    },

    // Monochrome polyline
    handlePacket48: function (data, size) {
      // for (var i = 2; i < size; i += 1) {
      //   renderer.drawLine(data, 0, i - 1, 0, i);
      // }
    },

    // Gradated line
    handlePacket50: function (data) {
      // renderer.drawLine(data, 0, 1, 2, 3);
    },

    // Gradated polyline
    handlePacket58: function (data, size) {
      // for (var i = 3; i < size; i += 2) {
      //   renderer.drawLine(data, i - 3, i - 2, i - 1, i);
      // }
    },

    // Rectangle
    handlePacket60: function (data) {
      renderer.drawRectangle([data[0], data[1], data[2]], 0, 0, 0 >>> 0);
    },

    // Sprite
    handlePacket64: function (data) {
      const tx = (data[2] >>> 0) & 255;
      const ty = (data[2] >>> 8) & 255;

      renderer.drawRectangle([data[0], data[1], data[3]], tx, ty, data[2] >>> 16);
    },

    // Dot
    handlePacket68: function (data) {
      renderer.drawRectangle([data[0], data[1], 0x00010001], 0, 0, 0 >>> 0);
    },

    // 8*8 rectangle
    handlePacket70: function (data) {
      renderer.drawRectangle([data[0], data[1], 0x00080008], 0, 0, 0 >>> 0);
    },

    // 8*8 sprite
    handlePacket74: function (data) {
      const tx = (data[2] >>> 0) & 255;
      const ty = (data[2] >>> 8) & 255;

      renderer.drawRectangle([data[0], data[1], 0x00080008], tx, ty, data[2] >>> 16);
    },

    // 16*16 rectangle
    handlePacket78: function (data) {
      renderer.drawRectangle([data[0], data[1], 0x00100010], 0, 0, 0 >>> 0);
    },

    // 16*16 sprite
    handlePacket7C: function (data) {
      const tx = (data[2] >>> 0) & 255;
      const ty = (data[2] >>> 8) & 255;

      renderer.drawRectangle([data[0], data[1], 0x00100010], tx, ty, data[2] >>> 16);
    },

    // Move image in framebuffer
    handlePacket80: function (data) {
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
    handlePacketA0: function (data) {
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
    handlePacketC0: function (data) {
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
    handlePacketE1: function (data) {
      gpu.status = (gpu.status & 0xfffff800) | (data[0] & 0x7ff);
      gpu.txflip = (data[0] >>> 12) & 1;
      gpu.tyflip = (data[0] >>> 13) & 1;
      gpu.updateTexturePage();
    },

    // Texture window setting
    handlePacketE2: function (data) {
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
    handlePacketE3: function (data) {
      gpu.info[3] = data[0] & 0x000fffff;
    },

    // Set drawing area bottom right
    handlePacketE4: function (data) {
      gpu.info[4] = data[0] & 0x000fffff;
    },

    // Drawing offset
    handlePacketE5: function (data) {
      gpu.info[5] = data[0] & 0x003fffff;

      gpu.drawOffsetX = (data[0] << 21) >> 21;
      gpu.drawOffsetY = (data[0] << 11) >> 22;

      // renderer.setDrawAreaOF(gpu.drawOffsetX, gpu.drawOffsetY);
    },

    // Mask setting
    handlePacketE6: function (data) {
      gpu.status &= 0xffffe7ff;
      gpu.status |= ((data[0] & 3) << 11);
    },

    syncDrawOffset: function (offset) {
      const X = (gpu.info[5] << 21) >>> 21;
      const Y = (gpu.info[5] << 11) >>> 22;
      const changed = (X !== offset.X) || (Y !== offset.Y);

      offset.X = X; offset.Y = Y;

      return changed;
    },

    syncDrawArea: function (area, prev) {
      const X1 = (gpu.info[3] << 22) >>> 22;
      const Y1 = (gpu.info[3] << 12) >>> 22;
      const X2 = (gpu.info[4] << 22) >>> 22;
      const Y2 = (gpu.info[4] << 12) >>> 22;

      if ((X1 !== area.X1) || (Y1 !== area.Y1) || (X2 !== area.X2) || (Y2 !== area.Y2)) {
        if (prev) {
          prev.X1 = area.X1; prev.Y1 = area.Y1;
          prev.X2 = area.X2; prev.Y2 = area.Y2;
        }
        area.X1 = X1; area.Y1 = Y1;
        area.X2 = X2; area.Y2 = Y2;
        return true;
      }
      return false;
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
      if (gpu.dmaIndex !== 0) abort('not implemented')
      if ((addr & ~3) === 0) {
        return (blck >> 16) * (blck & 0xFFFF);
      }

      const seen = new Set(); // fluctuates memory
      var data = gpu.dmaBuffer;
      let words = 0;
      for (; ;) {
        addr = addr & 0x001fffff;
        seen.add(addr);
        var header = ram.getInt32(addr, true);
        var nitem = header >>> 24;
        var nnext = header & 0x001fffff;

        addr = addr + 4; ++words;
        addr = addr & 0x001fffff;

        while (nitem > 0) {
          if (seen.has(addr)) return words;
          seen.add(addr);
          const packetWord = ram.getInt32(addr, true) >>> 0;
          const packetId = packetWord >>> 24;
          if (packetSizes[packetId] === 0) {
            addr += 4; --nitem; ++words;
            addr = addr & 0x001fffff;
            if (missing.has(packetId)) continue;
            missing.add(packetId);

            console.warn('invalid packetId:', hex(packetId, 2), hex(header), hex(packetWord));
            return words;
          }
          if (((packetId >= 0x48) && (packetId < 0x50)) || ((packetId >= 0x58) && (packetId < 0x60))) {
            let i = 0;
            for (; i < 4096; ++i) {
              const value = ram.getInt32(addr, true);
              addr += 4; --nitem; ++words;
              addr = addr & 0x001fffff;

              if (value === 0x55555555) break;
              if (value === 0x50005000) break;
              data[i] = value;
            }
            gpu.handlers[packetId].call(this, data, i);
            gpu.updated = true;
          }
          else {
            for (var i = 0; i < packetSizes[packetId]; ++i) {
              data[i] = ram.getInt32(addr, true);
              addr += 4; --nitem;
              addr = addr & 0x001fffff;
              ++words;
            }
            gpu.handlers[packetId].call(this, data, 0);
            gpu.updated = true;
          }
        }
        if (!nnext || (nnext == 0x001fffff)) break;
        addr = nnext;
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

  gpu.handlePacket21 = gpu.handlePacket20;
  gpu.handlePacket22 = gpu.handlePacket20;
  gpu.handlePacket23 = gpu.handlePacket20;

  gpu.handlePacket25 = gpu.handlePacket24;
  gpu.handlePacket26 = gpu.handlePacket24;
  gpu.handlePacket27 = gpu.handlePacket24;

  gpu.handlePacket29 = gpu.handlePacket28;
  gpu.handlePacket2A = gpu.handlePacket28;
  gpu.handlePacket2B = gpu.handlePacket28;

  gpu.handlePacket2D = gpu.handlePacket2C;
  gpu.handlePacket2E = gpu.handlePacket2C;
  gpu.handlePacket2F = gpu.handlePacket2C;

  gpu.handlePacket31 = gpu.handlePacket30;
  gpu.handlePacket32 = gpu.handlePacket30;
  gpu.handlePacket33 = gpu.handlePacket30;

  gpu.handlePacket35 = gpu.handlePacket34;
  gpu.handlePacket36 = gpu.handlePacket34;
  gpu.handlePacket37 = gpu.handlePacket34;

  gpu.handlePacket39 = gpu.handlePacket38;
  gpu.handlePacket3A = gpu.handlePacket38;
  gpu.handlePacket3B = gpu.handlePacket38;

  gpu.handlePacket3D = gpu.handlePacket3C;
  gpu.handlePacket3E = gpu.handlePacket3C;
  gpu.handlePacket3F = gpu.handlePacket3C;

  gpu.handlePacket41 = gpu.handlePacket40;
  gpu.handlePacket42 = gpu.handlePacket40;
  gpu.handlePacket43 = gpu.handlePacket40;
  gpu.handlePacket44 = gpu.handlePacket40;
  gpu.handlePacket45 = gpu.handlePacket40;
  gpu.handlePacket46 = gpu.handlePacket40;
  gpu.handlePacket47 = gpu.handlePacket40;

  gpu.handlePacket49 = gpu.handlePacket48;
  gpu.handlePacket4A = gpu.handlePacket48;
  gpu.handlePacket4B = gpu.handlePacket48;
  gpu.handlePacket4C = gpu.handlePacket48;
  gpu.handlePacket4D = gpu.handlePacket48;
  gpu.handlePacket4E = gpu.handlePacket48;
  gpu.handlePacket4F = gpu.handlePacket48;

  gpu.handlePacket51 = gpu.handlePacket50;
  gpu.handlePacket52 = gpu.handlePacket50;
  gpu.handlePacket53 = gpu.handlePacket50;
  gpu.handlePacket54 = gpu.handlePacket50;
  gpu.handlePacket55 = gpu.handlePacket50;
  gpu.handlePacket56 = gpu.handlePacket50;
  gpu.handlePacket57 = gpu.handlePacket50;

  gpu.handlePacket59 = gpu.handlePacket58;
  gpu.handlePacket5A = gpu.handlePacket58;
  gpu.handlePacket5B = gpu.handlePacket58;
  gpu.handlePacket5C = gpu.handlePacket58;
  gpu.handlePacket5D = gpu.handlePacket58;
  gpu.handlePacket5E = gpu.handlePacket58;
  gpu.handlePacket5F = gpu.handlePacket58;

  gpu.handlePacket61 = gpu.handlePacket60;
  gpu.handlePacket62 = gpu.handlePacket60;
  gpu.handlePacket63 = gpu.handlePacket60;

  gpu.handlePacket65 = gpu.handlePacket64;
  gpu.handlePacket66 = gpu.handlePacket64;
  gpu.handlePacket67 = gpu.handlePacket64;

  gpu.handlePacket69 = gpu.handlePacket68;
  gpu.handlePacket6A = gpu.handlePacket68;
  gpu.handlePacket6B = gpu.handlePacket68;

  gpu.handlePacket71 = gpu.handlePacket70;
  gpu.handlePacket72 = gpu.handlePacket70;
  gpu.handlePacket73 = gpu.handlePacket70;

  gpu.handlePacket75 = gpu.handlePacket74;
  gpu.handlePacket76 = gpu.handlePacket74;
  gpu.handlePacket77 = gpu.handlePacket74;

  gpu.handlePacket79 = gpu.handlePacket78;
  gpu.handlePacket7A = gpu.handlePacket78;
  gpu.handlePacket7B = gpu.handlePacket78;

  gpu.handlePacket7D = gpu.handlePacket7C;
  gpu.handlePacket7E = gpu.handlePacket7C;
  gpu.handlePacket7F = gpu.handlePacket7C;

  for (var i = 0; i < 256; ++i) {
    var packetHandlerName = 'handlePacket' + hex(i, 2).toUpperCase();
    gpu.handlers[i] = gpu[packetHandlerName] || gpu.invalidPacketHandler;
  }

  for (var i = 0x81; i <= 0x9f; ++i) {
    gpu.handlers[i] = gpu.handlePacket80;
  }
  for (var i = 0xA1; i <= 0xbf; ++i) {
    gpu.handlers[i] = gpu.handlePacketA0;
  }
  for (var i = 0xC1; i <= 0xdf; ++i) {
    gpu.handlers[i] = gpu.handlePacketC0;
  }

  gpu.info[7] = 2;
  gpu.info[8] = 0;

  scope.gpu = gpu;

})(window);
