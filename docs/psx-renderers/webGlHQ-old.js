//todo:
//      image loading in draw area should be displayed and not loaded into textuer buffers (MDEC ?)
//      only update texture when needed (keep track of dirty pages) less image load to textures
//      keep track of STP in CLUT allows better performance
//      - only a CLUT with mixed STP bits needs the flushes of the vertex buffer
//      rewrite shaders using only a 2048x512 as texture (even pixel is low byte, odd is high byte)
//      - allows for 4/8/16/24 bit modes
//      - faster load/store/move image
//      - no javascript buffer needed
//      - 100% gpu (filtering of primitives done by cpu)
// done:
//      filter primitives outside the draw area
//      filter primitives wider than 1024 or heigher than 512
//      load image at higher resolutions

"use strict"
var qwf = 1;
var qhf = 1;
var qwidth = 1024*qwf;
var qheight = 512*qhf;

Uint32Array.prototype.addVertexDisp = function(x,y,u,v) {
  var xy = (y << 16) | (x & 0xffff);
  var uv = (v << 16) | (u & 0xffff);

  var index = this.index >>> 2;
  this[index + 0] = xy;
  this[index + 1] = uv;

  this.index += 8;
}

Uint32Array.prototype.addVertex = function(x,y,c) {
  var xy = (y << 16) | (x & 0xffff);

  var index = this.index >>> 2;

  this[index + 0] = (c & 0xffffff) | 0x03000000;
  this[index + 1] = xy;

  this.index += 24;
}

Uint32Array.prototype.addVertexUV = function(x,y,c,tm,u,v,cx,cy) {
  var xy  = (y << 16) | (x & 0xffff);
  var uv  = (v << 16) | (u & 0xffff);
  var cxy = (cy << 16) | (cx & 0xffff);
  var txy = (gpu.ty << 16) | (gpu.tx & 0xffff);

  var index = this.index >>> 2;
  this[index + 0] = (c & 0xffffff) | (tm << 24);
  this[index + 1] = xy;
  this[index + 2] = uv;
  this[index + 3] = cxy;
  this[index + 4] = txy;
  this[index + 5] = gpu.twin;

  this.index += 24;
}

Uint32Array.prototype.getNumberOfVertices = function() {
  return this.index / 24;
}

Uint32Array.prototype.canHold = function(cnt) {
  return this.index + (24 * cnt) < (this.length * 4);
}

Uint32Array.prototype.reset = function() {
  this.index = 0;
}

Uint32Array.prototype.view = function() {
  return new Uint32Array(this.buffer, 0, this.index >> 2);
}

var vertexShaderDisplay =
    "precision highp float;"+
    "attribute vec2 aVertexPosition;" +
    "attribute vec2 aVertexTexture;" +
    "varying vec2 vTextureCoord;"+
    "varying vec2 tx;"+
    "void main(void) {" +
    "  gl_Position = vec4(aVertexPosition, 0.0, 1.0);" +
    "  tx.xy = aVertexTexture;" +
    "  vTextureCoord.x = aVertexTexture.x / 1024.0;" +
    "  vTextureCoord.y = aVertexTexture.y / 512.0;" +
    "}";

var fragmentShader16bit =
    "precision highp float;"+
    "uniform sampler2D uVRAM;" +
    "varying vec2 tx;"+
    "vec4 getColor(float tx, float ty) {" +
    "  if (ty >= 511.0) ty = 511.0;"+
    "  if (tx >= 1023.0) tx = 1023.0;"+
    "  return texture2D(uVRAM, vec2((tx + 0.0) / 1024.0, (ty + 0.0) / 512.0));"+
    "}"+

    "void main(void) {" +
    "  gl_FragColor = vec4(getColor(tx.x, tx.y).rgb, 1.0);"+
    "}";

var fragmentShaderTexture =
    "precision highp float;"+
    "uniform sampler2D uVRAM;" +
    "varying vec2 vTextureCoord;"+
    "void main(void) {" +
    "  vec4 pixel = texture2D(uVRAM, vTextureCoord);" +
    "  gl_FragColor = vec4(pixel.rrr, 1.0);" +
    "}";

var fragmentShader24bit =
    "precision highp float;"+
    "uniform sampler2D uVRAM;" +
    "uniform vec3 ts;"+
    "varying vec2 tx;"+
    "varying vec2 vTextureCoord;"+

    "vec4 getColor(float tx, float ty) {" +
    "  if (ty >= 512.0) ty = 512.0;"+
    "  if (tx >= 2048.0) tx = 2048.0;"+
    "  float r = texture2D(uVRAM, vec2((tx + 0.0) / 2048.0, ty / 512.0)).r;" +
    "  float g = texture2D(uVRAM, vec2((tx + 1.0) / 2048.0, ty / 512.0)).r;" +
    "  float b = texture2D(uVRAM, vec2((tx + 2.0) / 2048.0, ty / 512.0)).r;" +
    "  return vec4(r, g, b, 0.0);"+
    "}"+

    "void main(void) {" +
    "  float td = (tx.x - ts.x);"+
    "  float x = 3.0 * floor(td) + 2.0 * ts.x;"+

    "  gl_FragColor = getColor(x , floor(tx.y));"+
    "}";

