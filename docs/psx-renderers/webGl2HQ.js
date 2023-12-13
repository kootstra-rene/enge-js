"use strict";

const sbgr2rgba = new Uint32Array(65536);
const transfer = new Uint32Array(1024 * 512);
const view = new Uint8Array(transfer.buffer);

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

    this.directVideoRamContext = createDirectVideoRamContext(gl);
    this.renderContext = createVideoRamRenderContext(gl);

    this.buffers = [
      null, // transparent rendering mode 0
      null, // transparent rendering mode 1
      null, // transparent rendering mode 2
      null, // transparent rendering mode 3
      null, // opaque rendering
      new VertexBuffer(4, this), // storing images
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.cacheToVideoRam = function (x, y, w, h) {
  // note: no blitting here because stuff needs to be done in the shader
  const buffer = this.buffers[5];

  buffer.addVertex(x + 0, y + 0, 0);
  buffer.addVertex(x + w, y + 0, 0);
  buffer.addVertex(x + 0, y + h, 0);

  buffer.addVertex(x + 0, y + h, 0);
  buffer.addVertex(x + w, y + 0, 0);
  buffer.addVertex(x + w, y + h, 0);
}

WebGLRenderer.prototype.videoRamToCache = function (sx, sy, dx, dy, w, h) {
  const gl = this.gl;

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.renderContext.mainFramebuffer);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.renderContext.mainTexture, 0);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.directVideoRamContext.framebuffer);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.directVideoRamContext.texture, 0);

  gl.blitFramebuffer(4 * sx, 4 * sy, 4 * (sx + w), 4 * (sy + h), dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

WebGLRenderer.prototype.clearImage = function (x, y, w, h, c) {
  transfer.fill(c, 0, w * h);

  this.memoryToCache(x, y, w, h);
  this.cacheToVideoRam(x, y, w, h);
}

WebGLRenderer.prototype.loadImage = function (x, y, w, h, buffer) {
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
  this.videoRamToCache(sx, sy, dx, dy, w, h);
  this.cacheToVideoRam(dx, dy, w, h);
}

WebGLRenderer.prototype.storeImage = function (img) {
  const { x, y, w, h, pixelCount, buffer } = img;

  for (let i = 0; i < pixelCount; ++i) {
    transfer[i] = sbgr2rgba[buffer[i] >>> 0];
  }

  this.memoryToCache(x, y, w, h);
  this.cacheToVideoRam(x, y, w, h);
}

WebGLRenderer.prototype.setTransparencyMode = function (mode, program) {
}

WebGLRenderer.prototype.drawLine = function (data, c1, xy1, c2, xy2) {
}

WebGLRenderer.prototype.drawTriangle = function (data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
}

WebGLRenderer.prototype.drawRectangle = function (data, tx, ty, cl) {
}

WebGLRenderer.prototype.setDrawAreaOF = function (x, y) {
}

WebGLRenderer.prototype.setDrawAreaTL = function (x, y) {
}

WebGLRenderer.prototype.setDrawAreaBR = function (x, y) {
}

WebGLRenderer.prototype.onVBlankBegin = function () {
}

WebGLRenderer.prototype.onVBlankEnd = function () {
  this.buffers[5].flush();
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

function createFramebuffer(gl, texture) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return framebuffer;
}

function createDirectVideoRamContext(gl) {
  const program = utils.createProgramFromScripts(gl, 'vram-direct');
  const buffer = gl.createBuffer();
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  const vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(vertexPosition);
  gl.vertexAttribPointer(vertexPosition, 3, gl.SHORT, false, vertexStride, 0); // x,y,depth

  const vertexColor = gl.getAttribLocation(program, "a_color");
  gl.enableVertexAttribArray(vertexColor);
  gl.vertexAttribPointer(vertexColor, 4, gl.UNSIGNED_BYTE, true, vertexStride, 6);

  const texture = createTexture(gl, 1024, 512);
  const framebuffer = createFramebuffer(gl, texture);

  return { buffer, program, texture, framebuffer };
}

function createVideoRamRenderContext(gl) {
  const mainTexture = createTexture(gl, 4096, 2048);
  const mainFramebuffer = createFramebuffer(gl, mainTexture);

  const shadowTexture = createTexture(gl, 4096, 2048);
  const shadowFramebuffer = createFramebuffer(gl, shadowTexture);

  return { mainTexture, mainFramebuffer, shadowTexture, shadowFramebuffer };
}

function showDisplay(renderer, region = { x: 0, y: 0, w: 1024, h: 512 }) {
  const gl = renderer.gl;

  canvas.width = region.w * settings.quality;
  canvas.height = region.h * settings.quality;

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  // top-left cache
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.directVideoRamContext.framebuffer);
  gl.blitFramebuffer(0, 0, 1024, 512, 0, canvas.height, canvas.width / 2, canvas.height / 2, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // bottom-left videoram
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.renderContext.mainFramebuffer);
  gl.blitFramebuffer(0, 0, 4096, 2048, 0, canvas.height / 2, canvas.width / 2, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // bottom-right videoramShadow
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.renderContext.shadowFramebuffer);
  gl.blitFramebuffer(0, 0, 4096, 2048, canvas.width / 2, canvas.height / 2, canvas.width, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

  if (canvas.width && canvas.height) {
    ambilight.canvas.width = canvas.width;
    ambilight.canvas.height = canvas.height;
    ambilight.drawImage(canvas, 0, 0);
  }
}

class VertexBuffer {
  #mode;
  #writer;
  #index;
  #renderer;

  constructor(mode, renderer) {
    this.#mode = mode;
    this.#index = 0;
    const buffer = new Uint8Array(256 * 1024);
    this.#writer = new DataView(buffer.buffer);

    this.#renderer = renderer;

    renderer.gl.bufferData(renderer.gl.ARRAY_BUFFER, this.#writer, renderer.gl.STREAM_DRAW, 0);
  }

  addVertex(x, y, z, c) {
    const writer = this.#writer;

    writer.setInt16(this.#index + 0, x, true);
    writer.setInt16(this.#index + 2, y, true);
    writer.setInt16(this.#index + 4, z, true);
    writer.setUint32(this.#index + 6, c, true);

    this.#index += vertexStride;
  }

  flush() {
    if (this.#index <= 0) return;

    const { gl, directVideoRamContext, renderContext } = this.#renderer;

    gl.useProgram(directVideoRamContext.program);
    gl.viewport(0, 0, 4096, 2048);

    gl.bindBuffer(gl.ARRAY_BUFFER, directVideoRamContext.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#writer, 0, this.#index);

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderContext.mainFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderContext.mainTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, renderContext.shadowTexture, 0);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, this.vramDepth, 0);

    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, directVideoRamContext.texture);
    gl.drawArrays(gl.TRIANGLES, 0, this.#index / vertexStride);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.#index = 0;

  }

}
