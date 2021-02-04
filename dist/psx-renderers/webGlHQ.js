"use strict"

const $gpu = {
};

function WebGLRenderer(canvas) {
  this.gl = null;
  this.mode = 'vram';

  try {
    this.gl = canvas.getContext("webgl2", {
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

  if(this.gl) {
    this.gl.enable(this.gl.SCISSOR_TEST);

    this.gl.enableVertexAttribArray(0);

    this.programDisplayOff = createProgramDisplayOff(this.gl);
    this.programDisplay16bit = createProgramDisplay16Bit(this.gl);
    this.programDisplay24bit = createProgramDisplay24Bit(this.gl);

    this.program = utils.createProgramFromScripts(this.gl, 'vertex', 'fragment');

    var positions = [
         0.0,   0.0,
      1024.0,   0.0,
         0.0, 512.0,
         0.0, 512.0,
      1024.0,   0.0,
      1024.0, 512.0,
    ];

    this.program.vertexBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.program.vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Int16Array(positions), this.gl.STATIC_DRAW);

    this.program.vertexPosition = this.gl.getAttribLocation(this.program, "a_position");
    this.gl.enableVertexAttribArray(this.program.vertexPosition);
    this.gl.vertexAttribPointer(this.program.vertexPosition, 2, this.gl.SHORT, false, 0, 0);

    this.program.textureBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.program.textureBuffer);
     
    this.program.textureCoord = this.gl.getAttribLocation(this.program, "a_texcoord");
    this.gl.enableVertexAttribArray(this.program.textureCoord);
    this.gl.vertexAttribPointer(this.program.textureCoord, 2, this.gl.SHORT, false, 0, 0);

    // create texture
    this.vram = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.vram);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1024, 512, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    // this.gl.generateMipmap(this.gl.TEXTURE_2D);

    // create texture
    this.disp = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.disp);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1024, 512, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    // this.gl.generateMipmap(this.gl.TEXTURE_2D);

    // Clear the canvas
    this.gl.clearColor(0, 0.25, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
  else {
    alert( "Error: Your browser does not appear to support WebGL.");
  }
}

const rgba = new Uint32Array(1024 * 512);
WebGLRenderer.prototype.loadImage = function(x, y, w, h, buffer) {
  const gl = this.gl;
  // const rgba = new Uint32Array(w * h);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  
  let draw_fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba.buffer));

  for (let i = 0; i < h; ++i) {
    for (let j = 0; j < w; ++j) {
      let offset = i * w + j;
      let data32 = rgba[offset];

      let sbgr16 = 0;
      sbgr16 |= ((data32 >>> 24) & 0xff) ? 0x8000 : 0x0000;
      sbgr16 |= ((data32 >>> 19) & 0x1f) << 10;
      sbgr16 |= ((data32 >>> 11) & 0x1f) <<  5;
      sbgr16 |= ((data32 >>>  3) & 0x1f) <<  0;

      buffer[offset] = sbgr16;
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.moveImage = function(sx, sy, dx, dy, w, h) {
  const gl = this.gl;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  
  let draw_fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vram, 0);

  let read_fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, read_fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.disp, 0);

  // blit from vram -> disp
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, read_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, draw_fb);
  gl.blitFramebuffer(sx, sy, sx+w, sy+h, dx, dy, dx+w, dy+h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // blit from disp -> vram
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw_fb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read_fb);
  gl.blitFramebuffer(sx, sy, sx+w, sy+h, dx, dy, dx+w, dy+h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

const xet = new Uint32Array(1024 * 512);
const sbgr2rgba = new Uint32Array(65536);
for (let i = 0; i < 65536; ++i) {
  sbgr2rgba[i]  = ((i >>>  0) & 0x1f) <<  3;      // r
  sbgr2rgba[i] |= ((i >>>  5) & 0x1f) << 11;      // g
  sbgr2rgba[i] |= ((i >>> 10) & 0x1f) << 19;      // b
  sbgr2rgba[i] |= ((i >>> 15) & 0x01) ? 0xff000000 : 0; // a
}

WebGLRenderer.prototype.storeImage = function(img) {
  let gl = this.gl;

  for (var i = 0, l = img.pixelCount; i < l; ++i) {
    const sbgr = img.buffer[i] >>> 0;
    xet[i] = sbgr2rgba[sbgr];
  }

  let view = new Uint8Array(xet.buffer);
  gl.bindTexture(gl.TEXTURE_2D, this.disp);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, img.x, img.y, img.w, img.h, gl.RGBA, gl.UNSIGNED_BYTE, view);
  // gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);

  gl.bindTexture(gl.TEXTURE_2D, this.vram);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, img.x, img.y, img.w, img.h, gl.RGBA, gl.UNSIGNED_BYTE, view);
  // gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