var vertexShaderDraw =
    "precision highp float;"+
    "attribute vec2 aVertexPosition;" +
    "attribute vec2 aVertexTexture;" +
    "attribute vec4 aVertexColor;" +
    "attribute vec4 aTextureWindow;" +
    "attribute vec2 aTexturePage;" +
    "attribute vec2 aTextureClut;" +
    "uniform float uBlendAlpha;" +
    "varying float vTextureMode;" +
    "varying float vSTP;" +
    "varying vec4 vColor;" +
    "varying vec2 vClut;" +

    "varying float tmx;"+ // texture window mask x
    "varying float tmy;"+ // texture window mask y

    "varying float tox;"+ // texture window offset x
    "varying float toy;"+ // texture window offset y

    "varying float tcx;"+ // texture coordinate x
    "varying float tcy;"+ // texture coordinate y

    "varying float twin;"+

    "void main(void) {" +
    "  gl_Position = vec4(aVertexPosition, 0.0, 1.0); " +
    "  gl_Position.x -= 512.0; gl_Position.y -= 256.0;" +
    "  gl_Position.x /= 512.0; gl_Position.y /= 256.0;" +

    "  vClut = aTextureClut;"+
    "  vClut.x /= 1024.0;"+
    "  vClut.y /= 512.0;"+

    "  twin = aTextureWindow.x + aTextureWindow.y;"+

    "  tmx = 256.0 - aTextureWindow.x;"+
    "  tmy = 256.0 - aTextureWindow.y;"+

    "  tox = aTexturePage.x + aTextureWindow.z;"+
    "  toy = aTexturePage.y + aTextureWindow.a;"+

    "  tcx = aVertexTexture.x;"+
    "  tcy = aVertexTexture.y;"+

    "  vTextureMode = mod(aVertexColor.a, 8.0);"+
    "  if (vTextureMode == 7.0) {"+
    "    tcx = aVertexPosition.x / 1024.0;"+
    "    tcy = aVertexPosition.y / 512.0;"+
    "  }"+
    "  else {"+
    "    vSTP = floor(aVertexColor.a / 8.0);"+
    "  }"+
    "  vColor = vec4(aVertexColor.rgb / 256.0, uBlendAlpha);" +
    "}";

var fragmentShaderDraw =
    "precision highp float;"+
    "uniform sampler2D uTex8;" +
    "uniform sampler2D uRGBA;" +
    "uniform float uBlendAlpha;" +
    "varying float vTextureMode;" +
    "varying float vSTP;" +
    "varying vec4 vColor;" +
    "varying vec2 vClut;" +

    "varying float tmx;"+ // texture window mask x
    "varying float tmy;"+ // texture window mask y

    "varying float tox;"+ // texture window offset x
    "varying float toy;"+ // texture window offset yx

    "varying float tcx;"+ // texture coordinate x
    "varying float tcy;"+ // texture coordinate y

    "varying float twin;"+

    "void main(void) {" +
    "  if (vTextureMode == 7.0) {"+
    "    vec4 rgba = texture2D(uRGBA, vec2(tcx, tcy));"+
    "    gl_FragColor = rgba;"+
    "    return;"+
    "  }"+

    "  if (vTextureMode == 3.0) {"+
    "    gl_FragColor = vec4(vColor.rgb, uBlendAlpha);"+
    "    return;"+
    "  }"+

    "  vec4 rgba;"+
    "  float cx, cy, val, tx, ty;"+
    "  if (twin != 0.0) {"+
    "    tx = tox + mod(floor(tcx), tmx);"+
    "    ty = toy + mod(floor(tcy), tmy);"+
    "  }"+
    "  else {"+
    "    tx = tox + floor(tcx);"+
    "    ty = toy + floor(tcy);"+
    "  }"+
    "  if (vTextureMode == 1.0) {"+
    "    float val = texture2D(uTex8, vec2(tx / 2048.0, ty / 512.0)).r;" +
    "    cx = vClut.x + (val * 255.0) / 1024.0; cy = vClut.y;"+
    "  }"+
    "  else"+
    "  if (vTextureMode == 0.0) {"+
    "    vec4 clut = texture2D(uTex8, vec2(tx / 4096.0, ty / 512.0));" +
    "    if (mod((tx), 2.0) == 0.0) { val = clut.g; } else { val = clut.b; }"+
    "    cx = vClut.x + (val * 255.0) / 1024.0; cy = vClut.y;"+
    "  }"+
    "  else"+
    "  if (vTextureMode == 2.0) {"+
    "    cx = tx / 1024.0; cy = ty / 512.0;"+
    "  }"+

    "  rgba = texture2D(uRGBA, vec2(cx, cy));"+

    "  if (rgba.a == 0.0) {"+
    "    if (rgba == vec4(0.0, 0.0, 0.0, 0.0)) discard;"+
    "    if (vSTP == 3.0) discard;"+
    "  }"+
    "  else {"+
    "    if (vSTP == 2.0) discard;"+
    "  }"+
    "  gl_FragColor = vec4(vColor.rgb * rgba.rgb * 2.0, uBlendAlpha);"+
    "}";

function WebGLRenderer(canvas) {
  this.gl = null
  this.programDisplay = null
  this.vertexBuffer = new Uint32Array(18*1024 >> 2)// // 18.0 Kb, 768 vertices vertices, 256 triangles

  this.drawOffsetX = 0
  this.drawOffsetY = 0

  this.displaymode = 2
  this.vram = new Uint16Array(512*1024)

  this.vertexClip = false;
  this.drawAreaChange = false;

  try {
    this.gl = canvas.getContext("webgl", {
      alpha: false, 
      antialias: false, 
      preserveDrawingBuffer: false, 
      premultipliedAlpha: false, 
      depth: false, 
      stencil: false,

      powerPreference: 'high-performance',

      // failIfMajorPerformanceCaveat: true,
      // desynchronized: false, // makes screen black if true?
    });
  }
  catch (e) {
    alert("Error: Unable to get WebGL context");
    return;
  }

  if(this.gl) {
    this.initShaders();
    this.initTextures();
    this.setupBuffers();

    var gl = this.gl;
    this.setupWebGL(canvas);
    gl.useProgram(this.programDraw);
    gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.buf16draw);
    gl.activeTexture(this.gl.TEXTURE1);
    gl.bindTexture(this.gl.TEXTURE_2D, this.tex8vram);
    gl.activeTexture(this.gl.TEXTURE2);
    gl.bindTexture(this.gl.TEXTURE_2D, this.tex16rgba);

    this.vertexBuffer.reset();
    this.setupProgramDraw();
  }
  else {
    alert( "Error: Your browser does not appear to support WebGL.");
  }

  // this.metrics = {vertices:new Array(256),switches:0, triangles:0};
  // this.metrics.vertices.fill(0);
}

