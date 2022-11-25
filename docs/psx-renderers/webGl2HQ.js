"use strict"

const $gpu = {
};

const sbgr2rgba = new Uint32Array(65536);
const transfer = new Uint32Array(4096 * 2048);
const view = new Uint8Array(transfer.buffer);
const vertexBuffer = utils.createVertexBuffer();

for (let i = 0; i < 65536; ++i) {
  sbgr2rgba[i] = ((i >>> 0) & 0x1f) << 3;      // r
  sbgr2rgba[i] |= ((i >>> 5) & 0x1f) << 11;      // g
  sbgr2rgba[i] |= ((i >>> 10) & 0x1f) << 19;      // b
  sbgr2rgba[i] |= ((i >>> 15) & 0x01) ? 0xff000000 : 0; // a
}

let canvas = null;
let ambilight = null;

function WebGLRenderer(cv) {
  canvas = cv;
  ambilight = document.querySelector('#ambilight').getContext('2d', { alpha: false });
  ambilight.imageSmoothingEnabled = false;

  let gl = null;
  this.gl = null;
  this.mode = 'disp';
  this.fpsRenderCounter = 0;
  this.fpsCounter = 0;
  this.skipped = 0;
  this.renderMode = 4;
  this.layer = 0;

  try {
    this.gl = gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      depth: false,
      stencil: false,
    });
  }
  catch (e) {
    alert("Error: Unable to get WebGL context");
    return;
  }

  if (gl) {
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DITHER);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.SAMPLE_COVERAGE);
    gl.disable(gl.SCISSOR_TEST);

    gl.enableVertexAttribArray(0);

    this.displayBuffer = gl.createBuffer();
    this.programDisplay = createProgramDisplay(gl, this.displayBuffer);
    this.renderBuffer = gl.createBuffer();
    this.programRenderer = createProgramRenderer(gl, this.renderBuffer);

    // create texture
    this.vram = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.vram);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4096, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.fb_vram = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_vram);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // create texture
    this.vramShadow = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.vramShadow);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4096, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.fb_vramShadow = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_vramShadow);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vramShadow, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // create texture
    this.cache = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cache);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4096, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.fb_cache = gl.createFramebuffer();

    // copy texture data
    gl.bindTexture(gl.TEXTURE_2D, this.vram);
    transfer.fill(0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4096, 2048, gl.RGBA, gl.UNSIGNED_BYTE, view);

  }
  else {
    alert("Error: Your browser does not appear to support WebGL.");
  }
}