WebGLRenderer.prototype.drawLine = function(data, c1, xy1, c2, xy2) {
  this.updateDrawArea();
}

WebGLRenderer.prototype.drawTriangle = function(data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
  this.updateDrawArea();
}

WebGLRenderer.prototype.drawRectangle = function(data, tx, ty, cl) {
  this.updateDrawArea();
}

WebGLRenderer.prototype.fillRectangle = function(data) {
  let gl = this.gl;

  var x = (data[1] << 16) >>> 16;
  var y = (data[1] <<  0) >>> 16;
  var w = (data[2] << 16) >>> 16;
  var h = (data[2] <<  0) >>> 16;
  var c = (data[0] & 0xf8f8f8);

  x = (x & 0x3f0);
  y = (y & 0x1ff);
  w = ((w & 0x3ff) + 15) & ~15;
  h = (h & 0x1ff);
  if (!w && !h) return;

  xet.fill(c, 0, w*h);

  let view = new Uint8Array(xet.buffer);
  gl.bindTexture(gl.TEXTURE_2D, this.disp);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, view);
  gl.bindTexture(gl.TEXTURE_2D, this.vram);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, view);

  gl.bindTexture(gl.TEXTURE_2D, null);
}


WebGLRenderer.prototype.updateDrawArea = function() {
  if ($gpu.daM) {
    this.gl.clearColor(1,0,0,1);
    this.clip($gpu.daL, $gpu.daT, $gpu.daR, $gpu.daB);

    this.gl.clearColor(0,0,0,1);
    this.clip($gpu.daL + 1, $gpu.daT + 1, $gpu.daR - 1, $gpu.daB - 1);

    $gpu.daM = false;
  }
}

WebGLRenderer.prototype.setDrawAreaOF = function(x, y) {
  $gpu.daX = x;
  $gpu.daY = y;
}

WebGLRenderer.prototype.setDrawAreaTL = function(x, y) {
  $gpu.daL = x;
  $gpu.daT = y;

  $gpu.daM = true;
}

WebGLRenderer.prototype.setDrawAreaBR = function(x, y) {
  $gpu.daR = x;
  $gpu.daB = y;

  $gpu.daM = true;
}


WebGLRenderer.prototype.clip = function (l, t, r, b) {
  let sb = 512 - t;
  let st = sb - (b - t);
  // this.gl.scissor(l, st, r - l, (sb - st));
  // this.gl.clear(this.gl.COLOR_BUFFER_BIT);
}

WebGLRenderer.prototype.onVBlankEnd = function() {
  const area = gpu.getDisplayArea();
  const gl = this.gl;

  switch (this.mode) {
    case 'vram':  canvas.width = 1024;
                  canvas.height = 512;
                  gl.viewport(0, 0, canvas.width, canvas.height);
                  gl.scissor(0, 0, canvas.width, canvas.height);
                  showVideoRAM(this, area);
                  break;
    case 'disp':  canvas.width = area.w * 8;
                  canvas.height = area.h * 8;
                  gl.viewport(0, 0, canvas.width, canvas.height);
                  gl.scissor(0, 0, canvas.width, canvas.height);
                  if (gpu.status & (1 << 23)) {
                    showDisplayOff(this, area);
                  }
                  else {
                    if (gpu.status & (1 << 21)) {
                      showDisplay24Bit(this, area);
                    }
                    else {
                      showDisplay16Bit(this, area);
                    }
                  }
                  break;
  }
}

