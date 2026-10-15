mdlr('enge:webgl2', ({ include }) => {

  const { createVertexBuffer, createProgramFromScripts } = include('enge:webgl2:utils');

  const $gpu = {
    // draw area that applies to the vertices currently queued; the da* fields
    // can already hold a newer area that only takes effect in updateDrawArea()
    clipL: 0, clipT: 0, clipR: 0, clipB: 0,
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
      // nothing reads the canvas after the frame is handed to the compositor:
      // the ambilight copy is taken in the same task, right after drawing
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
      depth: false,
      stencil: false,
    });
  }
  catch (e) {
    return abort();
  }

  const [ONE, ZERO, CONSTANT_ALPHA, BLEND, FUNC_ADD, STENCIL_TEST, FRAMEBUFFER, READ_FRAMEBUFFER, DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, RGBA, UNSIGNED_BYTE, NEAREST, COLOR_BUFFER_BIT]
    = [gl.ONE, gl.ZERO, gl.CONSTANT_ALPHA, gl.BLEND, gl.FUNC_ADD, gl.STENCIL_TEST, gl.FRAMEBUFFER, gl.READ_FRAMEBUFFER, gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, gl.COLOR_BUFFER_BIT];
  const [gl_blendColor, gl_blendFuncSeparate, gl_blendEquationSeparate, gl_enable, gl_disable, gl_getUniformLocation, gl_texSubImage2D, gl_bindFramebuffer, gl_framebufferTexture2D, gl_blitFramebuffer, gl_enableVertexAttribArray, gl_getAttribLocation, gl_vertexAttribPointer, gl_bindTexture, gl_texImage2D, gl_createFramebuffer]
    = [gl.blendColor, gl.blendFuncSeparate, gl.blendEquationSeparate, gl.enable, gl.disable, gl.getUniformLocation, gl.texSubImage2D, gl.bindFramebuffer, gl.framebufferTexture2D, gl.blitFramebuffer, gl.enableVertexAttribArray, gl.getAttribLocation, gl.vertexAttribPointer, gl.bindTexture, gl.texImage2D, gl.createFramebuffer].map(a => a.bind(gl));

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

  // conservative: only rejects primitives whose vertices are all beyond one
  // edge of the draw area; partially visible ones are clipped by the scissor
  const outsideDrawArea = (x1, y1, x2, y2, x3, y3, x4 = x3, y4 = y3) => {
    if ((x1 < $gpu.daL) && (x2 < $gpu.daL) && (x3 < $gpu.daL) && (x4 < $gpu.daL)) return true;
    if ((x1 > $gpu.daR) && (x2 > $gpu.daR) && (x3 > $gpu.daR) && (x4 > $gpu.daR)) return true;
    if ((y1 < $gpu.daT) && (y2 < $gpu.daT) && (y3 < $gpu.daT) && (y4 < $gpu.daT)) return true;
    if ((y1 > $gpu.daB) && (y2 > $gpu.daB) && (y3 > $gpu.daB) && (y4 > $gpu.daB)) return true;
    return false;
  }

  // ---- lazy vram -> vramShadow synchronisation ----
  //
  // Primitives sample vramShadow because WebGL does not allow sampling the
  // texture that is being rendered to. Instead of copying whole draw/display
  // areas eagerly, VRAM is split into 32x32 cells and drawing marks the cells
  // it touches dirty. Before a textured primitive is queued, the cells its
  // texture (and CLUT) cover are checked; if any are dirty, the queued
  // vertices are flushed and only those cells are copied.
  //
  // Invariant: for every clean cell vramShadow equals vram. storeImage,
  // moveImage and fillRectangle keep it by writing both textures.
  //
  // A packet's own output is committed to the grid when the next packet
  // starts (nextPrimitive), so the two passes of a semi-transparent textured
  // primitive, or the two triangles of a quad, never sync against each other.
  const CELL_SHIFT = 5;
  const CELL_SIZE = 1 << CELL_SHIFT;
  const GRID_W = 1024 >> CELL_SHIFT;
  const GRID_H = 512 >> CELL_SHIFT;
  const dirtyCells = new Uint8Array(GRID_W * GRID_H);
  let dirtyCount = 0;

  // bounding box (native, inclusive) drawn by the current packet
  let pktL = 1024, pktT = 512, pktR = -1, pktB = -1;

  const touchArea = (x1, y1, x2, y2, x3 = x2, y3 = y2, x4 = x3, y4 = y3) => {
    let l = Math.min(x1, x2, x3, x4), r = Math.max(x1, x2, x3, x4);
    let t = Math.min(y1, y2, y3, y4), b = Math.max(y1, y2, y3, y4);
    // drawing is clipped to the draw area, which lies inside VRAM
    if (l < $gpu.clipL) l = $gpu.clipL;
    if (t < $gpu.clipT) t = $gpu.clipT;
    if (r > $gpu.clipR) r = $gpu.clipR;
    if (b > $gpu.clipB) b = $gpu.clipB;
    if (r < l || b < t) return;
    if (l < pktL) pktL = l;
    if (t < pktT) pktT = t;
    if (r > pktR) pktR = r;
    if (b > pktB) pktB = b;
  }

  const commitPacketArea = () => {
    if (pktR < pktL || pktB < pktT) return;
    const cl = Math.max(0, pktL) >> CELL_SHIFT, cr = Math.min(1023, pktR) >> CELL_SHIFT;
    const ct = Math.max(0, pktT) >> CELL_SHIFT, cb = Math.min(511, pktB) >> CELL_SHIFT;
    for (let cy = ct; cy <= cb; ++cy) {
      for (let cx = cl; cx <= cr; ++cx) {
        const i = cy * GRID_W + cx;
        if (!dirtyCells[i]) {
          dirtyCells[i] = 1;
          ++dirtyCount;
        }
      }
    }
    pktL = 1024; pktT = 512; pktR = -1; pktB = -1;
  }

  // region in native coords, x may run past 1023 (wraps), y must not
  const regionDirty = (x, y, w, h) => {
    const cx0 = x >> CELL_SHIFT, cx1 = (x + w - 1) >> CELL_SHIFT;
    const cy0 = y >> CELL_SHIFT, cy1 = (y + h - 1) >> CELL_SHIFT;
    for (let cy = cy0; cy <= cy1; ++cy) {
      const row = (cy & (GRID_H - 1)) * GRID_W;
      for (let cx = cx0; cx <= cx1; ++cx) {
        if (dirtyCells[row + (cx & (GRID_W - 1))]) return true;
      }
    }
    return false;
  }

  // copy grid cells [c0, c1) of grid row gy from vram to vramShadow;
  // expects fb_vram bound for read and fb_vramShadow for draw
  const blitCells = (c0, c1, gy) => {
    const X1 = 4 * CELL_SIZE * c0, X2 = 4 * CELL_SIZE * c1;
    const Y1 = 4 * CELL_SIZE * gy, Y2 = Y1 + 4 * CELL_SIZE;
    gl_blitFramebuffer(X1, Y1, X2, Y2, X1, Y1, X2, Y2, COLOR_BUFFER_BIT, NEAREST);
  }

  // copy the dirty cells overlapping a region and mark them clean; adjacent
  // dirty cells in a grid row are copied with one blit
  const syncRegion = (x, y, w, h) => {
    const cx0 = x >> CELL_SHIFT, cx1 = (x + w - 1) >> CELL_SHIFT;
    const cy0 = y >> CELL_SHIFT, cy1 = (y + h - 1) >> CELL_SHIFT;

    for (let cy = cy0; cy <= cy1; ++cy) {
      const gy = cy & (GRID_H - 1);
      const row = gy * GRID_W;
      let runStart = -1, runEnd = -1;

      for (let cx = cx0; cx <= cx1; ++cx) {
        const gx = cx & (GRID_W - 1);
        // a run cannot continue across the horizontal wrap
        if (gx === 0 && runStart >= 0) {
          blitCells(runStart, runEnd + 1, gy);
          runStart = -1;
        }
        if (dirtyCells[row + gx]) {
          dirtyCells[row + gx] = 0;
          --dirtyCount;
          if (runStart < 0) runStart = gx;
          runEnd = gx;
        }
        else if (runStart >= 0) {
          blitCells(runStart, runEnd + 1, gy);
          runStart = -1;
        }
      }
      if (runStart >= 0) blitCells(runStart, runEnd + 1, gy);
    }
  }

  // u/v bounds are the texel coordinates the primitive interpolates between,
  // anything outside 0..255 (wrapping) or an active texture window means the
  // whole page can be sampled
  const syncTextureSource = (cl, u0, u1, v0, v1) => {
    if (!dirtyCount) return;

    const status = gpu.status;
    if (u0 < 0 || u1 > 255 || (gpu.twin & 0x000000ff)) { u0 = 0; u1 = 255; }
    if (v0 < 0 || v1 > 255 || (gpu.twin & 0x0000ff00)) { v0 = 0; v1 = 255; }

    const mode = (status >>> 7) & 3;
    const shift = mode === 0 ? 2 : mode === 1 ? 1 : 0;
    const px = (status & 15) << 6;
    const py = ((status >>> 4) & 1) << 8;
    const tx = px + (u0 >> shift), tw = (u1 >> shift) - (u0 >> shift) + 1;
    const ty = py + v0, th = v1 - v0 + 1;

    const indexed = mode < 2;
    const cx = (cl & 63) << 4, cy = (cl >>> 6) & 511, cw = mode === 0 ? 16 : 256;

    const pageDirty = regionDirty(tx, ty, tw, th);
    const clutDirty = indexed && regionDirty(cx, cy, cw, 1);
    if (!pageDirty && !clutDirty) return;

    // queued primitives may be what wrote the dirty cells
    flushVertexBuffer();

    gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
    gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
    if (pageDirty) syncRegion(tx, ty, tw, th);
    if (clutDirty) syncRegion(cx, cy, cw, 1);
    gl_bindFramebuffer(DRAW_FRAMEBUFFER, null);
    gl_bindFramebuffer(READ_FRAMEBUFFER, null);
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
        gl_disable(BLEND);
        gl_disable(gl.CULL_FACE);
        gl_disable(gl.DITHER);
        gl_disable(gl.POLYGON_OFFSET_FILL);
        gl_disable(gl.SAMPLE_COVERAGE);
        gl_disable(gl.SCISSOR_TEST);

        gl_blendColor(0.0, 0.0, 0.0, 0.0);
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
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_cache);
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

    getVramState() {
      const buffer = new Uint16Array(1024 * 512);
      this.loadImage(0, 0, 1024, 512, buffer);
      return buffer;
    }

    setVramState(buffer) {
      this.storeImage({ x: 0, y: 0, w: 1024, h: 512, pixelCount: 1024 * 512, buffer });
    }

    moveImage(sx, sy, dx, dy, w, h) {
      this.seenRender = true;
      flushVertexBuffer();

      // blit from vram -> vramShadow
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_blitFramebuffer(4 * sx, 4 * sy, 4 * (sx + w), 4 * (sy + h), 4 * dx, 4 * dy, 4 * (dx + w), 4 * (dy + h), COLOR_BUFFER_BIT, NEAREST);

      // blit from vramShadow -> vram
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vramShadow);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
      gl_blitFramebuffer(4 * dx, 4 * dy, 4 * (dx + w), 4 * (dy + h), 4 * dx, 4 * dy, 4 * (dx + w), 4 * (dy + h), COLOR_BUFFER_BIT, NEAREST);

      // blit from vramShadow -> cache
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vramShadow);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_cache);
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
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
      gl_blitFramebuffer(x, y, (x + w), (y + h), 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), COLOR_BUFFER_BIT, NEAREST);

      // blit from vram -> vramShadow
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_blitFramebuffer(4 * x, 4 * y, 4 * (x + w), 4 * (y + h), 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), COLOR_BUFFER_BIT, NEAREST);

      gl_bindFramebuffer(FRAMEBUFFER, null);
    }

    setTransparencyMode(mode, program) {
      gl.useProgram(program);

      switch (mode & 0x7) {
        case 0: {
          gl_enable(BLEND);
          gl_blendEquationSeparate(FUNC_ADD, FUNC_ADD);
          gl_blendFuncSeparate(CONSTANT_ALPHA, CONSTANT_ALPHA, ONE, ZERO);
          gl_blendColor(0.0, 0.0, 0.0, 0.5);
        } break;
        case 1: {
          gl_enable(BLEND);
          gl_blendEquationSeparate(FUNC_ADD, FUNC_ADD);
          gl_blendFuncSeparate(CONSTANT_ALPHA, CONSTANT_ALPHA, ONE, ZERO);
          gl_blendColor(0.0, 0.0, 0.0, 1.0);
        } break;
        case 2: {
          gl_enable(BLEND);
          gl_blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT, FUNC_ADD);
          gl_blendFuncSeparate(ONE, ONE, ONE, ZERO);
        } break;
        case 3: {
          gl_enable(BLEND);
          gl_blendEquationSeparate(FUNC_ADD, FUNC_ADD);
          gl_blendFuncSeparate(gl.ONE_MINUS_CONSTANT_ALPHA, ONE, ONE, ZERO);
          gl_blendColor(0.0, 0.0, 0.0, 0.75);
        } break;
        case 4: {
          gl_disable(BLEND);
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

      c1 = getColor(data, c1);
      c2 = getColor(data, c2);

      touchArea(x1, y1, x2, y2, x1 + 1, y1 + 1, x2 + 1, y2 + 1);

      const vertexBuffer = getVertexBuffer(renderer, data);

      var w = Math.abs(x1 - x2);
      var h = Math.abs(y1 - y2);

      var buffer = vertexBuffer;

      if (x1 !== x2 || y1 !== y2) {
        if (w >= h) {
          buffer.addVertex(x1, y1 + 1, 0, 0, c1);
          buffer.addVertex(x1, y1 + 0, 0, 0, c1);
          buffer.addVertex(x2, y2 + 0, 0, 0, c2);

          buffer.addVertex(x2, y2 + 0, 0, 0, c2);
          buffer.addVertex(x2, y2 + 1, 0, 0, c2);
          buffer.addVertex(x1, y1 + 1, 0, 0, c1);

        }
        else {
          buffer.addVertex(x1 + 0, y1, 0, 0, c1);
          buffer.addVertex(x1 + 1, y1, 0, 0, c1);
          buffer.addVertex(x2 + 1, y2, 0, 0, c2);

          buffer.addVertex(x2 + 1, y2, 0, 0, c2);
          buffer.addVertex(x2 + 0, y2, 0, 0, c2);
          buffer.addVertex(x1 + 0, y1, 0, 0, c1);
        }
      }
      else {
        buffer.addVertex(x2 + 0, y2 + 0, 0, 0, c2);
        buffer.addVertex(x2 + 1, y2 + 0, 0, 0, c2);
        buffer.addVertex(x2 + 0, y2 + 1, 0, 0, c2);

        buffer.addVertex(x2 + 0, y2 + 1, 0, 0, c2);
        buffer.addVertex(x2 + 1, y2 + 0, 0, 0, c2);
        buffer.addVertex(x2 + 1, y2 + 1, 0, 0, c2);
      }
    }

    drawTriangle(data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
      this.seenRender = true;
      this.updateDrawArea();

      const x1 = $gpu.daX + ((data[xy1] << 21) >> 21);
      const y1 = $gpu.daY + ((data[xy1] << 5) >> 21);
      const x2 = $gpu.daX + ((data[xy2] << 21) >> 21);
      const y2 = $gpu.daY + ((data[xy2] << 5) >> 21);
      const x3 = $gpu.daX + ((data[xy3] << 21) >> 21);
      const y3 = $gpu.daY + ((data[xy3] << 5) >> 21);

      if (outsideDrawArea(x1, y1, x2, y2, x3, y3)) return;
      if (largePrimitive(x1, y1, x2, y2, x3, y3)) return;

      c1 = getColor(data, c1);
      c2 = getColor(data, c2);
      c3 = getColor(data, c3);

      const u1 = ((data[uv1] >>> 0) & 255) + gpu.quadU;
      const v1 = ((data[uv1] >>> 8) & 255) + gpu.quadV;
      const u2 = ((data[uv2] >>> 0) & 255) + gpu.quadU;
      const v2 = ((data[uv2] >>> 8) & 255) + gpu.quadV;
      const u3 = ((data[uv3] >>> 0) & 255) + gpu.quadU;
      const v3 = ((data[uv3] >>> 8) & 255) + gpu.quadV;

      if (data[0] & 0x04000000) {
        syncTextureSource(cl,
          Math.min(u1, u2, u3), Math.max(u1, u2, u3),
          Math.min(v1, v2, v3), Math.max(v1, v2, v3));
      }
      touchArea(x1, y1, x2, y2, x3, y3);

      const vertexBuffer = getVertexBuffer(renderer, data);

      const buffer = vertexBuffer;

      buffer.addVertex(x1, y1, u1, v1, c1, cl);
      buffer.addVertex(x2, y2, u2, v2, c2, cl);
      buffer.addVertex(x3, y3, u3, v3, c3, cl);
    }

    drawRectangle(data, tx, ty, cl) {
      this.seenRender = true;
      this.updateDrawArea();

      var x = $gpu.daX + ((data[1] << 21) >> 21);
      var y = $gpu.daY + ((data[1] << 5) >> 21);
      var c = getColor(data, 0, true);
      var w = (data[2] << 16) >> 16;
      var h = (data[2] >> 16);
      if (!w || !h) return;

      if (outsideDrawArea(x, y, x + w, y, x, y + h, x + w, y + h)) return;
      if (largePrimitive(x, y, x + w, y, x, y + h, x + w, y + h)) return;

      var tl = tx + 0;
      var tr = tx + w;
      if (gpu.txflip) {
        tl = tx + 1;
        tr = tx + 1 - w;
      }

      var tt = ty + 0;
      var tb = ty + h;
      if (gpu.tyflip) {
        tt = ty + 1;
        tb = ty + 1 - h;
      }

      if (data[0] & 0x04000000) {
        // texels sampled: unflipped tx .. tx+w-1, flipped tx-w+1 .. tx;
        // both are min(tl, tr) .. max(tl, tr) - 1
        syncTextureSource(cl,
          Math.min(tl, tr), Math.max(tl, tr) - 1,
          Math.min(tt, tb), Math.max(tt, tb) - 1);
      }
      touchArea(x, y, x + w, y + h);

      const vertexBuffer = getVertexBuffer(renderer, data);

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

      // fills wrap around the right and bottom edges of VRAM, so split into
      // up to four rectangles
      const w1 = Math.min(w, 1024 - x), w2 = w - w1;
      const h1 = Math.min(h, 512 - y), h2 = h - h1;
      clearRect(c, x, y, w1, h1);
      clearRect(c, 0, y, w2, h1);
      clearRect(c, x, 0, w1, h2);
      clearRect(c, 0, 0, w2, h2);
    }

    updateDrawArea() {
      if ($gpu.daM) {
        flushVertexBuffer();
        flushDepth();
        $gpu.daM = false;

        $gpu.clipL = $gpu.daL;
        $gpu.clipT = $gpu.daT;
        $gpu.clipR = $gpu.daR;
        $gpu.clipB = $gpu.daB;
      }
    }

    setDrawAreaOF(x, y) {
      $gpu.daX = x;
      $gpu.daY = y;
    }

    setDrawAreaTL(x, y) {
      $gpu.daL = x;
      $gpu.daT = y;

      $gpu.daM = true;
    }

    setDrawAreaBR(x, y) {
      $gpu.daR = x;
      $gpu.daB = y;

      $gpu.daM = true;
    }

    onVBlankEnd() {
    }

    onVBlankBegin() {
      ++this.fpsCounter;
      if (this.seenRender) {
        flushVertexBuffer();
        flushDepth();

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

  function getColor(data, index = 0, forceFlat = false) {
    const mask = forceFlat || (data[0] & 0x10000000) ? 0x00f8f8f8 : 0x00ffffff;
    return (data[0] & 0xff000000) | (data[index] & mask);
  }

  // fill a native-coordinate rectangle of vram and vramShadow with a 15-bit
  // colour (0x00bbggrr, bit 15 clear) using scissored clears at 4x scale;
  // both are written, so the shadow stays in sync for the dirty-cell tracking
  const fillColor = new Float32Array(4);
  function clearRect(c, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    fillColor[0] = ((c >>> 0) & 0xff) / 255;
    fillColor[1] = ((c >>> 8) & 0xff) / 255;
    fillColor[2] = ((c >>> 16) & 0xff) / 255;
    fillColor[3] = 0;

    gl_enable(gl.SCISSOR_TEST);
    gl.scissor(4 * x, 4 * y, 4 * w, 4 * h);
    gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
    gl.clearBufferfv(gl.COLOR, 0, fillColor);
    gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
    gl.clearBufferfv(gl.COLOR, 0, fillColor);
    gl_bindFramebuffer(DRAW_FRAMEBUFFER, null);
    gl_disable(gl.SCISSOR_TEST);
  }

  function flushDepth() {
    gl_enable(gl.DEPTH_TEST);
    gl_bindFramebuffer(FRAMEBUFFER, fb_vram);
    gl.clearDepth(0.0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl_bindFramebuffer(FRAMEBUFFER, null);

    primitiveId = 1;
    gl_disable(gl.DEPTH_TEST);
  }

  function flushBuffer(vertexBuffer, mode) {
    if (vertexBuffer.size()) {
      gl_enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.GREATER);
      renderer.setTransparencyMode(mode, renderer.programRenderer); // also binds the program
      gl.viewport(0, 0, 4096, 2048); // texture dimensions

      gl.bindVertexArray(renderer.programRenderer.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.renderBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertexBuffer, gl.STREAM_DRAW, vertexBuffer.base(), vertexBuffer.bytes());

      gl_bindFramebuffer(FRAMEBUFFER, fb_vram);

      // clip to the draw area (inclusive, native coords) at 4x vram scale;
      // scissor must be off again before any blit or clear
      gl_enable(gl.SCISSOR_TEST);
      gl.scissor(
        4 * $gpu.clipL,
        4 * $gpu.clipT,
        4 * Math.max(0, $gpu.clipR - $gpu.clipL + 1),
        4 * Math.max(0, $gpu.clipB - $gpu.clipT + 1));

      gl_bindTexture(TEXTURE_2D, vramShadow);
      gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.size());

      gl_disable(gl.SCISSOR_TEST);
      gl_bindFramebuffer(FRAMEBUFFER, null);
      vertexBuffer.reset();
      gl_disable(gl.DEPTH_TEST);
    }
  }

  // only called by primitives
  let $mode = 4;
  // samePacket is set for the second pass of a semi-transparent textured
  // primitive; it needs a new depth id but is still the same packet
  // primitive ids are vertex shorts used as depth; before one would exceed
  // 32767, draw what is queued and restart at 1 with a cleared depth buffer
  // (everything with an older id is then already in vram, so order holds)
  const MAX_PRIMITIVE_ID = 32767;
  const nextPrimitive = (samePacket = false) => {
    if (++primitiveId > MAX_PRIMITIVE_ID) {
      flushVertexBuffer();
      flushDepth();
    }
    if (!samePacket) commitPacketArea();
  }
  const getVertexBuffer = (renderer, data) => {
    const mode = (data[0] & 0x02000000) ? ((gpu.status >> 5) & 3) : 4;

    if (mode !== 4 && mode !== $mode) {
      flushVertexBuffer();
      $mode = mode;
    }
    const buffer = renderer.buffers[mode];
    // callers add at most 6 vertices (a rectangle or a line)
    if (!buffer.canHold(6)) flushVertexBuffer();
    return buffer;
  }

  const flushVertexBuffer = () => {
    flushBuffer(renderer.buffers[4], 4);
    flushBuffer(renderer.buffers[$mode], $mode);
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
    gl.uniform1i(program.tvEffect, settings.tvEffect ? 1 : 0);
    gl.uniform4i(program.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);

    gl_bindFramebuffer(FRAMEBUFFER, null);

    gl.bindVertexArray(program.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.displayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, getDisplayArrays(region), gl.STREAM_DRAW);

    gl.activeTexture(gl.TEXTURE0);
    gl_bindTexture(TEXTURE_2D, vram);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    vertexBuffer.reset();

    if (canvas.width && canvas.height) {
      ambilight.drawImage(canvas, 0, 0);
    }
  }

  const vertexStride = 24;

  // attribute layout lives in a VAO per program, bound to that program's own
  // vertex buffer; attributes the linker optimised out (location -1) are skipped
  const createVertexArray = (program, buffer, attributes) => {
    program.vao = gl.createVertexArray();
    gl.bindVertexArray(program.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, size, type, normalized, offset] of attributes) {
      const pos = gl_getAttribLocation(program, name);
      if (pos < 0) continue;
      gl_enableVertexAttribArray(pos);
      gl_vertexAttribPointer(pos, size, type, normalized, vertexStride, offset);
    }
    gl.bindVertexArray(null);
  }
  const createProgramDisplay = (displayBuffer) => {
    const program = createProgramFromScripts(gl, 'vertex', 'displayScreen');
    gl.useProgram(program);

    program.displayArea = gl_getUniformLocation(program, "u_disp");
    program.mode = gl_getUniformLocation(program, "u_mode");
    program.tvEffect = gl_getUniformLocation(program, "u_tv_effect");
    program.drawArea = gl_getUniformLocation(program, "u_draw");

    createVertexArray(program, displayBuffer, [
      ['a_position', 3, gl.SHORT, false, 0],
      ['a_texcoord', 2, gl.SHORT, false, 6],
    ]);

    return program;
  }

  const createProgramRenderer = (renderBuffer) => {
    const program = createProgramFromScripts(gl, 'pixel', 'videoram');
    gl.useProgram(program);

    createVertexArray(program, renderBuffer, [
      ['a_position', 3, gl.SHORT, false, 0],
      ['a_texcoord', 2, gl.SHORT, false, 6],
      ['a_color', 4, UNSIGNED_BYTE, true, 12],
      ['a_twin', 4, UNSIGNED_BYTE, false, 16],
      ['a_clut', 1, gl.SHORT, false, 20],
      ['a_tmode', 1, gl.BYTE, false, 22],
    ]);

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

  // attachments are framebuffer state and never change, so they are made
  // once here; everything else only binds the framebuffers
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
  gl_bindFramebuffer(FRAMEBUFFER, fb_cache);
  gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, cache, 0);
  gl_bindFramebuffer(FRAMEBUFFER, null);


  window.primitiveId = 0;
  window.nextPrimitive = nextPrimitive;

  window.renderer = new WebGLRenderer();
})