WebGLRenderer.prototype.outsideDrawArea = function(x1,y1,x2,y2,x3,y3) {
  if ((x1 < this.drawAreaL) && (x2 < this.drawAreaL) && (x3 < this.drawAreaL)) return true;
  if ((x1 > this.drawAreaR) && (x2 > this.drawAreaR) && (x3 > this.drawAreaR)) return true;
  if ((y1 < this.drawAreaT) && (y2 < this.drawAreaT) && (y3 < this.drawAreaT)) return true;
  if ((y1 > this.drawAreaB) && (y2 > this.drawAreaB) && (y3 > this.drawAreaB)) return true;
  return false;
}
WebGLRenderer.prototype.largePrimitive = function(x1,y1,x2,y2,x3,y3) {
  if (Math.abs(x1 - x2) > 1023) return true;
  if (Math.abs(x2 - x3) > 1023) return true;
  if (Math.abs(x3 - x1) > 1023) return true;
  if (Math.abs(y1 - y2) > 511) return true;
  if (Math.abs(y2 - y3) > 511) return true;
  if (Math.abs(y3 - y1) > 511) return true;
  return false;
}

WebGLRenderer.prototype.setupWebGL = function(canvas) {
  var gl = this.gl;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DITHER);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.disable(gl.SAMPLE_COVERAGE);
  gl.disable(gl.SCISSOR_TEST);

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.clear(gl.DEPTH_BUFFER_BIT);

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);

  this.canvas = canvas;
}

WebGLRenderer.prototype.initShaders = function(){
  try {
    var gl = this.gl;

    // Drawing
    this.programDraw = gl.createProgram();
    gl.attachShader(this.programDraw, this.makeShader(vertexShaderDraw, gl.VERTEX_SHADER));
    gl.attachShader(this.programDraw, this.makeShader(fragmentShaderDraw, gl.FRAGMENT_SHADER));
    gl.linkProgram(this.programDraw);

    if (!gl.getProgramParameter(this.programDraw, gl.LINK_STATUS)) {
      console.log("Unable to initialize the shader program.");
    }

    gl.useProgram(this.programDraw);
    this.programDraw.uTex8  = gl.getUniformLocation(this.programDraw, "uTex8");
    this.programDraw.uRGBA  = gl.getUniformLocation(this.programDraw, "uRGBA");
    gl.uniform1i(this.programDraw.uTex8, 1);
    gl.uniform1i(this.programDraw.uRGBA, 2);

    // Display 16bit vram
    this.programDisplay = gl.createProgram();
    gl.attachShader(this.programDisplay, this.makeShader(vertexShaderDisplay, gl.VERTEX_SHADER));
    gl.attachShader(this.programDisplay, this.makeShader(fragmentShader16bit, gl.FRAGMENT_SHADER));
    gl.linkProgram(this.programDisplay);

    if (!gl.getProgramParameter(this.programDisplay, gl.LINK_STATUS)) {
      console.log("Unable to initialize the shader program.");
    }

    gl.useProgram(this.programDisplay);
    this.programDisplay.vram = gl.getUniformLocation(this.programDisplay, "uVRAM");
    this.programDisplay.ts = gl.getUniformLocation(this.programDisplay, "ts");
    gl.uniform1i(this.programDisplay.vram, 0);

    // Display 24bit vram
    this.program24bit = gl.createProgram();
    gl.attachShader(this.program24bit, this.makeShader(vertexShaderDisplay, gl.VERTEX_SHADER));
    gl.attachShader(this.program24bit, this.makeShader(fragmentShader24bit, gl.FRAGMENT_SHADER));
    gl.linkProgram(this.program24bit);

    if (!gl.getProgramParameter(this.program24bit, gl.LINK_STATUS)) {
      console.log("Unable to initialize the shader program.");
    }

    gl.useProgram(this.program24bit);
    this.program24bit.vram = gl.getUniformLocation(this.program24bit, "uVRAM");
    this.program24bit.ts = gl.getUniformLocation(this.program24bit, "ts");
    gl.uniform1i(this.program24bit.vram, 1);

    // Display 8/4bit vram
    this.programTexture = gl.createProgram();
    gl.attachShader(this.programTexture, this.makeShader(vertexShaderDisplay, gl.VERTEX_SHADER));
    gl.attachShader(this.programTexture, this.makeShader(fragmentShaderTexture, gl.FRAGMENT_SHADER));
    gl.linkProgram(this.programTexture);

    if (!gl.getProgramParameter(this.programTexture, gl.LINK_STATUS)) {
      console.log("Unable to initialize the shader program.");
    }

    gl.useProgram(this.programTexture);
    this.programTexture.vram = gl.getUniformLocation(this.programTexture, "uVRAM");
    gl.uniform1i(this.programTexture.vram, 0);
  }
  catch (e) {
    console.log("Failed to init shaders:\n\n" + e.stack);
  }
}

WebGLRenderer.prototype.initTextures = function() {
  var gl = this.gl;

  if (navigator.platform === 'MacIntel') {
    console.log("Disabling texturing for apple");
    return
  }

  const buf = new Uint8Array(2048*512*4);
  buf.fill(0);

  // 8-bit video ram
  this.tex8vram = this.createTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2048, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);

  this.buf8vram = this.createBuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf8vram);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex8vram, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Drawing
  this.tex16draw = this.createTexture(gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, qwidth, qheight, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);

  this.buf16draw = this.createBuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf16draw);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex16draw, 0);

  // Colour Mapping
  this.tex16rgba = this.createTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1024, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);

  this.buf16rgba = this.createBuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf16rgba);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex16rgba, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