WebGLRenderer.prototype.loadImage = function (x, y, w, h, buffer) {
  flushVertexBuffer(this);
  const gl = this.gl;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_vram);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_cache);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  // blit from vram -> cache
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_cache);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_vram);
  gl.blitFramebuffer(4 * x, 4 * y, 4 * (x + w), 4 * (y + h), x, y, x + w, y + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_cache);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, view);

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

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.moveImage = function (sx, sy, dx, dy, w, h) {
  flushVertexBuffer(this);
  const gl = this.gl;

  sx *= 4;
  sy *= 4;
  dx *= 4;
  dy *= 4;
  w *= 4;
  h *= 4;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_vramShadow);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vramShadow, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_cache);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  // blit from vramShadow -> cache
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_cache);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_vramShadow);
  gl.blitFramebuffer(sx, sy, sx + w, sy + h, sx, sy, sx + w, sy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // blit from cache -> vramShadow
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_vramShadow);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_cache);
  gl.blitFramebuffer(sx, sy, sx + w, sy + h, dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // blit from cache -> vram
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_vram);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_cache);
  gl.blitFramebuffer(sx, sy, sx + w, sy + h, dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.storeImage = function (img) {
  flushVertexBuffer(this);
  const gl = this.gl;

  for (let i = 0, l = img.pixelCount; i < l; ++i) {
    const sbgr = img.buffer[i] >>> 0;
    transfer[i] = sbgr2rgba[sbgr];
  }

  // copy texture data
  gl.bindTexture(gl.TEXTURE_2D, this.cache);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, img.x, img.y, img.w, img.h, gl.RGBA, gl.UNSIGNED_BYTE, view);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_vramShadow);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vramShadow, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_cache);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  // blit from cache -> vramShadow
  let { x, y, w, h } = img;
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_vramShadow);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_cache);
  gl.blitFramebuffer(x, y, x + w, y + h, 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_vram);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  // blit from cache -> vram
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_vram);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_cache);
  gl.blitFramebuffer(x, y, x + w, y + h, 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.largePrimitive = function (x1, y1, x2, y2, x3, y3, x4 = x3, y4 = y3) {
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

WebGLRenderer.prototype.outsideDrawArea = function (x1, y1, x2, y2, x3, y3, x4 = x3, y4 = y3) {
  ++this.skipped;
  if ((x1 < $gpu.daL) && (x2 < $gpu.daL) && (x3 < $gpu.daL) && (x4 < $gpu.daL)) return true;
  if ((x1 > $gpu.daR) && (x2 > $gpu.daR) && (x3 > $gpu.daR) && (x4 > $gpu.daR)) return true;
  if ((y1 < $gpu.daT) && (y2 < $gpu.daT) && (y3 < $gpu.daT) && (y4 < $gpu.daT)) return true;
  if ((y1 > $gpu.daB) && (y2 > $gpu.daB) && (y3 > $gpu.daB) && (y4 > $gpu.daB)) return true;

  --this.skipped;
  return false;
}

WebGLRenderer.prototype.updateTransparencyMode = function (data) {
  const mode = (data[0] & 0x02000000) ? ((gpu.status >> 5) & 3) : 4;

  if (this.renderMode === mode) return;
  flushVertexBuffer(this);
  this.renderMode = mode;
  ++this.layer;

  this.setTransparencyMode(mode, this.programRenderer);
}

WebGLRenderer.prototype.setTransparencyMode = function (mode, program) {
  const gl = this.gl;
  gl.useProgram(program);

  switch (mode & 0xf) {
    case 0: {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.SRC_ALPHA, gl.SRC_ALPHA);
      if (program.alpha) {
        gl.uniform1f(program.alpha, 0.50);
      }
    } break;
    case 1: {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      if (program.alpha) {
        gl.uniform1f(program.alpha, 1.00);
      }
    } break;
    case 2: {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
      if (program.alpha) {
        gl.uniform1f(program.alpha, 1.00);
      }
    } break;
    case 3: {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.ONE);
      if (program.alpha) {
        gl.uniform1f(program.alpha, 0.75);
      }
    } break;
    case 4: {
      gl.disable(gl.BLEND);
      if (program.alpha) {
        gl.uniform1f(program.alpha, 0.00);
      }
    } break;
  }
}

WebGLRenderer.prototype.drawLine = function (data, c1, xy1, c2, xy2) {
  this.updateDrawArea();

  var x1 = $gpu.daX + ((data[xy1] << 21) >> 21);
  var y1 = $gpu.daY + ((data[xy1] << 5) >> 21);
  var x2 = $gpu.daX + ((data[xy2] << 21) >> 21);
  var y2 = $gpu.daY + ((data[xy2] << 5) >> 21);

  if (this.outsideDrawArea(x1, y1, x2, y2, x1, y1)) return;
  if (this.largePrimitive(x1, y1, x2, y2, x1, y1)) return;

  if (!vertexBuffer.canHold(6)) flushVertexBuffer(this);
  this.updateTransparencyMode(data);

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
    buffer.addVertex(x2 + 1, y2 + 0, 0, 0,((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
    buffer.addVertex(x2 + 1, y2 + 1, 0, 0, ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff)));
  }
}

