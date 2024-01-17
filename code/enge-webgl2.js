mdlr('enge:webgl2', m => {

  const {createVertexBuffer,createProgramFromScripts} = m.require('enge:webgl2:utils');

  const $gpu = {
  };

  const sbgr2rgba = new Uint32Array(65536);
  const transfer = new Uint32Array(4096 * 2048);
  const view = new Uint8Array(transfer.buffer);
  const vertexBuffer = createVertexBuffer();

  const canvas = document.getElementById('display');
  const ambilight = document.querySelector('#ambilight').getContext('2d', { alpha: false });
  ambilight.imageSmoothingEnabled = false;

  for (let i = 0; i < 65536; ++i) {
    sbgr2rgba[i] = ((i >>> 0) & 0x1f) << 3;      // r
    sbgr2rgba[i] |= ((i >>> 5) & 0x1f) << 11;      // g
    sbgr2rgba[i] |= ((i >>> 10) & 0x1f) << 19;      // b
    sbgr2rgba[i] |= ((i >>> 15) & 0x01) ? 0xff000000 : 0; // a
  }

  let gl = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      depth: false,
      stencil: false,
    });
  }
  catch (e) {
    return abort();
  }

  const [STENCIL_TEST, FRAMEBUFFER, READ_FRAMEBUFFER, DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, RGBA, UNSIGNED_BYTE, NEAREST, COLOR_BUFFER_BIT] = [gl.STENCIL_TEST, gl.FRAMEBUFFER, gl.READ_FRAMEBUFFER, gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, gl.COLOR_BUFFER_BIT];
  const [gl_enable, gl_disable, gl_getUniformLocation, gl_texSubImage2D, gl_bindFramebuffer, gl_framebufferTexture2D, gl_blitFramebuffer, gl_enableVertexAttribArray, gl_getAttribLocation, gl_vertexAttribPointer, gl_bindTexture, gl_texImage2D, gl_createFramebuffer] = [gl.enable, gl.disable, gl.getUniformLocation, gl.texSubImage2D, gl.bindFramebuffer, gl.framebufferTexture2D, gl.blitFramebuffer, gl.enableVertexAttribArray, gl.getAttribLocation, gl.vertexAttribPointer, gl.bindTexture, gl.texImage2D, gl.createFramebuffer].map(a => a.bind(gl));

  const largePrimitive = (x1, y1, x2, y2, x3, y3, x4 = x3, y4 = y3) => {
    if (Math.abs(x1 - x2) > 1023) return true;
    if (Math.abs(x2 - x3) > 1023) return true;
    if (Math.abs(x3 - x1) > 1023) return true;
    if (Math.abs(x4 - x2) > 1023) return true;
    if (Math.abs(x4 - x3) > 1023) return true;
    if (Math.abs(y1 - y2) > 511) return true;
    if (Math.abs(y2 - y3) > 511) return true;
    if (Math.abs(y3 - y1) > 511) return true;
    if (Math.abs(y4 - y2) > 511) return true;
    if (Math.abs(y4 - y3) > 511) return true;
    return false;
  }

  const outsideDrawArea = (x1, y1, x2, y2, x3, y3, x4 = x3, y4 = y3) => {
    return false;
    if ((x1 < $gpu.daL) && (x2 < $gpu.daL) && (x3 < $gpu.daL) && (x4 < $gpu.daL)) return true;
    if ((x1 > $gpu.daR) && (x2 > $gpu.daR) && (x3 > $gpu.daR) && (x4 > $gpu.daR)) return true;
    if ((y1 < $gpu.daT) && (y2 < $gpu.daT) && (y3 < $gpu.daT) && (y4 < $gpu.daT)) return true;
    if ((y1 > $gpu.daB) && (y2 > $gpu.daB) && (y3 > $gpu.daB) && (y4 > $gpu.daB)) return true;
    return false;
  }


  // todo: refactor to completely move this class
  class WebGLRenderer {
    buffers = [
      createVertexBuffer(),
      createVertexBuffer(),
      createVertexBuffer(),
      createVertexBuffer(),
      createVertexBuffer(true),
    ];

    constructor() {
      this.mode = 'disp';
      this.fpsRenderCounter = 0;
      this.fpsCounter = 0;
      this.skipped = 0;
      this.seenRender = false;

      if (gl) {
        gl_disable(STENCIL_TEST);
        gl_disable(gl.DEPTH_TEST);
        gl_disable(gl.BLEND);
        gl_disable(gl.CULL_FACE);
        gl_disable(gl.DITHER);
        gl_disable(gl.POLYGON_OFFSET_FILL);
        gl_disable(gl.SAMPLE_COVERAGE);
        gl_disable(gl.SCISSOR_TEST);

        gl_enableVertexAttribArray(0);
        gl.blendColor(0.0, 0.0, 0.0, 0.0);
        gl.clearDepth(0.0);

        this.displayBuffer = gl.createBuffer();
        this.programDisplay = createProgramDisplay(this.displayBuffer);
        this.renderBuffer = gl.createBuffer();
        this.programRenderer = createProgramRenderer(this.renderBuffer);

        // copy texture data
        gl_bindTexture(TEXTURE_2D, vram);
        transfer.fill(0);
        gl_texSubImage2D(TEXTURE_2D, 0, 0, 0, 4096, 2048, RGBA, UNSIGNED_BYTE, view);

        flushDepth();
      }
      else {
        alert("Error: Your browser does not appear to support WebGL.");
      }
    }

    loadImage(x, y, w, h, buffer) {
      flushVertexBuffer();
      // blit from vram -> cache
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_cache);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, cache, 0);
      gl_blitFramebuffer(4 * x, 4 * y, 4 * (x + w), 4 * (y + h), x, y, (x + w), (y + h), COLOR_BUFFER_BIT, NEAREST);

      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_cache);
      gl.readPixels(x, y, w, h, RGBA, UNSIGNED_BYTE, view);

      const size = w * h;
      for (let i = 0; i < size; ++i) {
        const data32 = transfer[i];
        let sbgr16 = 0;
        sbgr16 |= ((data32 >>> 24) & 0xff) ? 0x8000 : 0x0000;
        sbgr16 |= ((data32 >>> 19) & 0x1f) << 10;
        sbgr16 |= ((data32 >>> 11) & 0x1f) << 5;
        sbgr16 |= ((data32 >>> 3) & 0x1f) << 0;

        buffer[i] = sbgr16;
      }

      gl_bindFramebuffer(FRAMEBUFFER, null);
    }

    moveImage(sx, sy, dx, dy, w, h) {
      this.seenRender = true;
      flushVertexBuffer();

      // blit from vram -> vramShadow
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
      gl_blitFramebuffer(4 * sx, 4 * sy, 4 * (sx + w), 4 * (sy + h), 4 * dx, 4 * dy, 4 * (dx + w), 4 * (dy + h), COLOR_BUFFER_BIT, NEAREST);

      // blit from vramShadow -> vram
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vramShadow);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_blitFramebuffer(4 * dx, 4 * dy, 4 * (dx + w), 4 * (dy + h), 4 * dx, 4 * dy, 4 * (dx + w), 4 * (dy + h), COLOR_BUFFER_BIT, NEAREST);

      // blit from vramShadow -> cache
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vramShadow);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_cache);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, cache, 0);
      gl_blitFramebuffer(4 * dx, 4 * dy, 4 * (dx + w), 4 * (dy + h), dx, dy, (dx + w), (dy + h), COLOR_BUFFER_BIT, NEAREST);

      gl_bindFramebuffer(DRAW_FRAMEBUFFER, null);
      gl_bindFramebuffer(READ_FRAMEBUFFER, null);

      gl.activeTexture(gl.TEXTURE0 + 0);

    }

    storeImage(img) {
      this.seenRender = true;
      flushVertexBuffer();
      for (let i = 0, l = img.pixelCount; i < l; ++i) {
        const sbgr = img.buffer[i] >>> 0;
        transfer[i] = sbgr2rgba[sbgr];
      }

      const { x, y, w, h } = img;
      // copy texture data
      gl_bindTexture(TEXTURE_2D, cache);
      gl_texSubImage2D(TEXTURE_2D, 0, x, y, w, h, RGBA, UNSIGNED_BYTE, view);
      gl_bindTexture(TEXTURE_2D, null);

      // blit from cache -> vram
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_cache);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, cache, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_blitFramebuffer(x, y, (x + w), (y + h), 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), COLOR_BUFFER_BIT, NEAREST);

      // blit from vram -> vramShadow
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
      gl_blitFramebuffer(4 * x, 4 * y, 4 * (x + w), 4 * (y + h), 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), COLOR_BUFFER_BIT, NEAREST);

      gl_bindFramebuffer(FRAMEBUFFER, null);
    }

    setTransparencyMode(mode, program) {
      gl.useProgram(program);

      switch (mode & 0x7) {
        case 0: {
          gl_enable(gl.BLEND);
          gl.blendEquation(gl.FUNC_ADD);
          gl.blendColor(0.0, 0.0, 0.0, 0.5);
          gl.blendFuncSeparate(gl.CONSTANT_ALPHA, gl.CONSTANT_ALPHA, gl.ONE, gl.ZERO);
        } break;
        case 1: {
          gl_enable(gl.BLEND);
          gl.blendEquation(gl.FUNC_ADD);
          gl.blendColor(0.0, 0.0, 0.0, 1.0);
          gl.blendFuncSeparate(gl.CONSTANT_ALPHA, gl.CONSTANT_ALPHA, gl.ONE, gl.ZERO);
        } break;
        case 2: {
          gl_enable(gl.BLEND);
          gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_ADD);
          gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ZERO);
        } break;
        case 3: {
          gl_enable(gl.BLEND);
          gl.blendEquation(gl.FUNC_ADD);
          gl.blendColor(0.0, 0.0, 0.0, 0.75);
          gl.blendFuncSeparate(gl.ONE_MINUS_CONSTANT_ALPHA, gl.ONE, gl.ONE, gl.ZERO);
        } break;
        case 4: {
          gl_disable(gl.BLEND);
        } break;
      }
    }

    drawLine(data, c1, xy1, c2, xy2) {
      this.seenRender = true;
      this.updateDrawArea();

      var x1 = $gpu.daX + ((data[xy1] << 21) >> 21);
      var y1 = $gpu.daY + ((data[xy1] << 5) >> 21);
      var x2 = $gpu.daX + ((data[xy2] << 21) >> 21);
      var y2 = $gpu.daY + ((data[xy2] << 5) >> 21);

      if (outsideDrawArea(x1, y1, x2, y2, x1, y1)) return;
      if (largePrimitive(x1, y1, x2, y2, x1, y1)) return;

      // if (!vertexBuffer.canHold(6)) flushVertexBuffer();
      const vertexBuffer = getVertexBuffer(renderer, data);

      var w = Math.abs(x1 - x2);
      var h = Math.abs(y1 - y2);

      var buffer = vertexBuffer;

      if (x1 !== x2 || y1 !== y2) {
        if (w >= h) {
          buffer.addVertex(x1, y1 + 1, 0, 0, ((data[0] & 0xff000000) | (data[c1] & 0x00ffffff)));
          buffer.addVertex(x1, y1 + 0, 0, 0, ((data[0] & 0xff000000) | (data[c1] & 0x00ffffff)));
          buffer.addVertex(x2, y2 + 0, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));

          buffer.addVertex(x2, y2 + 0, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
          buffer.addVertex(x2, y2 + 1, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
          buffer.addVertex(x1, y1 + 1, 0, 0, ((data[0] & 0xff000000) | (data[c1] & 0x00ffffff)));

        }
        else {
          buffer.addVertex(x1 + 0, y1, 0, 0, ((data[0] & 0xff000000) | (data[c1] & 0x00ffffff)));
          buffer.addVertex(x1 + 1, y1, 0, 0, ((data[0] & 0xff000000) | (data[c1] & 0x00ffffff)));
          buffer.addVertex(x2 + 1, y2, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));

          buffer.addVertex(x2 + 1, y2, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
          buffer.addVertex(x2 + 0, y2, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
          buffer.addVertex(x1 + 0, y1, 0, 0, ((data[0] & 0xff000000) | (data[c1] & 0x00ffffff)));
        }
      }
      else {
        buffer.addVertex(x2 + 0, y2 + 0, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
        buffer.addVertex(x2 + 1, y2 + 0, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
        buffer.addVertex(x2 + 0, y2 + 1, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));

        buffer.addVertex(x2 + 0, y2 + 1, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
        buffer.addVertex(x2 + 1, y2 + 0, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
        buffer.addVertex(x2 + 1, y2 + 1, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
      }
    }

    drawTriangle(data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
      this.seenRender = true;
      this.updateDrawArea();

      c1 = getColor(data, c1);
      c2 = getColor(data, c2);
      c3 = getColor(data, c3);

      const x1 = $gpu.daX + ((data[xy1] << 21) >> 21);
      const y1 = $gpu.daY + ((data[xy1] << 5) >> 21);
      const x2 = $gpu.daX + ((data[xy2] << 21) >> 21);
      const y2 = $gpu.daY + ((data[xy2] << 5) >> 21);
      const x3 = $gpu.daX + ((data[xy3] << 21) >> 21);
      const y3 = $gpu.daY + ((data[xy3] << 5) >> 21);

      if (outsideDrawArea(x1, y1, x2, y2, x3, y3)) return;
      if (largePrimitive(x1, y1, x2, y2, x3, y3)) return;

      // if (!vertexBuffer.canHold(6)) flushVertexBuffer();
      const vertexBuffer = getVertexBuffer(renderer, data);

      const buffer = vertexBuffer;
      const u1 = (data[uv1] >>> 0) & 255;
      const v1 = (data[uv1] >>> 8) & 255;
      const u2 = (data[uv2] >>> 0) & 255;
      const v2 = (data[uv2] >>> 8) & 255;
      const u3 = (data[uv3] >>> 0) & 255;
      const v3 = (data[uv3] >>> 8) & 255;

      buffer.addVertex(x1, y1, u1, v1, c1, cl);
      buffer.addVertex(x2, y2, u2, v2, c2, cl);
      buffer.addVertex(x3, y3, u3, v3, c3, cl);
    }

    drawRectangle(data, tx, ty, cl) {
      this.seenRender = true;
      this.updateDrawArea();

      var x = $gpu.daX + ((data[1] << 21) >> 21);
      var y = $gpu.daY + ((data[1] << 5) >> 21);
      var c = getColor(data, 0);
      var w = (data[2] << 16) >> 16;
      var h = (data[2] >> 16);
      if (!w || !h) return;

      if (outsideDrawArea(x, y, x + w, y, x, y + h, x + w, y + h)) return;
      if (largePrimitive(x, y, x + w, y, x, y + h, x + w, y + h)) return;

      // if (!vertexBuffer.canHold(6)) flushVertexBuffer();
      const vertexBuffer = getVertexBuffer(renderer, data);

      var tl = tx + 0;
      var tr = tx + w;
      if (gpu.txflip) {
        tl = tx + 0;
        tr = tx - w + 1;
      }

      var tt = ty + 0;
      var tb = ty + h;
      if (gpu.tyflip) {
        tt = ty + 0;
        tb = ty - h + 1;
      }

      var buffer = vertexBuffer;
      buffer.addVertex(x + 0, y + 0, tl, tt, c, cl);
      buffer.addVertex(x + w, y + 0, tr, tt, c, cl);
      buffer.addVertex(x + 0, y + h, tl, tb, c, cl);

      buffer.addVertex(x + w, y + 0, tr, tt, c, cl);
      buffer.addVertex(x + 0, y + h, tl, tb, c, cl);
      buffer.addVertex(x + w, y + h, tr, tb, c, cl);
    }

    fillRectangle(data) {
      flushVertexBuffer();

      var x = (data[1] << 16) >>> 16;
      var y = (data[1] << 0) >>> 16;
      var w = (data[2] << 16) >>> 16;
      var h = (data[2] << 0) >>> 16;
      var c = (data[0] & 0x00f8f8f8);
      if (!w && !h) return;

      x = (x & 0x3f0);
      y = (y & 0x1ff);
      w = ((w & 0x3ff) + 15) & ~15;
      h = (h & 0x1ff);

      transfer.fill(c, 0, w * h);

      // copy texture data
      gl_bindTexture(TEXTURE_2D, cache);
      gl_texSubImage2D(TEXTURE_2D, 0, x, y, w, h, RGBA, UNSIGNED_BYTE, view);
      gl_bindTexture(TEXTURE_2D, null);

      // blit from cache -> vram
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_cache);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, cache, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_blitFramebuffer(x, y, (x + w), (y + h), 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), COLOR_BUFFER_BIT, NEAREST);

      // blit from vram -> vramShadow
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
      gl_blitFramebuffer(4 * x, 4 * y, 4 * (x + w), 4 * (y + h), 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), COLOR_BUFFER_BIT, NEAREST);

      gl_bindFramebuffer(DRAW_FRAMEBUFFER, null);
      gl_bindFramebuffer(READ_FRAMEBUFFER, null);
      gl_bindFramebuffer(FRAMEBUFFER, null);
    }

    updateDrawArea() {
      if ($gpu.daM) {
        flushVertexBuffer();
        copyVramToShadowVram(this, true);
        flushDepth();
        $gpu.daM = false;

        gl.useProgram(this.programRenderer);
        gl.uniform4i(this.programRenderer.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);
      }
    }

    setDrawAreaOF(x, y) {
      $gpu.daX = x;
      $gpu.daY = y;
    }

    setDrawAreaTL(x, y) {
      $gpu.daLold = $gpu.daL;
      $gpu.daTold = $gpu.daT;
      $gpu.daL = x;
      $gpu.daT = y;

      $gpu.daM = true;
    }

    setDrawAreaBR(x, y) {
      $gpu.daRold = $gpu.daR;
      $gpu.daBold = $gpu.daB;
      $gpu.daR = x;
      $gpu.daB = y;

      $gpu.daM = true;
    }

    onVBlankBegin() {
      // console.log('onVBlankBegin')
    }

    onVBlankEnd() {
      ++this.fpsCounter;
      if (this.seenRender) {
        flushVertexBuffer();
        flushDepth();
        copyVramToShadowVram(this, false, true);
        // console.log('onVBlankEnd')

        ++this.fpsRenderCounter;
        this.seenRender = false;
      }
      else return;


      this.setTransparencyMode(4, this.programDisplay);

      const area = gpu.getDisplayArea();

      switch (this.mode) {
        case 'clut4':
          showDisplay(this, 3);
          break;
        case 'clut8':
          showDisplay(this, 2);
          break;
        case 'draw':
          showDisplay(this, 6);
          break;
        case 'page2': // display-area and draw-area
          showDisplay(this, 7);
          break;
        case 'disp':
          const overscanx = settings.overscan * area.w;
          const overscany = settings.overscan * area.h;

          area.x += (overscanx >> 1);
          area.y += (overscany >> 1);
          area.w -= (overscanx >> 0);
          area.h -= (overscany >> 0);
          showDisplay(this, (gpu.status >> 21) & 0b101, area);
          break;
      }
    }

    setMode(mode) {
      this.mode = mode;
      this.seenRender = true;
    }
  }

  function getColor(data, index = 0) {
    return (data[0] & 0xff000000) | (data[index] & 0x00f8f8f8);

    var c;
    if (data[0] & 0x04000000) {
      if (data[0] & 0x01000000) {
        // blend texture
        c = ((data[0] & 0xff000000) | (data[index] & 0x00ffffff));
      }
      else {
        // raw texture
        c = ((data[0] & 0xff000000) | (0x00808080));
      }
    }
    else {
      c = ((data[0] & 0xff000000) | (data[index] & 0x00ffffff));
    }
    return c;
  }

  function flushDepth() {
    gl_enable(gl.DEPTH_TEST);
    gl_bindFramebuffer(FRAMEBUFFER, fb_vram);
    gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
    gl_framebufferTexture2D(FRAMEBUFFER, gl.DEPTH_ATTACHMENT, TEXTURE_2D, vramDepth, 0);
    gl.clearDepth(0.0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl_bindFramebuffer(FRAMEBUFFER, null);

    primitiveId = 1;
    gl_disable(gl.DEPTH_TEST);
  }

  function copyVramToShadowVram(renderer, old = false, display = false) {
    if (!display) {
      const X1 = 4 * (old ? $gpu.daLold : $gpu.daL);
      const Y1 = 4 * (old ? $gpu.daTold : $gpu.daT);
      const X2 = 4 * (old ? $gpu.daRold : $gpu.daR + 1);
      const Y2 = 4 * (old ? $gpu.daBold : $gpu.daB + 1);
      // blit from vram -> vramShadow
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
      gl_blitFramebuffer(X1, Y1, X2, Y2, X1, Y1, X2, Y2, COLOR_BUFFER_BIT, NEAREST);
    }
    else {
      const { x, y, w, h } = gpu.getDisplayArea();
      // blit from vram -> vramShadow
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(READ_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
      gl_blitFramebuffer(4 * x, 4 * y, 4 * (x + w), 4 * (y + h), 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), COLOR_BUFFER_BIT, NEAREST);
    }
    gl_bindFramebuffer(FRAMEBUFFER, null);
  }

  function flushBuffer(vertexBuffer, mode) {
    if (vertexBuffer.size()) {
      gl_enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.GREATER);
      renderer.setTransparencyMode(mode, renderer.programRenderer);

      gl.useProgram(renderer.programRenderer);
      gl.viewport(0, 0, 4096, 2048); // texture dimensions

      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.displayBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertexBuffer, gl.STREAM_DRAW, vertexBuffer.base(), vertexBuffer.bytes());

      gl_bindFramebuffer(FRAMEBUFFER, fb_vram);
      gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
      gl_framebufferTexture2D(FRAMEBUFFER, gl.DEPTH_ATTACHMENT, TEXTURE_2D, vramDepth, 0)

      gl_bindTexture(TEXTURE_2D, vramShadow);
      gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.size());

      gl_bindFramebuffer(FRAMEBUFFER, null);
      vertexBuffer.reset();
      gl_disable(gl.DEPTH_TEST);
    }
  }

  // only called by primitives
  let $mode = 4;
  const nextPrimitive = () => {
    ++primitiveId;
  }
  const getVertexBuffer = (renderer, data) => {
    const mode = (data[0] & 0x02000000) ? ((gpu.status >> 5) & 3) : 4;

    if (mode !== 4 && mode !== $mode) {
      flushVertexBuffer();
      $mode = mode;
    }
    return renderer.buffers[mode];
  }

  const flushVertexBuffer = () => {
    flushBuffer(vertexBuffer);

    for (let mode = 4; mode >= 0; --mode) {
      flushBuffer(renderer.buffers[mode], mode);
    }
    // gl.flush();
    // copyVramToShadowVram(renderer);
    // flushDepth(renderer);
  }

  const getDisplayArrays = ({ x, y, w, h }) => {
    vertexBuffer.addVertex(0, 0, x + 0, y + 0);
    vertexBuffer.addVertex(1024, 0, x + w, y + 0);
    vertexBuffer.addVertex(0, 512, x + 0, y + h);

    vertexBuffer.addVertex(0, 512, x + 0, y + h);
    vertexBuffer.addVertex(1024, 0, x + w, y + 0);
    vertexBuffer.addVertex(1024, 512, x + w, y + h);

    return vertexBuffer.view();
  }

  const showDisplay = (renderer, mode, region = { x: 0, y: 0, w: 1024, h: 512 }) => {
    const program = renderer.programDisplay;

    if ((canvas.width !== region.w * settings.quality) || (canvas.height !== region.h * settings.quality)) {
      canvas.width = ambilight.canvas.width = region.w * settings.quality;
      canvas.height = ambilight.canvas.height = region.h * settings.quality;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.useProgram(program);
    const area = gpu.getDisplayArea();
    gl.uniform4i(program.displayArea, area.x, area.y, area.x + area.w - 1, area.y + area.h - 1);
    gl.uniform1i(program.mode, mode);
    gl.uniform4i(program.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);

    gl_bindFramebuffer(FRAMEBUFFER, null);

    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.displayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, getDisplayArrays(region), gl.STATIC_DRAW);

    gl.activeTexture(gl.TEXTURE0);
    gl_bindTexture(TEXTURE_2D, vram);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    vertexBuffer.reset();

    if (canvas.width && canvas.height) {
      ambilight.drawImage(canvas, 0, 0);
    }
  }

  const vertexStride = 24;
  const createProgramDisplay = (displayBuffer) => {
    const program = createProgramFromScripts(gl, 'vertex', 'displayScreen');
    gl.useProgram(program);

    program.displayArea = gl_getUniformLocation(program, "u_disp");
    program.mode = gl_getUniformLocation(program, "u_mode");
    program.drawArea = gl_getUniformLocation(program, "u_draw");

    gl.bindBuffer(gl.ARRAY_BUFFER, displayBuffer);

    let pos;

    pos = gl_getAttribLocation(program, "a_position");
    gl_enableVertexAttribArray(pos);
    gl_vertexAttribPointer(pos, 3, gl.SHORT, false, vertexStride, 0);

    pos = gl_getAttribLocation(program, "a_texcoord");
    gl_enableVertexAttribArray(pos);
    gl_vertexAttribPointer(pos, 2, gl.SHORT, false, vertexStride, 6);

    return program;
  }

  const createProgramRenderer = (renderBuffer) => {
    const program = createProgramFromScripts(gl, 'pixel', 'videoram');
    gl.useProgram(program);

    program.drawArea = gl_getUniformLocation(program, "u_draw");

    let pos;

    pos = gl_getAttribLocation(program, "a_position");
    gl_enableVertexAttribArray(pos);
    gl_vertexAttribPointer(pos, 3, gl.SHORT, false, vertexStride, 0);

    pos = gl_getAttribLocation(program, "a_texcoord");
    gl_enableVertexAttribArray(pos);
    gl_vertexAttribPointer(pos, 2, gl.SHORT, false, vertexStride, 6);

    pos = gl_getAttribLocation(program, "a_color");
    gl_enableVertexAttribArray(pos);
    gl_vertexAttribPointer(pos, 4, UNSIGNED_BYTE, true, vertexStride, 10);

    pos = gl_getAttribLocation(program, "a_twin");
    gl_enableVertexAttribArray(pos);
    gl_vertexAttribPointer(pos, 4, UNSIGNED_BYTE, false, vertexStride, 14);

    pos = gl_getAttribLocation(program, "a_clut");
    gl_enableVertexAttribArray(pos);
    gl_vertexAttribPointer(pos, 1, gl.SHORT, false, vertexStride, 18);

    pos = gl_getAttribLocation(program, "a_tmode");
    gl_enableVertexAttribArray(pos);
    gl_vertexAttribPointer(pos, 1, gl.BYTE, false, vertexStride, 20);

    return program;
  }

  const createAndBindTexture = () => {
    const texture = gl.createTexture();
    gl_bindTexture(TEXTURE_2D, texture);
    gl.texParameteri(TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(TEXTURE_2D, gl.TEXTURE_MIN_FILTER, NEAREST);
    gl.texParameteri(TEXTURE_2D, gl.TEXTURE_MAG_FILTER, NEAREST);
    return texture;
  }

  const createDepthComponent = (width, height) => {
    const texture = createAndBindTexture();
    gl_texImage2D(TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    gl_bindTexture(TEXTURE_2D, null);
    return texture;
  }

  // create texture
  const vram = createAndBindTexture();
  gl_texImage2D(TEXTURE_2D, 0, RGBA, 4096, 2048, 0, RGBA, UNSIGNED_BYTE, null);
  const vramDepth = createDepthComponent(4096, 2048);

  const fb_vram = gl_createFramebuffer();
  gl_bindFramebuffer(FRAMEBUFFER, fb_vram);
  gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
  gl_bindTexture(TEXTURE_2D, vramDepth);
  gl_framebufferTexture2D(FRAMEBUFFER, gl.DEPTH_ATTACHMENT, TEXTURE_2D, vramDepth, 0)
  gl_bindFramebuffer(FRAMEBUFFER, null);

  // create texture
  const vramShadow = createAndBindTexture();
  gl_texImage2D(TEXTURE_2D, 0, RGBA, 4096, 2048, 0, RGBA, UNSIGNED_BYTE, null);

  const fb_vramShadow = gl_createFramebuffer();
  gl_bindFramebuffer(FRAMEBUFFER, fb_vramShadow);
  gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
  gl_bindFramebuffer(FRAMEBUFFER, null);

  // create texture
  const cache = createAndBindTexture();
  gl_texImage2D(TEXTURE_2D, 0, RGBA, 4096, 2048, 0, RGBA, UNSIGNED_BYTE, null);

  const fb_cache = gl_createFramebuffer();


  window.primitiveId = 0;
  window.nextPrimitive = nextPrimitive;

  window.renderer = new WebGLRenderer();
})