WebGLRenderer.prototype.loadImage = function(x, y, w, h, buffer) {
  // const gl = this.gl;
  // const rgba = new Uint32Array(w * h);

  // this.flushVertexBuffer(true);

  // gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  
  // let draw_fb = gl.createFramebuffer();
  // gl.bindFramebuffer(gl.FRAMEBUFFER, draw_fb);
  // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex16draw, 0);

  // gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba.buffer));

  // for (let i = 0; i < h; ++i) {
  //   for (let j = 0; j < w; ++j) {
  //     let offset = i * w + j;
  //     let data32 = rgba[offset];

  //     let sbgr16 = 0;
  //     sbgr16 |= ((data32 >>> 24) & 0xff) ? 0x8000 : 0x0000;
  //     sbgr16 |= ((data32 >>> 19) & 0x1f) << 10;
  //     sbgr16 |= ((data32 >>> 11) & 0x1f) <<  5;
  //     sbgr16 |= ((data32 >>>  3) & 0x1f) <<  0;

  //     buffer[offset] = sbgr16;
  //   }
  // }

  // // gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf16draw);

  // // var gl = this.gl;

  var o = 0;
  for (var j = 0; j < h; ++j) {
    for (var i = 0; i < w; ++i) {
      var offsetY = ((y + j) % 512) * 1024;
      buffer[o++] = this.vram[offsetY + ((x+i)%1024)]
    }
  }
  // console.log('loadImage', x, y, w, h)
}

WebGLRenderer.prototype.moveImage = function(sx, sy, dx, dy, w, h) {
  var gl = this.gl;

  var o = 0;
  var img = gpu.img;
  img.x = dx;
  img.y = dy;
  img.w = w;
  img.h = h;
  img.pixelCount = w*h;
  var copy = img.buffer;
  var vram = this.vram;
  for (var j = h; j > 0; --j) {
    var x = sx;
    var oy = ((sy++) % 512) * 1024;
    for (var i = w; i > 0; --i) {
      copy[o++] = vram[oy + ((x++) % 1024)];
    }
  }

  this.storeImage(img)
}

WebGLRenderer.prototype.storeImage = function(img) {
  var gl = this.gl;

  var o = 0;
  var data = img.buffer;
  var vram = this.vram;
  for (var j = 0; j < img.h; ++j) {
    const offsetY = ((img.y + j) % 512) * 1024;
    var x = img.x;
    // for (var i = 0, il = img.w; i < il; ++i) {
    for (var i = img.w; i > 0; --i) {
      vram[offsetY + ((x++)%1024)] = data[o++];
    }
  }

  this.storeImageInTexture(img)
  // console.log('storeImage', img.x, img.y, img.w, img.h)
}

// Uint8Array.prototype.setInt16 = function(index, value) {
//   this[index]   = value;
//   this[index+1] = value >> 8;
// }

var tex = new Uint8Array(2048*512*4*2);
var xet = new Uint8Array(1024*512*4*2);
WebGLRenderer.prototype.storeImageInTexture = function(img) {
  var gl = this.gl;

  // flush current vertices as a clut could be changed at this point.
  this.flushVertexBuffer(true);
  
  var outsidebounds = false;
  if ((img.x + img.w) > 1024) outsidebounds = true;
  if ((img.y + img.h) >  512) outsidebounds = true;
  if (outsidebounds) {
    console.log('image out of bounds:', img.x, img.y, img.w, img.h);
    // todo: implement proper vram wrapping
    return;
  }
  // mode 8-bit
  for (var i = 0, l = img.pixelCount; i < l; ++i) {
    var sbgr = img.buffer[i];

    var lo = (sbgr >>> 0) & 0xff;
    tex[(i << 3) + 0] = lo;
    tex[(i << 3) + 1] = (lo >>> 0) & 0xf;
    tex[(i << 3) + 2] = (lo >>> 4) & 0xf;
    tex[(i << 3) + 3] = 0;//((sbgr >>> 15) & 0x01) ? 255 : 0; // a

    var hi = (sbgr >>> 8) & 0xff;
    tex[(i << 3) + 4] = hi;
    tex[(i << 3) + 5] = (hi >>> 0) & 0xf;
    tex[(i << 3) + 6] = (hi >>> 4) & 0xf;
    tex[(i << 3) + 7] = 0;//((sbgr >>> 15) & 0x01) ? 255 : 0; // a;

    xet[(i << 2) + 0] = ((sbgr >>>  0) & 0x1f) << 3;      // r
    xet[(i << 2) + 1] = ((sbgr >>>  5) & 0x1f) << 3;      // g
    xet[(i << 2) + 2] = ((sbgr >>> 10) & 0x1f) << 3;      // b
    xet[(i << 2) + 3] = ((sbgr >>> 15) & 0x01) ? 255 : 0; // a
  }
  gl.bindTexture(gl.TEXTURE_2D, this.tex8vram);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, img.x << 1, img.y, img.w << 1, img.h, gl.RGBA, gl.UNSIGNED_BYTE, tex);

  // rgba mapping
  gl.bindTexture(gl.TEXTURE_2D, this.tex16rgba);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, img.x, img.y, img.w, img.h, gl.RGBA, gl.UNSIGNED_BYTE, xet);

// needed for 16bit video
//  if (gpu.status & (1 << 21)) return

  var x1 = img.x; var x2 = img.x + img.w;
  var y1 = img.y; var y2 = img.y + img.h;
  var buffer = this.getVertexBuffer(6, 0); 
  buffer.addVertexUV(x1, y1, 0, 7, 0, 0, 0, 0);
  buffer.addVertexUV(x2, y1, 0, 7, 0, 0, 0, 0);
  buffer.addVertexUV(x1, y2, 0, 7, 0, 0, 0, 0);

  buffer.addVertexUV(x2, y1, 0, 7, 0, 0, 0, 0);
  buffer.addVertexUV(x1, y2, 0, 7, 0, 0, 0, 0);
  buffer.addVertexUV(x2, y2, 0, 7, 0, 0, 0, 0);
  this.flushVertexBuffer(false);
}

WebGLRenderer.prototype.makeShader = function(src, type) {
  var gl = this.gl;

if ((src !== vertexShaderDisplay) 
 && (src !== fragmentShader16bit)
 && (src !== fragmentShaderTexture)
 && (src !== fragmentShader24bit)
 && (src !== vertexShaderDraw)
 && (src !== fragmentShaderDraw)
) return;

  var shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert("Error compiling shader: " + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
  }
  return shader;
}