WebGLRenderer.prototype.drawTriangle = function (data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
  this.updateDrawArea();

  // set packetId on each vertex
  c1 = ((data[0] & 0xff000000) | (data[c1] & 0x00ffffff));
  c2 = ((data[0] & 0xff000000) | (data[c2] & 0x00ffffff));
  c3 = ((data[0] & 0xff000000) | (data[c3] & 0x00ffffff));

  const x1 = $gpu.daX + ((data[xy1] << 21) >> 21);
  const y1 = $gpu.daY + ((data[xy1] << 5) >> 21);
  const x2 = $gpu.daX + ((data[xy2] << 21) >> 21);
  const y2 = $gpu.daY + ((data[xy2] << 5) >> 21);
  const x3 = $gpu.daX + ((data[xy3] << 21) >> 21);
  const y3 = $gpu.daY + ((data[xy3] << 5) >> 21);

  if (this.outsideDrawArea(x1, y1, x2, y2, x3, y3)) return;
  if (this.largePrimitive(x1, y1, x2, y2, x3, y3)) return;

  if (!vertexBuffer.canHold(6)) flushVertexBuffer(this);
  this.updateTransparencyMode(data);

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

WebGLRenderer.prototype.drawRectangle = function (data, tx, ty, cl) {
  this.updateDrawArea();

  var x = $gpu.daX + ((data[1] << 21) >> 21);
  var y = $gpu.daY + ((data[1] << 5) >> 21);
  var c = data[0];
  var w = (data[2] << 16) >> 16;
  var h = (data[2] >> 16);
  if (!w || !h) return;

  if (this.outsideDrawArea(x, y, x + w, y, x, y + h, x + w, y + h)) return;
  if (this.largePrimitive(x, y, x + w, y, x, y + h, x + w, y + h)) return;

  if (!vertexBuffer.canHold(6)) flushVertexBuffer(this);
  this.updateTransparencyMode(data);

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

WebGLRenderer.prototype.fillRectangle = function (data) {
  flushVertexBuffer(this);

  let gl = this.gl;

  var x = (data[1] << 16) >>> 16;
  var y = (data[1] << 0) >>> 16;
  var w = (data[2] << 16) >>> 16;
  var h = (data[2] << 0) >>> 16;
  var c = (data[0]);

  x = (x & 0x3f0);
  y = (y & 0x1ff);
  w = ((w & 0x3ff) + 15) & ~15;
  h = (h & 0x1ff);
  if (!w && !h) return;

  transfer.fill(c, 0, 1);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_cache);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);
  gl.activeTexture(gl.TEXTURE0 + 0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.cache);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, view);

  // blit from cache -> vramShadow
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_vramShadow);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vramShadow, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_cache);
  gl.blitFramebuffer(0, 0, 1, 1, 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // blit from cache -> vram
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_vram);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_cache);
  gl.blitFramebuffer(0, 0, 1, 1, 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.updateDrawArea = function () {
  if ($gpu.daM) {
    flushVertexBuffer(this);
    $gpu.daM = false;

    this.gl.useProgram(this.programDisplay);
    this.gl.uniform4i(this.programDisplay.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);
    this.gl.useProgram(this.programRenderer);
    this.gl.uniform4i(this.programRenderer.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);
  }
}

WebGLRenderer.prototype.setDrawAreaOF = function (x, y) {
  $gpu.daX = x;
  $gpu.daY = y;
}

WebGLRenderer.prototype.setDrawAreaTL = function (x, y) {
  $gpu.daL = x;
  $gpu.daT = y;

  $gpu.daM = true;
}

WebGLRenderer.prototype.setDrawAreaBR = function (x, y) {
  $gpu.daR = x;
  $gpu.daB = y;

  $gpu.daM = true;
}

WebGLRenderer.prototype.onVBlankBegin = function () {
  const gl = this.gl;

  flushVertexBuffer(this);
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

  this.setTransparencyMode(this.renderMode, this.programRenderer);
  this.layer = 0;


  ++this.fpsCounter;
}

WebGLRenderer.prototype.onVBlankEnd = function () {
}

WebGLRenderer.prototype.setMode = function (mode) {
  this.mode = mode;
}

function flushVertexBuffer(renderer) {
  const gl = renderer.gl;

  if (vertexBuffer.index) {
    gl.useProgram(renderer.programRenderer);
    gl.viewport(0, 0, 4096, 2048); // texture dimensions

    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.displayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexBuffer, gl.STATIC_DRAW, 0, vertexBuffer.index);

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.fb_vram);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.vramShadow);
    gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.size());

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.fb_vramShadow);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.vram);
    gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.size());

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    vertexBuffer.reset();
  }
}