WebGLRenderer.prototype.onVBlankBegin = function() {
}


WebGLRenderer.prototype.setMode = function(mode) {
  this.mode = mode;
}


function getDisplayTexture(area) {
  return new Int16Array([
    area.x +    0.0, area.y +    0.0,
    area.x + area.w, area.y +    0.0,
    area.x +    0.0, area.y + area.h,
    area.x +    0.0, area.y + area.h,
    area.x + area.w, area.y +    0.0,
    area.x + area.w, area.y + area.h,
  ]);
}

function getVideoRamTexture() {
  return new Int16Array([
         0.0,   0.0,
      1024.0,   0.0,
         0.0, 512.0,
         0.0, 512.0,
      1024.0,   0.0,
      1024.0, 512.0,
  ]);
}

function showDisplayOff(renderer, area) {
  let gl = renderer.gl;

  gl.useProgram(renderer.programDisplayOff);

  gl.activeTexture(gl.TEXTURE0 + 0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.disp);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.program.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.program.textureBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getDisplayTexture(area), gl.STATIC_DRAW);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function showDisplay16Bit(renderer, area) {
  let gl = renderer.gl;

  gl.useProgram(renderer.programDisplay16bit);
  gl.uniform4i(renderer.programDisplay16bit.displayArea, area.x, area.y, area.w, area.h);

  gl.activeTexture(gl.TEXTURE0 + 0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.disp);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.program.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.program.textureBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getDisplayTexture(area), gl.STATIC_DRAW);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function showDisplay24Bit(renderer, area) {
  let gl = renderer.gl;

  gl.useProgram(renderer.programDisplay24bit);
  gl.uniform4i(renderer.programDisplay24bit.displayArea, area.x, area.y, area.w, area.h);
                      
  gl.activeTexture(gl.TEXTURE0 + 0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.disp);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.program.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.program.textureBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getDisplayTexture(area), gl.STATIC_DRAW);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function showVideoRAM(renderer, area) {
  let gl = renderer.gl;

  gl.useProgram(renderer.program);

  gl.activeTexture(gl.TEXTURE0 + 0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.vram);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.program.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.program.textureBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function createProgramDisplayOff(gl) {
  const program = utils.createProgramFromScripts(gl, 'vertex', 'displayOff');

  // vertex schader
  program.vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, program.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  program.vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(program.vertexPosition);
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, 0, 0);

  // fragment shader
  program.textureBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, program.textureBuffer);
   
  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, 0, 0);

  return program;
}

function createProgramDisplay16Bit(gl) {
  const program = utils.createProgramFromScripts(gl, 'vertex', 'display16bit');
  program.displayArea = gl.getUniformLocation(program, "u_disp");

  // vertex schader
  program.vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, program.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  program.vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(program.vertexPosition);
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, 0, 0);

  // fragment shader
  program.textureBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, program.textureBuffer);
   
  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, 0, 0);

  return program;
}

function createProgramDisplay24Bit(gl) {
  const program = utils.createProgramFromScripts(gl, 'vertex', 'display24bit');
  program.displayArea = gl.getUniformLocation(program, "u_disp");

  // vertex schader
  program.vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, program.vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, getVideoRamTexture(), gl.STATIC_DRAW);

  program.vertexPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(program.vertexPosition);
  gl.vertexAttribPointer(program.vertexPosition, 2, gl.SHORT, false, 0, 0);

  // fragment shader
  program.textureBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, program.textureBuffer);
   
  program.textureCoord = gl.getAttribLocation(program, "a_texcoord");
  gl.enableVertexAttribArray(program.textureCoord);
  gl.vertexAttribPointer(program.textureCoord, 2, gl.SHORT, false, 0, 0);

  return program;
}