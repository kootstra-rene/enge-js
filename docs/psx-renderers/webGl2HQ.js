"use strict";

const sbgr2rgba = new Uint32Array(65536);
const transfer = new Uint32Array(1024 * 512);
const view = new Uint8Array(transfer.buffer);

const _ = null;

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
  this.fpsRenderCounter = 0;
  this.fpsCounter = 0;
  this.drawArea = {};
  this.drawOffset = {};

  try {
    this.gl = gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      depth: false,
      stencil: false,
    });
    canvas.imageSmoothingEnabled = false;
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

    this.directVideoRamContext = createDirectVideoRamContext(gl);
    this.renderContext = createVideoRamRenderContext(gl);
    this.displayContext = createDisplayContext(gl);

    this.buffers = [
      new VertexRenderBuffer(0).init(gl, this.renderContext), // transparent rendering mode 0
      new VertexRenderBuffer(1).init(gl, this.renderContext), // transparent rendering mode 1
      new VertexRenderBuffer(2).init(gl, this.renderContext), // transparent rendering mode 2
      new VertexRenderBuffer(3).init(gl, this.renderContext), // transparent rendering mode 3
      new VertexRenderBuffer(4).init(gl, this.renderContext), // opaque rendering
      new VertexDirectBuffer(4).init(gl, this.directVideoRamContext, this.renderContext), // storing images
      new VertexDisplayBuffer(4).init(gl, this.displayContext), // display
    ];

  }
  else {
    alert("Error: Your browser does not appear to support WebGL.");
  }
}

WebGLRenderer.prototype.memoryToCache = function (x, y, w, h) {
  const gl = this.gl;

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.directVideoRamContext.framebuffer);
  gl.bindTexture(gl.TEXTURE_2D, this.directVideoRamContext.texture);

  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.directVideoRamContext.texture, 0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, view);

  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.cacheToVideoRam = function (x, y, w, h) {
  // note: no blitting here because stuff needs to be done in the shader
  const buffer = this.buffers[5];

  VertexBuffer.updateDepth();

  buffer.addVertex(x + 0, y + 0);
  buffer.addVertex(x + w, y + 0);
  buffer.addVertex(x + 0, y + h);

  buffer.addVertex(x + 0, y + h);
  buffer.addVertex(x + w, y + 0);
  buffer.addVertex(x + w, y + h);
}

WebGLRenderer.prototype.videoRamToCache = function (sx, sy, dx, dy, w, h) {
  const gl = this.gl;

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.renderContext.mainFramebuffer);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.renderContext.mainTexture, 0);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.directVideoRamContext.framebuffer);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.directVideoRamContext.texture, 0);

  gl.blitFramebuffer(4 * sx, 4 * sy, 4 * (sx + w), 4 * (sy + h), dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
}

WebGLRenderer.prototype.clearImage = function (x, y, w, h, c) {
  this.flushRenderBuffer();

  transfer.fill(c, 0, w * h);

  this.memoryToCache(x, y, w, h);
  this.cacheToVideoRam(x, y, w, h);
}

WebGLRenderer.prototype.loadImage = function (x, y, w, h, buffer) {
  this.flushRenderBuffer();

  this.videoRamToCache(x, y, x, y, w, h);

  // read pixels from cache
  const gl = this.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.directVideoRamContext.framebuffer);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, view);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

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
}

WebGLRenderer.prototype.moveImage = function (sx, sy, dx, dy, w, h) {
  this.flushRenderBuffer();

  this.videoRamToCache(sx, sy, dx, dy, w, h);
  this.cacheToVideoRam(dx, dy, w, h);
}

WebGLRenderer.prototype.storeImage = function (img) {
  this.flushRenderBuffer();

  const { x, y, w, h, pixelCount, buffer } = img;

  for (let i = 0; i < pixelCount; ++i) {
    transfer[i] = sbgr2rgba[buffer[i] >>> 0];
  }

  this.memoryToCache(x, y, w, h);
  this.cacheToVideoRam(x, y, w, h);
}

WebGLRenderer.prototype.getDrawBuffer = function (data) {
  const flags = (data[0] >>> 24) & 7;

  VertexBuffer.updateDepth();

  if (0 === (flags & 2)) {
    return this.buffers[4];
  }
  return this.buffers[(gpu.status >> 5) & 3];
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
  const { X1, Y1, X2, Y2 } = this.drawArea;
  if ((x1 < X1) && (x2 < X1) && (x3 < X1) && (x4 < X1)) return true;
  if ((x1 > X2) && (x2 > X2) && (x3 > X2) && (x4 > X2)) return true;
  if ((y1 < Y1) && (y2 < Y1) && (y3 < Y1) && (y4 < Y1)) return true;
  if ((y1 > Y2) && (y2 > Y2) && (y3 > Y2) && (y4 > Y2)) return true;
  return false;
}

