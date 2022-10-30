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

function WebGLRenderer(cv) {
  canvas = cv;
  let gl = null;
  this.gl = null;
  this.mode = 'draw';
  this.fpsRenderCounter = 0;
  this.fpsCounter = 0;
  this.skipped = 0;

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

    // create texture
    this.vramShadow = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.vramShadow);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4096, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    // create texture
    this.cache = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cache);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4096, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

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
  const gl = this.gl;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let read_fb = this.read_fb = this.read_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, read_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  let draw_fb = this.draw_fb = this.draw_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  // blit from vram -> cache
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read_fb);
  gl.blitFramebuffer(4 * x, 4 * y, 4 * (x + w), 4 * (y + h), x, y, x + w, y + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

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

  let draw_fb = this.draw_fb = this.draw_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  let read_fb = this.read_fb = this.read_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, read_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  // blit from vram -> cache
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, read_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, draw_fb);
  gl.blitFramebuffer(sx, sy, sx + w, sy + h, sx, sy, sx + w, sy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // blit from cache -> vram
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read_fb);
  gl.blitFramebuffer(sx, sy, sx + w, sy + h, dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.storeImage = function (img) {
  flushVertexBuffer(this);

  for (let i = 0, l = img.pixelCount; i < l; ++i) {
    const sbgr = img.buffer[i] >>> 0;
    transfer[i] = sbgr2rgba[sbgr];
  }

  const gl = this.gl;

  // copy texture data
  gl.bindTexture(gl.TEXTURE_2D, this.cache);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, img.x, img.y, img.w, img.h, gl.RGBA, gl.UNSIGNED_BYTE, view);

  let draw_fb = this.draw_fb = this.draw_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vramShadow, 0);

  let read_fb = this.read_fb = this.read_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, read_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  // blit from cache -> vram
  let { x, y, w, h } = img;
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read_fb);
  gl.blitFramebuffer(x, y, x + w, y + h, 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), gl.COLOR_BUFFER_BIT, gl.NEAREST);

  draw_fb = this.draw_fb = this.draw_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  // blit from cache -> vram
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read_fb);
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
}, 0

WebGLRenderer.prototype.drawLine = function (data, c1, xy1, c2, xy2) {
  this.updateDrawArea();
}

WebGLRenderer.prototype.updateTransparencyMode = function (data) {
  const mode = (data[0] & 0x02000000) ? ((gpu.status >> 5) & 3) : 4;
  const gl = this.gl;

  if (this.renderMode === mode) return;
  flushVertexBuffer(this);
  this.renderMode = mode;

  switch (mode & 0xf) {
    case 0: gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.SRC_ALPHA, gl.SRC_ALPHA);
      gl.uniform1f(this.programRenderer.alpha, 0.50);
      break;
    case 1: gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1f(this.programRenderer.alpha, 1.00);
      break;
    case 2: gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
      gl.uniform1f(this.programRenderer.alpha, 1.00);
      break;
    case 3: gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.ONE);
      gl.uniform1f(this.programRenderer.alpha, 0.75);
      break;
    case 4: gl.disable(gl.BLEND);
      gl.uniform1f(this.programRenderer.alpha, 0.00);
      break;
  }
}
WebGLRenderer.prototype.drawTriangle = function (data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
  this.updateDrawArea();
  this.updateTransparencyMode(data);

  const x1 = $gpu.daX + ((data[xy1] << 21) >> 21);
  const y1 = $gpu.daY + ((data[xy1] << 5) >> 21);
  const x2 = $gpu.daX + ((data[xy2] << 21) >> 21);
  const y2 = $gpu.daY + ((data[xy2] << 5) >> 21);
  const x3 = $gpu.daX + ((data[xy3] << 21) >> 21);
  const y3 = $gpu.daY + ((data[xy3] << 5) >> 21);

  if (this.outsideDrawArea(x1, y1, x2, y2, x3, y3)) return;
  if (this.largePrimitive(x1, y1, x2, y2, x3, y3)) return;
  if (!vertexBuffer.canHold(3)) flushVertexBuffer(this);

  const textured = (data[0] & 0x04000000) === 0x04000000;
  // console.log([x1, y1, data[c1].toString(16)], [x2, y2, data[c2].toString(16)], [x3, y3, data[c3].toString(16)]);

  if (!textured) {
    const buffer = vertexBuffer;//this.getVertexBuffer(3, data[0]);
    buffer.addVertex(x1, y1, -1, -1, data[c1]);
    buffer.addVertex(x2, y2, -1, -1, data[c2]);
    buffer.addVertex(x3, y3, -1, -1, data[c3]);
  }
  else {
    const buffer = vertexBuffer;
    const u1 = (data[uv1] >>> 0) & 255;
    const v1 = (data[uv1] >>> 8) & 255;
    const u2 = (data[uv2] >>> 0) & 255;
    const v2 = (data[uv2] >>> 8) & 255;
    const u3 = (data[uv3] >>> 0) & 255;
    const v3 = (data[uv3] >>> 8) & 255;

    const tox = 0*(gpu.status & 0x0f) << 6;
    const toy = (gpu.status & 0x10) << 4;

    // console.log((gpu.status >> 7) & 3, tox, toy, u1, v1)

    buffer.addVertex(x1, y1, tox + u1, toy + v1, data[c1]);
    buffer.addVertex(x2, y2, tox + u2, toy + v2, data[c2]);
    buffer.addVertex(x3, y3, tox + u3, toy + v3, data[c3]);
  }
}

