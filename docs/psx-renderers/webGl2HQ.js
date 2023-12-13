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

    this.renderBuffer = gl.createBuffer();
    this.programRenderer = createProgramRenderer(gl, this.renderBuffer);

    // create texture cache
    this.cache = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cache);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1024, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.fb_cache = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_cache);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // create videoram texture
    this.videoram = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.videoram);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4096, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.fb_videoram = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_videoram);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.videoram, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.buffers = [
      null,
      null,
      null,
      null,
      null, // new VertexBuffer(4, this), // opaque rendering
      new VertexBuffer(4, this), // storing images
    ];


  }
  else {
    alert("Error: Your browser does not appear to support WebGL.");
  }
}

WebGLRenderer.prototype.memoryToCache = function (x, y, w, h) {
  const gl = this.gl;

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_cache);
  gl.bindTexture(gl.TEXTURE_2D, this.cache);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, view);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.cacheToVideoRam = function (x, y, w, h) {
  // no blitting here because stuff needs to be done in the shader
  this.buffers[5].addVertex(x + 0, y + 0, 0);
  this.buffers[5].addVertex(x + w, y + 0, 0);
  this.buffers[5].addVertex(x + 0, y + h, 0);

  this.buffers[5].addVertex(x + 0, y + h, 0);
  this.buffers[5].addVertex(x + w, y + 0, 0);
  this.buffers[5].addVertex(x + w, y + h, 0);
}

WebGLRenderer.prototype.videoRamToCache = function (sx, sy, dx, dy, w, h) {
  const gl = this.gl;

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb_videoram);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.videoram, 0);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb_cache);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  gl.blitFramebuffer(4 * sx, 4 * sy, 4 * (sx + w), 4 * (sy + h), dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

WebGLRenderer.prototype.clearImage = function (x, y, w, h, c) {
  const gl = this.gl;

  transfer.fill(c, 0, w * h);

  this.memoryToCache(x, y, w, h);
  this.cacheToVideoRam(x, y, w, h);
}

WebGLRenderer.prototype.loadImage = function (x, y, w, h, buffer) {
  // load the image in the cache and renderbuffers
  const gl = this.gl;

  this.videoRamToCache(x, y, x, y, w, h);

  // read pixels from cache
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb_cache);
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
  // move the image in the cache and renderbuffers
  const gl = this.gl;

  this.videoRamToCache(sx, sy, dx, dy, w, h);
  this.cacheToVideoRam(dx, dy, w, h);
}

WebGLRenderer.prototype.storeImage = function (img) {
  // store the image in the cache (texture data only)
  const { x, y, w, h, pixelCount, buffer } = img;
  const gl = this.gl;

  for (let i = 0; i < pixelCount; ++i) {
    const sbgr = buffer[i] >>> 0;
    transfer[i] = sbgr2rgba[sbgr];
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
function createProgramRenderer(gl, renderBuffer) {
  const program = utils.createProgramFromScripts(gl, 'pixel', 'vram-direct');
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderBuffer);

  const vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(vertexPosition);
  gl.vertexAttribPointer(vertexPosition, 3, gl.SHORT, false, vertexStride, 0); // x,y,depth

  const vertexColor = gl.getAttribLocation(program, "a_color");
  gl.enableVertexAttribArray(vertexColor);
  gl.vertexAttribPointer(vertexColor, 4, gl.UNSIGNED_BYTE, true, vertexStride, 6);

  return program;
}

function showDisplay(renderer, region = { x: 0, y: 0, w: 1024, h: 512 }) {
  const gl = renderer.gl;

  canvas.width = region.w * settings.quality;
  canvas.height = region.h * settings.quality;

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.fb_cache);
  gl.blitFramebuffer(0, 0, 1024, 512, 0, canvas.height, canvas.width / 2, canvas.height / 2, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.fb_videoram);
  gl.blitFramebuffer(0, 0, 4096, 2048, 0, canvas.height / 2, canvas.width / 2, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);

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
    const buffer = new Uint8Array(1024 * 1024);
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

    const { gl, fb_videoram, videoram, renderBuffer, programRenderer, cache } = this.#renderer;

    gl.useProgram(programRenderer);
    gl.viewport(0, 0, 4096, 2048);

    gl.bindBuffer(gl.ARRAY_BUFFER, renderBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#writer, 0, this.#index);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb_videoram);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, videoram, 0);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, this.vramDepth, 0);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, cache);
    gl.drawArrays(gl.TRIANGLES, 0, this.#index / vertexStride);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.#index = 0;

  }

}