mdlr('enge:webgl2:utils', m => {
  /**
   * Creates and compiles a shader.
   *
   * @param {!WebGLRenderingContext} gl The WebGL Context.
   * @param {string} shaderSource The GLSL source code for the shader.
   * @param {number} shaderType The type of shader, VERTEX_SHADER or
   *     FRAGMENT_SHADER.
   * @return {!WebGLShader} The shader.
   */
  function compileShader(gl, shaderSource, shaderType) {
    // Create the shader object
    var shader = gl.createShader(shaderType);

    // Set the shader source code.
    gl.shaderSource(shader, shaderSource);

    // Compile the shader
    gl.compileShader(shader);

    // Check if it compiled
    var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
      // Something went wrong during compilation; get the error
      throw "could not compile shader:" + gl.getShaderInfoLog(shader);
    }

    return shader;
  }

  /**
   * Creates a program from 2 shaders.
   *
   * @param {!WebGLRenderingContext) gl The WebGL context.
   * @param {!WebGLShader} vertexShader A vertex shader.
   * @param {!WebGLShader} fragmentShader A fragment shader.
   * @return {!WebGLProgram} A program.
   */
  function createProgram(gl, vertexShader, fragmentShader) {
    // create a program.
    var program = gl.createProgram();

    // attach the shaders.
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    // link the program.
    gl.linkProgram(program);

    // Check if it linked.
    var success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
      // something went wrong with the link
      throw ("program filed to link:" + gl.getProgramInfoLog(program));
    }

    return program;
  };

  /**
   * Creates a shader from the content of a script tag.
   *
   * @param {!WebGLRenderingContext} gl The WebGL Context.
   * @param {string} scriptId The id of the script tag.
   * @param {string} opt_shaderType. The type of shader to create.
   *     If not passed in will use the type attribute from the
   *     script tag.
   * @return {!WebGLShader} A shader.
   */
  function createShaderFromScript(gl, scriptId, opt_shaderType) {
    // look up the script tag by id.
    var shaderScript = document.getElementById(scriptId);
    if (!shaderScript) {
      throw ("*** Error: unknown script element: " + scriptId);
    }

    // extract the contents of the script tag.
    var shaderSource = shaderScript.text;

    // If we didn't pass in a type, use the 'type' from
    // the script tag.
    if (!opt_shaderType) {
      if (shaderScript.type == "x-shader/x-vertex") {
        opt_shaderType = gl.VERTEX_SHADER;
      } else if (shaderScript.type == "x-shader/x-fragment") {
        opt_shaderType = gl.FRAGMENT_SHADER;
      } else if (!opt_shaderType) {
        throw ("*** Error: shader type not set");
      }
    }

    return compileShader(gl, shaderSource, opt_shaderType);
  };

  /**
   * Creates a program from 2 script tags.
   *
   * @param {!WebGLRenderingContext} gl The WebGL Context.
   * @param {string} vertexShaderId The id of the vertex shader script tag.
   * @param {string} fragmentShaderId The id of the fragment shader script tag.
   * @return {!WebGLProgram} A program
   */
  function createProgramFromScripts(gl, vertexShaderId, fragmentShaderId) {
    var vertexShader = createShaderFromScript(gl, vertexShaderId, gl.VERTEX_SHADER);
    var fragmentShader = createShaderFromScript(gl, fragmentShaderId, gl.FRAGMENT_SHADER);
    return createProgram(gl, vertexShader, fragmentShader);
  }

  /**
   * 
   * @returns vertex-buffer
   */
  function createVertexBuffer(reverse = false) {
    const buffer = new Uint8Array(1024 * 1024);
    const view = new DataView(buffer.buffer);

    const bytesPerVertex = 24;
    buffer.addVertex = function (x, y, u, v, c = 0x00808080, cl) {
      if (reverse) {
        this.index -= bytesPerVertex;
      }
      view.setInt16(this.index + 0, x, true);
      view.setInt16(this.index + 2, y, true);
      view.setInt16(this.index + 4, primitiveId, true);
      view.setInt16(this.index + 6, u, true);
      view.setInt16(this.index + 8, v, true);
      view.setUint32(this.index + 10, c, true);
      view.setUint32(this.index + 14, gpu.twin, true);
      view.setUint16(this.index + 18, cl >>> 0, true);
      view.setUint8(this.index + 20, ((gpu.status >> 7) & 3) | ((gpu.status & 31) << 2), true);
      if (!reverse) {
        this.index += bytesPerVertex;
      }
    }

    buffer.reset = function () {
      this.index = reverse ? this.length : 0;
    }

    buffer.size = function () {
      if (reverse) {
        return (this.length - this.index) / bytesPerVertex;
      }
      return this.index / bytesPerVertex;
    }

    buffer.view = function () {
      if (reverse) {
        return new Uint8Array(this.buffer, this.index, this.length - this.index);
      }
      return new Uint8Array(this.buffer, 0, this.index);
    }

    buffer.base = function () {
      return reverse ? this.index : 0;
    }
    // buffer.canHold = function(vertices) {
    //   return (this.index + (vertices * bytesPerVertex)) < this.length;
    // }

    buffer.bytes = function () {
      return reverse ? this.length - this.index : this.index;
    }

    buffer.reset();
    return buffer;
  }

  return {
    createProgramFromScripts,
    createVertexBuffer,
  };

})

mdlr('enge:psx:webgl2', m => {

  m.require('enge:webgl2');
  m.require('enge:psx');

})