WebGLRenderer.prototype.drawRectangle = function (data, tx, ty, cl) {
  this.updateDrawArea();
  this.updateTransparencyMode(data);

  var x = $gpu.daX + ((data[1] << 21) >> 21);
  var y = $gpu.daY + ((data[1] << 5) >> 21);
  var c = data[0];
  var w = (data[2] << 16) >> 16;
  var h = (data[2] >> 16);
  if (!w || !h) return;

  if (this.outsideDrawArea(x, y, x + w, y, x, y + h, x + w, y + h)) return;
  if (this.largePrimitive(x, y, x + w, y, x, y + h, x + w, y + h)) return;
  if (!vertexBuffer.canHold(6)) flushVertexBuffer(this);

  var textured = (data[0] & 0x04000000) === 0x04000000;

  if (!textured) {
    var buffer = vertexBuffer;//this.getVertexBuffer(6, data[0]);
    buffer.addVertex(x + 0, y + 0, -1, -1, c);
    buffer.addVertex(x + w, y + 0, -1, -1, c);
    buffer.addVertex(x + 0, y + h, -1, -1, c);

    buffer.addVertex(x + w, y + 0, -1, -1, c);
    buffer.addVertex(x + 0, y + h, -1, -1, c);
    buffer.addVertex(x + w, y + h, -1, -1, c);
  }
  else {
    var tl = tx + 0;
    var tr = tx + w;
    if (gpu.txflip) {
      tl = tx + 0
      tr = tx - w + 1
    }

    var tt = ty + 0;
    var tb = ty + h;
    if (gpu.tyflip) {
      tt = ty + 0
      tb = ty - h + 1
    }

    const tox = 0*(gpu.status & 0x0f) << 6;
    const toy = (gpu.status & 0x10) << 4;

    var buffer = vertexBuffer;//this.getVertexBuffer(6, data[0]);
    buffer.addVertex(x + 0, y + 0, tox + tl, toy + tt, c);
    buffer.addVertex(x + w, y + 0, tox + tr, toy + tt, c);
    buffer.addVertex(x + 0, y + h, tox + tl, toy + tb, c);

    buffer.addVertex(x + w, y + 0, tox + tr, toy + tt, c);
    buffer.addVertex(x + 0, y + h, tox + tl, toy + tb, c);
    buffer.addVertex(x + w, y + h, tox + tr, toy + tb, c);
  }
}

WebGLRenderer.prototype.fillRectangle = function (data) {
  flushVertexBuffer(this);

  let gl = this.gl;

  var x = (data[1] << 16) >>> 16;
  var y = (data[1] << 0) >>> 16;
  var w = (data[2] << 16) >>> 16;
  var h = (data[2] << 0) >>> 16;
  var c = (data[0] & 0xf8f8f8);

  x = (x & 0x3f0);
  y = (y & 0x1ff);
  w = ((w & 0x3ff) + 15) & ~15;
  h = (h & 0x1ff);
  if (!w && !h) return;

  transfer.fill(c, 0, 1);

  let draw_fb = this.draw_fb = this.draw_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vramShadow, 0);

  let read_fb = this.read_fb = this.read_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, read_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  // blit from cache -> vram
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read_fb);
  gl.blitFramebuffer(0, 0, 1, 1, 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), gl.COLOR_BUFFER_BIT, gl.NEAREST);

  draw_fb = this.draw_fb = this.draw_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  // blit from cache -> vram
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read_fb);
  gl.blitFramebuffer(0, 0, 1, 1, 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), gl.COLOR_BUFFER_BIT, gl.NEAREST);


  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}


WebGLRenderer.prototype.updateDrawArea = function () {
  if ($gpu.daM) {
    flushVertexBuffer(this);

    this.gl.useProgram(this.programDisplay);
    this.gl.uniform4i(this.programDisplay.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);
    this.gl.useProgram(this.programRenderer);
    this.gl.uniform4i(this.programRenderer.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);
    $gpu.daM = false;
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
  this.updateTransparencyMode([0]);

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

    let draw_fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderer.vramShadow, 0);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.vram);

    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.displayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexBuffer.view(), gl.STATIC_DRAW);

    gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.index / 32);

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
  canvas.height = region.h * settings.quality * 2;
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
}

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
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, 32, 0);

  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, 32, 4);

  program.vertexColor = gl.getAttribLocation(program, "a_color");
  gl.enableVertexAttribArray(program.vertexColor);
  gl.vertexAttribPointer(program.vertexColor, 4, gl.UNSIGNED_BYTE, true, 32, 8);

  return program;
}

function createProgramRenderer(gl, renderBuffer) {
  const program = utils.createProgramFromScripts(gl, 'pixel', 'videoram');
  gl.useProgram(program);

  // program.displayArea = gl.getUniformLocation(program, "u_disp");
  // program.time = gl.getUniformLocation(program, "u_time");
  // program.mode = gl.getUniformLocation(program, "u_mode");
  program.drawArea = gl.getUniformLocation(program, "u_draw");
  program.alpha = gl.getUniformLocation(program, "u_alpha");

  // gl.bindBuffer(gl.ARRAY_BUFFER, renderBuffer);

  program.vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(program.vertexPosition);
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, 32, 0);

  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, 32, 4);

  program.vertexColor = gl.getAttribLocation(program, "a_color");
  gl.enableVertexAttribArray(program.vertexColor);
  gl.vertexAttribPointer(program.vertexColor, 4, gl.UNSIGNED_BYTE, true, 32, 8);

  program.textureMode = gl.getAttribLocation(program, "a_tmode");
  gl.enableVertexAttribArray(program.textureMode);
  gl.vertexAttribPointer(program.textureMode, 1, gl.BYTE, false, 32, 12);

  return program;
}