WebGLRenderer.prototype.drawLine = function (data, c1, xy1, c2, xy2) {
  // todo: check if gl.LINES can be an option
  this.flushImageBuffer();

  this.syncDrawArea();

  const ox = this.drawOffset.X;
  const oy = this.drawOffset.Y;
  const x1 = ox + ((data[xy1] << 21) >> 21);
  const y1 = oy + ((data[xy1] << 5) >> 21);
  const x2 = ox + ((data[xy2] << 21) >> 21);
  const y2 = oy + ((data[xy2] << 5) >> 21);

  if (this.outsideDrawArea(x1, y1, x2, y2, x1, y1)) return;
  if (this.largePrimitive(x1, y1, x2, y2, x1, y1)) return;

  const buffer = this.getDrawBuffer(data);

  var w = Math.abs(x1 - x2);
  var h = Math.abs(y1 - y2);

  if (x1 !== x2 || y1 !== y2) {
    if (w >= h) {
      buffer.addVertex(x1, y1 + 1, _, _, data[c1]);
      buffer.addVertex(x1, y1 + 0, _, _, data[c1]);
      buffer.addVertex(x2, y2 + 0, _, _, data[c2]);

      buffer.addVertex(x2, y2 + 0, _, _, data[c2]);
      buffer.addVertex(x2, y2 + 1, _, _, data[c2]);
      buffer.addVertex(x1, y1 + 1, _, _, data[c1]);

    }
    else {
      buffer.addVertex(x1 + 0, y1, _, _, data[c1]);
      buffer.addVertex(x1 + 1, y1, _, _, data[c1]);
      buffer.addVertex(x2 + 1, y2, _, _, data[c2]);

      buffer.addVertex(x2 + 1, y2, _, _, data[c2]);
      buffer.addVertex(x2 + 0, y2, _, _, data[c2]);
      buffer.addVertex(x1 + 0, y1, _, _, data[c1]);
    }
  }
  else {
    buffer.addVertex(x2 + 0, y2 + 0, _, _, data[c2]);
    buffer.addVertex(x2 + 1, y2 + 0, _, _, data[c2]);
    buffer.addVertex(x2 + 0, y2 + 1, _, _, data[c2]);

    buffer.addVertex(x2 + 0, y2 + 1, _, _, data[c2]);
    buffer.addVertex(x2 + 1, y2 + 0, _, _, data[c2]);
    buffer.addVertex(x2 + 1, y2 + 1, _, _, data[c2]);
  }

}

WebGLRenderer.prototype.flushImageBuffer = function () {
  this.buffers[5].flush();
}

WebGLRenderer.prototype.flushRenderBuffer = function () {
  for (let i = 4; i >= 0; --i) {
    this.buffers[i].flush();
  }
}

WebGLRenderer.prototype.syncDrawArea = function () {
  const drawAreaBeforeChange = {};

  if (gpu.syncDrawArea(this.drawArea, drawAreaBeforeChange)) {
    const gl = this.gl;
    const { X1, Y1, X2, Y2 } = this.drawArea;

    // todo: flush everything until now;
    this.flushImageBuffer();
    this.flushRenderBuffer();

    gl.useProgram(this.renderContext.program);
    gl.uniform4i(this.renderContext.program.drawArea, X1, Y1, X2, Y2);

    this.syncDrawAreaToShadow(drawAreaBeforeChange);
    // this.syncDrawAreaDepth(drawAreaBeforeChange);
    this.syncDrawAreaDepth(this.drawArea);
  }

  gpu.syncDrawOffset(this.drawOffset);
}
WebGLRenderer.prototype.syncDrawAreaDepth = function (area) {
  let { X1, Y1, X2, Y2 } = area; ++X2; ++Y2;

  // todo: clear depth buffer in draw area change? 
  const { gl, renderContext } = this;

  gl.bindFramebuffer(gl.FRAMEBUFFER, renderContext.mainFramebuffer);
  // gl.bindTexture(gl.TEXTURE_2D, renderContext.mainTexture);
  // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderContext.mainTexture, 0);
  // gl.bindTexture(gl.TEXTURE_2D, renderContext.shadowTexture);
  // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, renderContext.shadowTexture, 0);
  // gl.bindTexture(gl.TEXTURE_2D, renderContext.mainDepthComponent);
  // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, renderContext.mainDepthComponent, 0);
  gl.viewport(4*X1, 4*Y1, 4*X2, 4*Y2);
  // gl.viewport(0,0,4096,2048);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  VertexBuffer.resetDepth();
}