WebGLRenderer.prototype.setupBuffers = function() {
  var gl = this.gl;

  this.programDraw.blendAlpha = gl.getUniformLocation(this.programDraw, "uBlendAlpha");

  this.programDraw.vertexPosition = gl.getAttribLocation(this.programDraw, "aVertexPosition");
  gl.enableVertexAttribArray(this.programDraw.vertexPosition);

  this.programDraw.vertexTexture = gl.getAttribLocation(this.programDraw, "aVertexTexture");
  gl.enableVertexAttribArray(this.programDraw.vertexTexture);

  this.programDraw.textureWindow = gl.getAttribLocation(this.programDraw, "aTextureWindow");
  gl.enableVertexAttribArray(this.programDraw.textureWindow);

  this.programDraw.texturePage = gl.getAttribLocation(this.programDraw, "aTexturePage");
  gl.enableVertexAttribArray(this.programDraw.texturePage);

  this.programDraw.vertexColor = gl.getAttribLocation(this.programDraw, "aVertexColor");
  gl.enableVertexAttribArray(this.programDraw.vertexColor);

  this.programDraw.aclut = gl.getAttribLocation(this.programDraw, "aTextureClut");
  gl.enableVertexAttribArray(this.programDraw.aclut);

  this.programDraw.vertexTexture = gl.getAttribLocation(this.programDraw, "aVertexTexture");
  gl.enableVertexAttribArray(this.programDraw.vertexTexture);


  this.programDisplay.vertexPosition = gl.getAttribLocation(this.programDraw, "aVertexPosition");
  gl.enableVertexAttribArray(this.programDisplay.vertexPosition);

  this.programDisplay.vertexTexture = gl.getAttribLocation(this.programDisplay, "aVertexTexture");
  gl.enableVertexAttribArray(this.programDisplay.vertexTexture);


  this.program24bit.vertexTexture = gl.getAttribLocation(this.program24bit, "aVertexTexture");
  gl.enableVertexAttribArray(this.program24bit.vertexTexture);

  this.program24bit.vertexPosition = gl.getAttribLocation(this.program24bit, "aVertexPosition");
  gl.enableVertexAttribArray(this.program24bit.vertexPosition);


// 8/4-bit video ram
  this.programTexture.vertexPosition = gl.getAttribLocation(this.programDraw, "aVertexPosition");
  gl.enableVertexAttribArray(this.programTexture.vertexPosition);

  this.programTexture.vertexTexture = gl.getAttribLocation(this.programDisplay, "aVertexTexture");
  gl.enableVertexAttribArray(this.programTexture.vertexTexture);

  this.canvasBuffer = gl.createBuffer();

  gl.bindBuffer(gl.ARRAY_BUFFER, this.canvasBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, this.vertexBuffer, gl.DYNAMIC_DRAW);
}

WebGLRenderer.prototype.createBuffer = function() {
  var gl = this.gl;
  var buffer = gl.createFramebuffer();

  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);

  return buffer;
}

WebGLRenderer.prototype.createTexture = function(mode) {
  var gl = this.gl;
  var texture = gl.createTexture();
  if (mode === undefined) mode = gl.NEAREST;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mode);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mode);

  return texture;
}

WebGLRenderer.prototype.setupProgramDraw = function() {
  var gl = this.gl;

  gl.viewport(0, 0, qwidth, qheight);
  gl.useProgram(this.programDraw);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf16draw);

  gl.vertexAttribPointer(this.programDraw.vertexColor   , 4, gl.UNSIGNED_BYTE, false, 24, 0);
  gl.vertexAttribPointer(this.programDraw.vertexPosition, 2, gl.SHORT, false, 24, 4);
  gl.vertexAttribPointer(this.programDraw.vertexTexture , 2, gl.SHORT, false, 24, 8);
  gl.vertexAttribPointer(this.programDraw.aclut         , 2, gl.SHORT, false, 24, 12);
  gl.vertexAttribPointer(this.programDraw.texturePage   , 2, gl.SHORT, false, 24, 16);
  gl.vertexAttribPointer(this.programDraw.textureWindow , 4, gl.UNSIGNED_BYTE, false, 24, 20);

  gl.enable(gl.SCISSOR_TEST);
}

WebGLRenderer.prototype.flushVertexBuffer = function(clip) {
  var gl = this.gl;

  if (this.vertexBuffer.index <= 0) {
    // ++this.metrics.vertices[0];
    return;
  }

  gl.bindTexture(gl.TEXTURE_2D, this.tex16rgba);

  if (this.vertexClip !== clip || !clip || this.drawAreaChange) {
    gl.enable(gl.SCISSOR_TEST);
    if (clip) {
      let dah = (this.drawAreaB - this.drawAreaT + 1) * qhf;
      let dat = this.drawAreaT * qhf;
      gl.scissor(this.drawAreaL*qwf, dat, (this.drawAreaR-this.drawAreaL+1)*qwf, dah);
    }
    else
      gl.scissor(0, 0, 1024*qwf, 512*qhf);

    this.vertexClip = clip;
  }


  var drawBuffer = this.vertexBuffer.view();//.subarray(0, this.vertexBuffer.index / 4);
  // gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, drawBuffer, gl.STREAM_DRAW);
  var vertices = this.vertexBuffer.getNumberOfVertices();
  gl.drawArrays(gl.TRIANGLES, 0, vertices);
  // ++this.metrics.vertices[vertices/3];
  // this.metrics.triangles += vertices/3;

  this.vertexBuffer.reset();
}