mdlr('enge:webgl2:utils', ({ include }) => {
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
    // vertex layout (24 bytes, every field naturally aligned):
    //    0 x  i16    2 y  i16    4 primitive id  i16    6 u  i16    8 v  i16
    //   10 (unused)  12 colour u32   16 texture window u32
    //   20 clut u16  22 texture mode/page u8   23 (unused)
    // typed-array stores are about twice as fast as DataView calls; WebGL and
    // typed arrays both use the platform byte order
    const buffer = new Uint8Array(1024 * 1024);
    const i16 = new Int16Array(buffer.buffer);
    const u16 = new Uint16Array(buffer.buffer);
    const u32 = new Uint32Array(buffer.buffer);

    const bytesPerVertex = 24;
    let index = 0;
    buffer.addVertex = (x, y, u, v, c = 0x00808080, cl) => {
      if (reverse) {
        index -= bytesPerVertex;
      }
      const h = index >> 1, w = index >> 2;
      i16[h + 0] = x;
      i16[h + 1] = y;
      i16[h + 2] = primitiveId;
      i16[h + 3] = u;
      i16[h + 4] = v;
      u32[w + 3] = c;
      u32[w + 4] = gpu.twin;
      u16[h + 10] = cl;
      buffer[index + 22] = ((gpu.status >> 7) & 3) | ((gpu.status & 31) << 2);
      if (!reverse) {
        index += bytesPerVertex;
      }
    }

    buffer.reset = () => {
      index = reverse ? buffer.length : 0;
    }

    buffer.canHold = vertices => {
      const free = reverse ? index : buffer.length - index;
      return free >= vertices * bytesPerVertex;
    }

    buffer.size = () => {
      if (reverse) {
        return (buffer.length - index) / bytesPerVertex;
      }
      return index / bytesPerVertex;
    }

    buffer.view = () => {
      if (reverse) {
        return new Uint8Array(buffer.buffer, index, buffer.length - index);
      }
      return new Uint8Array(buffer.buffer, 0, index);
    }

    buffer.base = () => {
      return reverse ? index : 0;
    }

    buffer.bytes = () => {
      return reverse ? buffer.length - index : index;
    }

    buffer.reset();
    return buffer;
  }

  return {
    createProgramFromScripts,
    createVertexBuffer,
  };

})

mdlr('enge:psx:webgl2', ({ include }) => {

  Object.assign(window,
    include('enge:utils'),
  );

  include('enge:webgl2');
  include('enge:psx');

})

