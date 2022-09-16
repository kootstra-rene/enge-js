"use strict"

const $gpu = {
};

const sbgr2rgba = new Uint32Array(65536);
const transfer = new Uint32Array(4096 * 2048);
const view = new Uint8Array(transfer.buffer);

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

    this.vertexBuffer = gl.createBuffer();
    this.textureBuffer = gl.createBuffer();

    this.program = createProgram(gl, this.vertexBuffer, this.textureBuffer);
    this.programDisplay = createProgramDisplay(gl, this.vertexBuffer, this.textureBuffer);

    // create texture
    this.vram = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.vram);
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
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  let read_fb = this.read_fb = this.read_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, read_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

  // blit from cache -> vram
  let { x, y, w, h } = img;
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read_fb);
  gl.blitFramebuffer(x, y, x + w, y + h, 4 * x, 4 * y, 4 * (x + w), 4 * (y + h), gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.drawLine = function (data, c1, xy1, c2, xy2) {
  this.updateDrawArea();
}

WebGLRenderer.prototype.drawTriangle = function (data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
  this.updateDrawArea();
}

WebGLRenderer.prototype.drawRectangle = function (data, tx, ty, cl) {
  this.updateDrawArea();
}

WebGLRenderer.prototype.fillRectangle = function (data) {
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

  // gl.bindTexture(gl.TEXTURE_2D, this.vram);
  // gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, view);

  // gl.bindTexture(gl.TEXTURE_2D, null);

  let draw_fb = this.draw_fb = this.draw_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  let read_fb = this.read_fb = this.read_fb || gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, read_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cache, 0);

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
    //   const program = this.programDisplay;
    //   this.gl.useProgram(program);
    //   this.gl.uniform4i(program.drawArea, $gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);
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
  const area = gpu.getDisplayArea();
  const gl = this.gl;

  switch (this.mode) {
    case 'clut4': // todo: implement
      showVideoRAM(this, area, 4);
      break;
    case 'clut8':
      showVideoRAM(this, area, 2);
      break;
    case 'draw':
      showVideoRAM(this, area, 1);
      break;
    case 'disp':
      showDisplay(this, area, (gpu.status >> 21) & 0b101);
      break;
  }

  ++this.fpsCounter;
}

WebGLRenderer.prototype.onVBlankEnd = function () {
}


WebGLRenderer.prototype.setMode = function (mode) {
  this.mode = mode;
}


function getDisplayTexture(area) {
  // todo: 'global' structure to minimize allocs
  return new Int16Array([
    area.x + 0.0, area.y + 0.0,
    area.x + area.w, area.y + 0.0,
    area.x + 0.0, area.y + area.h,
    area.x + 0.0, area.y + area.h,
    area.x + area.w, area.y + 0.0,
    area.x + area.w, area.y + area.h,
  ]);
}

function getVideoRamTexture() {
  // todo: 'global' structure to minimize allocs
  return new Int16Array([
    0.0, 0.0,
    1024.0, 0.0,
    0.0, 512.0,
    0.0, 512.0,
    1024.0, 0.0,
    1024.0, 512.0,
  ]);
}

function showDisplay(renderer, area, mode) {
  const gl = renderer.gl;
  const program = renderer.programDisplay;

  canvas.width = area.w * 1 * settings.quality;
  canvas.height = area.h * 2 * settings.quality;
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.useProgram(program);
  gl.uniform1f(program.time, (performance.now() >>> 0) / 1000.0);
  gl.uniform2f(program.resolution, canvas.width, canvas.height);
  gl.uniform4i(program.displayArea, area.x, area.y, area.w, area.h);
  gl.uniform1i(program.mode, mode);

  gl.activeTexture(gl.TEXTURE0 + 0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.vram);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.textureBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getDisplayTexture(area), gl.STATIC_DRAW);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function showVideoRAM(renderer, area, mode) {
  const gl = renderer.gl;
  const program = renderer.program;

  canvas.width = 4096;
  canvas.height = 2048;
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.useProgram(program);
  gl.uniform1i(program.mode, mode);

  gl.activeTexture(gl.TEXTURE0 + 0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.vram);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.textureBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function createProgram(gl, vertexBuffer, textureBuffer) {
  const program = utils.createProgramFromScripts(gl, 'vertex', 'displayVideoRam');
  gl.useProgram(program);

  program.mode = gl.getUniformLocation(program, "u_mode");

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  program.vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(program.vertexPosition);
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);

  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, 0, 0);

  return program;
}

function createProgramDisplay(gl, vertexBuffer, textureBuffer) {
  const program = utils.createProgramFromScripts(gl, 'vertex', 'displayScreen');
  gl.useProgram(program);

  program.displayArea = gl.getUniformLocation(program, "u_disp");
  program.time = gl.getUniformLocation(program, "u_time");
  program.resolution = gl.getUniformLocation(program, "u_resolution");
  program.mode = gl.getUniformLocation(program, "u_mode");
  program.drawArea = gl.getUniformLocation(program, "u_draw");

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  program.vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(program.vertexPosition);
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);

  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, 0, 0);

  return program;
}