WebGLRenderer.prototype.setBlendMode = function(mode) {
  if (this.renderMode === mode) return;
  this.flushVertexBuffer(true);
  this.renderMode = mode;

  var gl = this.gl;

  switch (mode) {
    case 0: gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.SRC_ALPHA, gl.SRC_ALPHA);
            gl.uniform1f(this.programDraw.blendAlpha, 0.50);
            break;
    case 1: gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE, gl.ONE);
            gl.uniform1f(this.programDraw.blendAlpha, 1.00);
            break;
    case 2: gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
            gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
            gl.uniform1f(this.programDraw.blendAlpha, 1.00);
            break;
    case 3: gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.ONE);
            gl.uniform1f(this.programDraw.blendAlpha, 0.75);
            break;
    case 4: gl.disable(gl.BLEND);
            // gl.uniform1f(this.programDraw.blendAlpha, 0.00);
            break;
  }
  // ++this.metrics.switches;
}

WebGLRenderer.prototype.getVertexBuffer = function(cnt, pid) {
  var select = ((pid || 0) & 0x02000000) ? ((gpu.status >> 5) & 3) : 4;

  if (!this.vertexBuffer.canHold(cnt)) {
    this.flushVertexBuffer(true);
  }
  this.setBlendMode(select);

  return this.vertexBuffer;
}

WebGLRenderer.prototype.switchDisplayMode = function() {
  this.displaymode = (this.displaymode + 1) % 3
}

WebGLRenderer.prototype.drawLine = function(data, c1, xy1, c2, xy2) {
  var x1 = this.drawOffsetX + ((data[xy1] << 21) >> 21);
  var y1 = this.drawOffsetY + ((data[xy1] <<  5) >> 21);
  var x2 = this.drawOffsetX + ((data[xy2] << 21) >> 21);
  var y2 = this.drawOffsetY + ((data[xy2] <<  5) >> 21);

  if (this.outsideDrawArea(x1,y1,x2,y2,x1,y1)) return;
  if (this.largePrimitive(x1,y1,x2,y2,x1,y1)) return;

  var w = Math.abs(x1-x2);
  var h = Math.abs(y1-y2);

  var buffer = this.getVertexBuffer(6, data[0]);

  if (x1 !== x2 || y1 !== y2) {
    if (w >= h) {
      buffer.addVertex(x1, y1+1, data[c1]);
      buffer.addVertex(x1, y1+0, data[c1]);
      buffer.addVertex(x2, y2+0, data[c2]);

      buffer.addVertex(x2, y2+0, data[c2]);
      buffer.addVertex(x2, y2+1, data[c2]);
      buffer.addVertex(x1, y1+1, data[c1]);

    }
    else {
      buffer.addVertex(x1+0, y1, data[c1]);
      buffer.addVertex(x1+1, y1, data[c1]);
      buffer.addVertex(x2+1, y2, data[c2]);

      buffer.addVertex(x2+1, y2, data[c2]);
      buffer.addVertex(x2+0, y2, data[c2]);
      buffer.addVertex(x1+0, y1, data[c1]);
    }
  }
  else {
    buffer.addVertex(x2+0, y2+0, data[c2]);
    buffer.addVertex(x2+1, y2+0, data[c2]);
    buffer.addVertex(x2+0, y2+1, data[c2]);

    buffer.addVertex(x2+0, y2+1, data[c2]);
    buffer.addVertex(x2+1, y2+0, data[c2]);
    buffer.addVertex(x2+1, y2+1, data[c2]);
  }
}

// todo: cache results as this is called per textured primitive
WebGLRenderer.prototype.getClutInfo = function(cl, tm) {
  var cx = ((cl >>> 0) & 0x03f) * 16;
  var cy = ((cl >>> 6) & 0x1ff);

  if (tm === 2) return 3;
  if (tm === 1) var len = 256;
  if (tm === 0) var len = 16;

  var info = 0;
  var offs = 1024*cy+cx;
  var vram = this.vram;
  while (--len >= 0) {
    var pixel = vram[offs++];
    if (pixel !== 0) {
      if (pixel <= 0x7fff) {
        info |= 1; // STP:0
      }
      else {
        info |= 2; // STP:1
      }
    }
  }
  return info;
}

WebGLRenderer.prototype.drawTriangle = function(data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
  switch ((data[0] >> 24) & 0xF) {// raw-texture
    case 0x5:
    case 0x7:
    case 0xd:
    case 0xf:
      data[c1] = (data[c1] & 0xff000000) | 0x00808080;
      data[c2] = (data[c2] & 0xff000000) | 0x00808080;
      data[c3] = (data[c3] & 0xff000000) | 0x00808080;
      break;
  }

  var x1 = this.drawOffsetX + ((data[xy1] << 21) >> 21);
  var y1 = this.drawOffsetY + ((data[xy1] <<  5) >> 21);
  var x2 = this.drawOffsetX + ((data[xy2] << 21) >> 21);
  var y2 = this.drawOffsetY + ((data[xy2] <<  5) >> 21);
  var x3 = this.drawOffsetX + ((data[xy3] << 21) >> 21);
  var y3 = this.drawOffsetY + ((data[xy3] <<  5) >> 21);

  if (gpu.txflip || gpu.tyflip) console.warn('texture flip with triangles');

  if (this.outsideDrawArea(x1,y1,x2,y2,x3,y3)) return;
  if (this.largePrimitive(x1,y1,x2,y2,x3,y3)) return;

  var textured = (data[0] & 0x04000000) === 0x04000000;

  if (!textured) {
    var buffer = this.getVertexBuffer(3, data[0]);
    buffer.addVertex(x1, y1, data[c1]);
    buffer.addVertex(x2, y2, data[c2]);
    buffer.addVertex(x3, y3, data[c3]);
    return;
  }

  var u1 = (data[uv1] >>> 0) & 255;
  var v1 = (data[uv1] >>> 8) & 255;
  var u2 = (data[uv2] >>> 0) & 255;
  var v2 = (data[uv2] >>> 8) & 255;
  var u3 = (data[uv3] >>> 0) & 255;
  var v3 = (data[uv3] >>> 8) & 255;
  var cx = ((cl >>> 0) & 0x03f) * 16;
  var cy = ((cl >>> 6) & 0x1ff);

  var tm = Math.min(((gpu.status >> 7) & 3), 2);

  var semi_transparent = (data[0] & 0x02000000) === 0x02000000;

  var info = 3;
  if (semi_transparent) {
    info = this.getClutInfo(cl, tm);
    tm |= 16;
  }

  if (!semi_transparent || ((info & 2) === 2)) {
    var buffer = this.getVertexBuffer(3, data[0]);
    buffer.addVertexUV(x1, y1, data[c1], tm | 8, u1, v1, cx, cy);
    buffer.addVertexUV(x2, y2, data[c2], tm | 8, u2, v2, cx, cy);
    buffer.addVertexUV(x3, y3, data[c3], tm | 8, u3, v3, cx, cy);
  }

  if (semi_transparent && ((info & 1) === 1)) {
    var buffer = this.getVertexBuffer(3, 0);
    buffer.addVertexUV(x1, y1, data[c1], tm, u1, v1, cx, cy);
    buffer.addVertexUV(x2, y2, data[c2], tm, u2, v2, cx, cy);
    buffer.addVertexUV(x3, y3, data[c3], tm, u3, v3, cx, cy);
  }
}