function getDisplayArrays(area) {
  vertexBuffer.addVertex(0, 0, area.x + 0, area.y + 0, 0xffffffff);
  vertexBuffer.addVertex(1024, 0, area.x + area.w, area.y + 0, 0xffffffff);
  vertexBuffer.addVertex(0, 512, area.x + 0, area.y + area.h, 0xffffffff);

  vertexBuffer.addVertex(0, 512, area.x + 0, area.y + area.h, 0xffffffff);
  vertexBuffer.addVertex(1024, 0, area.x + area.w, area.y + 0, 0xffffffff);
  vertexBuffer.addVertex(1024, 512, area.x + area.w, area.y + area.h, 0xffffffff);

  return vertexBuffer.view();
}

function showDisplay(renderer, mode, region = { x: 0, y: 0, w: 1024, h: 512 }) {
  const gl = renderer.gl;
  const program = renderer.programDisplay;

  canvas.width = region.w * settings.quality;
  canvas.height = region.h * settings.quality;
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.useProgram(program);
  gl.uniform1f(program.time, (performance.now() >>> 0) / 1000.0);
  const area = gpu.getDisplayArea();
  gl.uniform4i(program.displayArea, area.x, area.y, area.x + area.w - 1, area.y + area.h - 1);
  gl.uniform1i(program.mode, mode);

  gl.activeTexture(gl.TEXTURE0 + 0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.vramShadow);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.displayBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getDisplayArrays(region), gl.STATIC_DRAW);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  vertexBuffer.reset();

  // if (canvas.width && canvas.height) {
  //   ambilight.canvas.width = canvas.width;
  //   ambilight.canvas.height = canvas.height;
  //   ambilight.drawImage(canvas, 0, 0);
  // }
}

const vertexStride = 32;
function createProgramDisplay(gl, displayBuffer) {
  const program = utils.createProgramFromScripts(gl, 'vertex', 'displayScreen');
  gl.useProgram(program);

  program.displayArea = gl.getUniformLocation(program, "u_disp");
  program.time = gl.getUniformLocation(program, "u_time");
  program.mode = gl.getUniformLocation(program, "u_mode");
  program.drawArea = gl.getUniformLocation(program, "u_draw");

  gl.bindBuffer(gl.ARRAY_BUFFER, displayBuffer);

  program.vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(program.vertexPosition);
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, vertexStride, 0);

  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, vertexStride, 4);

  program.vertexColor = gl.getAttribLocation(program, "a_color");
  gl.enableVertexAttribArray(program.vertexColor);
  gl.vertexAttribPointer(program.vertexColor, 4, gl.UNSIGNED_BYTE, true, vertexStride, 8);

  return program;
}

function createProgramRenderer(gl, renderBuffer) {
  const program = utils.createProgramFromScripts(gl, 'pixel', 'videoram');
  gl.useProgram(program);

  program.drawArea = gl.getUniformLocation(program, "u_draw");
  program.alpha = gl.getUniformLocation(program, "u_alpha");

  // gl.bindBuffer(gl.ARRAY_BUFFER, renderBuffer);

  program.vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(program.vertexPosition);
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, vertexStride, 0);

  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, vertexStride, 4);

  program.vertexColor = gl.getAttribLocation(program, "a_color");
  gl.enableVertexAttribArray(program.vertexColor);
  gl.vertexAttribPointer(program.vertexColor, 4, gl.UNSIGNED_BYTE, true, vertexStride, 8);

  program.twin = gl.getAttribLocation(program, "a_twin");
  gl.enableVertexAttribArray(program.twin);
  gl.vertexAttribPointer(program.twin, 4, gl.UNSIGNED_BYTE, false, vertexStride, 12);

  program.clut = gl.getAttribLocation(program, "a_clut");
  gl.enableVertexAttribArray(program.clut);
  gl.vertexAttribPointer(program.clut, 1, gl.SHORT, false, vertexStride, 16);

  program.textureMode = gl.getAttribLocation(program, "a_tmode");
  gl.enableVertexAttribArray(program.textureMode);
  gl.vertexAttribPointer(program.textureMode, 1, gl.BYTE, false, vertexStride, 19);

  return program;
}