WebGLRenderer.prototype.syncDrawAreaToShadow = function (area) {
  let { X1, Y1, X2, Y2 } = area; ++X2; ++Y2;

  const { gl, renderContext, directVideoRamContext } = this;

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderContext.mainFramebuffer);
  // gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderContext.mainTexture, 0);

  // (required) copy draw area to shadow
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, renderContext.shadowFramebuffer);
  // gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderContext.shadowTexture, 0);

  gl.blitFramebuffer(4 * X1, 4 * Y1, 4 * X2, 4 * Y2, 4 * X1, 4 * Y1, 4 * X2, 4 * Y2, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // (optional) copy draw area to cache
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, directVideoRamContext.framebuffer);
  // gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, directVideoRamContext.texture, 0);

  gl.blitFramebuffer(4 * X1, 4 * Y1, 4 * X2, 4 * Y2, X1, Y1, X2, Y2, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
}

WebGLRenderer.prototype.drawTriangle = function (data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
  this.flushImageBuffer();

  this.syncDrawArea();

  const ox = this.drawOffset.X;
  const oy = this.drawOffset.Y;
  const x1 = ox + ((data[xy1] << 21) >> 21);
  const y1 = oy + ((data[xy1] << 5) >> 21);
  const x2 = ox + ((data[xy2] << 21) >> 21);
  const y2 = oy + ((data[xy2] << 5) >> 21);
  const x3 = ox + ((data[xy3] << 21) >> 21);
  const y3 = oy + ((data[xy3] << 5) >> 21);

  if (this.outsideDrawArea(x1, y1, x2, y2, x3, y3)) return;
  if (this.largePrimitive(x1, y1, x2, y2, x3, y3)) return;

  const buffer = this.getDrawBuffer(data);

  buffer.addVertex(x1, y1, _, _, data[c1]);
  buffer.addVertex(x2, y2, _, _, data[c2]);
  buffer.addVertex(x3, y3, _, _, data[c3]);
}

WebGLRenderer.prototype.drawRectangle = function (data, tx, ty, cl) {
  this.flushImageBuffer();

  this.syncDrawArea();

  const ox = this.drawOffset.X;
  const oy = this.drawOffset.Y;
  const x = ox + ((data[1] << 21) >> 21);
  const y = oy + ((data[1] << 5) >> 21);
  const w = (data[2] << 16) >> 16;
  const h = (data[2] >> 16);

  if (this.outsideDrawArea(x, y, x + w, y, x, y + h, x + w, y + h)) return;
  if (this.largePrimitive(x, y, x + w, y, x, y + h, x + w, y + h)) return;

  const buffer = this.getDrawBuffer(data);

  buffer.addVertex(x + 0, y + 0, _, _, data[0]);
  buffer.addVertex(x + w, y + 0, _, _, data[0]);
  buffer.addVertex(x + 0, y + h, _, _, data[0]);

  buffer.addVertex(x + 0, y + h, _, _, data[0]);
  buffer.addVertex(x + w, y + 0, _, _, data[0]);
  buffer.addVertex(x + w, y + h, _, _, data[0]);
}

WebGLRenderer.prototype.onVBlankBegin = function () {
}

WebGLRenderer.prototype.onVBlankEnd = function () {
  this.flushImageBuffer();
  this.flushRenderBuffer();

  this.syncDrawAreaToShadow(this.drawArea);
  this.syncDrawAreaDepth(this.drawArea);
//  this.syncDrawAreaDepth({X1:0,Y1:0,X2:1024,Y2:512});
  ++this.fpsCounter;

  showDisplay(this);
}

