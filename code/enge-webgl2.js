mdlr('enge:webgl2', ({ include }) => {

  const { createVertexBuffer, createProgramFromScripts } = include('enge:webgl2:utils');

  // VRAM render scale: VRAM is rendered at scale x native resolution
  // (1024 x 512), scale is a power of two
  let scale = 4, scaleShift = 2;
  let vramWidth = 1024 * scale, vramHeight = 512 * scale;

  const $gpu = {
    // draw area that applies to the vertices currently queued; the da* fields
    // can already hold a newer area that only takes effect in updateDrawArea()
    clipL: 0, clipT: 0, clipR: 0, clipB: 0,
  };

  // staging for native-resolution (1024x512) VRAM uploads and readbacks
  const transfer = new Uint32Array(1024 * 512);
  const view = new Uint8Array(transfer.buffer);
  const vertexBuffer = createVertexBuffer();

  const canvas = document.getElementById('display');
  const ambilight = document.querySelector('#ambilight').getContext('2d', { alpha: false });
  ambilight.imageSmoothingEnabled = false;


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

  // PGXP triangle vertices: integer position plus the 1/16-pixel fraction
  const addPreciseVertices = (buffer, frac, x1, y1, xy1, u1, v1, c1, x2, y2, xy2, u2, v2, c2, x3, y3, xy3, u3, v3, c3, cl) => {
    buffer.addVertex(x1 + (frac[xy1] & 15) / 16, y1 + ((frac[xy1] >> 4) & 15) / 16, u1, v1, c1, cl);
    buffer.addVertex(x2 + (frac[xy2] & 15) / 16, y2 + ((frac[xy2] >> 4) & 15) / 16, u2, v2, c2, cl);
    buffer.addVertex(x3 + (frac[xy3] & 15) / 16, y3 + ((frac[xy3] >> 4) & 15) / 16, u3, v3, c3, cl);
  }

  // ---- texture filtering support ----
  //
  // Filtered sampling reads neighbouring texels, so it is clamped to the
  // texels the primitive itself covers (its UV limits), as DuckStation does,
  // to keep neighbouring images in a texture atlas from bleeding in.
  const VERTEX_SPRITE = 1; // vertex flag: rectangle (GP0 60h-7Fh)
  const uvLimits = new Int16Array(4);
  // texture filters in use: picks the shader variant and whether polygons
  // need UV limits; latched at vblank so a frame's batches agree
  // filter settings as latched at the last vblank (see latchFilters)
  let textureFilter = settings.textureFilter | 0, spriteFilter = settings.spriteFilter | 0;
  let filtersActive = !!(textureFilter | spriteFilter);

  // texel range of a textured polygon packet, over all 3 or 4 vertices; the
  // upper bound is made inclusive (max - 1 unless the range is one texel)
  const polygonUVLimits = data => {
    const id = data[0] >>> 24;
    const per = (id & 0x10) ? 3 : 2, count = (id & 0x08) ? 4 : 3;
    let umin = 0x7fff, vmin = 0x7fff, umax = -0x8000, vmax = -0x8000;
    for (let k = 0; k < count; ++k) {
      const word = data[2 + k * per];
      const u = (word & 255) + gpu.quadU, v = ((word >>> 8) & 255) + gpu.quadV;
      if (u < umin) umin = u;
      if (u > umax) umax = u;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    uvLimits[0] = umin;
    uvLimits[1] = vmin;
    uvLimits[2] = umax !== umin ? umax - 1 : umax;
    uvLimits[3] = vmax !== vmin ? vmax - 1 : vmax;
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
    const X1 = scale * CELL_SIZE * c0, X2 = scale * CELL_SIZE * c1;
    const Y1 = scale * CELL_SIZE * gy, Y2 = Y1 + scale * CELL_SIZE;
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
      createVertexBuffer(),     // 0-3: semi-transparent, per blend mode
      createVertexBuffer(),
      createVertexBuffer(),
      createVertexBuffer(),
      createVertexBuffer(true), // 4: opaque, filled backwards (front to back)
      createVertexBuffer(),     // 5: opaque in submission order (check mask)
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
        // display shader variants by FMV filter (0 off, 1 smooth, 2 xBR) and
        // screen filter (0 off, 1 xBR, 2 Super-xBR)
        this.displayPrograms = new Map();
        this.programDisplay = getDisplayProgram(this, settings.fmvFilter | 0, screenFilterActive(0) ? settings.screenFilter | 0 : 0);
        this.renderBuffer = gl.createBuffer();
        // pixel shader variants by check mask and the filters in use (see
        // getRendererProgram); the unfiltered ones are made up front
        this.rendererPrograms = new Map();
        for (const buffer of this.buffers) buffer.setStride(filtersActive ? 36 : 28);
        this.programRenderer = getRendererProgram(this, false, 0, 0);
        this.programRendererCheckMask = getRendererProgram(this, true, 0, 0);
        this.programMaskDepth = createProgramMaskDepth();
        this.programCopy = createProgramCopy();
        this.programUpload = createProgramUpload();
        this.programSuperXbr = createProgramSuperXbr();
        applyScaleUniforms(this);

        // textures are created zeroed, so vram starts out black
        flushDepth();
      }
      else {
        alert("Error: Your browser does not appear to support WebGL.");
      }
    }

    loadImage(x, y, w, h, buffer) {
      flushVertexBuffer();

      // reads wrap around the right and bottom VRAM edges; each piece is
      // read into its place in rows of w pixels
      gl.pixelStorei(gl.PACK_ROW_LENGTH, w);
      for (const [sx, sy, vx, vy, pw, ph] of wrappedPieces(x, y, w, h)) {
        // blit from vram -> cache (4x -> native)
        gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
        gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_cache);
        gl_blitFramebuffer(scale * vx, scale * vy, scale * (vx + pw), scale * (vy + ph), vx, vy, vx + pw, vy + ph, COLOR_BUFFER_BIT, NEAREST);

        gl_bindFramebuffer(READ_FRAMEBUFFER, fb_cache);
        gl.pixelStorei(gl.PACK_SKIP_PIXELS, sx);
        gl.pixelStorei(gl.PACK_SKIP_ROWS, sy);
        gl.readPixels(vx, vy, pw, ph, RGBA, UNSIGNED_BYTE, view);
      }
      gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
      gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);

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
      invalidateMaskDepth();

      const mask = (gpu.status >>> 11) & 3;
      if (mask) return this.moveImageMasked(sx, sy, dx, dy, w, h, mask);

      // blit from vram -> vramShadow
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_blitFramebuffer(scale * sx, scale * sy, scale * (sx + w), scale * (sy + h), scale * dx, scale * dy, scale * (dx + w), scale * (dy + h), COLOR_BUFFER_BIT, NEAREST);

      // blit from vramShadow -> vram
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vramShadow);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
      gl_blitFramebuffer(scale * dx, scale * dy, scale * (dx + w), scale * (dy + h), scale * dx, scale * dy, scale * (dx + w), scale * (dy + h), COLOR_BUFFER_BIT, NEAREST);

      gl_bindFramebuffer(DRAW_FRAMEBUFFER, null);
      gl_bindFramebuffer(READ_FRAMEBUFFER, null);

      gl.activeTexture(gl.TEXTURE0 + 0);

    }

    // GP0(80h) with GP0(E6h) mask bits: set mask forces bit 15 on every
    // copied pixel, check mask keeps destination pixels that have it. Drawn
    // with a shader from vramShadow (synced over both areas), so overlapping
    // copies read the source as it was before the copy, like the blit path.
    // Clipped at the VRAM edge like the blits.
    moveImageMasked(sx, sy, dx, dy, w, h, mask) {
      w = Math.min(w, 1024 - sx, 1024 - dx);
      h = Math.min(h, 512 - sy, 512 - dy);
      if (w <= 0 || h <= 0) return;

      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      syncRegion(sx, sy, w, h);
      syncRegion(dx, dy, w, h);

      const program = this.programCopy;
      gl.useProgram(program);
      gl.uniform2i(program.offset, scale * (sx - dx), scale * (sy - dy));
      gl.uniform1i(program.setMask, mask & 1);
      gl.uniform1i(program.checkMask, (mask >> 1) & 1);
      gl.bindVertexArray(program.vao);
      gl_disable(BLEND);
      gl.viewport(0, 0, vramWidth, vramHeight);
      gl_enable(gl.SCISSOR_TEST);
      gl.scissor(scale * dx, scale * dy, scale * w, scale * h);
      gl_bindTexture(TEXTURE_2D, vramShadow);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl_disable(gl.SCISSOR_TEST);
      gl_bindTexture(TEXTURE_2D, null);

      // blit from vram -> vramShadow
      const X1 = scale * dx, Y1 = scale * dy, X2 = scale * (dx + w), Y2 = scale * (dy + h);
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      gl_blitFramebuffer(X1, Y1, X2, Y2, X1, Y1, X2, Y2, COLOR_BUFFER_BIT, NEAREST);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, null);
      gl_bindFramebuffer(READ_FRAMEBUFFER, null);
    }

    storeImage(img) {
      this.seenRender = true;
      flushVertexBuffer();
      invalidateMaskDepth();

      const { x, y, w, h } = img;
      const pieces = wrappedPieces(x, y, w, h);

      // upload the raw 16-bit words to the staging texture at their VRAM
      // position; uploads wrap around the right and bottom VRAM edges, each
      // piece taken from its place in the caller's rows of w words
      gl_bindTexture(TEXTURE_2D, upload);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, w);
      for (const [sx, sy, vx, vy, pw, ph] of pieces) {
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, sx);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, sy);
        gl_texSubImage2D(TEXTURE_2D, 0, vx, vy, pw, ph, gl.RED_INTEGER, gl.UNSIGNED_SHORT, img.buffer);
      }
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

      // GP0(E6h): set mask forces bit 15, check mask keeps pixels that have
      // it; the check reads vramShadow, so bring the target area up to date
      const mask = (gpu.status >>> 11) & 3;
      if (mask & 2) {
        gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
        gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
        for (const [, , vx, vy, pw, ph] of pieces) syncRegion(vx, vy, pw, ph);
      }

      // convert to RGBA while drawing them into vram at 4x, then copy to
      // vramShadow
      const program = this.programUpload;
      gl.useProgram(program);
      gl.uniform1i(program.setMask, mask & 1);
      gl.uniform1i(program.checkMask, (mask >> 1) & 1);
      gl.activeTexture(gl.TEXTURE1);
      gl_bindTexture(TEXTURE_2D, vramShadow);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(program.vao);
      gl_disable(BLEND);
      gl.viewport(0, 0, vramWidth, vramHeight);
      gl_enable(gl.SCISSOR_TEST);
      for (const [, , vx, vy, pw, ph] of pieces) {
        gl.scissor(scale * vx, scale * vy, scale * pw, scale * ph);
        gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl_disable(gl.SCISSOR_TEST);
      gl_bindTexture(TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1);
      gl_bindTexture(TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);

      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      for (const [, , vx, vy, pw, ph] of pieces) {
        const X1 = scale * vx, Y1 = scale * vy, X2 = scale * (vx + pw), Y2 = scale * (vy + ph);
        gl_blitFramebuffer(X1, Y1, X2, Y2, X1, Y1, X2, Y2, COLOR_BUFFER_BIT, NEAREST);
      }

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
      if (filtersActive) vertexBuffer.setPrimitive(0, 0, 0, 0, 0);

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

      // integer (game) coordinates: culling and dirty tracking use these, as
      // the hardware does; the PGXP fraction is only added to the vertices
      // (keeping these small integers also avoids boxing doubles per call)
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
      if (filtersActive && (data[0] & 0x04000000)) {
        polygonUVLimits(data);
        buffer.setPrimitive(0, uvLimits[0], uvLimits[1], uvLimits[2], uvLimits[3]);
      }
      else if (filtersActive) buffer.setPrimitive(0, 0, 0, 0, 0);

      // PGXP: add the 1/16-pixel fraction carried from the GTE (polygons only)
      const pgxpFrac = gpu.pgxpFrac;
      if (pgxpFrac) {
        addPreciseVertices(buffer, pgxpFrac, x1, y1, xy1, u1, v1, c1, x2, y2, xy2, u2, v2, c2, x3, y3, xy3, u3, v3, c3, cl);
        return;
      }
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
      if (filtersActive) buffer.setPrimitive(VERTEX_SPRITE,
        Math.min(tl, tr), Math.min(tt, tb), Math.max(tl, tr) - 1, Math.max(tt, tb) - 1);
      buffer.addVertex(x + 0, y + 0, tl, tt, c, cl);
      buffer.addVertex(x + w, y + 0, tr, tt, c, cl);
      buffer.addVertex(x + 0, y + h, tl, tb, c, cl);

      buffer.addVertex(x + w, y + 0, tr, tt, c, cl);
      buffer.addVertex(x + 0, y + h, tl, tb, c, cl);
      buffer.addVertex(x + w, y + h, tr, tb, c, cl);
    }

    fillRectangle(data) {
      flushVertexBuffer();
      invalidateMaskDepth();

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


      if (desiredScale() !== scale) changeRenderScale(desiredScale());
      latchFilters(this);

      this.programDisplay = getDisplayProgram(this, settings.fmvFilter | 0, screenFilterActive(0) ? settings.screenFilter | 0 : 0);
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

    // VRAM render scale (4 or 8)
    getScale() {
      return scale;
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

  // split a native rectangle that may run past the right/bottom VRAM edge
  // into the up to four pieces it wraps into:
  // [offset x, offset y in the rectangle, vram x, vram y, width, height]
  function wrappedPieces(x, y, w, h) {
    const w1 = Math.min(w, 1024 - x), w2 = w - w1;
    const h1 = Math.min(h, 512 - y), h2 = h - h1;
    const pieces = [[0, 0, x, y, w1, h1]];
    if (w2 > 0) pieces.push([w1, 0, 0, y, w2, h1]);
    if (h2 > 0) pieces.push([0, h1, x, 0, w1, h2]);
    if (w2 > 0 && h2 > 0) pieces.push([w1, h1, 0, 0, w2, h2]);
    return pieces;
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
    gl.scissor(scale * x, scale * y, scale * w, scale * h);
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
    maskDepthValid = false;
    gl_disable(gl.DEPTH_TEST);
  }

  function flushBuffer(vertexBuffer, mode) {
    if (vertexBuffer.size()) {
      gl_enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.GREATER);
      const program = getRendererProgram(renderer, ($maskMode & 2) !== 0, textureFilter, spriteFilter);
      renderer.setTransparencyMode(mode, program); // also binds the program
      // uniforms are program state: only set them when they change
      const fullRes = settings.fullResTextures !== false ? 1 : 0, setMask = $maskMode & 1;
      const state = (setMask << 0) | (fullRes << 1) | (textureFilter << 2) | (spriteFilter << 5);
      if (program.uniformState !== state) {
        program.uniformState = state;
        gl.uniform1i(program.setMask, setMask);
        gl.uniform1i(program.fullResTextures, fullRes);
        gl.uniform1i(program.textureFilter, textureFilter);
        gl.uniform1i(program.spriteFilter, spriteFilter);
      }
      gl.viewport(0, 0, vramWidth, vramHeight); // texture dimensions

      gl.bindVertexArray(program.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.renderBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertexBuffer, gl.STREAM_DRAW, vertexBuffer.base(), vertexBuffer.bytes());

      gl_bindFramebuffer(FRAMEBUFFER, fb_vram);

      // clip to the draw area (inclusive, native coords) at 4x vram scale;
      // scissor must be off again before any blit or clear
      gl_enable(gl.SCISSOR_TEST);
      gl.scissor(
        scale * $gpu.clipL,
        scale * $gpu.clipT,
        scale * Math.max(0, $gpu.clipR - $gpu.clipL + 1),
        scale * Math.max(0, $gpu.clipB - $gpu.clipT + 1));

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
    updateMaskMode();

    let mode = (data[0] & 0x02000000) ? ((gpu.status >> 5) & 3) : 4;

    if (mode !== 4 && mode !== $mode) {
      flushVertexBuffer();
      $mode = mode;
    }
    if ($maskMode & 2) {
      // check mask: an earlier pixel with bit 15 must block later ones, so
      // draw strictly in submission order: opaque primitives forwards, and a
      // flush whenever the stream switches between opaque and semi-transparent
      if (mode === 4) mode = 5;
      if (mode !== $lastMode) flushVertexBuffer();
      ensureMaskDepth();
    }
    $lastMode = mode;

    const buffer = renderer.buffers[mode];
    // callers add at most 6 vertices (a rectangle or a line)
    if (!buffer.canHold(6)) flushVertexBuffer();
    return buffer;
  }

  const flushVertexBuffer = () => {
    flushBuffer(renderer.buffers[4], 4);
    flushBuffer(renderer.buffers[5], 4);
    flushBuffer(renderer.buffers[$mode], $mode);
  }

  // the filter settings take effect at vblank, so all batches of a frame
  // use the same shader variant and vertex layout; whatever is still queued
  // is drawn with the old ones first
  const latchFilters = renderer => {
    const tf = settings.textureFilter | 0, sf = settings.spriteFilter | 0;
    if (tf === textureFilter && sf === spriteFilter) return;
    for (let mode = 0; mode < 6; ++mode) flushBuffer(renderer.buffers[mode], Math.min(mode, 4));
    textureFilter = tf;
    spriteFilter = sf;
    const active = !!(tf | sf);
    if (active !== filtersActive) {
      filtersActive = active;
      for (const buffer of renderer.buffers) buffer.setStride(active ? 36 : 28);
    }
  }

  // ---- GP0(E6h) mask bits for drawing ----
  //
  // set mask (bit 0) is a shader uniform forcing alpha (VRAM bit 15) to 1.
  // check mask (bit 1) uses the depth buffer: pixels with bit 15 set get
  // depth 1.0, above every primitive id, so the GREATER test rejects any
  // later fragment there. Existing bit-15 pixels are marked by a depth pass
  // over the draw area (ensureMaskDepth); pixels drawn with bit 15 while
  // check mask is on mark themselves (CHECK_MASK shader variant). The marks
  // are rebuilt whenever depth is cleared or VRAM changes underneath.
  let $maskMode = 0;
  let $lastMode = 4;
  let maskDepthValid = false;

  const updateMaskMode = () => {
    const mask = (gpu.status >>> 11) & 3;
    if (mask === $maskMode) return;
    flushVertexBuffer();
    // leaving check mask: drop the depth marks so masked pixels can be drawn
    if (($maskMode & 2) && !(mask & 2)) flushDepth();
    $maskMode = mask;
  }

  // vram changed outside primitive drawing (upload, copy, fill)
  const invalidateMaskDepth = () => {
    maskDepthValid = false;
  }

  const ensureMaskDepth = () => {
    if (maskDepthValid) return;
    flushVertexBuffer();
    flushDepth();

    const l = $gpu.clipL, t = $gpu.clipT;
    const w = $gpu.clipR - l + 1, h = $gpu.clipB - t + 1;
    if (w > 0 && h > 0) {
      // the pass reads vramShadow, so bring the draw area up to date
      gl_bindFramebuffer(READ_FRAMEBUFFER, fb_vram);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);
      syncRegion(l, t, w, h);

      const program = renderer.programMaskDepth;
      gl.useProgram(program);
      gl.bindVertexArray(program.vao);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vram);
      gl.viewport(0, 0, vramWidth, vramHeight);
      gl_enable(gl.SCISSOR_TEST);
      gl.scissor(scale * l, scale * t, scale * w, scale * h);
      gl_enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.depthMask(true);
      gl.colorMask(false, false, false, false);
      gl_disable(BLEND);
      gl_bindTexture(TEXTURE_2D, vramShadow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.colorMask(true, true, true, true);
      gl_disable(gl.DEPTH_TEST);
      gl_disable(gl.SCISSOR_TEST);
      gl_bindFramebuffer(DRAW_FRAMEBUFFER, null);
      gl_bindFramebuffer(READ_FRAMEBUFFER, null);
    }
    maskDepthValid = true;
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

  // ---- screen filter ----
  //
  // A 2D upscaler over the native display pixels: xBR in the display shader,
  // or Super-xBR in passes over offscreen textures (one doubling per pass
  // group). At quality 1 the whole picture is filtered and the canvas is
  // drawn at 4x so the result is not lost to CSS scaling. Above quality 1
  // the output is quality x native, and only pixels whose VRAM block is one
  // colour (sprites, 2D, uploads) take the filtered result; blocks with
  // render-scale detail (polygon edges, shading) keep the rendered pixels.
  const SCREEN_FILTER_Q1_SCALE = 4;
  const screenFilterActive = displayMode => (settings.screenFilter | 0) > 0 && (displayMode === 0 || displayMode === 1);

  const fb_screen = gl_createFramebuffer();
  let screenTextures = null;

  // native pixels + block mask (n), first diagonal pass (d), and per
  // doubling the orthogonal (o) and realign (r) results; the next
  // doubling's diagonal pass reuses the previous o. Doublings that would
  // exceed this GPU's texture or viewport limit are dropped (the result is
  // then sampled bilinearly).
  const ensureScreenTextures = (w, h, wanted) => {
    const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), maxViewport[0], maxViewport[1]);
    let levels = wanted;
    while (levels > 1 && (Math.max(w, h) << levels) > max) --levels;
    if (screenTextures && screenTextures.w === w && screenTextures.h === h && screenTextures.levels === levels) return screenTextures;
    if (screenTextures) for (const t of screenTextures.list) gl.deleteTexture(t);
    const make = (tw, th) => {
      const t = createAndBindTexture();
      gl.texParameteri(TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl_texImage2D(TEXTURE_2D, 0, RGBA, tw, th, 0, RGBA, UNSIGNED_BYTE, null);
      return t;
    };
    const n = make(w, h), d = make(w, h);
    const list = [n, d], o = [], r = [];
    for (let k = 1; k <= levels; ++k) {
      o.push(make(w << k, h << k));
      r.push(make(w << k, h << k));
    }
    list.push(...o, ...r);
    gl_bindTexture(TEXTURE_2D, null);
    return screenTextures = { w, h, levels, n, d, o, r, list };
  }

  // runs the screen filter passes for the display area; returns the native
  // texture with the block mask and, for Super-xBR, the upscaled result
  const runScreenFilter = (renderer, area, superXbr, levels) => {
    const w = area.w, h = area.h;
    const t = ensureScreenTextures(w, h, levels);
    const program = renderer.programSuperXbr;
    gl.useProgram(program);
    gl.bindVertexArray(program.vao);
    gl.uniform4i(program.displayArea, area.x, area.y, area.x + w - 1, area.y + h - 1);
    gl_bindFramebuffer(FRAMEBUFFER, fb_screen);

    const pass = (n, target, tw, th, source, original = null) => {
      gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, target, 0);
      gl.viewport(0, 0, tw, th);
      gl.uniform1i(program.pass, n);
      gl.activeTexture(gl.TEXTURE1);
      gl_bindTexture(TEXTURE_2D, original);
      gl.activeTexture(gl.TEXTURE0);
      gl_bindTexture(TEXTURE_2D, source);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    // native pixels, then per doubling: diagonal, orthogonal, realign
    pass(0, t.n, w, h, vram);
    let result = null;
    if (superXbr) {
      let input = t.n, diagonal = t.d;
      for (let k = 0; k < t.levels; ++k) {
        const iw = w << k, ih = h << k;
        pass(1, diagonal, iw, ih, input);
        pass(2, t.o[k], 2 * iw, 2 * ih, diagonal, input);
        pass(3, t.r[k], 2 * iw, 2 * ih, t.o[k]);
        input = t.r[k];
        diagonal = t.o[k];
      }
      result = input;
    }

    gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, null, 0);
    gl_bindFramebuffer(FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE1);
    gl_bindTexture(TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl_bindTexture(TEXTURE_2D, null);
    return { mask: t.n, result };
  }

  const showDisplay = (renderer, mode, region = { x: 0, y: 0, w: 1024, h: 512 }) => {
    const program = renderer.programDisplay;
    const area = gpu.getDisplayArea();
    const screenFilter = screenFilterActive(mode) ? (settings.screenFilter | 0) : 0;
    const hybrid = settings.quality > 1;
    // output scale: quality, or 4x at quality 1; one doubling per factor 2
    const outScale = (screenFilter && !hybrid) ? SCREEN_FILTER_Q1_SCALE : settings.quality;
    const screen = (screenFilter && mode === 0) ? runScreenFilter(renderer, area, screenFilter === 2, Math.log2(outScale)) : null;
    if ((canvas.width !== region.w * outScale) || (canvas.height !== region.h * outScale)) {
      canvas.width = region.w * outScale;
      canvas.height = region.h * outScale;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.useProgram(program);
    gl.uniform4i(program.displayArea, area.x, area.y, area.x + area.w - 1, area.y + area.h - 1);
    gl.uniform1i(program.mode, mode);
    gl.uniform1i(program.tvEffect, settings.tvEffect ? 1 : 0);
    gl.uniform1i(program.screenHybrid, hybrid ? 1 : 0);
    gl.uniform4i(program.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);

    gl_bindFramebuffer(FRAMEBUFFER, null);

    gl.bindVertexArray(program.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.displayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, getDisplayArrays(region), gl.STREAM_DRAW);

    if (screen) {
      gl.activeTexture(gl.TEXTURE1);
      gl_bindTexture(TEXTURE_2D, screen.result);
      gl.activeTexture(gl.TEXTURE2);
      gl_bindTexture(TEXTURE_2D, screen.mask);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl_bindTexture(TEXTURE_2D, vram);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (screen) {
      gl.activeTexture(gl.TEXTURE1);
      gl_bindTexture(TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE2);
      gl_bindTexture(TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
    }
    vertexBuffer.reset();

    updateAmbilight();
  }

  // the ambilight is a full-size copy of the display behind it; when it is
  // switched off the copy is skipped, the canvas hidden and its memory freed
  const updateAmbilight = () => {
    const target = ambilight.canvas;
    const enabled = settings.ambilight !== false;
    if (target.hidden === enabled) target.hidden = !enabled;

    if (!enabled) {
      if (target.width || target.height) target.width = target.height = 0;
      return;
    }
    if (!canvas.width || !canvas.height) return;
    if (target.width !== canvas.width || target.height !== canvas.height) {
      target.width = canvas.width;
      target.height = canvas.height;
      ambilight.imageSmoothingEnabled = false; // resizing resets context state
    }
    ambilight.drawImage(canvas, 0, 0);
  }

  // Vertex layout, shared by both programs (see createVertexBuffer):
  //   0 position x, y, z (float32; x/y may be sub-pixel with PGXP, z = primitiveId)
  //  12 texcoord u, v (int16)   16 color (4 x u8)   20 twin (4 x u8)
  //  24 clut (u16)              26 tmode (u8)       27 flags (u8, bit 0 = sprite)
  //  28 uv limits umin, vmin, umax, vmax (int16, inclusive texel range)
  // Positions are floats so sub-pixel vertices need no shader change.
  const vertexStride = 36;

  // attribute layout lives in a VAO per program, bound to that program's own
  // vertex buffer; attributes the linker optimised out (location -1) are skipped
  const createVertexArray = (program, buffer, attributes, stride = vertexStride) => {
    program.vao = gl.createVertexArray();
    gl.bindVertexArray(program.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, size, type, normalized, offset] of attributes) {
      const pos = gl_getAttribLocation(program, name);
      if (pos < 0) continue;
      gl_enableVertexAttribArray(pos);
      gl_vertexAttribPointer(pos, size, type, normalized, stride, offset);
    }
    gl.bindVertexArray(null);
  }
  const getDisplayProgram = (renderer, fmvFilter, screenFilter) => {
    const key = `${fmvFilter},${screenFilter}`;
    let program = renderer.displayPrograms.get(key);
    if (!program) {
      const defines = [[null, 'FMV_SMOOTH', 'FMV_XBR'][fmvFilter], [null, 'SCREEN_XBR', 'SCREEN_SUPER_XBR'][screenFilter]].filter(Boolean);
      if (defines.length) defines.push('DISPLAY_FILTERS');
      program = createProgramDisplay(renderer.displayBuffer, defines);
      renderer.displayPrograms.set(key, program);
      setScaleUniforms(program);
    }
    return program;
  }

  const createProgramDisplay = (displayBuffer, defines = []) => {
    const program = createProgramFromScripts(gl, 'vertex', 'displayScreen', defines);
    gl.useProgram(program);

    program.displayArea = gl_getUniformLocation(program, "u_disp");
    program.mode = gl_getUniformLocation(program, "u_mode");
    program.tvEffect = gl_getUniformLocation(program, "u_tv_effect");
    program.screenHybrid = gl_getUniformLocation(program, "u_screenHybrid");
    gl.uniform1i(gl_getUniformLocation(program, "u_screen"), 1);
    gl.uniform1i(gl_getUniformLocation(program, "u_screenMask"), 2);
    program.drawArea = gl_getUniformLocation(program, "u_draw");

    createVertexArray(program, displayBuffer, [
      ['a_position', 3, gl.FLOAT, false, 0],
      ['a_texcoord', 2, gl.SHORT, false, 12],
    ]);

    return program;
  }

  // pixel shader variant for the render scale, check mask and the
  // texture/sprite filters: each
  // filter's code is only compiled in when one of the two settings uses it,
  // since a shader holding every filter is slower even for nearest.
  // Variants are compiled on first use and kept.
  const filterDefine = f => [null, 'FILTER_BILINEAR', 'FILTER_BILINEAR', 'FILTER_XBR', 'FILTER_MMPX', 'FILTER_BICUBIC'][f] || null;
  const getRendererProgram = (renderer, checkMask, textureFilter, spriteFilter) => {
    const key = (checkMask ? 1 : 0) | (textureFilter << 1) | (spriteFilter << 4) | (scaleShift << 7);
    let program = renderer.rendererPrograms.get(key);
    if (!program) {
      const defines = new Set([`VRAM_SCALE_SHIFT ${scaleShift}`]);
      if (checkMask) defines.add('CHECK_MASK');
      for (const f of [textureFilter, spriteFilter]) {
        const d = filterDefine(f);
        if (d) defines.add('TEXTURE_FILTERS').add(d);
      }
      program = createProgramRenderer(renderer.renderBuffer, [...defines]);
      renderer.rendererPrograms.set(key, program);
      setScaleUniforms(program);
    }
    return program;
  }

  const createProgramRenderer = (renderBuffer, defines = []) => {
    const program = createProgramFromScripts(gl, 'pixel', 'videoram', defines);
    // filter variants read the 36-byte vertices with the filter data; the
    // others the 28-byte ones (flags and UV limits then read as 0)
    const full = defines.includes('TEXTURE_FILTERS');
    gl.useProgram(program);
    program.setMask = gl_getUniformLocation(program, 'u_setMask');
    program.fullResTextures = gl_getUniformLocation(program, 'u_fullResTextures');
    program.textureFilter = gl_getUniformLocation(program, 'u_textureFilter');
    program.spriteFilter = gl_getUniformLocation(program, 'u_spriteFilter');

    createVertexArray(program, renderBuffer, [
      ['a_position', 3, gl.FLOAT, false, 0],
      ['a_texcoord', 2, gl.SHORT, false, 12],
      ['a_color', 4, UNSIGNED_BYTE, true, 16],
      ['a_twin', 4, UNSIGNED_BYTE, false, 20],
      ['a_clut', 1, gl.SHORT, false, 24],
      ['a_tmode', 1, gl.BYTE, false, 26],
      ...(full ? [
        ['a_flags', 1, UNSIGNED_BYTE, false, 27],
        ['a_uvLimits', 4, gl.SHORT, false, 28],
      ] : []),
    ], full ? 36 : 28);

    return program;
  }

  // converts uploaded 16-bit VRAM words to RGBA; draws a single triangle
  // from gl_VertexID, so its VAO has no attributes
  const createProgramUpload = () => {
    const program = createProgramFromScripts(gl, 'vramUploadVertex', 'vramUpload');
    gl.useProgram(program);
    gl.uniform1i(gl_getUniformLocation(program, 'u_source'), 0);
    gl.uniform1i(gl_getUniformLocation(program, 'u_dest'), 1);
    program.setMask = gl_getUniformLocation(program, 'u_setMask');
    program.checkMask = gl_getUniformLocation(program, 'u_checkMask');
    program.vao = gl.createVertexArray();
    return program;
  }

  // the render scale as seen by the shaders
  const setScaleUniforms = program => {
    gl.useProgram(program);
    const s = gl_getUniformLocation(program, 'u_scale');
    const shift = gl_getUniformLocation(program, 'u_scaleShift');
    if (s) gl.uniform1i(s, scale);
    if (shift) gl.uniform1i(shift, scaleShift);
  }
  const applyScaleUniforms = renderer => {
    for (const program of renderer.rendererPrograms.values()) setScaleUniforms(program);
    setScaleUniforms(renderer.programUpload);
    for (const program of renderer.displayPrograms.values()) setScaleUniforms(program);
    setScaleUniforms(renderer.programSuperXbr);
  }

  // VRAM -> VRAM copy honouring the mask bits
  const createProgramCopy = () => {
    const program = createProgramFromScripts(gl, 'vramUploadVertex', 'vramCopy');
    gl.useProgram(program);
    gl.uniform1i(gl_getUniformLocation(program, 'u_vram'), 0);
    program.offset = gl_getUniformLocation(program, 'u_offset');
    program.setMask = gl_getUniformLocation(program, 'u_setMask');
    program.checkMask = gl_getUniformLocation(program, 'u_checkMask');
    program.vao = gl.createVertexArray();
    return program;
  }

  // screen filter passes (native pixels, Super-xBR); draws a single
  // triangle from gl_VertexID
  const createProgramSuperXbr = () => {
    const program = createProgramFromScripts(gl, 'vramUploadVertex', 'superXbr');
    gl.useProgram(program);
    gl.uniform1i(gl_getUniformLocation(program, 'u_source'), 0);
    gl.uniform1i(gl_getUniformLocation(program, 'u_original'), 1);
    program.pass = gl_getUniformLocation(program, 'u_pass');
    program.displayArea = gl_getUniformLocation(program, 'u_disp');
    program.vao = gl.createVertexArray();
    return program;
  }

  // marks VRAM pixels with bit 15 set in the depth buffer (check mask)
  const createProgramMaskDepth = () => {
    const program = createProgramFromScripts(gl, 'vramUploadVertex', 'vramMaskDepth');
    gl.useProgram(program);
    gl.uniform1i(gl_getUniformLocation(program, 'u_vram'), 0);
    program.vao = gl.createVertexArray();
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

  // ---- VRAM textures and the render scale ----
  //
  // VRAM is rendered at 4x, or at 8x (8192x4096) for quality 8 when the GPU
  // supports textures, renderbuffers and viewports that large. 8x needs about
  // 320 MB of GPU memory (two RGBA8 textures and a 16-bit depth buffer) against
  // 80 MB at 4x. If the GPU refuses the allocation, 8x is not offered again.
  const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  let allow8x = gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192 &&
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) >= 8192 &&
    maxViewport[0] >= 8192 && maxViewport[1] >= 4096;
  const desiredScale = () => (allow8x && settings.quality >= 8) ? 8 : 4;
  // maxQuality is not saved with the settings: it belongs to this GPU
  const setMaxQuality = max => {
    Object.defineProperty(settings, 'maxQuality', { value: max, writable: true, enumerable: false, configurable: true });
    if (settings.quality > max) settings.quality = max;
    settings.updateQuality?.();
  }
  const disallow8x = () => {
    allow8x = false;
    setMaxQuality(4);
  }
  setMaxQuality(allow8x ? 8 : 4);

  let vram, vramDepth, vramShadow;
  // attachments are framebuffer state: they only change when the render
  // scale does; everything else only binds the framebuffers
  const fb_vram = gl_createFramebuffer();
  const fb_vramShadow = gl_createFramebuffer();

  // VRAM, depth and shadow textures at render scale n, or null when the GPU
  // cannot provide them (nothing is left allocated then)
  const createVramTextures = n => {
    for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; ++i) { }
    const w = 1024 * n, h = 512 * n;
    const color = createAndBindTexture();
    gl_texImage2D(TEXTURE_2D, 0, RGBA, w, h, 0, RGBA, UNSIGNED_BYTE, null);
    const depth = createDepthComponent(w, h);
    const shadow = createAndBindTexture();
    gl_texImage2D(TEXTURE_2D, 0, RGBA, w, h, 0, RGBA, UNSIGNED_BYTE, null);
    gl_bindTexture(TEXTURE_2D, null);

    const fb = gl_createFramebuffer();
    gl_bindFramebuffer(FRAMEBUFFER, fb);
    gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, color, 0);
    gl_framebufferTexture2D(FRAMEBUFFER, gl.DEPTH_ATTACHMENT, TEXTURE_2D, depth, 0);
    let ok = gl.checkFramebufferStatus(FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl_framebufferTexture2D(FRAMEBUFFER, gl.DEPTH_ATTACHMENT, TEXTURE_2D, null, 0);
    gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, shadow, 0);
    ok = ok && gl.checkFramebufferStatus(FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
    gl_bindFramebuffer(FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    if (ok) return { color, depth, shadow };
    gl.deleteTexture(color); gl.deleteTexture(depth); gl.deleteTexture(shadow);
    return null;
  }

  const attachVramTextures = (t, n) => {
    vram = t.color; vramDepth = t.depth; vramShadow = t.shadow;
    gl_bindFramebuffer(FRAMEBUFFER, fb_vram);
    gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vram, 0);
    gl_framebufferTexture2D(FRAMEBUFFER, gl.DEPTH_ATTACHMENT, TEXTURE_2D, vramDepth, 0);
    gl_bindFramebuffer(FRAMEBUFFER, fb_vramShadow);
    gl_framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, vramShadow, 0);
    gl_bindFramebuffer(FRAMEBUFFER, null);
    scale = n;
    scaleShift = Math.log2(n);
    vramWidth = 1024 * n;
    vramHeight = 512 * n;
  }

  {
    let n = desiredScale(), t = createVramTextures(n);
    if (!t && n !== 4) { disallow8x(); n = 4; t = createVramTextures(4); }
    attachVramTextures(t, n);
  }

  // switch the render scale at runtime: the current VRAM (and shadow) is
  // scaled into new textures, so nothing drawn is lost
  const changeRenderScale = n => {
    flushVertexBuffer();
    const t = createVramTextures(n);
    if (!t) { if (n === 8) disallow8x(); return; }

    const tmp = gl_createFramebuffer();
    gl_bindFramebuffer(DRAW_FRAMEBUFFER, tmp);
    for (const [src, dst] of [[fb_vram, t.color], [fb_vramShadow, t.shadow]]) {
      gl_framebufferTexture2D(DRAW_FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, dst, 0);
      gl_bindFramebuffer(READ_FRAMEBUFFER, src);
      gl_blitFramebuffer(0, 0, vramWidth, vramHeight, 0, 0, 1024 * n, 512 * n, COLOR_BUFFER_BIT, NEAREST);
    }
    gl_bindFramebuffer(READ_FRAMEBUFFER, null);
    gl_bindFramebuffer(DRAW_FRAMEBUFFER, null);
    gl.deleteFramebuffer(tmp);

    const old = [vram, vramDepth, vramShadow];
    attachVramTextures(t, n);
    old.forEach(texture => gl.deleteTexture(texture));
    applyScaleUniforms(window.renderer);
    flushDepth(); // the new depth buffer starts cleared (and mask depth is rebuilt)
  }

  // native-resolution staging texture for readbacks
  const cache = createAndBindTexture();
  gl_texImage2D(TEXTURE_2D, 0, RGBA, 1024, 512, 0, RGBA, UNSIGNED_BYTE, null);

  // native-resolution staging texture for uploads, raw 16-bit VRAM words
  const upload = createAndBindTexture();
  gl_texImage2D(TEXTURE_2D, 0, gl.R16UI, 1024, 512, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, null);

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
  function createShaderFromScript(gl, scriptId, opt_shaderType, defines = []) {
    // look up the script tag by id.
    var shaderScript = document.getElementById(scriptId);
    if (!shaderScript) {
      throw ("*** Error: unknown script element: " + scriptId);
    }

    // extract the contents of the script tag.
    var shaderSource = shaderScript.text;

    // #define lines go right after the #version line, which must come first
    if (defines.length) {
      const eol = shaderSource.indexOf('\n');
      shaderSource = shaderSource.slice(0, eol + 1) + defines.map(d => `#define ${d}\n`).join('') + shaderSource.slice(eol + 1);
    }

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
  function createProgramFromScripts(gl, vertexShaderId, fragmentShaderId, defines = []) {
    var vertexShader = createShaderFromScript(gl, vertexShaderId, gl.VERTEX_SHADER);
    var fragmentShader = createShaderFromScript(gl, fragmentShaderId, gl.FRAGMENT_SHADER, defines);
    return createProgram(gl, vertexShader, fragmentShader);
  }

  /**
   *
   * @returns vertex-buffer
   */
  // layout: see vertexStride in enge:webgl2
  function createVertexBuffer(reverse = false) {
    // typed-array stores are about twice as fast as DataView calls; WebGL and
    // typed arrays both use the platform byte order
    // 36 bytes with the filter data (sprite flag, UV limits), 28 without
    let bytesPerVertex = 36;
    const buffer = new Uint8Array(36 * 43690);
    const i16 = new Int16Array(buffer.buffer);
    const u16 = new Uint16Array(buffer.buffer);
    const u32 = new Uint32Array(buffer.buffer);
    const f32 = new Float32Array(buffer.buffer);

    let index = 0;
    // flags and UV limits of the primitive being added (see setPrimitive)
    let flags = 0, umin = 0, vmin = 0, umax = 0, vmax = 0;
    buffer.setPrimitive = (f, u0, v0, u1, v1) => {
      flags = f; umin = u0; vmin = v0; umax = u1; vmax = v1;
    }
    buffer.addVertex = (x, y, u, v, c = 0x00808080, cl) => {
      if (reverse) {
        index -= bytesPerVertex;
      }
      const h = index >> 1, w = index >> 2;
      f32[w + 0] = x;
      f32[w + 1] = y;
      f32[w + 2] = primitiveId;
      i16[h + 6] = u;
      i16[h + 7] = v;
      u32[w + 4] = c;
      u32[w + 5] = gpu.twin;
      u16[h + 12] = cl;
      buffer[index + 26] = ((gpu.status >> 7) & 3) | ((gpu.status & 31) << 2);
      // flags and UV limits are only read by the filter shaders
      if (bytesPerVertex === 36) {
        buffer[index + 27] = flags;
        i16[h + 14] = umin;
        i16[h + 15] = vmin;
        i16[h + 16] = umax;
        i16[h + 17] = vmax;
      }
      if (!reverse) {
        index += bytesPerVertex;
      }
    }

    // vertex size: 36 with the filter data, 28 without; only while empty
    buffer.setStride = n => {
      bytesPerVertex = n;
      buffer.reset();
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