WebGLRenderer.prototype.drawRectangle = function(data, tx, ty, cl) {
    switch ((data[0] >> 24) & 0xF) {
    case 0x5:
    case 0x7:
    case 0xd:
    case 0xf:
      data[0] = (data[0] & 0xff000000) | 0x00808080;  
      break;
  }

  var x = this.drawOffsetX + ((data[1] << 21) >> 21);
  var y = this.drawOffsetY + ((data[1] <<  5) >> 21);
  var c = (data[0] & 0xffffff);
  var w = (data[2] << 16) >> 16;
  var h = (data[2] >> 16);
// console.log(`drawRectangle: ${x}, ${y}`)

  var showT1 = !this.outsideDrawArea(x+0, y  +0, x+w-1, y+0, x  +0, y+h-1);
  var showT2 = !this.outsideDrawArea(x+0, y+h-1, x+w-1, y+0, x+w-1, y+h-1);
  if (!showT1 && !showT2) return;

  var textured = (data[0] & 0x04000000) === 0x04000000;

  if (!textured) {
    var buffer = this.getVertexBuffer(6, data[0]); 
    buffer.addVertex(x+0, y+0, c);
    buffer.addVertex(x+w, y+0, c);
    buffer.addVertex(x+0, y+h, c);

    buffer.addVertex(x+w, y+0, c);
    buffer.addVertex(x+0, y+h, c);
    buffer.addVertex(x+w, y+h, c);
    return;
  }

  var cx = ((cl >>> 0) & 0x03f) * 16;
  var cy = ((cl >>> 6) & 0x1ff);

  var tm = Math.min(((gpu.status >> 7) & 3), 2);

  var tl = tx + 0;
  var tr = tx + w;
  if (gpu.txflip) {
    tl = tx + 0
    tr = tx - w// + 1
  }

  var tt = ty + 0;
  var tb = ty + h;
  if (gpu.tyflip) {
    tt = ty + 0
    tb = ty - h// + 1
  }

  var semi_transparent = (data[0] & 0x02000000) === 0x02000000;
// console.log(`--drawRectangle: ${x}, ${y}, ${w}, ${h}`)

  var info = 3;
  if (semi_transparent) {
    info = this.getClutInfo(cl, tm);
    tm |= 16;
  }

  if (!semi_transparent || ((info & 2) === 2)) {
    var buffer = this.getVertexBuffer(6, data[0]); 
    buffer.addVertexUV(x+0, y+0, c, tm | 8, tl, tt, cx, cy);
    buffer.addVertexUV(x+w, y+0, c, tm | 8, tr, tt, cx, cy);
    buffer.addVertexUV(x+0, y+h, c, tm | 8, tl, tb, cx, cy);

    buffer.addVertexUV(x+w, y+0, c, tm | 8, tr, tt, cx, cy);
    buffer.addVertexUV(x+0, y+h, c, tm | 8, tl, tb, cx, cy);
    buffer.addVertexUV(x+w, y+h, c, tm | 8, tr, tb, cx, cy);
  }

  if (semi_transparent && ((info & 1) === 1)) {
    var buffer = this.getVertexBuffer(6, 0); 
    buffer.addVertexUV(x+0, y+0, c, tm, tl, tt, cx, cy);
    buffer.addVertexUV(x+w, y+0, c, tm, tr, tt, cx, cy);
    buffer.addVertexUV(x+0, y+h, c, tm, tl, tb, cx, cy);

    buffer.addVertexUV(x+w, y+0, c, tm, tr, tt, cx, cy);
    buffer.addVertexUV(x+0, y+h, c, tm, tl, tb, cx, cy);
    buffer.addVertexUV(x+w, y+h, c, tm, tr, tb, cx, cy);
  }
}

WebGLRenderer.prototype.clearVRAM = function(x, y, w, h) {
  var gl = this.gl;

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf8vram);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex8vram, 0);

  gl.scissor(x << 1, y, w << 1, h);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf16draw);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex16draw, 0);
}

WebGLRenderer.prototype.fillRectangle = function(data) {
  var x = (data[1] << 16) >> 16;
  var y = (data[1] >> 16);
  var c = (data[0] & 0xf8f8f8);
  var w = (data[2] << 16) >>> 16;
  var h = (data[2] >> 16) >>> 0;
  // w = ((w + 15) >> 4) << 4;
  // h = ((h + 15) >> 4) << 4;
  // x = ((x + 15) >> 4) << 4;
  // y = ((y + 15) >> 4) << 4;
  x = (x & 0x3f0);
  y = (y & 0x1ff);
  w = ((w & 0x3ff) + 15) & ~15;
  h = (h & 0x1ff);
  if (!w && !h) return;

  this.flushVertexBuffer(true);
  var buffer = this.getVertexBuffer(6, 0);
  buffer.addVertex(x+0, y+0, c);
  buffer.addVertex(x+w, y+0, c);
  buffer.addVertex(x+0, y+h, c);

  buffer.addVertex(x+0, y+h, c);
  buffer.addVertex(x+w, y+0, c);
  buffer.addVertex(x+w, y+h, c);
  this.flushVertexBuffer(false);
  this.clearVRAM(x, y, w, h, c); // really needed sadly for Castlevania
}