const vertexStride = 24;
function createTexture(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function createDepthComponent(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function createFramebuffer(gl, texture, depthComponent) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindTexture(gl.TEXTURE_2D, depthComponent);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthComponent, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return framebuffer;
}

function setupVertexAttribute(gl, program) {
  gl.enableVertexAttribArray(0);

  const vertexPosition = gl.getAttribLocation(program, "a_position");
  if (vertexPosition >= 0) {
    gl.enableVertexAttribArray(vertexPosition);
    gl.vertexAttribPointer(vertexPosition, 3, gl.SHORT, false, vertexStride, 0);
  }

  const vertexColor = gl.getAttribLocation(program, "a_color");
  if (vertexColor >= 0) {
    gl.enableVertexAttribArray(vertexColor);
    gl.vertexAttribPointer(vertexColor, 4, gl.UNSIGNED_BYTE, true, vertexStride, 6);
  }

  const textureCoord = gl.getAttribLocation(program, "a_texcoord");
  if (textureCoord >= 0) {
    gl.enableVertexAttribArray(textureCoord);
    gl.vertexAttribPointer(textureCoord, 2, gl.SHORT, false, vertexStride, 10);
  }
}

function createDirectVideoRamContext(gl) {
  const texture = createTexture(gl, 1024, 512);
  const framebuffer = createFramebuffer(gl, texture);

  const program = utils.createProgramFromScripts(gl, 'vram-direct');
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();

  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  setupVertexAttribute(gl, program);

  gl.bindVertexArray(null);

  return { vao, buffer, program, texture, framebuffer };
}

function createVideoRamRenderContext(gl) {
  const mainTexture = createTexture(gl, 4096, 2048);
  const mainDepthComponent = createDepthComponent(gl, 4096, 2048);
  const mainFramebuffer = createFramebuffer(gl, mainTexture, mainDepthComponent);

  const shadowTexture = createTexture(gl, 4096, 2048);
  const shadowFramebuffer = createFramebuffer(gl, shadowTexture);

  const program = utils.createProgramFromScripts(gl, 'vram-render');
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();

  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  gl.enableVertexAttribArray(0);

  program.drawArea = gl.getUniformLocation(program, "u_draw");
  program.alpha = gl.getUniformLocation(program, "u_alpha");

  setupVertexAttribute(gl, program);

  gl.bindVertexArray(null);

  return { vao, buffer, program, mainTexture, mainDepthComponent, mainFramebuffer, shadowTexture, shadowFramebuffer };
}

function createDisplayContext(gl) {
  const program = utils.createProgramFromScripts(gl, 'vram-display');
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();

  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  gl.enableVertexAttribArray(0);

  program.displayArea = gl.getUniformLocation(program, "u_disp");
  program.mode = gl.getUniformLocation(program, "u_mode");

  setupVertexAttribute(gl, program);

  gl.bindVertexArray(null);

  return { vao, buffer, program };
}

function displaySection(xl, yt, xr, yb, x, y, w, h, texture) {
  const buffer = renderer.buffers[6];

  buffer.addVertex(xl, yt, x + 0, y + 0);
  buffer.addVertex(xr, yt, x + w, y + 0);
  buffer.addVertex(xl, yb, x + 0, y + h);

  buffer.addVertex(xl, yb, x + 0, y + h);
  buffer.addVertex(xr, yt, x + w, y + 0);
  buffer.addVertex(xr, yb, x + w, y + h);

  buffer.flush(x, y, w, h, texture);
}

function showDisplay(renderer) {
  const gl = renderer.gl;
  const { renderContext, directVideoRamContext } = renderer;

  // NOTE: do NOT update canvas width and height the performance impact is insane.

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  if (true) {
    // top-right videoramShadow
    const { x, y, w, h } = gpu.getDisplayArea();
    displaySection(2048, 0, 4096, 1024, x, y, w, h, renderContext.mainTexture);

    // top-left cache
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, directVideoRamContext.framebuffer);
    gl.blitFramebuffer(0, 0, 1024, 512, 0, 2048, 2048, 1024, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    // bottom-left videoram
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderContext.mainFramebuffer);
    gl.blitFramebuffer(0, 0, 4096, 2048, 0, 1024, 2048, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    // bottom-right videoramShadow
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderContext.shadowFramebuffer);
    gl.blitFramebuffer(0, 0, 4096, 2048, 2048, 1024, 4096, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  else {
    let { x, y, w, h } = gpu.getDisplayArea();
    const buffer = renderer.buffers[6];
    const xl = 0, xr = 4096;
    const yt = 0, yb = 2048;
    buffer.addVertex(xl, yt, x + 0, y + 0);
    buffer.addVertex(xr, yt, x + w, y + 0);
    buffer.addVertex(xl, yb, x + 0, y + h);

    buffer.addVertex(xl, yb, x + 0, y + h);
    buffer.addVertex(xr, yt, x + w, y + 0);
    buffer.addVertex(xr, yb, x + w, y + h);
    buffer.flush(x, y, w, h, renderContext.mainTexture);
  }
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

  if (canvas.width && canvas.height) {
    ambilight.drawImage(canvas, 0, 0);
  }
}