WebGLRenderer.prototype.setDrawAreaOF = function(x, y) {
  this.drawOffsetX = x;
  this.drawOffsetY = y;
}

WebGLRenderer.prototype.setDrawAreaTL = function(x, y) {
  this.flushVertexBuffer(true);
  this.drawAreaChange = true;
  this.drawAreaT = y;
  this.drawAreaL = x;
}

WebGLRenderer.prototype.setDrawAreaBR = function(x, y) {
  this.flushVertexBuffer(true);
  this.drawAreaChange = true;
  this.drawAreaB = y;
  this.drawAreaR = x;
}

WebGLRenderer.prototype.onVBlankBegin = function() {
}

WebGLRenderer.prototype.onVBlankEnd = function() {
  var gl = this.gl;

  this.flushVertexBuffer(true);

  gl.disable(gl.SCISSOR_TEST);
  // Display
  gl.useProgram(this.programDisplay);
  this.vertexBuffer.addVertexDisp(-32768, +32767,    0,   0);
  this.vertexBuffer.addVertexDisp(+32767, +32767, 1024,   0);
  this.vertexBuffer.addVertexDisp(-32768, -32768,    0, 512);

  this.vertexBuffer.addVertexDisp(+32767, +32767, 1024,   0);
  this.vertexBuffer.addVertexDisp(-32768, -32768,    0, 512);
  this.vertexBuffer.addVertexDisp(+32767, -32768, 1024, 512);

  gl.disable(gl.BLEND);
  this.renderMode = 5;
  // restore to canvas frame buffer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);

  gl.vertexAttribPointer(this.programDisplay.vertexPosition, 2, gl.SHORT, true, 8, 4);
  gl.vertexAttribPointer(this.programDisplay.vertexTexture , 2, gl.SHORT, false, 8, 8);

  var drawBuffer = this.vertexBuffer.subarray(0, this.vertexBuffer.index / 4);

  if (this.displaymode === 0) {
    gl.viewport(0, 0, this.canvas.width = 2048, this.canvas.height = 1024)
    display8bit(this, drawBuffer)
  }
  if (this.displaymode === 1) {
    gl.viewport(0, 0, this.canvas.width = 1024, this.canvas.height = 512)
    display16bit(this, drawBuffer)
  }
  if (this.displaymode === 2) {
    var area = gpu.getDisplayArea();
    this.canvas.width = area.w*qwf;
    this.canvas.height = area.h*qhf;
    this.vertexBuffer.reset()

    var al = area.x
    var ar = area.x + area.w
    var at = area.y
    var ab = area.y + area.h

    this.vertexBuffer.addVertexDisp(-32768, +32767, al, at);
    this.vertexBuffer.addVertexDisp(+32767, +32767, ar, at);
    this.vertexBuffer.addVertexDisp(-32768, -32768, al, ab);

    this.vertexBuffer.addVertexDisp(+32767, +32767, ar, at);
    this.vertexBuffer.addVertexDisp(-32768, -32768, al, ab);
    this.vertexBuffer.addVertexDisp(+32767, -32768, ar, ab);

    var drawBuffer = this.vertexBuffer.subarray(0, this.vertexBuffer.index / 4)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)

    // if (gpu.status & (1 << 23)) {
    //   gl.clearColor(0.0, 0.0, 0.0, 1.0);
    //   gl.clear(gl.COLOR_BUFFER_BIT);
    // }
    // else
    if (gpu.status & (1 << 21)) {
      display24bit(this, drawBuffer, al, at)
    }
    else {
      display16bit(this, drawBuffer, al, at)
    }
  }

  this.vertexBuffer.reset();
  // Draw
 this.setupProgramDraw();
}

WebGLRenderer.prototype.setMode = function(mode) {
  switch (mode) {
    case 'vram':  this.displaymode = 1;
                  break
    default    :  this.displaymode = 2;
                  break
  }
}

function display8bit(self, drawBuffer) {
  var gl = self.gl;

  gl.useProgram(self.programTexture);

  gl.vertexAttribPointer(self.programTexture.vertexPosition, 2, gl.SHORT, true, 8, 0);
  gl.vertexAttribPointer(self.programTexture.vertexTexture , 2, gl.SHORT, false, 8, 4);

  gl.bindTexture(gl.TEXTURE_2D, self.tex8vram);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawBuffer);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function display16bit(self, drawBuffer, al, at) {
  var gl = self.gl;
  var lace = ((gpu.status >> 22) & 1) ? 2.0 : 1.0;

  gl.useProgram(self.programDisplay);
  gl.uniform3f(self.programDisplay.ts, al, at, lace);

  gl.vertexAttribPointer(self.programDisplay.vertexPosition, 2, gl.SHORT, true, 8, 0);
  gl.vertexAttribPointer(self.programDisplay.vertexTexture , 2, gl.SHORT, false, 8, 4);

  gl.bindTexture(gl.TEXTURE_2D, self.tex16draw);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawBuffer);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// todo: display from draw area. more complex but handles blackbars correct.
function display24bit(self, drawBuffer, al, at) {
  var gl = self.gl;
  var lace = ((gpu.status >> 22) & 1) ? 2.0 : 1.0;

  gl.useProgram(self.program24bit);
  gl.uniform3f(self.program24bit.ts, al, at, lace);

  gl.vertexAttribPointer(self.program24bit.vertexPosition, 2, gl.SHORT, true, 8, 0);
  gl.vertexAttribPointer(self.program24bit.vertexTexture , 2, gl.SHORT, false, 8, 4);

  gl.bindTexture(gl.TEXTURE_2D, self.tex16draw);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawBuffer);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
