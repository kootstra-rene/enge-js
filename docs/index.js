'use strict';globalThis.mdlr=(()=>{const e={names:/^(?:\[(?<t>[a-z]+)\])?(?<n>[-:a-z0-9_]+)$/,modules:new Map,loader:new Map,info:(t,n="unit")=>{const[,o,r]=e.names.exec(t)??[];return{type:o??n,n:`[${o??n}]${r}`}},load:(t,n)=>e.loader.get(t.type)(t,n)};e.loader.set('unit',((n,o)=>{const r=new t(n,o);return e.modules.get(n.n)(r)})).set('mdlr',e.loader.get('unit')).set('node',(e=>require(e.n.replace('[node]',''))));class t{constructor(t,n={}){this.context=n,this.name=t.n,'mdlr'===t.type&&(this.$=t=>e[t])}require(t,n){return this.context[t]??e.load(e.info(t),n)}}return(t,n)=>{const o=e.info(t);if(n?.constructor!==Function)return e.load(o,n);e.modules.set(o.n,n)}})();
mdlr('enge:psx:webgl', m => {
Object.assign(window,
m.require('enge:utils'),
);
m.require('enge:webgl');
m.require('enge:psx');
})
mdlr('enge:utils', m => {
const Base64 = m.require('base64');
function readStorageStream(item, handler) {
const base64text = localStorage.getItem(item);
if (base64text) {
const arrayBuffer = Base64.decode(base64text);
return handler(arrayBuffer);
}
else {
return handler(null);
}
}
function writeStorageStream(item, arrayBuffer) {
const base64text = Base64.encode(arrayBuffer);
localStorage.setItem(item, base64text);
}
function hex(value, len) {
return ("00000000" + (value >>> 0).toString(16)).substr(-(len || 8));
}
function log() {
console.log.call(console, ('000000000000' + (psx.clock)).substr(-12) + ']', Array.prototype.slice.call(arguments).join(''));
}
const settings = (() => {
const object = JSON.parse(localStorage.getItem('config') || '{}');
const defaults = { quality: 1, overscan: 0.00 };
return Object.assign(defaults, object);
})();
settings.updateQuality = quality => {
const elem = document.getElementById('quality');
const select = document.getElementById('quality-select');
if (quality === true) {
settings.quality <<= 1;
if (settings.quality > 4) settings.quality = 1;
}
else if (quality !== undefined) {
settings.quality = Number(quality) || 1;
}
if (quality !== undefined) {
localStorage.setItem('config', JSON.stringify(settings));
}
if (select) select.value = String(settings.quality);
if (elem) elem.innerText = `Q${settings.quality}`;
}
window.addEventListener('storage', () => {
const object = JSON.parse(localStorage.getItem('config') || '{}');
Object.assign(settings, object);
});
return { log, hex, readStorageStream, writeStorageStream, settings };
})
mdlr('enge:webgl', m => {
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
var qwf = settings.quality || 1;
var qhf = settings.quality || 1;
var qwidth = 1024 * qwf;
var qheight = 512 * qhf;
const $stats = {
flushes: 0,
dump: () => {
$stats.flushes = 0;
}
}
const nextPrimitive = () => { } // changes for webGL2
Uint32Array.prototype.addVertexDisp = function (x, y, u, v) {
var xy = (y << 16) | (x & 0xffff);
var uv = (v << 16) | (u & 0xffff);
var index = this.index >>> 2;
this[index + 0] = xy;
this[index + 1] = uv;
this.index += 8;
}
Uint32Array.prototype.addVertex = function (x, y, c) {
x = x * 16;
y = y * 16;
var xy = (y << 16) | (x & 0xffff);
var index = this.index >>> 2;
this[index + 0] = (c & 0xffffff) | 0x03000000;
this[index + 1] = xy;
this.index += 24;
}
Uint32Array.prototype.addVertexUV = function (x, y, c, tm, u, v, cx, cy) {
x = x * 16;
y = y * 16;
var xy = (y << 16) | (x & 0xffff);
var uv = (v << 16) | (u & 0xffff);
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
Uint32Array.prototype.getNumberOfVertices = function () {
return this.index / 24;
}
Uint32Array.prototype.canHold = function (cnt) {
return this.index + (24 * cnt * 2) < (this.length * 4);
}
Uint32Array.prototype.reset = function () {
this.index = 0;
}
Uint32Array.prototype.view = function () {
return new Uint32Array(this.buffer, 0, this.index >> 2);
}
const vertexShaderDisplay =
"precision highp float;" +
"attribute vec2 aVertexPosition;" +
"attribute vec2 aVertexTexture;" +
"varying vec2 vTextureCoord;" +
"varying vec2 tx;" +
"void main(void) {" +
"  gl_Position = vec4(aVertexPosition, 0.0, 1.0);" +
"  tx.xy = aVertexTexture;" +
"  vTextureCoord.x = aVertexTexture.x / 1024.0;" +
"  vTextureCoord.y = aVertexTexture.y / 512.0;" +
"}";
const fragmentShader16bit =
"precision highp float;" +
"uniform sampler2D uVRAM;" +
"varying vec2 tx;" +
"vec4 getColor(float tx, float ty) {" +
"  if (ty >= 511.0) ty = 511.0;" +
"  if (tx >= 1023.0) tx = 1023.0;" +
"  return texture2D(uVRAM, vec2((tx + 0.0) / 1024.0, (ty + 0.0) / 512.0));" +
"}" +
"void main(void) {" +
"  gl_FragColor = vec4(getColor(tx.x, tx.y).rgb, 1.0);" +
"}";
const fragmentShaderTexture =
"precision highp float;" +
"uniform sampler2D uVRAM;" +
"varying vec2 vTextureCoord;" +
"void main(void) {" +
"  vec4 pixel = texture2D(uVRAM, vTextureCoord);" +
"  gl_FragColor = vec4(pixel.aaa, 1.0);" +
"}";
const fragmentShader24bit =
"precision highp float;" +
"uniform sampler2D uVRAM;" +
"uniform vec3 ts;" +
"varying vec2 tx;" +
"varying vec2 vTextureCoord;" +
"vec4 getColor(float tx, float ty) {" +
"  if (ty >= 512.0) ty = 512.0;" +
"  if (tx >= 2048.0) tx = 2048.0;" +
"  float r = texture2D(uVRAM, vec2((tx + 0.0) / 2048.0, ty / 512.0)).a;" +
"  float g = texture2D(uVRAM, vec2((tx + 1.0) / 2048.0, ty / 512.0)).a;" +
"  float b = texture2D(uVRAM, vec2((tx + 2.0) / 2048.0, ty / 512.0)).a;" +
"  return vec4(r, g, b, 1.0);" +
"}" +
"void main(void) {" +
"  float td = (tx.x - ts.x);" +
"  float x = 3.0 * floor(td) + 2.0 * ts.x;" +
"  gl_FragColor = getColor(x , floor(tx.y));" +
"}";
const vertexShaderDraw =
"precision highp float;" +
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
"varying float tmx;" + // texture window mask x
"varying float tmy;" + // texture window mask y
"varying float tox;" + // texture window offset x
"varying float toy;" + // texture window offset y
"varying float tcx;" + // texture coordinate x
"varying float tcy;" + // texture coordinate y
"varying float twin;" +
"void main(void) {" +
"  gl_Position = vec4(aVertexPosition, 0.0, 1.0); " +
"  gl_Position.x -= 8192.0; gl_Position.y -= 4096.0;" +
"  gl_Position.x /= 8192.0; gl_Position.y /= 4096.0;" +
"  vClut = aTextureClut;" +
"  vClut.x /= 1024.0;" +
"  vClut.y /= 512.0;" +
"  twin = aTextureWindow.x + aTextureWindow.y;" +
"  tmx = 256.0 - aTextureWindow.x;" +
"  tmy = 256.0 - aTextureWindow.y;" +
"  tox = aTexturePage.x + aTextureWindow.z;" +
"  toy = aTexturePage.y + aTextureWindow.a;" +
"  tcx = aVertexTexture.x;" +
"  tcy = aVertexTexture.y;" +
"  vTextureMode = mod(aVertexColor.a, 8.0);" +
"  if (vTextureMode == 7.0) {" +
"    tcx = aVertexPosition.x / 8192.0 / 2.0;" +
"    tcy = aVertexPosition.y / 4096.0 / 2.0;" +
"  }" +
"  else {" +
"    vSTP = floor(aVertexColor.a / 8.0);" +
"  }" +
"  vColor = vec4(aVertexColor.rgb / 256.0, uBlendAlpha);" +
"}";
const fragmentShaderDraw =
"precision highp float;" +
"uniform sampler2D uTex8;" +
"uniform float uBlendAlpha;" +
"varying float vTextureMode;" +
"varying float vSTP;" +
"varying vec4 vColor;" +
"varying vec2 vClut;" +
"varying float tmx;" + // texture window mask x
"varying float tmy;" + // texture window mask y
"varying float tox;" + // texture window offset x
"varying float toy;" + // texture window offset yx
"varying float tcx;" + // texture coordinate x
"varying float tcy;" + // texture coordinate y
"varying float twin;" +
"float getSRGB16(float cx, float cy) {" +
"  float tx = floor(cx * 1024.0) * 2.0;" +
"  float ty = floor(cy * 512.0);" +
"  float lo = floor(texture2D(uTex8, vec2(tx + 0.0, ty) / vec2(2048.0, 512.0)).a * 255.0);" +
"  float hi = floor(texture2D(uTex8, vec2(tx + 1.0, ty) / vec2(2048.0, 512.0)).a * 255.0);" +
"  return hi * 256.0 + lo;" +
"}" +
"vec4 getColor(float cx, float cy) {" +
"  float srgb = getSRGB16(cx, cy);" +
"  float r = mod(floor(srgb /     1.0), 32.0) / 32.0;" +
"  float g = mod(floor(srgb /    32.0), 32.0) / 32.0;" +
"  float b = mod(floor(srgb /  1024.0), 32.0) / 32.0;" +
"  float a = srgb >= 32768.0 ? 1.0 : 0.0;" +
"  return vec4(r, g, b, a);" +
"}" +
"vec4 getClutColor() {" +
"  float cx, cy, val, tx, ty;" +
"  vec4 rgba;" +
"  if (twin != 0.0) {" +
"    tx = tox + mod(floor(tcx), tmx);" +
"    ty = toy + mod(floor(tcy), tmy);" +
"  }" +
"  else {" +
"    tx = tox + floor(tcx);" +
"    ty = toy + floor(tcy);" +
"  }" +
"  if (vTextureMode == 1.0) {" +
"    val = texture2D(uTex8, vec2(tx / 2048.0, ty / 512.0)).a * 255.0;" +
"    cx = vClut.x + (val / 1024.0); cy = vClut.y;" +
"    rgba = getColor(cx, cy);" +
"  }" +
"  else" +
"  if (vTextureMode == 0.0) {" +
"    val = texture2D(uTex8, vec2(tx / 4096.0, ty / 512.0)).a * 255.0;" +
"    if (mod((tx), 2.0) == 0.0) { val = mod(val, 16.0); } else { val = mod(floor(val / 16.0), 16.0); }" +
"    cx = vClut.x + (val / 1024.0); cy = vClut.y;" +
"    rgba = getColor(cx, cy);" +
"  }" +
"  else" +
"  if (vTextureMode == 2.0) {" +
`    cx = (tox + tcx) / 1024.0; cy = (toy + tcy) / 512.0;` +
"    rgba = texture2D(uTex8, vec2(cx, cy));" +
"  }" +
"  if (rgba.a == 0.0) {" +
"    if (vSTP == 3.0) return vec4(0.0,0.0,0.0,0.0);" +
"  }" +
"  else {" +
"    if (vSTP == 2.0) return vec4(0.0,0.0,0.0,0.0);" +
"  }" +
"  return rgba;" +
"}" +
"void main(void) {" +
"  float fx = tcx - floor(tcx);" +
"  float fy = tcy - floor(tcy);" +
"  if (vTextureMode == 7.0) {" + // copy mode
"    gl_FragColor = getColor(tcx, tcy);" +
"    return;" +
"  }" +
"  if (vTextureMode == 3.0) {" +
"    gl_FragColor = vec4(vColor.rgb, uBlendAlpha);" +
"    return;" +
"  }" +
"  vec4 c = getClutColor();" +
"  if (c == vec4(0.0, 0.0, 0.0, 0.0)) discard;" +
// "  if (fx < 0.25) { gl_FragColor = vec4(0.25, 0.0, 0.0, uBlendAlpha); return; }"+
// "  if (fx >= 0.75) { gl_FragColor = vec4(0.0, 0.0, 0.25, uBlendAlpha); return; }"+
// "  if (fy < 0.25) { gl_FragColor = vec4(0.25, 0.0, 0.0, uBlendAlpha); return; }"+
// "  if (fy >= 0.75) { gl_FragColor = vec4(0.0, 0.0, 0.25, uBlendAlpha); return; }"+
"  gl_FragColor = vec4(2.0 * (vColor.rgb * c.rgb), uBlendAlpha);" +
"}";
class WebGLRenderer {
constructor(canvas) {
this.gl = null;
this.programDisplay = null;
this.vertexBuffer = new Uint32Array(18 * 1024 >> 2); // // 18.0 Kb, 768 vertices, 256 triangles
this.drawOffsetX = 0;
this.drawOffsetY = 0;
this.displaymode = 2;
this.vram = new Uint16Array(512 * 1024);
this.vertexClip = false;
this.drawAreaChange = false;
this.seenRender = false;
this.fpsRenderCounter = 0;
this.fpsCounter = 0;
try {
this.gl = canvas.getContext("webgl", {
alpha: false,
antialias: false,
preserveDrawingBuffer: false,
premultipliedAlpha: false,
depth: false,
stencil: false,
powerPreference: 'high-performance',
// desynchronized: true, // makes screen black if true?
});
}
catch (e) {
alert("Error: Unable to get WebGL context");
return;
}
if (this.gl) {
this.initShaders();
this.initTextures();
this.setupBuffers();
var gl = this.gl;
this.setupWebGL(canvas);
gl.useProgram(this.programDraw);
gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.buf16draw);
gl.activeTexture(this.gl.TEXTURE1);
gl.bindTexture(this.gl.TEXTURE_2D, this.tex8vram);
this.vertexBuffer.reset();
this.setupProgramDraw();
}
else {
alert("Error: Your browser does not appear to support WebGL.");
}
}
// todo: cache results as this is called per textured primitive.
//       do not ever remove one of the more powerful optimisations
getClutInfo(cl, tm) {
var cx = ((cl >>> 0) & 0x03f) * 16;
var cy = ((cl >>> 6) & 0x1ff);
if (tm === 2) return 3;
if (tm === 1) var len = 256;
if (tm === 0) var len = 16;
var info = 0;
var offs = 1024 * cy + cx;
var vram = this.vram;
while (--len >= 0) {
var pixel = vram[offs++];
if (pixel !== 0) {
if (pixel <= 0x7fff) {
info |= 1; // STP:0  // opaque colors in clut
}
else {
info |= 2; // STP:1  // transparent colors in clut
}
}
}
return info;
}
outsideDrawArea(x1, y1, x2, y2, x3, y3) {
if ((x1 < this.drawAreaL) && (x2 < this.drawAreaL) && (x3 < this.drawAreaL)) return true;
if ((x1 > this.drawAreaR) && (x2 > this.drawAreaR) && (x3 > this.drawAreaR)) return true;
if ((y1 < this.drawAreaT) && (y2 < this.drawAreaT) && (y3 < this.drawAreaT)) return true;
if ((y1 > this.drawAreaB) && (y2 > this.drawAreaB) && (y3 > this.drawAreaB)) return true;
return false;
}
largePrimitive(x1, y1, x2, y2, x3, y3) {
if (Math.abs(x1 - x2) > 1023) return true;
if (Math.abs(x2 - x3) > 1023) return true;
if (Math.abs(x3 - x1) > 1023) return true;
if (Math.abs(y1 - y2) > 511) return true;
if (Math.abs(y2 - y3) > 511) return true;
if (Math.abs(y3 - y1) > 511) return true;
return false;
}
setupWebGL(canvas) {
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
initShaders() {
try {
var gl = this.gl;
// Drawing
this.programDraw = gl.createProgram();
gl.attachShader(this.programDraw, this.makeShader(vertexShaderDraw, gl.VERTEX_SHADER));
gl.attachShader(this.programDraw, this.makeShader(fragmentShaderDraw, gl.FRAGMENT_SHADER));
gl.linkProgram(this.programDraw);
if (!gl.getProgramParameter(this.programDraw, gl.LINK_STATUS)) {
abort();
}
gl.useProgram(this.programDraw);
this.programDraw.uTex8 = gl.getUniformLocation(this.programDraw, "uTex8");
gl.uniform1i(this.programDraw.uTex8, 1);
// Display 16bit vram
this.programDisplay = gl.createProgram();
gl.attachShader(this.programDisplay, this.makeShader(vertexShaderDisplay, gl.VERTEX_SHADER));
gl.attachShader(this.programDisplay, this.makeShader(fragmentShader16bit, gl.FRAGMENT_SHADER));
gl.linkProgram(this.programDisplay);
if (!gl.getProgramParameter(this.programDisplay, gl.LINK_STATUS)) {
abort();
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
abort();
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
abort();
}
gl.useProgram(this.programTexture);
this.programTexture.vram = gl.getUniformLocation(this.programTexture, "uVRAM");
gl.uniform1i(this.programTexture.vram, 0);
}
catch (e) {
abort();
}
}
initTextures() {
var gl = this.gl;
// 8-bit video ram
this.tex8vram = this.createTexture();
gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, 2048, 512, 0, gl.ALPHA, gl.UNSIGNED_BYTE, null);
this.buf8vram = this.createBuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf8vram);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex8vram, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
// Drawing
this.tex16draw = this.createTexture();
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, qwidth, qheight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
this.buf16draw = this.createBuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf16draw);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex16draw, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
this.vramP2 = this.createTexture();
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, qwidth, qheight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
loadImage(x, y, w, h, buffer) {
let o = 0;
for (let j = 0; j < h; ++j) {
const offsetY = ((y + j) % 512) * 1024;
for (let i = 0; i < w; ++i) {
buffer[o++] = this.vram[offsetY + ((x + i) % 1024)];
}
}
// buffer.fill(0x7c1f, 0, w*h);
}
getVramState() {
return new Uint16Array(this.vram);
}
setVramState(buffer) {
this.vram.set(buffer);
this.storeImageInTexture({ x: 0, y: 0, w: 1024, h: 512, pixelCount: 1024 * 512, buffer: this.vram });
}
moveImage(sx, sy, dx, dy, w, h) {
var gl = this.gl;
var o = 0;
var img = gpu.img;
img.x = dx;
img.y = dy;
img.w = w;
img.h = h;
img.pixelCount = w * h;
var copy = img.buffer;
var vram = this.vram;
for (var j = h; j > 0; --j) {
var x = sx;
var oy = ((sy++) % 512) * 1024;
for (var i = w; i > 0; --i) {
copy[o++] = vram[oy + ((x++) % 1024)];
}
}
this.storeImage(img);
}
storeImage(img) {
this.seenRender = true;
var gl = this.gl;
var o = 0;
var data = img.buffer;
var vram = this.vram;
for (var j = 0; j < img.h; ++j) {
const offsetY = ((img.y + j) % 512) * 1024;
var x = img.x;
for (var i = img.w; i > 0; --i) {
vram[offsetY + ((x++) % 1024)] = data[o++];
}
}
this.storeImageInTexture(img);
}
// var tex = new Uint8Array(1024*512*2);
storeImageInTexture(img) {
const gl = this.gl;
// flush current vertices as a clut could be changed at this point.
this.flushVertexBuffer(true);
// out-of-bound horizontally
if ((img.x + img.w) > 1024) {
let w1 = 1024 - img.x;
let w2 = img.w - w1;
let buf1 = new Uint16Array(w1 * img.h);
let buf2 = new Uint16Array(w2 * img.h);
let i1 = 0, i2 = 0;
for (let y = 0; y < img.h; ++y) {
const bo = y * img.w;
for (let x = 0; x < w1; ++x) {
buf1[i1++] = img.buffer[bo + x];
}
for (let x = 0; x < w2; ++x) {
buf2[i2++] = img.buffer[bo + x + w1];
}
}
this.storeImageInTexture({ x: img.x, y: img.y, w: w1, h: img.h, buffer: buf1, pixelCount: i1 });
this.storeImageInTexture({ x: 0, y: img.y, w: w2, h: img.h, buffer: buf2, pixelCount: i2 });
return;
}
// out-of-bound vertically
if ((img.y + img.h) > 512) {
let h1 = 512 - img.y;
let h2 = img.h - h1;
this.storeImageInTexture({ x: img.x, y: img.y, w: img.w, h: h1, buffer: new Uint16Array(img.buffer.buffer, 0, h1 * img.w), pixelCount: h1 * img.w });
this.storeImageInTexture({ x: img.x, y: 0, w: img.w, h: h2, buffer: new Uint16Array(img.buffer.buffer, h1 * img.w), pixelCount: h2 * img.w });
return;
}
// copy image to GPU
const view = new Uint8Array(img.buffer.buffer, 0, img.pixelCount << 1);
gl.bindTexture(gl.TEXTURE_2D, this.tex8vram);
gl.texSubImage2D(gl.TEXTURE_2D, 0, img.x << 1, img.y, img.w << 1, img.h, gl.ALPHA, gl.UNSIGNED_BYTE, view);
// needed for 16bit video
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
makeShader(src, type) {
var gl = this.gl;
if ((src !== vertexShaderDisplay)
&& (src !== fragmentShader16bit)
&& (src !== fragmentShaderTexture)
&& (src !== fragmentShader24bit)
&& (src !== vertexShaderDraw)
&& (src !== fragmentShaderDraw)) return;
var shader = gl.createShader(type);
gl.shaderSource(shader, src);
gl.compileShader(shader);
if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
alert("Error compiling shader: " + gl.getShaderInfoLog(shader));
gl.deleteShader(shader);
}
return shader;
}
setupBuffers() {
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
createBuffer() {
var gl = this.gl;
var buffer = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
return buffer;
}
createTexture(mode) {
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
setupProgramDraw() {
var gl = this.gl;
gl.viewport(0, 0, qwidth, qheight);
gl.useProgram(this.programDraw);
gl.bindFramebuffer(gl.FRAMEBUFFER, this.buf16draw);
gl.vertexAttribPointer(this.programDraw.vertexColor, 4, gl.UNSIGNED_BYTE, false, 24, 0);
gl.vertexAttribPointer(this.programDraw.vertexPosition, 2, gl.SHORT, false, 24, 4);
gl.vertexAttribPointer(this.programDraw.vertexTexture, 2, gl.SHORT, false, 24, 8);
gl.vertexAttribPointer(this.programDraw.aclut, 2, gl.SHORT, false, 24, 12);
gl.vertexAttribPointer(this.programDraw.texturePage, 2, gl.SHORT, false, 24, 16);
gl.vertexAttribPointer(this.programDraw.textureWindow, 4, gl.UNSIGNED_BYTE, false, 24, 20);
gl.enable(gl.SCISSOR_TEST);
}
flushVertexBuffer(clip) {
const gl = this.gl;
$stats.flushes++;
if (this.vertexBuffer.index <= 0) {
return;
}
if (this.vertexClip !== clip || !clip || this.drawAreaChange) {
gl.enable(gl.SCISSOR_TEST);
if (clip) {
let dah = (this.drawAreaB - this.drawAreaT + 1) * qhf;
let dat = this.drawAreaT * qhf;
gl.scissor(this.drawAreaL * qwf, dat, (this.drawAreaR - this.drawAreaL + 1) * qwf, dah);
}
else
gl.scissor(0, 0, 1024 * qwf, 512 * qhf);
this.vertexClip = clip;
}
const drawBuffer = this.vertexBuffer.view();
// const vertices = this.vertexBuffer.getNumberOfVertices();
// gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawBuffer);
// gl.drawArrays(gl.TRIANGLES, 0, vertices);
const vertices = this.vertexBuffer.getNumberOfVertices();
gl.bufferData(gl.ARRAY_BUFFER, drawBuffer, gl.STREAM_DRAW);
switch (this.renderMode >> 4) {
case 0: case 1:
gl.activeTexture(this.gl.TEXTURE1);
gl.bindTexture(this.gl.TEXTURE_2D, this.tex8vram);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vramP2, 0);
gl.drawArrays(gl.TRIANGLES, 0, vertices);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex16draw, 0);
gl.drawArrays(gl.TRIANGLES, 0, vertices);
break;
case 2: case 3:
gl.activeTexture(this.gl.TEXTURE1);
gl.bindTexture(this.gl.TEXTURE_2D, this.tex16draw);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.vramP2, 0);
gl.drawArrays(gl.TRIANGLES, 0, vertices);
gl.bindTexture(this.gl.TEXTURE_2D, this.vramP2);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex16draw, 0);
gl.drawArrays(gl.TRIANGLES, 0, vertices);
gl.bindTexture(this.gl.TEXTURE_2D, this.tex8vram);
break;
}
this.vertexBuffer.reset();
}
setBlendMode(mode) {
if (this.renderMode === mode) return;
this.flushVertexBuffer(true);
this.renderMode = mode;
var gl = this.gl;
switch (mode & 0xf) {
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
gl.uniform1f(this.programDraw.blendAlpha, 0.00);
break;
}
}
getVertexBuffer(cnt, pid) {
var select = (((pid || 0) & 0x02000000) ? ((gpu.status >> 5) & 3) : 4) | (gpu.tp << 4);
if (!this.vertexBuffer.canHold(cnt)) {
this.flushVertexBuffer(true);
}
this.setBlendMode(select);
return this.vertexBuffer;
}
drawLine(data, c1, xy1, c2, xy2) {
this.seenRender = true;
var x1 = this.drawOffsetX + ((data[xy1] << 21) >> 21);
var y1 = this.drawOffsetY + ((data[xy1] << 5) >> 21);
var x2 = this.drawOffsetX + ((data[xy2] << 21) >> 21);
var y2 = this.drawOffsetY + ((data[xy2] << 5) >> 21);
if (this.outsideDrawArea(x1, y1, x2, y2, x1, y1)) return;
if (this.largePrimitive(x1, y1, x2, y2, x1, y1)) return;
//   let map;
//   map = this.getGteCoord(x1, y1); if (map) { x1 = map.x+this.drawOffsetX; y1 = map.y+this.drawOffsetY; }
//   map = this.getGteCoord(x2, y2); if (map) { x2 = map.x+this.drawOffsetX; y2 = map.y+this.drawOffsetY; }
var w = Math.abs(x1 - x2);
var h = Math.abs(y1 - y2);
var buffer = this.getVertexBuffer(6, data[0]);
if (x1 !== x2 || y1 !== y2) {
if (w >= h) {
buffer.addVertex(x1, y1 + 1, data[c1]);
buffer.addVertex(x1, y1 + 0, data[c1]);
buffer.addVertex(x2, y2 + 0, data[c2]);
buffer.addVertex(x2, y2 + 0, data[c2]);
buffer.addVertex(x2, y2 + 1, data[c2]);
buffer.addVertex(x1, y1 + 1, data[c1]);
}
else {
buffer.addVertex(x1 + 0, y1, data[c1]);
buffer.addVertex(x1 + 1, y1, data[c1]);
buffer.addVertex(x2 + 1, y2, data[c2]);
buffer.addVertex(x2 + 1, y2, data[c2]);
buffer.addVertex(x2 + 0, y2, data[c2]);
buffer.addVertex(x1 + 0, y1, data[c1]);
}
}
else {
buffer.addVertex(x2 + 0, y2 + 0, data[c2]);
buffer.addVertex(x2 + 1, y2 + 0, data[c2]);
buffer.addVertex(x2 + 0, y2 + 1, data[c2]);
buffer.addVertex(x2 + 0, y2 + 1, data[c2]);
buffer.addVertex(x2 + 1, y2 + 0, data[c2]);
buffer.addVertex(x2 + 1, y2 + 1, data[c2]);
}
}
drawTriangle(data, c1, xy1, c2, xy2, c3, xy3, tx, ty, uv1, uv2, uv3, cl) {
this.seenRender = true;
if ((data[0] & 0x82000000) === 0x80000000 >> 0) return; //WebGL2 improvement fix;
if (data[0] & 0x01000000) data[c1] = (data[c1] & 0xff000000) | 0x00808080; //- raw-texture
if (data[0] & 0x01000000) data[c2] = (data[c2] & 0xff000000) | 0x00808080; //- raw-texture
if (data[0] & 0x01000000) data[c3] = (data[c3] & 0xff000000) | 0x00808080; //- raw-texture
var x1 = this.drawOffsetX + ((data[xy1] << 21) >> 21);
var y1 = this.drawOffsetY + ((data[xy1] << 5) >> 21);
var x2 = this.drawOffsetX + ((data[xy2] << 21) >> 21);
var y2 = this.drawOffsetY + ((data[xy2] << 5) >> 21);
var x3 = this.drawOffsetX + ((data[xy3] << 21) >> 21);
var y3 = this.drawOffsetY + ((data[xy3] << 5) >> 21);
if (this.outsideDrawArea(x1, y1, x2, y2, x3, y3)) return;
if (this.largePrimitive(x1, y1, x2, y2, x3, y3)) return;
var textured = (data[0] & 0x04000000) === 0x04000000;
if (!textured) {
var buffer = this.getVertexBuffer(3, data[0]);
buffer.addVertex(x1, y1, data[c1] & 0xfefefe);
buffer.addVertex(x2, y2, data[c2] & 0xfefefe);
buffer.addVertex(x3, y3, data[c3] & 0xfefefe);
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
var clut = ((this.renderMode >> 4) & 3) < 2;
var info = 3;
if (semi_transparent) {
info = this.getClutInfo(cl, tm);
}
if (!semi_transparent || ((info & 2) === 2)) {
var buffer = this.getVertexBuffer(3, data[0]);
buffer.addVertexUV(x1, y1, data[c1] & 0xfefefe, tm | 8, u1, v1, cx, cy);
buffer.addVertexUV(x2, y2, data[c2] & 0xfefefe, tm | 8, u2, v2, cx, cy);
buffer.addVertexUV(x3, y3, data[c3] & 0xfefefe, tm | 8, u3, v3, cx, cy);
}
if (clut && semi_transparent && ((info & 1) === 1)) {
// there are opaque colors in the clut
var buffer = this.getVertexBuffer(3, 0);
buffer.addVertexUV(x1, y1, data[c1] & 0xfefefe, tm | 16, u1, v1, cx, cy);
buffer.addVertexUV(x2, y2, data[c2] & 0xfefefe, tm | 16, u2, v2, cx, cy);
buffer.addVertexUV(x3, y3, data[c3] & 0xfefefe, tm | 16, u3, v3, cx, cy);
}
}
drawRectangle(data, tx, ty, cl) {
this.seenRender = true;
if ((data[0] & 0x82000000) === 0x80000000 >> 0) return; //WebGL2 improvement fix;
if (data[0] & 0x01000000) data[0] = (data[0] & 0xff000000) | 0x00808080; //- raw-texture
var x = this.drawOffsetX + ((data[1] << 21) >> 21);
var y = this.drawOffsetY + ((data[1] << 5) >> 21);
var c = (data[0] & 0xfefefe);
var w = (data[2] << 16) >> 16;
var h = (data[2] >> 16);
if (!w || !h) return;
var showT1 = !this.outsideDrawArea(x + 0, y + 0, x + w - 1, y + 0, x + 0, y + h - 1);
var showT2 = !this.outsideDrawArea(x + 0, y + h - 1, x + w - 1, y + 0, x + w - 1, y + h - 1);
if (!showT1 && !showT2) return;
var textured = (data[0] & 0x04000000) === 0x04000000;
if (!textured) {
var buffer = this.getVertexBuffer(6, data[0]);
buffer.addVertex(x + 0, y + 0, c);
buffer.addVertex(x + w, y + 0, c);
buffer.addVertex(x + 0, y + h, c);
buffer.addVertex(x + w, y + 0, c);
buffer.addVertex(x + 0, y + h, c);
buffer.addVertex(x + w, y + h, c);
if (!c && w > 1 && h > 1) {
this.flushVertexBuffer(true);
this.clearVRAM(x, y, w, h, c, true);
}
return;
}
var cx = ((cl >>> 0) & 0x03f) * 16;
var cy = ((cl >>> 6) & 0x1ff);
var tm = Math.min(((gpu.status >> 7) & 3), 2);
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
var semi_transparent = (data[0] & 0x02000000) === 0x02000000;
var clut = ((this.renderMode >> 4) & 3) < 2;
var info = 3;
if (semi_transparent) {
info = this.getClutInfo(cl, tm);
}
if (!semi_transparent || ((info & 2) === 2)) {
var buffer = this.getVertexBuffer(6, data[0]);
buffer.addVertexUV(x + 0, y + 0, c, tm | 8, tl, tt, cx, cy);
buffer.addVertexUV(x + w, y + 0, c, tm | 8, tr, tt, cx, cy);
buffer.addVertexUV(x + 0, y + h, c, tm | 8, tl, tb, cx, cy);
buffer.addVertexUV(x + w, y + 0, c, tm | 8, tr, tt, cx, cy);
buffer.addVertexUV(x + 0, y + h, c, tm | 8, tl, tb, cx, cy);
buffer.addVertexUV(x + w, y + h, c, tm | 8, tr, tb, cx, cy);
}
if (clut && semi_transparent && ((info & 1) === 1)) {
// there are opaque colors in the clut
var buffer = this.getVertexBuffer(6, 0);
buffer.addVertexUV(x + 0, y + 0, c, tm | 16, tl, tt, cx, cy);
buffer.addVertexUV(x + w, y + 0, c, tm | 16, tr, tt, cx, cy);
buffer.addVertexUV(x + 0, y + h, c, tm | 16, tl, tb, cx, cy);
buffer.addVertexUV(x + w, y + 0, c, tm | 16, tr, tt, cx, cy);
buffer.addVertexUV(x + 0, y + h, c, tm | 16, tl, tb, cx, cy);
buffer.addVertexUV(x + w, y + h, c, tm | 16, tr, tb, cx, cy);
}
}
clearVRAM(x, y, w, h, color, clip) {
var gl = this.gl;
// update clear buffer;
if (clip && !(gpu.status & (1 << 21))) {
let l = x, r = l + w, t = y, b = y + h;
l = (l <= gpu.drawAreaX1) ? gpu.drawAreaX1 : l;
r = (r >= gpu.drawAreaX2) ? gpu.drawAreaX2 : r;
t = (t <= gpu.drawAreaY1) ? gpu.drawAreaY1 : t;
b = (b >= gpu.drawAreaY2) ? gpu.drawAreaY2 : b;
x = l; w = r - l;
y = t; h = b - t;
}
const size = (w * h) >>> 0;
if ((clrState.color !== color) || (clrState.size < size)) {
clrState.color = color;
clrState.size = size;
const r = (color >>> 3) & 0x1f;
const g = (color >>> 11) & 0x1f;
const b = (color >>> 19) & 0x1f;
const c = (b << 10) | (g << 5) | r;
clrState.c = c;
clr.fill(c, 0, size);
}
for (let j = 0; j < h; ++j) {
const offsetY = ((y + j) % 512) * 1024;
for (let i = 0; i < w; ++i) {
this.vram[offsetY + ((x + i) % 1024)] = clrState.c;
}
}
gl.bindTexture(gl.TEXTURE_2D, this.tex8vram);
// copy image to GPU
const view = new Uint8Array(clr.buffer, 0, size << 1);
gl.texSubImage2D(gl.TEXTURE_2D, 0, x << 1, y, w << 1, h, gl.ALPHA, gl.UNSIGNED_BYTE, view); // pdx wacky races - clut cache?
// if (gl.getError() !== gl.NO_ERROR) debugger;
gl.bindTexture(gl.TEXTURE_2D, null);
}
fillRectangle(data) {
this.seenRender = true;
var gl = this.gl;
var x = (data[1] << 16) >> 16;
var y = (data[1] >> 16);
var c = (data[0] & 0xf8f8f8);
var w = (data[2] << 16) >>> 16;
var h = (data[2] >> 16) >>> 0;
x = (x & 0x3f0);
y = (y & 0x1ff);
w = ((w & 0x3ff) + 15) & ~15;
h = (h & 0x1ff);
if (!w || !h) return;
this.flushVertexBuffer(true);
this.clearVRAM(x, y, w, h, c, false);
var buffer = this.getVertexBuffer(6, 0);
buffer.addVertex(x + 0, y + 0, c);
buffer.addVertex(x + w, y + 0, c);
buffer.addVertex(x + 0, y + h, c);
buffer.addVertex(x + 0, y + h, c);
buffer.addVertex(x + w, y + 0, c);
buffer.addVertex(x + w, y + h, c);
this.flushVertexBuffer(false);
}
setDrawAreaOF(x, y) {
this.drawOffsetX = x;
this.drawOffsetY = y;
}
setDrawAreaTL(x, y) {
this.flushVertexBuffer(true);
this.drawAreaChange = true;
this.drawAreaT = y;
this.drawAreaL = x;
}
setDrawAreaBR(x, y) {
this.flushVertexBuffer(true);
this.drawAreaChange = true;
this.drawAreaB = y;
this.drawAreaR = x;
}
onVBlankEnd() {
}
onVBlankBegin() {
var gl = this.gl;
this.flushVertexBuffer(true);
// if (!this.seenRender) return;
$stats.dump();
gl.disable(gl.SCISSOR_TEST);
// Display
gl.useProgram(this.programDisplay);
this.vertexBuffer.addVertexDisp(-32768, +32767, 0, 0);
this.vertexBuffer.addVertexDisp(+32767, +32767, 1024, 0);
this.vertexBuffer.addVertexDisp(-32768, -32768, 0, 512);
this.vertexBuffer.addVertexDisp(+32767, +32767, 1024, 0);
this.vertexBuffer.addVertexDisp(-32768, -32768, 0, 512);
this.vertexBuffer.addVertexDisp(+32767, -32768, 1024, 512);
gl.disable(gl.BLEND);
this.renderMode = 5;
// restore to canvas frame buffer;
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
gl.activeTexture(gl.TEXTURE0);
gl.vertexAttribPointer(this.programDisplay.vertexPosition, 2, gl.SHORT, true, 8, 4);
gl.vertexAttribPointer(this.programDisplay.vertexTexture, 2, gl.SHORT, false, 8, 8);
var drawBuffer = this.vertexBuffer.subarray(0, this.vertexBuffer.index / 4);
if (this.displaymode === 0) {
gl.viewport(0, 0, this.canvas.width = 2048, this.canvas.height = 1024);
display8bit(this, drawBuffer);
}
if (this.displaymode === 1) {
gl.viewport(0, 0, this.canvas.width = 4096, this.canvas.height = 2048);
display16bit(this, drawBuffer);
}
if (this.displaymode === 3) {
gl.viewport(0, 0, this.canvas.width = 4096, this.canvas.height = 2048);
display16bit(this, drawBuffer);
}
if (this.displaymode === 2) {
var area = gpu.getDisplayArea();
this.vertexBuffer.reset();
var al = area.x;
var ar = area.x + area.w;
var at = area.y;
var ab = area.y + area.h;
this.vertexBuffer.addVertexDisp(-32768, +32767, al, at);
this.vertexBuffer.addVertexDisp(+32767, +32767, ar, at);
this.vertexBuffer.addVertexDisp(-32768, -32768, al, ab);
this.vertexBuffer.addVertexDisp(+32767, +32767, ar, at);
this.vertexBuffer.addVertexDisp(-32768, -32768, al, ab);
this.vertexBuffer.addVertexDisp(+32767, -32768, ar, ab);
var drawBuffer = this.vertexBuffer.subarray(0, this.vertexBuffer.index / 4);
if (gpu.status & (1 << 23)) {
gl.viewport(0, 0, this.canvas.width = area.w, this.canvas.height = area.h);
gl.clearColor(0.0, 0.0, 0.0, 1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
}
else if (gpu.status & (1 << 21)) {
gl.viewport(0, 0, this.canvas.width = area.w, this.canvas.height = area.h);
display24bit(this, drawBuffer, al, at);
}
else {
gl.viewport(0, 0, this.canvas.width = area.w * qwf, this.canvas.height = area.h * qhf);
display16bit(this, drawBuffer, al, at);
}
}
this.vertexBuffer.reset();
// Draw
this.setupProgramDraw();
if (this.seenRender) {
++this.fpsRenderCounter;
}
++this.fpsCounter;
this.seenRender = false;
}
setMode(mode) {
switch (mode) {
default:
case 'disp': this.displaymode = 2;
break;
case 'draw': this.displaymode = 1;
break;
case 'clut4': // todo: implement
case 'clut8': this.displaymode = 0;
break;
case 'page2': this.displaymode = 3;
break;
}
}
}
let clr = new Uint16Array(1024 * 512);
const clrState = {
color: 0,
c: 0,
size: 1024 * 512
};
clr.fill(0);
function display8bit(self, drawBuffer) {
var gl = self.gl;
gl.useProgram(self.programTexture);
gl.vertexAttribPointer(self.programTexture.vertexPosition, 2, gl.SHORT, true, 8, 0);
gl.vertexAttribPointer(self.programTexture.vertexTexture, 2, gl.SHORT, false, 8, 4);
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
gl.vertexAttribPointer(self.programDisplay.vertexTexture, 2, gl.SHORT, false, 8, 4);
const texture = self.displaymode === 3 ? self.vramP2 : self.tex16draw;
gl.bindTexture(gl.TEXTURE_2D, texture);
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
gl.vertexAttribPointer(self.program24bit.vertexTexture, 2, gl.SHORT, false, 8, 4);
gl.bindTexture(gl.TEXTURE_2D, self.tex16draw);
gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawBuffer);
gl.drawArrays(gl.TRIANGLES, 0, 6);
}
window.primitiveId = 0;
window.nextPrimitive = nextPrimitive;
window.renderer = new WebGLRenderer(document.getElementById('display'));
})
mdlr('enge:psx', m => {
Object.assign(window,
m.require('enge:psx:core'),
m.require('enge:psx:trace'),
);
Object.assign(window,
m.require('enge:psx:serial'),
m.require('enge:psx:gamepad'),
m.require('enge:psx:cpu'),
m.require('enge:psx:cdr'),
m.require('enge:psx:mdec'),
m.require('enge:psx:gpu'),
m.require('enge:psx:gte'),
m.require('enge:psx:mmu'),
m.require('enge:psx:rec'),
m.require('enge:psx:spu'),
);
Object.assign(window,
m.require('enge:psx:index'),
);
})
mdlr('base64', m => {
const encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const decodings = {};
encodings.split('').forEach((a, i) => decodings[a] = i);
decodings['='] = 0;
function decode(string) {
let length = string.length;
let byteLength = length / 4 * 3;
if (string[length - 2] === '=') --byteLength;
if (string[length - 1] === '=') --byteLength;
const buffer = new Uint8Array(byteLength);
let bi = 0;
for (let i = 0; i < length; i += 4) {
const a = decodings[string[i + 0]];
const b = decodings[string[i + 1]];
const c = decodings[string[i + 2]];
const d = decodings[string[i + 3]];
const value = a << 18 | b << 12 | c << 6 | d;
buffer[bi + 0] = (value >> 16) & 255;
buffer[bi + 1] = (value >> 8) & 255;
buffer[bi + 2] = (value >> 0) & 255;
bi += 3;
}
return buffer;
}
function encode(arrayBuffer) {
let base64 = '';
const bytes = new Uint8Array(arrayBuffer.buffer);
const byteLength = bytes.byteLength;
const byteRemainder = byteLength % 3;
const mainLength = byteLength - byteRemainder;
let a, b, c, d;
let chunk;
for (let i = 0; i < mainLength; i = i + 3) {
chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
a = (chunk >> 18) & 63;
b = (chunk >> 12) & 63;
c = (chunk >> 6) & 63;
d = (chunk >> 0) & 63;
base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
}
if (byteRemainder == 1) {
chunk = bytes[mainLength];
a = (chunk & 252) >> 2;
b = (chunk & 3) << 4;
base64 += encodings[a] + encodings[b] + '==';
}
else if (byteRemainder == 2) {
chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
a = (chunk & 64512) >> 10;
b = (chunk & 1008) >> 4;
c = (chunk & 15) << 2;
base64 += encodings[a] + encodings[b] + encodings[c] + '=';
}
return base64;
}
return { decode, encode };
})
mdlr('enge:psx:core', m => {
let lastId = 0;
const events = [];
const inactiveEvents = [];
const psx = {
clock: 0.0,
eventClock: 0.0,
}
psx.addEvent = (clocks, cb) => {
const event = {
id: ++lastId,
active: true,
clock: +psx.clock + +clocks,
start: +psx.clock,
cb
};
if (psx.eventClock > event.clock) {
psx.eventClock = event.clock;
}
events.push(event);
return event;
}
psx.updateEvent = (event, clocks) => {
event.start = event.clock;
event.clock += +clocks;
event.active = true;
if (psx.eventClock > event.clock) {
psx.eventClock = event.clock;
}
return event;
}
psx.unsetEvent = (event) => {
if (!event.active) return;
const index = events.findIndex(a => a.id === event.id);
if (index !== -1) {
inactiveEvents.push(event);
events.splice(index, 1);
event.active = false;
}
return event;
}
psx.eventCycles = (event) => {
return +psx.clock - event.start;
}
psx.setEvent = (event, clocks) => {
if (!event.active) {
const index = inactiveEvents.findIndex(a => a.id === event.id);
if (index !== -1) {
inactiveEvents.splice(index, 1);
events.push(event);
}
}
event.clock = +psx.clock + +clocks;
event.start = +psx.clock;
event.active = true;
if (psx.eventClock > event.clock) {
psx.eventClock = event.clock;
}
return event;
}
psx.handleEvents = (entry) => {
let eventClock = Number.MAX_SAFE_INTEGER;
for (let event of events) {
if (!event.active) continue;
if (psx.clock >= event.clock) {
event.cb(event, psx.clock);
}
if (event.clock < eventClock) {
eventClock = event.clock;
}
};
psx.eventClock = eventClock;
return cpuInterrupt(entry);
}
// Events contain callbacks and therefore cannot be serialized directly.
// Save their stable ids and timing, then restore those values onto the
// existing event objects so closures remain intact.
psx.getState = () => ({
clock: psx.clock,
eventClock: psx.eventClock,
lastId,
events: [...events, ...inactiveEvents].map(event => ({
id: event.id,
active: event.active,
clock: event.clock,
start: event.start
}))
});
psx.setState = state => {
if (!state) return;
psx.clock = state.clock;
psx.eventClock = state.eventClock;
lastId = state.lastId;
const allEvents = [...events, ...inactiveEvents];
events.length = 0;
inactiveEvents.length = 0;
for (const saved of state.events || []) {
const event = allEvents.find(candidate => candidate.id === saved.id);
if (!event) continue;
event.clock = saved.clock;
event.start = saved.start;
event.active = saved.active;
(saved.active ? events : inactiveEvents).push(event);
}
};
return { psx };
})
mdlr('enge:psx:trace', m => {
const gameCodeRegEx = /[A-Za-z]{4}_[0-9]{3}\.[0-9]{2}/;
let line = '';
let lastLine = null;
let gameCode = '';
function traceBiosCalls(programCounter, functionId) {
switch (programCounter) {
case 0xa0:
switch (functionId) {
case 0x3c: BIOS_std_out_putchar(cpu.gpr[4]);
break;
}
break;
case 0xb0:
switch (functionId) {
case 0x3d: BIOS_std_out_putchar(cpu.gpr[4]);
break;
}
break;
}
}
function BIOS_std_out_putchar(charCode) {
line += String.fromCharCode(charCode);
if (charCode === 10 || charCode === 13) {
if (line !== lastLine) {
extractGameCodeFromCurrentLine();
lastLine = line;
}
console.debug(line);
line = '';
}
}
function extractGameCodeFromCurrentLine() {
const result = gameCodeRegEx.exec(line);
if (result) {
let gc = result[0].replace('.', '').toUpperCase();
if (gameCode !== gc) {
document.title = `eNGE - [${gc}]`;
gameCode = gc;
}
}
}
return { trace: traceBiosCalls };
})
mdlr('enge:psx:serial', m => {
const devices = [
m.require('enge:psx:serial-device').setId(0),
m.require('enge:psx:serial-device').setId(1),
];
const syncWithDevice = (device, data) => {
let byte = device.sendReceiveByte(data & 0xff);
let more = device.hasMore();
setResult(byte, !more);
}
const setResult = (byte, last) => {
r1044 |= 0x0002; // JOY_STAT.RX = 1
data = byte & 0xff;
if (!last) {
// OpenBIOS expects the serial device to advance at the faster cadence
// for both pad and memory-card transfers. This changes timing only; the
// upstream memory-card commands, response bytes, and checksums remain
// unchanged so card behavior can be tested independently.
psx.setEvent(eventIRQ, (baud * 4) >>> 0);
}
}
const eventIRQ = psx.addEvent(0, (self, clock) => {
r1044 |= 0x0200; // JOY_STAT.IRQ = 1;
cpu.istat |= 0x0080; // todo: should take care of edge triggering
psx.unsetEvent(self);
});
let baud = 0x0088;
let data = 0;
let command = 0;
let r1044 = 0; // JOY_STAT
let r104a = 0; // JOY_CTRL
let joy = {
devices,
rd08r1040: () => {
if (r1044 & 0x0002) {
r1044 &= ~0x0002; // JOY_STAT.RX = 0
}
return data;
},
rd16r1044: () => {
return r1044;
},
rd16r104a: () => {
return r104a;
},
rd16r104e: () => {
return baud;
},
wr08r1040: function (data) {
let device = null;
if ((r104a & 0x0002) === 0x0000) {
abort();
}
if ((r104a & 0x0002) === 0x0002) {
device = (r104a & 0x2000) ? devices[1] : devices[0];
}
switch (command) {
case 0x00:
if (!device) {
return setResult(0xff, true);
}
setResult(0xff, false);
command = data & 0xff;
if (command === 0x81) device.init();
if (command === 0x01) device.init();
break;
case 0x01:
device.buildControllerResponse(data & 0xff);
command = 0x02;
case 0x02:
syncWithDevice(device, data);
break;
case 0x81:
device.buildMemCardResponse(data & 0xff);
command = 0x82;
case 0x82:
syncWithDevice(device, data);
break;
case 0x83:
return setResult(0xff, true); // no memcard for now
default: console.warn('unknown command state:', hex(command, 4), ' device:', device.id);
break;
}
},
wr16r1048: (data) => {
if (data !== 0xd) abort(hex(data, 4));
},
wr16r104a: function (data) {
r104a = data & ~(0x0010 | 0x0040); //  mask out write-only bits
if ((data & 0x0040) || !(r104a & 0x0002)) {
//  reset when pad is not selected or reset is requested
let device = null;
if ((r104a & 0x0002) === 0x0002) {
device.init();
}
psx.unsetEvent(eventIRQ);
command = 0;
r1044 = 0x0005;
}
if ((data & 0x0010)) {
r1044 &= ~(0x0200); // JOY_STAT.IRQ = 0
}
},
wr16r104e: function (data) {
if (data !== 0x88) abort(`invalid JOY_BAUD: $${hex(data, 4)}`);
baud = data & 0xffff;
}
}
return { joy };
})
mdlr('enge:psx:gamepad', m => {
let controller = null;
const joypads = [null, null];
const keyboard = new Map();
const virtual = { lo: 0xff, hi: 0xff };
const keyboardState = { lo: 0xff, hi: 0xff };
const debugPad = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug-pad') === '1';
const debugInput = (...args) => {
if (debugPad) console.log('[PAD]', ...args);
};
const setController = (type) => {
if (controller === type) return;
controller = type;
const elem = document.getElementById('gamepad');
if (elem) {
elem.classList.remove(...elem.classList);
elem.classList.add('connected');
elem.classList.add(type);
}
}
const buttonPressed = (b) => !!b?.pressed;
const updateDevice = (pad, device) => {
if (!device) return;
const {axes = [], buttons = []} = pad || {};
const axis = (index) => axes[index] || 0;
let lo = virtual.lo & keyboardState.lo;
if (axis(0) <= -0.4) { lo &= ~0x80 } // left
if (axis(0) >= 0.4) { lo &= ~0x20 } // right
if (axis(1) <= -0.4) { lo &= ~0x10 } // up
if (axis(1) >= 0.4) { lo &= ~0x40 } // down
if (buttonPressed(buttons[14])) { lo &= ~0x80 } // left
if (buttonPressed(buttons[15])) { lo &= ~0x20 } // right
if (buttonPressed(buttons[12])) { lo &= ~0x10 } // up
if (buttonPressed(buttons[13])) { lo &= ~0x40 } // down
if (buttonPressed(buttons[8])) { lo &= ~0x01 } // select
if (buttonPressed(buttons[9])) { lo &= ~0x08 } // start
device.lo = lo;
let hi = virtual.hi & keyboardState.hi;
if (buttonPressed(buttons[3])) { hi &= ~0x10 } // triangle
if (buttonPressed(buttons[1])) { hi &= ~0x20 } // circle
if (buttonPressed(buttons[0])) { hi &= ~0x40 } // cross
if (buttonPressed(buttons[2])) { hi &= ~0x80 } // square
if (buttonPressed(buttons[4])) { hi &= ~0x04 } // l1
if (buttonPressed(buttons[6])) { hi &= ~0x01 } // l2
if (buttonPressed(buttons[5])) { hi &= ~0x08 } // r1
if (buttonPressed(buttons[7])) { hi &= ~0x02 } // r2
device.hi = hi;
};
const releaseDevice = (device) => {
if (device) {
device.lo = 0xff;
device.hi = 0xff;
}
};
const setVirtualButton = (property, bit, pressed) => {
if (pressed) virtual[property] &= ~bit;
else virtual[property] |= bit;
};
window.engeSetVirtualButton = setVirtualButton;
const virtualPointers = new Map();
const virtualButtons = new Map();
const releaseVirtualPointer = event => {
const pointerId = event.pointerId;
if (pointerId == null) return;
const key = virtualPointers.get(pointerId);
if (!key) return;
virtualPointers.delete(pointerId);
const stillPressed = [...virtualPointers.values()].includes(key);
if (!stillPressed) {
const [property, bit] = key.split(':');
setVirtualButton(property, Number(bit), false);
virtualButtons.get(key)?.classList.remove('is-pressed');
}
};
document.querySelectorAll('[data-virtual-property]').forEach(button => {
const property = button.dataset.virtualProperty;
const bit = Number(button.dataset.virtualBit);
const key = `${property}:${bit}`;
virtualButtons.set(key, button);
const release = event => {
event.preventDefault();
event.stopPropagation();
releaseVirtualPointer(event);
};
button.addEventListener('pointerdown', event => {
event.preventDefault();
event.stopPropagation();
releaseVirtualPointer(event);
virtualPointers.set(event.pointerId, key);
setVirtualButton(property, bit, true);
button.classList.add('is-pressed');
});
button.addEventListener('pointerup', release);
button.addEventListener('pointercancel', release);
button.addEventListener('pointerleave', event => {
if (event.pointerType === 'mouse') release(event);
});
button.addEventListener('contextmenu', event => {
event.preventDefault();
event.stopPropagation();
});
});
window.addEventListener('pointerup', releaseVirtualPointer);
window.addEventListener('pointercancel', releaseVirtualPointer);
window.addEventListener('blur', () => {
virtualPointers.clear();
for (const button of document.querySelectorAll('[data-virtual-property]')) {
setVirtualButton(button.dataset.virtualProperty, Number(button.dataset.virtualBit), false);
button.classList.remove('is-pressed');
}
});
const stick = document.querySelector('[data-virtual-stick]');
const stickKnob = stick?.querySelector('.touch-stick-knob');
let stickPointerId = null;
const stickBits = { up: 16, down: 64, left: 128, right: 32 };
const clearVirtualStick = () => {
if (stickKnob) stickKnob.style.transform = 'translate(0, 0)';
for (const bit of Object.values(stickBits)) setVirtualButton('lo', bit, false);
};
const updateVirtualStick = event => {
if (!stick || !stickKnob) return;
const bounds = stick.getBoundingClientRect();
const centerX = bounds.left + bounds.width / 2;
const centerY = bounds.top + bounds.height / 2;
const radius = Math.min(bounds.width, bounds.height) * 0.36;
let x = event.clientX - centerX;
let y = event.clientY - centerY;
const distance = Math.hypot(x, y);
if (distance > radius) {
x = x / distance * radius;
y = y / distance * radius;
}
stickKnob.style.transform = `translate(${x}px, ${y}px)`;
for (const bit of Object.values(stickBits)) setVirtualButton('lo', bit, false);
if (distance < radius * 0.25) return;
if (Math.abs(x) >= Math.abs(y)) {
setVirtualButton('lo', x < 0 ? stickBits.left : stickBits.right, true);
}
else {
setVirtualButton('lo', y < 0 ? stickBits.up : stickBits.down, true);
}
};
const releaseVirtualStick = event => {
if (stickPointerId !== null && event.pointerId != null && event.pointerId !== stickPointerId) return;
stickPointerId = null;
clearVirtualStick();
};
stick?.addEventListener('pointerdown', event => {
event.preventDefault();
event.stopPropagation();
stickPointerId = event.pointerId;
stick.setPointerCapture?.(event.pointerId);
updateVirtualStick(event);
});
stick?.addEventListener('pointermove', event => {
if (event.pointerId === stickPointerId) updateVirtualStick(event);
});
stick?.addEventListener('pointerup', releaseVirtualStick);
stick?.addEventListener('pointercancel', releaseVirtualStick);
stick?.addEventListener('lostpointercapture', releaseVirtualStick);
window.addEventListener('pointerup', releaseVirtualStick);
window.addEventListener('pointercancel', releaseVirtualStick);
window.addEventListener('touchend', releaseVirtualStick, {passive: false});
window.addEventListener('touchcancel', releaseVirtualStick, {passive: false});
window.addEventListener('blur', releaseVirtualStick);
const enge_gamepad_update = () => {
if (!navigator.getGamepads) return;
const pads = navigator.getGamepads();
for (let index = 0; index < joypads.length; ++index) {
if (!joypads[index] && pads[index]) joypads[index] = pads[index];
}
const usedPadIndices = new Set();
for (let index = 0; index < joypads.length; ++index) {
const pad = joypads[index] && pads[joypads[index].index];
if (pad && usedPadIndices.has(pad.index)) {
joypads[index] = null;
releaseDevice(joy.devices[index]);
continue;
}
if (pad) {
usedPadIndices.add(pad.index);
updateDevice(pad, joy.devices[index]);
setController('gamepad');
}
else if (index === 0) {
// Keep virtual and keyboard releases flowing to controller 1.
updateDevice(null, joy.devices[index]);
}
else if (index === 1) {
releaseDevice(joy.devices[index]);
}
}
}
// Thanks zaykho(https://github.com/zaykho) for helping to add this feature.
// refactored the code to be slightly simpler and more inline with the rest
// default keyboard mapping
keyboard.set(69, { bits: 0x10, property: 'hi' }); /*  [^]  */
keyboard.set(68, { bits: 0x20, property: 'hi' }); /*  [O]  */
keyboard.set(88, { bits: 0x40, property: 'hi' }); /*  [X]  */
keyboard.set(83, { bits: 0x80, property: 'hi' }); /*  [#]  */
keyboard.set(81, { bits: 0x01, property: 'hi' }); /*  [L2]  */
keyboard.set(84, { bits: 0x02, property: 'hi' }); /*  [R2]  */
keyboard.set(87, { bits: 0x04, property: 'hi' }); /*  [L1]  */
keyboard.set(82, { bits: 0x08, property: 'hi' }); /*  [R1]  */
keyboard.set(38, { bits: 0x10, property: 'lo' }); /*  [u]  */
keyboard.set(39, { bits: 0x20, property: 'lo' }); /*  [r]  */
keyboard.set(40, { bits: 0x40, property: 'lo' }); /*  [d]  */
keyboard.set(37, { bits: 0x80, property: 'lo' }); /*  [l]  */
keyboard.set(32, { bits: 0x01, property: 'lo' }); /* [sel] */
keyboard.set(13, { bits: 0x08, property: 'lo' }); /*[start]*/
const keyboardCodes = new Map([
['KeyE', 69], ['KeyD', 68], ['KeyX', 88], ['KeyS', 83],
['KeyQ', 81], ['KeyT', 84], ['KeyW', 87], ['KeyR', 82],
['ArrowUp', 38], ['ArrowRight', 39], ['ArrowDown', 40], ['ArrowLeft', 37],
['Space', 32], ['Enter', 13]
]);
const getKeyboardMapping = event =>
keyboard.get(event.keyCode) || keyboard.get(keyboardCodes.get(event.code));
window.addEventListener("keydown", (e) => {
const mapping = getKeyboardMapping(e);
const device = joy.devices[0];
if (mapping !== undefined) {
e.preventDefault();
keyboardState[mapping.property] &= ~mapping.bits;
device[mapping.property] &= ~mapping.bits;
debugInput('keydown', { key: e.key, code: e.code, property: mapping.property, bits: `0x${mapping.bits.toString(16)}`, lo: device.lo, hi: device.hi });
setController('keyboard');
}
}, false);
window.addEventListener("keyup", (e) => {
const mapping = getKeyboardMapping(e);
const device = joy.devices[0];
if (mapping !== undefined) {
e.preventDefault();
keyboardState[mapping.property] |= mapping.bits;
device[mapping.property] |= mapping.bits;
debugInput('keyup', { key: e.key, code: e.code, property: mapping.property, bits: `0x${mapping.bits.toString(16)}`, lo: device.lo, hi: device.hi });
}
}, false);
window.addEventListener("gamepadconnected", (e) => {
const index = e.gamepad.index < joypads.length
? e.gamepad.index
: joypads.findIndex(pad => !pad);
if (index >= 0) joypads[index] = e.gamepad;
document.getElementById('gamepad')?.classList.add('connected')
});
window.addEventListener("gamepaddisconnected", (e) => {
const index = joypads.findIndex(pad => pad?.index === e.gamepad.index);
if (index >= 0) {
joypads[index] = null;
releaseDevice(joy.devices[index]);
}
if (!joypads.some(Boolean)) {
document.getElementById('gamepad')?.classList.remove('connected');
}
});
return {
handleGamePads: enge_gamepad_update
}
})
mdlr('enge:psx:cpu', m => {
const cop = new Int32Array(32);
const gpr = new Int32Array(32);
const cpu = {
gpr,
cop,
'cause': 0,
'cycles': 0,
'epc': 0,
'hi': 0,
'imask': 0,
'istat': 0,
'icurr': 0,
'lo': 0,
'pc': 0,
'sr': 0,
forceWriteBits: 0x00000000 >>> 0,
getCtrl: (reg) => {
switch (reg) {
case 12: return cpu.sr >> 0;
case 13: return cpu.cause >> 0;
case 14: return cpu.epc >> 0;
case 15: return 2 >> 0;
}
return cop[reg];
},
setCtrl: (reg, value) => {
cop[reg] = value >> 0;
switch (reg) {
case 12: cpu.sr = value;
// trick to force writing to unused memory location with isolated cache
cpu.forceWriteBits = (value & 0x00010000) ? 0x01fffffc >>> 0 : 0x00000000 >>> 0;
break;
case 13: cpu.cause = cpu.cause & 0xfffffcff;
cpu.cause |= (value & 0x00000300);
break;
}
},
rfe: () => {
cpu.sr = (cpu.sr & ~0x0F) | ((cpu.sr >> 2) & 0x0F);
},
lwl: (reg, addr) => {
const data = memRead32((addr & ~3) & 0x01ffffff);
switch (addr & 3) {
case 0: gpr[reg] = (gpr[reg] & 0x00FFFFFF) | (data << 24); break;
case 1: gpr[reg] = (gpr[reg] & 0x0000FFFF) | (data << 16); break;
case 2: gpr[reg] = (gpr[reg] & 0x000000FF) | (data << 8); break;
case 3: gpr[reg] = (gpr[reg] & 0x00000000) | (data << 0); break;
};
},
lwr: (reg, addr) => {
const data = memRead32((addr & ~3) & 0x01ffffff);
switch (addr & 3) {
case 0: gpr[reg] = (gpr[reg] & 0x00000000) | (data >>> 0); break;
case 1: gpr[reg] = (gpr[reg] & 0xFF000000) | (data >>> 8); break;
case 2: gpr[reg] = (gpr[reg] & 0xFFFF0000) | (data >>> 16); break;
case 3: gpr[reg] = (gpr[reg] & 0xFFFFFF00) | (data >>> 24); break;
};
},
swl: (reg, addr) => {
let data = memRead32((addr & ~3) & 0x01ffffff) >>> 0;
switch (addr & 3) {
case 0: data = (data & 0xFFFFFF00) | (gpr[reg] >>> 24); break;
case 1: data = (data & 0xFFFF0000) | (gpr[reg] >>> 16); break;
case 2: data = (data & 0xFF000000) | (gpr[reg] >>> 8); break;
case 3: data = (data & 0x00000000) | (gpr[reg] >>> 0); break;
};
memWrite32((addr & ~3) & 0x01ffffff, data);
},
swr: (reg, addr) => {
let data = memRead32((addr & ~3) & 0x01ffffff) >>> 0;
switch (addr & 3) {
case 0: data = (data & 0x00000000) | (gpr[reg] << 0); break;
case 1: data = (data & 0x000000FF) | (gpr[reg] << 8); break;
case 2: data = (data & 0x0000FFFF) | (gpr[reg] << 16); break;
case 3: data = (data & 0x00FFFFFF) | (gpr[reg] << 24); break;
};
memWrite32((addr & ~3) & 0x01ffffff, data);
},
neg: (a) => {
let a00 = (a >> 0) & 0xffff;
let a16 = (a >> 16) & 0xffff;
let v = (~a00 & 0xFFFF) + 1;
a00 = v & 0xFFFF;
v = (~a16 & 0xFFFF) + (v >>> 16);
a16 = v & 0xFFFF;
return (a16 << 16) | a00;
},
mult: (a, b) => {
a >>= 0; b >>= 0;
let n = 0;
if (a < 0) { n ^= 1; a = cpu.neg(a); }
if (b < 0) { n ^= 1; b = cpu.neg(b); }
cpu.multu(a, b);
if (n === 1) {
let a00 = (cpu.lo >>> 0) & 0xffff;
let a16 = (cpu.lo >>> 16) & 0xffff;
let a32 = (cpu.hi >>> 0) & 0xffff;
let a48 = (cpu.hi >>> 16) & 0xffff;
let v = (~a00 & 0xFFFF) + 1;
a00 = v & 0xFFFF;
v = (~a16 & 0xFFFF) + (v >>> 16);
a16 = v & 0xFFFF;
v = (~a32 & 0xFFFF) + (v >>> 16);
a32 = v & 0xFFFF;
v = (~a48 & 0xFFFF) + (v >>> 16);
a48 = v & 0xFFFF;
cpu.hi = ((a48 << 16) | a32) >> 0;
cpu.lo = ((a16 << 16) | a00) >>> 0;
}
},
multu: (a, b) => {
a >>>= 0; b >>>= 0;
let a00 = a & 0xffff;
let a16 = a >>> 16;
let b00 = b & 0xffff;
let b16 = b >>> 16;
let c48 = 0, c32 = 0, c16 = 0, c00 = 0;
c00 += (a00 * b00);
c16 += (c00 >>> 16);
c00 &= 0xFFFF;
c16 += (a00 * b16);
c32 += (c16 >>> 16);
c16 &= 0xFFFF;
c16 += (a16 * b00);
c32 += (c16 >>> 16);
c16 &= 0xFFFF;
c32 += (a16 * b16);
c48 += (c32 >>> 16);
c32 &= 0xFFFF;
cpu.hi = ((c48 << 16) | c32) >>> 0;
cpu.lo = ((c16 << 16) | c00) >>> 0;
},
div:  (a, b) => {
if (b === 0) {
if ((a >> 0) >= 0) {
cpu.hi = a;
cpu.lo = 0xffffffff;
}
else {
cpu.hi = a;
cpu.lo = 0x00000001;
}
}
else if (((b >> 0) === -1) && ((a >>> 0) === 0x80000000)) {
cpu.hi = 0 >> 0;
cpu.lo = 0x80000000 >> 0;
}
else {
cpu.hi = ((a >> 0) % (b >> 0)) >> 0;
cpu.lo = ((a >> 0) / (b >> 0)) >> 0;
}
},
divu:  (a, b) => {
if (b === 0) {
cpu.hi = a;
cpu.lo = 0xffffffff;
}
else {
cpu.hi = ((a >>> 0) % (b >>> 0)) >>> 0;
cpu.lo = ((a >>> 0) / (b >>> 0)) >>> 0;
}
}
};
const cpuException = (id, pc) => {
cpu.sr = (cpu.sr & ~0x3F) | ((cpu.sr << 2) & 0x3F);
cpu.cause = (cpu.cause & ~0x7C) | id;
cpu.epc = pc;
return vector;
}
const cpuInterrupt = (entry) => {
if ((cpu.sr & 1) === 1) {
let ip = cpu.cause & 0x300;
let im = cpu.sr & 0x300;
if ((ip & im) !== 0) {
return cpuException((ip & im), entry.pc);
}
else
if ((cpu.sr & 0x400) === 0x400) {
if (cpu.istat & cpu.imask) {
return cpuException(0x400, entry.pc);
}
}
}
return entry;
}
return { cpu, cpuException, cpuInterrupt }
})
mdlr('enge:psx:cdr', m => {
const cdDebug = new URLSearchParams(window.location.search).has('debug-cd') ||
window.localStorage.getItem('enge-debug-cdrom') === '1';
const cdLog = (...args) => {
if (cdDebug) console.debug('[CDR]', ...args.map(value =>
typeof value === 'object' ? JSON.stringify(value) : value));
};
let sectorData8 = new Int8Array(0);
let sectorData16 = new Int16Array(0);
// Remote discs are kept as a small LRU of HTTP range chunks. The current
// sector remains in this fixed 2352-byte buffer for the synchronous CDR
// register and DMA paths below.
const remoteChunkSize = Math.floor((8 * 1024 * 1024) / 2352) * 2352;
const remoteMaxChunks = 3;
const remoteSectorSize = 2352;
const remoteSector = new Uint8Array(remoteSectorSize);
let remoteImage;
let localImage;
let remoteRead;
let debugSectorLogCount = 0;
let debugDmaLogCount = 0;
let debugResponseLogCount = 0;
const fetchRemoteChunk = (file, fileIndex, chunkIndex) => {
const cached = file.chunks.get(chunkIndex);
if (cached) return Promise.resolve(cached);
if (file.pending.has(chunkIndex)) return file.pending.get(chunkIndex);
const start = chunkIndex * remoteChunkSize;
const end = Math.min(start + remoteChunkSize, file.size);
cdLog('HTTP range', { file: fileIndex, chunk: chunkIndex, start, end: end - 1 });
const request = fetch(file.url, {
headers: { Range: `bytes=${start}-${end - 1}` }
}).then(async response => {
if (response.status !== 206) {
throw new Error(`CD image server returned HTTP ${response.status}; byte ranges are required`);
}
const data = new Uint8Array(await response.arrayBuffer());
cdLog('HTTP range complete', { file: fileIndex, chunk: chunkIndex, bytes: data.byteLength });
file.chunks.set(chunkIndex, data);
while (remoteImage.chunkCount() > remoteMaxChunks) {
const oldestFile = remoteImage.files.find(candidate => candidate.chunks.size);
oldestFile?.chunks.delete(oldestFile.chunks.keys().next().value);
}
return data;
});
file.pending.set(chunkIndex, request);
request.then(
() => file.pending.delete(chunkIndex),
() => file.pending.delete(chunkIndex),
);
return request;
};
let status = 0x18;
let statusCode = 0x00;
let ncmdread = 0;
let ncmdctrl = 0;
let sectorOffset = 0;
let sectorIndex = 0;
let sectorEnd = 0;
let playIndex = 0;
let irq = 0;
let irqEnable = 0xff;
let mode = 0;
let mute = false; // todo: implement mute
let currLoc = 0;
let seekLoc = 0;
let volCdLeft2SpuLeft = 1.0;
let volCdLeft2SpuRight = 0.0;
let volCdRight2SpuLeft = 0.0;
let volCdRight2SpuRight = 1.0;
let volConfigCdLeft2SpuLeft = 1.0;
let volConfigCdLeft2SpuRight = 0.0;
let volConfigCdRight2SpuLeft = 0.0;
let volConfigCdRight2SpuRight = 1.0;
let pcmidx = 0;
let pcmmax = 0;
let filterFile = 0;
let filterChan = 0;
let currTrack = {};
const [addEvent, setEvent, unsetEvent] = [psx.addEvent, psx.setEvent, psx.unsetEvent];
const floor = a => a >> 0;
const itob = i => floor(i / 10) * 16 + floor(i % 10);
const btoi = b => floor(b / 16) * 10 + floor(b % 16);
const results = new Array(16);
const pushResults = results.push.bind(results);
const params = new Array(16);
const pcm = new Float32Array(8064 * 44100 / 18900);
const xa = new Float32Array(8064);
const tracks = [];
const sl = [0.0, 0.0];
const sr = [0.0, 0.0];
const getCdVolume = (data) => ((data & 0xff) >>> 0) / 0x80;
const setIrq = (data) => {
irq = (irq & 0xE0) | (data & 0x1F);
if (irq & (0x1F & irqEnable)) {
cpu.istat |= 0x0004;
}
if (cdDebug && (data & 0x1F)) {
cdLog('interrupt asserted', {
requested: data & 0x1F,
irq,
irqEnable,
istat: cpu.istat >>> 0,
});
}
};
const acknowledgeInterrupt = (data) => {
const before = irq;
irq &= ~(data & (0x1F & irqEnable));
if (cdDebug && (data & 0x1F)) {
cdLog('interrupt acknowledged', {
requested: data & 0x1F,
before,
after: irq,
irqEnable,
istat: cpu.istat >>> 0,
});
}
};
const enqueueEvent = (irq, ...params) => {
// if (results.length) abort('not yet read all results');
status = (status & ~0x80) | 0x20;
pushResults(params);
setIrq(irq);
};
const resetparams = () => {
params.length = 0;
};
const completeCmd = (self) => {
unsetEvent(self);
if (irq & 0x1f) {
setCommandEvent(64);
return;
}
const readCycles = PSX_SPEED / ((mode & 0x80) ? 150 : 75);
const loc = currLoc - 150;
let currentCommand = ncmdctrl;
ncmdctrl = 0;
cdLog('complete command', `0x${currentCommand.toString(16).padStart(2, '0')}`, {
status,
statusCode,
irq,
loc: currLoc,
results: results.length
});
switch (currentCommand) {
case 0x00: break;
case 0x01:
if (!sectorData8.length) {
enqueueEvent(5, 0x01);
}
else {
enqueueEvent(3, 0x02);
}
break;
case 0x02:
if (!((params[0] === 0) && (params[1] === 0) && (params[2] === 0))) {
seekLoc = (btoi(params[0]) * (60 * 75)) +
(btoi(params[1]) * (75)) +
(btoi(params[2]));
}
else {
seekLoc = currLoc;
}
enqueueEvent(3, 0x02);
break;
case 0x03:
if (params.length === 0 || params[0] === 0) {
currLoc = seekLoc;
}
if (params.length === 1) {
currTrack = tracks[btoi(params[0])];
currLoc = seekLoc = currTrack.begin + 150;
}
setReadEvent(readCycles >>> 0);
ncmdread = 0x03;
enqueueEvent(3, 0x82);
break;
case 0x06:
setReadEvent(readCycles >>> 0);
ncmdread = 0x06;
enqueueEvent(3, 0x42);
currLoc = seekLoc;
break;
case 0x07:
enqueueEvent(3, 0x00);
ncmdctrl = 0x70;
status |= 0x80;
break
case 0x70:
enqueueEvent(2, 0x02);
break;
case 0x08:
enqueueEvent(3, 0x02);
setCommandEvent(((mode & 0x80) ? 0x18a6076 : 0xd38aca) >>> 0);
ncmdctrl = 0x80;
status |= 0x80;
break;
case 0x80:
enqueueEvent(2, 0x00);
break;
case 0x09:
pushResults(statusCode | 0x20);
setCommandEvent(((mode & 0x80) ? 0x10bd93 : 0x21181c) >>> 0);
ncmdctrl = 0x90;
status |= 0xA0;
setIrq(3);
break;
case 0x90:
statusCode = (statusCode & ~0x20) | 0x02;
pushResults(statusCode);
status = (status & ~0x80) | 0x20;
setIrq(2);
break;
case 0x99:
statusCode = (statusCode & ~0xA0) | 0x02;
pushResults(statusCode);
status = (status & ~0x80) | 0x20;
setIrq(4);
break;
case 0x0A:
enqueueEvent(3, 0x02);
setCommandEvent(0x1000 >>> 0);
ncmdctrl = 0xA0;
status |= 0x80;
break;
case 0xA0:
enqueueEvent(2, 0x02);
break;
case 0x0B:
enqueueEvent(3, 0x02);
mute = true;
break;
case 0x0C:
enqueueEvent(3, 0x02);
mute = false;
break;
case 0x0D:
filterFile = params[0];
filterChan = params[1];
enqueueEvent(3, 0x02);
break;
case 0x0E:
enqueueEvent(3, 0x02);
mode = params[0];
break;
case 0x0F:
enqueueEvent(3, 0x02, mode, 0, filterFile, filterChan);
break;
case 0x10: {
const offset = sectorOffset + 12;
pushResults(
sectorData8[offset + 0],
sectorData8[offset + 1],
sectorData8[offset + 2],
sectorData8[offset + 3],
sectorData8[offset + 4],
sectorData8[offset + 5],
sectorData8[offset + 6],
sectorData8[offset + 7],
);
status = (status & ~0x80) | 0x20;
setIrq(3);
} break;
case 0x11: {
let loc = (currLoc - 150 - currTrack.begin);
let mm = (loc / (60 * 75)) >> 0;
let ss = ((loc / (75)) >> 0) % 60;
let st = loc % 75;
pushResults(itob(currTrack.id), 0x01, itob(mm), itob(ss), itob(st));
pushResults(itob((((currLoc - 150) / 75) / 60) % 60));
pushResults(itob((((currLoc - 150) / 75) % 60)));
pushResults(itob((((currLoc - 150) % 75))));
status = (status & ~0x80) | 0x20;
setIrq(3);
} break;
case 0x12:
setCommandEvent(0x1000 >>> 0);
ncmdctrl = 0x120;
statusCode |= 0x02;
pushResults(statusCode);
status |= 0x20;
setIrq(3);
break;
case 0x120:
statusCode |= 0x02;
let amm = (loc / (60 * 75)) >> 0;
let ass = ((loc / (75)) >> 0) % 60;
let ast = loc % 75;
pushResults(0x82, itob(currTrack.id), 1, itob(amm), itob(ass), itob(ast), 0, 0);
status = (status & ~0x80) | 0x20;
setIrq(1);
break;
case 0x13:
statusCode |= 0x02;
pushResults(statusCode, 0x01, itob(tracks.length - 1));
status = (status & ~0x80) | 0x20;
setIrq(3);
break;
case 0x14: {
let mmss = 0;
let track = tracks[btoi(params[0])];
if (!track) {
statusCode |= 0x10;
pushResults(0x11, 0x80);
status = (status & ~0x80) | 0x20;
setIrq(5);
break;
}
if (params[0] === 0) {
mmss = floor((track.end + 150) / 75);
}
else {
mmss = floor((track.begin + 150) / 75);
}
statusCode |= 0x02;
pushResults(statusCode, itob(floor(mmss / 60)), itob(floor(mmss % 60)));
status = (status & ~0x80) | 0x20;
setIrq(3);
} break;
case 0x15:
setCommandEvent(0x1000 >>> 0);
ncmdctrl = 0x150;
enqueueEvent(3, 0x42);
status |= 0x80;
break;
case 0x150:
enqueueEvent(2, 0x2);
currLoc = seekLoc;
break;
case 0x16:
setCommandEvent(0x1000 >>> 0);
ncmdctrl = 0x160;
enqueueEvent(3, 0x42);
status |= 0x80;
break;
case 0x160:
enqueueEvent(2, 0x2);
currLoc = seekLoc;
break;
case 0x19:
pushResults(0x99, 0x02, 0x01, 0xc3);
status = (status & ~0x80) | 0x20;
setIrq(3);
break;
case 0x1A:
setCommandEvent(0x4a00 >>> 0);
pushResults(statusCode);
ncmdctrl = 0x1A0;
status |= 0x20;
setIrq(3);
break;
case 0x1A0:
if (sectorData8.length) {
// SCEA alternative: 0x53, 0x43, 0x45, 0x41.
pushResults(0x02, 0x00, 0x20, 0x00, 0x65, 0x4e, 0x47, 0x45); // eNGE
cdLog('GetID response', '02 00 20 00 65 4e 47 45 (eNGE)');
status = (status & ~0x80) | 0x20;
setIrq(2);
}
else {
statusCode |= 0x10;
pushResults(0x11, 0x80);
status = (status & ~0x80) | 0x20;
setIrq(5);
}
break;
case 0x1B:
setReadEvent(readCycles >>> 0);
ncmdread = 0x1B;
enqueueEvent(3, 0x42);
currLoc = seekLoc;
break;
case 0x1E:
setCommandEvent(0x1000 >>> 0);
ncmdctrl = 0x1E0;
enqueueEvent(3, 0x02);
break;
case 0x1E0:
enqueueEvent(2, 0x02);
break;
default: abort(hex(ncmdctrl, 2));
}
resetparams();
};
const completeRead = (self) => {
if (irq & 0x1f) {
psx.updateEvent(self, 64);
return;
}
let readCycles = 33868800 / ((mode & 0x80) ? 150 : 75);
let loc = currLoc - 150;
switch (ncmdread) {
case 0x00:
unsetEvent(eventRead);
break;
case 0x03:
playIndex = 0;
if (currLoc === currTrack.end) {
if (mode & 0x02) {
unsetEvent(self);
return command(0x99);
}
}
if ((mode & 0x05) == 0x05) {
// A remote sector miss pauses this CD event until its range request
// completes. The event is retried without advancing currLoc.
if (!readSector(currLoc)) return;
switch (loc % 75) {
case 0:
case 20:
case 40:
case 60: {
let amm = (loc / (60 * 75)) >> 0;
let ass = ((loc / (75)) >> 0) % 60;
let ast = loc % 75;
pushResults(0x82, itob(currTrack.id), 1, itob(amm), itob(ass), itob(ast), 0, 0);
status = (status & ~0x80) | 0x60;
setIrq(1);
} break;
case 10:
case 30:
case 50:
case 70: {
let loc = (currLoc - currTrack.begin);
let amm = (loc / (60 * 75)) >> 0;
let ass = ((loc / (75)) >> 0) % 60;
let ast = loc % 75;
pushResults(0x82, itob(currTrack.id), 1, itob(amm), 0x80 | itob(ass), itob(ast), 0, 0);
status = (status & ~0x80) | 0x60;
setIrq(1);
} break;
}
psx.updateEvent(self, readCycles);
currLoc++;
break;
}
case 0x06:
case 0x1b:
if (!readSector(currLoc)) return;
pushResults(0x22);
status = (status & ~0x80) | 0x60;
setIrq(1);
psx.updateEvent(self, readCycles);
currLoc++;
break;
default:
abort(hex(ncmdread, 2));
}
};
const eventCmd = addEvent(0, completeCmd);
const setCommandEvent = e => setEvent(eventCmd, e);
const eventRead = addEvent(0, completeRead);
const setReadEvent = e => setEvent(eventRead, e);
const command = (data) => {
let nevtctrl = 0x0200;
setIrq(0);
results.length = 0;
status |= 0x80;
ncmdctrl = data;
cdLog('command', `0x${data.toString(16).padStart(2, '0')}`, {
params: [...params],
status,
statusCode,
currLoc,
seekLoc,
hasDisc: sectorData8.length > 0,
tracks: tracks.length
});
switch (data) {
case 0x01:  //- CdlNop
nevtctrl = 0xc4e1;
break;
case 0x02:  //- CdlSetloc
case 0x03:  //- CdlPlay
case 0x0b:  //- CdlMute
case 0x0c:  //- CdlDemute
case 0x0d:  //- CdlSetFilter
case 0x0e:  //- CdlSetmode
case 0x0f:  //- CdlGetparam
case 0x10:  //- CdlGetLocL
case 0x11:  //- CdlGetLocP
case 0x12:  //- CdlSetSession
case 0x13:  //- CdlGetTN
case 0x14:  //- CdlGetTD
case 0x19:  //- CdlTest
case 0x1a:  //- CdlID
case 0x1e:  //- CdlReadTOC
break;
case 0x0a:  //- CdlInit
nevtctrl = 0x13cce;
case 0x06:  //- CdlReadN
case 0x07:  //- CdlStandby
case 0x08:  //- CdlStop
case 0x15:  //- CdlSeekL
case 0x16:  //- CdlSeekP
case 0x1B:  //- CdlReadS
stopReading();
break;
case 0x09:  //- CdlPause
stopReading();
break;
case 0x99:  //- CdlPause (auto)
break;
default: abort(hex(data, 2));
}
setCommandEvent(nevtctrl >>> 0);
};
const readSector = (readLoc) => {
for (let i = 1; i < tracks.length; ++i) {
let track = currTrack = tracks[i];
if ((track.begin < readLoc) && (readLoc < track.end)) break;
}
if (remoteImage) {
const track = currTrack || tracks[1];
const fileIndex = track.fileIndex || 0;
const file = remoteImage.files[fileIndex];
const fileSector = (track.fileBegin || 0) + (readLoc - 150 - track.begin);
const byteOffset = fileSector * remoteSectorSize;
const chunkIndex = Math.floor(byteOffset / remoteChunkSize);
const chunkOffset = byteOffset - chunkIndex * remoteChunkSize;
const chunk = file.chunks.get(chunkIndex);
if (!chunk || chunkOffset + remoteSectorSize > chunk.length) {
if (!remoteRead || remoteRead.fileIndex !== fileIndex || remoteRead.chunkIndex !== chunkIndex) {
cdLog('sector cache miss; requesting range', { readLoc, file: fileIndex, chunk: chunkIndex });
const request = fetchRemoteChunk(file, fileIndex, chunkIndex);
remoteRead = { fileIndex, chunkIndex, request };
}
remoteRead.request.then(() => setEvent(eventRead, 0)).catch(error => abort(error.message));
return false;
}
// Read ahead while the current range is still being consumed. This is
// especially important for CDDA tracks, where a cache miss is audible.
if (chunkOffset + (remoteSectorSize * 32) >= chunk.length &&
(chunkIndex + 1) * remoteChunkSize < file.size) {
fetchRemoteChunk(file, fileIndex, chunkIndex + 1).catch(error => {
console.warn('CD read-ahead failed:', error.message);
});
}
remoteSector.set(chunk.subarray(chunkOffset, chunkOffset + remoteSectorSize));
sectorData8 = new Int8Array(remoteSector.buffer);
sectorData16 = new Int16Array(remoteSector.buffer);
sectorOffset = 0;
} else if (localImage) {
const track = currTrack || tracks[1];
const fileIndex = track?.fileIndex || 0;
const file = localImage.files[fileIndex];
const fileSector = (track?.fileBegin || 0) + (readLoc - 150 - (track?.begin || 0));
const byteOffset = fileSector * remoteSectorSize;
if (!file || byteOffset < 0 || byteOffset + remoteSectorSize > file.byteLength) return false;
remoteSector.set(file.subarray(byteOffset, byteOffset + remoteSectorSize));
sectorData8 = new Int8Array(remoteSector.buffer);
sectorData16 = new Int16Array(remoteSector.buffer);
sectorOffset = 0;
}
if (sectorData8.length <= 0) return false;
if (cdDebug && (readLoc < 20 || readLoc % 75 === 0)) {
cdLog('sector ready', { readLoc, track: currTrack.id, data: !!currTrack.data, audio: !!currTrack.audio });
}
if (!remoteImage && !localImage) sectorOffset = (readLoc - 150) * 2352;
if (cdDebug && debugSectorLogCount < 64) {
const header = Array.from(sectorData8.slice(sectorOffset + 0x0f, sectorOffset + 0x15), byte =>
String.fromCharCode(byte & 0xff)).join('');
cdLog('sector ready', {
lba: readLoc - 150,
readLoc,
track: currTrack.id,
mode: mode & 0x30,
header,
bytes: Array.from(sectorData8.slice(sectorOffset, sectorOffset + 16), byte =>
(byte & 0xff).toString(16).padStart(2, '0')).join(' ')
});
debugSectorLogCount++;
const lba = readLoc - 150;
if (lba === 22 && (mode & 0x30) === 0) {
const entries = [];
for (let offset = 24; offset < 24 + 2048;) {
const length = sectorData8[sectorOffset + offset] & 0xff;
if (!length) break;
const nameLength = sectorData8[sectorOffset + offset + 32] & 0xff;
const name = Array.from(sectorData8.slice(
sectorOffset + offset + 33,
sectorOffset + offset + 33 + nameLength
), byte => String.fromCharCode(byte & 0xff)).join('');
entries.push(name);
offset += length;
}
cdLog('root directory entries', entries);
}
}
let sectorSize = 0;
switch (mode & 0x30) {
case 0x00: sectorIndex = 24;
sectorSize = 2048;
break;
case 0x10: sectorIndex = 24;
sectorSize = 2328;
break;
case 0x20:
case 0x30: sectorIndex = 12;
sectorSize = 2340;
break;
}
sectorEnd = sectorIndex + sectorSize;
if ((mode & 0x48) !== 0) {
let sectorMode = sectorData8[sectorOffset + 0x0f];
if (sectorMode !== 2) return true;
if ((mode & 0x48) === 0x48) {
let file = sectorData8[sectorOffset + 0x10];
if (file !== filterFile) return true;
let chan = sectorData8[sectorOffset + 0x11];
if (chan !== filterChan) return true;
}
let sub = sectorData8[sectorOffset + 0x12];
if ((sub & 0x44) !== 0x44) return true;
let nfo = sectorData8[sectorOffset + 0x13];
let ms, sr;
switch ((nfo >>> 0) & 3) {
case 0: ms = decodeMono; break;
case 1: ms = decodeStereo; break;
}
switch ((nfo >>> 2) & 1) {
case 0: sr = 37800; break;
case 1: sr = 18900; break;
}
// todo: implement next two
// switch ((nfo >>> 4) & 3) {
//   case 0: bs = '4bit'; break;
//   case 1: bs = '8bit'; break;
// }
// switch ((nfo >>> 6) & 1) {
//   case 0: em = 'normal'; break;
//   case 1: em = 'emphasis'; break;
// }
pcmidx = 0;
xa.fill(0);
pcm.fill(0);
let ix = ms?.call() || 0;
let samples = (44100 * ix) / sr;
let i = 0;
let upscaleFreq = 0;
ix = -1;
for (let s = 0; s < samples; s += 2) {
pcm[++ix] = xa[i + 0];
pcm[++ix] = xa[i + 1];
upscaleFreq += sr;
if (upscaleFreq >= 44100) {
upscaleFreq -= 44100;
i += 2;
}
}
pcmmax = ix;
}
return true;
};
const decodeMono = () => {
let ix = 0;
for (let sg = 0; sg < 18; ++sg) {
const decodeOffset = sectorOffset + 24 + (sg * 128);
for (let su = 0; su < 8; ++su) {
const shiftFilter = sectorData8[decodeOffset + 4 + su];
const shift = (shiftFilter & 0x0f) >>> 0;
const filter = (shiftFilter & 0xf0) >>> 3;
const k0 = xa2flt[filter + 0];
const k1 = xa2flt[filter + 1];
for (let sd = 0; sd < 28; ++sd) {
const offset = (decodeOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
const data = sectorData8[offset] & 0xff;
const index = (shift * 256 + data) * 2;
let s = (sl[1] * k0) + (sl[0] * k1) + xa2pcm[index + (su & 1)];
sl[0] = sl[1];
sl[1] = s;
xa[ix + sd * 2 + 0] = s;
xa[ix + sd * 2 + 1] = s;
}
ix += 2 * 28;
}
}
return ix;
}
const decodeStereo = () => {
let ix = 0;
for (let sg = 0; sg < 18; ++sg) {
const decodeOffset = sectorOffset + 24 + (sg * 128);
for (let su = 0; su < 8; su += 2) {
{
const shiftFilter = sectorData8[decodeOffset + 4 + su];
const shift = (shiftFilter & 0x0f) >>> 0;
const filter = (shiftFilter & 0xf0) >>> 3;
const k0 = xa2flt[filter + 0];
const k1 = xa2flt[filter + 1];
for (let sd = 0; sd < 28; ++sd) {
const offset = (decodeOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
const data = sectorData8[offset] & 0xff;
const index = (shift * 256 + data) * 2;
let s = (sl[1] * k0) + (sl[0] * k1) + xa2pcm[index + 0];
sl[0] = sl[1];
sl[1] = s;
xa[ix + sd * 2 + 0] = s;
}
}
{
const shiftFilter = sectorData8[decodeOffset + 5 + su];
const shift = (shiftFilter & 0x0f) >>> 0;
const filter = (shiftFilter & 0xf0) >>> 3;
const k0 = xa2flt[filter + 0];
const k1 = xa2flt[filter + 1];
for (let sd = 0; sd < 28; ++sd) {
const offset = (decodeOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
const data = sectorData8[offset] & 0xff;
const index = (shift * 256 + data) * 2;
let s = (sr[1] * k0) + (sr[0] * k1) + xa2pcm[index + 1];
sr[0] = sr[1];
sr[1] = s;
xa[ix + sd * 2 + 1] = s;
}
}
ix += 2 * 28;
}
}
return ix;
};
const stopReading = () => {
unsetEvent(eventRead);
statusCode &= ~0x80;
statusCode &= ~0x20;
ncmdread = 0;
};
const resetForNewImage = () => {
stopReading();
status = 0x18;
statusCode = 0x00;
ncmdread = 0;
ncmdctrl = 0;
sectorOffset = 0;
sectorIndex = 0;
sectorEnd = 0;
playIndex = 0;
currLoc = 0;
seekLoc = 0;
irq = 0;
results.length = 0;
params.length = 0;
currTrack = {};
cpu.istat &= ~0x0004;
};
return {
cdr: {
rd08r1800: () => {
if (cdDebug && debugResponseLogCount < 128) {
cdLog('status register read', { status, irq, results: results.length });
debugResponseLogCount++;
}
return status;
},
rd08r1801: () => {
if ((status & 0x23) == 0x21) {
if (results.length === 1) {
status &= ~(0x40 | 0x20);
}
const result = results.shift();
if (cdDebug && debugResponseLogCount < 128) {
cdLog('result register read', {
result,
status,
irq,
remaining: results.length
});
debugResponseLogCount++;
}
return result;
}
if (cdDebug && debugResponseLogCount < 128) {
cdLog('result register read while not ready', { status, irq, remaining: results.length });
debugResponseLogCount++;
}
return 0;
},
rd08r1802: () => {
if (status & 0x40) {
return sectorData8[sectorOffset + sectorIndex++];
}
return 0x00;
},
rd08r1803: () => {
switch (status & 3) {
case 0: return 0xE0 | irqEnable;
case 1:
if (cdDebug && (irq & 0x1f || debugResponseLogCount < 128)) {
cdLog('interrupt register read', { irq, status, results: results.length });
if (!irq) debugResponseLogCount++;
}
return irq;
};
},
wr08r1800: (data) => {
status = (status & ~3) | (data & 3);
},
wr08r1801: (data) => {
switch (status & 3) {
case 0: command(data);
break;
case 3: volConfigCdRight2SpuRight = getCdVolume(data);
break;
};
},
wr08r1802: (data) => {
switch (status & 3) {
case 0:
params.push(data);
if (params.length === 16) status &= ~0x10;
break;
case 1:
irqEnable = data;
irq = 0;
if (cdDebug) cdLog('interrupt register select/write', { irqEnable, irq });
break;
case 2:
volConfigCdLeft2SpuLeft = getCdVolume(data);
break;
case 3:
volConfigCdRight2SpuLeft = getCdVolume(data);
break;
};
},
wr08r1803: (data) => {
switch (status & 3) {
case 0:
if (data === 0x80) {
status |= 0x40;
}
break;
case 1:
if (cdDebug && (data & 0x1f)) {
cdLog('interrupt register acknowledge write', { data, irq, irqEnable });
}
if (data & (0x1F & irqEnable)) {
acknowledgeInterrupt(data);
}
if (data & 0x40) {
resetparams();
}
break;
case 2:
volConfigCdLeft2SpuRight = getCdVolume(data);
break;
case 3:
if (data & 0x20) {
volCdLeft2SpuLeft = volConfigCdLeft2SpuLeft;
volCdLeft2SpuRight = volConfigCdLeft2SpuRight;
volCdRight2SpuLeft = volConfigCdRight2SpuLeft;
volCdRight2SpuRight = volConfigCdRight2SpuRight;
}
break;
};
},
nextpcm: (buf) => {
if (ncmdread === 0x03) {
if (currTrack.audio) {
let offset = (sectorOffset + playIndex) >> 1;
let sampleL = sectorData16[offset + 0] / 32768.0;
let sampleR = sectorData16[offset + 1] / 32768.0;
let sL = sampleL * volCdLeft2SpuLeft + sampleR * volCdRight2SpuLeft;
let sR = sampleR * volCdRight2SpuRight + sampleL * volCdLeft2SpuRight;
buf[0] = sL;
buf[1] = sR;
}
if (currTrack.data) {
buf[0] = 0.0;
buf[1] = 0.0;
}
playIndex += 4;
return;
}
if ((mode & 0x48) !== 0) {
// if due to timing issues we read beyond the buffer, repeat last samples to reduce clicks.
if (pcmidx >= (pcmmax - 1)) pcmidx = pcmmax - 1;
let sampleL = pcm[pcmidx + 0];
let sampleR = pcm[pcmidx + 1];
let sL = sampleL * volCdLeft2SpuLeft + sampleR * volCdRight2SpuLeft;
let sR = sampleR * volCdRight2SpuRight + sampleL * volCdLeft2SpuRight;
buf[0] = sL;
buf[1] = sR;
pcmidx += 2;
}
},
dmaTransferMode0000: (addr, blck) => {
if (!(addr & 0x007fffff)) return 0x10;
const transferSize = (blck & 0xFFFF) << 2;
if (cdDebug && debugDmaLogCount < 32) {
cdLog('DMA sector transfer', {
addr: `0x${(addr >>> 0).toString(16).padStart(8, '0')}`,
bytes: transferSize,
sectorIndex,
sectorEnd
});
debugDmaLogCount++;
}
clearCodeCache(addr, transferSize);
for (let i = 0; i < transferSize; i += 2) {
map16[(addr & 0x001fffff) >> 1] = sectorData16[(sectorOffset + sectorIndex) >> 1];
sectorIndex += 2;
addr += 2;
}
if (cdDebug && debugDmaLogCount <= 32) {
const ramStart = (addr - transferSize) & 0x001fffff;
cdLog('DMA payload check', {
bytes: Array.from(map8.slice(ramStart, ramStart + 16), byte =>
(byte & 0xff).toString(16).padStart(2, '0')).join(' '),
text: String.fromCharCode(...Array.from(map8.slice(ramStart, ramStart + 8), byte => byte & 0xff))
});
// DMA starts at the sector payload (sector offset 24), so the
// directory begins at RAM offset zero rather than RAM + 24.
if (sectorEnd === 2072 && (map8[ramStart] & 0xff) === 0x30) {
const entries = [];
for (let offset = 0; offset < 2048;) {
const length = map8[ramStart + offset] & 0xff;
if (!length) break;
const nameLength = map8[ramStart + offset + 32] & 0xff;
const name = Array.from(map8.slice(
ramStart + offset + 33,
ramStart + offset + 33 + nameLength
), byte => String.fromCharCode(byte & 0xff)).join('');
entries.push(name);
offset += length;
}
cdLog('DMA RAM directory entries', entries);
}
}
if (sectorIndex >= sectorEnd) {
status &= ~0x40;
}
return transferSize;
},
setTOC: (new_tracks) => {
tracks.splice(0, tracks.length, ...new_tracks);
},
getState: () => ({
status,
statusCode,
ncmdread,
ncmdctrl,
sectorOffset,
sectorIndex,
sectorEnd,
playIndex,
irq,
irqEnable,
mode,
mute,
currLoc,
seekLoc,
volCdLeft2SpuLeft,
volCdLeft2SpuRight,
volCdRight2SpuLeft,
volCdRight2SpuRight,
volConfigCdLeft2SpuLeft,
volConfigCdLeft2SpuRight,
volConfigCdRight2SpuLeft,
volConfigCdRight2SpuRight,
pcmidx,
pcmmax,
filterFile,
filterChan,
currTrackIndex: tracks.indexOf(currTrack),
results: [...results],
params: [...params],
sectorData: sectorData8.slice(sectorOffset, sectorOffset + remoteSectorSize),
pcm,
xa,
sl: [...sl],
sr: [...sr]
}),
setState: state => {
if (!state) return;
status = state.status;
statusCode = state.statusCode;
ncmdread = state.ncmdread;
ncmdctrl = state.ncmdctrl;
sectorOffset = state.sectorOffset;
sectorIndex = state.sectorIndex;
sectorEnd = state.sectorEnd;
playIndex = state.playIndex;
irq = state.irq;
irqEnable = state.irqEnable;
mode = state.mode;
mute = state.mute;
currLoc = state.currLoc;
seekLoc = state.seekLoc;
volCdLeft2SpuLeft = state.volCdLeft2SpuLeft;
volCdLeft2SpuRight = state.volCdLeft2SpuRight;
volCdRight2SpuLeft = state.volCdRight2SpuLeft;
volCdRight2SpuRight = state.volCdRight2SpuRight;
volConfigCdLeft2SpuLeft = state.volConfigCdLeft2SpuLeft;
volConfigCdLeft2SpuRight = state.volConfigCdLeft2SpuRight;
volConfigCdRight2SpuLeft = state.volConfigCdRight2SpuLeft;
volConfigCdRight2SpuRight = state.volConfigCdRight2SpuRight;
pcmidx = state.pcmidx;
pcmmax = state.pcmmax;
filterFile = state.filterFile;
filterChan = state.filterChan;
currTrack = tracks[state.currTrackIndex] || {};
results.length = 0;
results.push(...state.results);
params.length = 0;
params.push(...state.params);
if (state.sectorData) {
remoteSector.set(state.sectorData);
sectorData8 = new Int8Array(remoteSector.buffer);
sectorData16 = new Int16Array(remoteSector.buffer);
}
pcm.set(state.pcm);
xa.set(state.xa);
sl[0] = state.sl[0];
sl[1] = state.sl[1];
sr[0] = state.sr[0];
sr[1] = state.sr[1];
remoteRead = undefined;
},
setCdImage: (data) => {
resetForNewImage();
remoteImage = undefined;
localImage = undefined;
sectorData16 = new Int16Array(data.buffer);
sectorData8 = new Int8Array(data.buffer);
},
setCdImages: (dataBuffers) => {
resetForNewImage();
remoteImage = undefined;
const files = dataBuffers.map(buffer => new Uint8Array(buffer));
if (!files.length || files.some(file => !file.byteLength || file.byteLength % remoteSectorSize !== 0)) {
throw new Error('Local CD images must be raw 2352-byte-sector BIN files');
}
localImage = {
files,
sectors: files.reduce((sectors, file) => sectors + file.byteLength / remoteSectorSize, 0)
};
sectorData8 = new Int8Array(remoteSector.buffer);
sectorData16 = new Int16Array(remoteSector.buffer);
return { size: files.reduce((size, file) => size + file.byteLength, 0), sectors: localImage.sectors, files };
},
setCdImageURL: async (url) => {
return cdr.setCdImageURLs([url]);
},
setCdImageURLs: async (urls) => {
// Discover the size with a one-byte range request. A full download is
// deliberately rejected because it defeats the bounded-memory path.
const files = await Promise.all(urls.map(async url => {
const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
if (response.status !== 206) {
throw new Error(`CD image server returned HTTP ${response.status}; byte ranges are required`);
}
const contentRange = response.headers.get('Content-Range');
const match = contentRange?.match(/bytes\s+\d+-\d+\/(\d+)/i);
const size = match ? Number(match[1]) : 0;
if (!size || size % remoteSectorSize !== 0) {
throw new Error('CD image size is unavailable or is not a raw 2352-byte-sector image');
}
return { url, size, chunks: new Map(), pending: new Map() };
}));
remoteImage = {
files,
chunkCount: () => files.reduce((count, file) => count + file.chunks.size, 0)
};
resetForNewImage();
// The BIOS checks sectorData8.length to detect whether a disc is
// present before issuing its first read. Keep the fixed sector views
// visible even though the first sector has not been fetched yet.
sectorData8 = new Int8Array(remoteSector.buffer);
sectorData16 = new Int16Array(remoteSector.buffer);
return {
size: files.reduce((size, file) => size + file.size, 0),
sectors: files.reduce((sectors, file) => sectors + file.size / remoteSectorSize, 0),
files
};
}
}
}
})
mdlr('enge:psx:mdec', m => {
const iq = new Int32Array(128);
const scale = new Uint8Array(3 * 256);
const SCALERC256 = (y, x) => {
return scale[256 + 128 + y + x];
};
const SCALERC32 = (y, x) => {
return SCALERC256(y,x)>>>3;
};
const zscan = [
0, 1, 8, 16, 9, 2, 3, 10,
17, 24, 32, 25, 18, 11, 4, 5,
12, 19, 26, 33, 40, 48, 41, 34,
27, 20, 13, 6, 7, 14, 21, 28,
35, 42, 49, 56, 57, 50, 43, 36,
29, 22, 15, 23, 30, 37, 44, 51,
58, 59, 52, 45, 38, 31, 39, 46,
53, 60, 61, 54, 47, 55, 62, 63
];
const aanscales = [
0x4000, 0x58c5, 0x539f, 0x4b42, 0x4000, 0x3249, 0x22a3, 0x11a8,
0x58c5, 0x7b21, 0x73fc, 0x6862, 0x58c5, 0x45bf, 0x300b, 0x187e,
0x539f, 0x73fc, 0x6d41, 0x6254, 0x539f, 0x41b3, 0x2d41, 0x1712,
0x4b42, 0x6862, 0x6254, 0x587e, 0x4b42, 0x3b21, 0x28ba, 0x14c3,
0x4000, 0x58c5, 0x539f, 0x4b42, 0x4000, 0x3249, 0x22a3, 0x11a8,
0x3249, 0x45bf, 0x41b3, 0x3b21, 0x3249, 0x2782, 0x1b37, 0x0de0,
0x22a3, 0x300b, 0x2d41, 0x28ba, 0x22a3, 0x1b37, 0x12bf, 0x098e,
0x11a8, 0x187e, 0x1712, 0x14c3, 0x11a8, 0x0de0, 0x098e, 0x04df,
];
const iqtab_init = (addr, size) => {
for (let i = 0; i < size; ++i) {
const q = map8[((addr + i) & 0x001fffff) >>> 0] & 0xff;
iq[i] = (q * aanscales[zscan[i & 63]]) >> 12;
}
};
const icdt = (blk, o) => {
let z10, z11, z12, z13;
let oo = o;
for (let i = 8; i > 0; --i, o += 8) {
z10 = (blk[o + 0] + blk[o + 4]) >> 0;
z11 = (blk[o + 0] - blk[o + 4]) >> 0;
z13 = (blk[o + 2] + blk[o + 6]) >> 0;
z12 = (blk[o + 2] - blk[o + 6]) >> 0;
z12 = (((z12 * 362) >> 8) - z13) >> 0;
const tmp0 = (z10 + z13) >> 0;
const tmp3 = (z10 - z13) >> 0;
const tmp1 = (z11 + z12) >> 0;
const tmp2 = (z11 - z12) >> 0;
z13 = (blk[o + 3] + blk[o + 5]) >> 0;
z10 = (blk[o + 3] - blk[o + 5]) >> 0;
z11 = (blk[o + 1] + blk[o + 7]) >> 0;
z12 = (blk[o + 1] - blk[o + 7]) >> 0;
const z5 = ((z12 - z10) * 473) >> 8;
const tmp7 = (z11 + z13) >> 0;
const tmp6 = ((((z10 * 669) >> 8) + z5) - tmp7) >> 0;
const tmp5 = ((((z11 - z13) * 362) >> 8) - tmp6) >> 0;
const tmp4 = ((((z12 * 277) >> 8) - z5) + tmp5) >> 0;
blk[o + 0] = (tmp0 + tmp7) >> 5;
blk[o + 1] = (tmp1 + tmp6) >> 5;
blk[o + 2] = (tmp2 + tmp5) >> 5;
blk[o + 3] = (tmp3 - tmp4) >> 5;
blk[o + 4] = (tmp3 + tmp4) >> 5;
blk[o + 5] = (tmp2 - tmp5) >> 5;
blk[o + 6] = (tmp1 - tmp6) >> 5;
blk[o + 7] = (tmp0 - tmp7) >> 5;
}
o = oo;
for (let i = 8; i > 0; --i, ++o) {
z10 = (blk[o + 0] + blk[o + 32]) >> 0;
z11 = (blk[o + 0] - blk[o + 32]) >> 0;
z13 = (blk[o + 16] + blk[o + 48]) >> 0;
z12 = (blk[o + 16] - blk[o + 48]) >> 0;
z12 = (((z12 * 362) >> 8) - z13) >> 0;
const tmp0 = (z10 + z13) >> 0;
const tmp3 = (z10 - z13) >> 0;
const tmp1 = (z11 + z12) >> 0;
const tmp2 = (z11 - z12) >> 0;
z13 = (blk[o + 24] + blk[o + 40]) >> 0;
z10 = (blk[o + 24] - blk[o + 40]) >> 0;
z11 = (blk[o + 8] + blk[o + 56]) >> 0;
z12 = (blk[o + 8] - blk[o + 56]) >> 0;
const z5 = ((z12 - z10) * 473) >> 8;
const tmp7 = (z11 + z13) >> 0;
const tmp6 = ((((z10 * 669) >> 8) + z5) - tmp7) >> 0;
const tmp5 = ((((z11 - z13) * 362) >> 8) - tmp6) >> 0;
const tmp4 = ((((z12 * 277) >> 8) - z5) + tmp5) >> 0;
blk[o + 0] = (tmp0 + tmp7) >> 0;
blk[o + 8] = (tmp1 + tmp6) >> 0;
blk[o + 16] = (tmp2 + tmp5) >> 0;
blk[o + 24] = (tmp3 - tmp4) >> 0;
blk[o + 32] = (tmp3 + tmp4) >> 0;
blk[o + 40] = (tmp2 - tmp5) >> 0;
blk[o + 48] = (tmp1 - tmp6) >> 0;
blk[o + 56] = (tmp0 - tmp7) >> 0;
}
};
const rl2blk = (blk, addr) => {
blk.fill(0);
let base = (addr & 0x001fffff) >>> 1;
for (let i = 0; i < 6; ++i) {
const iqoff = i >= 2 ? 0 : 64;
const o = 64 * i;
const rl = map16[base++] & 0xffff;
const q = rl >> 10;
const dc = ((rl << 22) >> 22);
let k = 0;
blk[o] = iq[iqoff] * dc;
for (; ;) {
const rl = map16[base++] & 0xffff;
k += ((rl >> 10) + 1);
if (k <= 63) {
const dc = ((rl << 22) >> 22);
const val = (iq[iqoff + k] * q * dc) >> 3;
blk[o + zscan[k]] = val;
}
if (k > 63) break;
}
icdt(blk, o);
}
return base << 1;
};
const putquadrgb15 = (addr, blk, o, Cr, Cb) => {
const R = ((1433 * Cr)) >> 10;
const G = ((-351 * Cb) - (728 * Cr)) >> 10;
const B = ((1807 * Cb)) >> 10;
const base = (addr & 0x001fffff) >>> 0;
const memory = map16;
let Y, r, g, b, a = mdc.STP;
Y = blk[o + 0] << 0;
r = SCALERC32(Y, R);
g = SCALERC32(Y, G);
b = SCALERC32(Y, B);
memory[(base + 0) >>> 1] = a | (b << 10) | (g << 5) | r;
Y = blk[o + 1] << 0;
r = SCALERC32(Y, R);
g = SCALERC32(Y, G);
b = SCALERC32(Y, B);
memory[(base + 2) >>> 1] = a | (b << 10) | (g << 5) | r;
Y = blk[o + 8] << 0;
r = SCALERC32(Y, R);
g = SCALERC32(Y, G);
b = SCALERC32(Y, B);
memory[(base + 32) >>> 1] = a | (b << 10) | (g << 5) | r;
Y = blk[o + 9] << 0;
r = SCALERC32(Y, R);
g = SCALERC32(Y, G);
b = SCALERC32(Y, B);
memory[(base + 34) >>> 1] = a | (b << 10) | (g << 5) | r;
};
const yuv2rgb15 = (blk, addr) => {
let y;
let ro = 0;
let bo = 64;
let yo = 64 * 2;
for (y = 0; y < 16; y += 2, ro += 8, bo += 8, yo += 16, addr += 64) {
if (y == 8) yo += 64;
putquadrgb15(addr + 0, blk, yo + 0, blk[ro + 0], blk[bo + 0]);
putquadrgb15(addr + 4, blk, yo + 2, blk[ro + 1], blk[bo + 1]);
putquadrgb15(addr + 8, blk, yo + 4, blk[ro + 2], blk[bo + 2]);
putquadrgb15(addr + 12, blk, yo + 6, blk[ro + 3], blk[bo + 3]);
putquadrgb15(addr + 16, blk, yo + 64, blk[ro + 4], blk[bo + 4]);
putquadrgb15(addr + 20, blk, yo + 66, blk[ro + 5], blk[bo + 5]);
putquadrgb15(addr + 24, blk, yo + 68, blk[ro + 6], blk[bo + 6]);
putquadrgb15(addr + 28, blk, yo + 70, blk[ro + 7], blk[bo + 7]);
}
};
const putquadrgb24 = (addr, blk, o, Cr, Cb) => {
const R = ((1433 * Cr)) >> 10;
const G = ((-351 * Cb) - (728 * Cr)) >> 10;
const B = ((1807 * Cb)) >> 10;
const base = (addr & 0x001fffff) >>> 0;
const memory = map8;
let Y;
Y = blk[o + 0] << 0;
memory[base + 0] = SCALERC256(Y, R);
memory[base + 1] = SCALERC256(Y, G);
memory[base + 2] = SCALERC256(Y, B);
Y = blk[o + 1] << 0;
memory[base + 3] = SCALERC256(Y, R);
memory[base + 4] = SCALERC256(Y, G);
memory[base + 5] = SCALERC256(Y, B);
Y = blk[o + 8] << 0;
memory[base + 48] = SCALERC256(Y, R);
memory[base + 49] = SCALERC256(Y, G);
memory[base + 50] = SCALERC256(Y, B);
Y = blk[o + 9] << 0;
memory[base + 51] = SCALERC256(Y, R);
memory[base + 52] = SCALERC256(Y, G);
memory[base + 53] = SCALERC256(Y, B);
};
const yuv2rgb24 = (blk, addr) => {
let y;
let ro = 0;
let bo = 64;
let yo = 64 * 2;
for (y = 0; y < 16; y += 2, ro += 8, bo += 8, yo += 16, addr += 96) {
if (y == 8) yo += 64;
putquadrgb24(addr + 0, blk, yo + 0, blk[ro + 0], blk[bo + 0]);
putquadrgb24(addr + 6, blk, yo + 2, blk[ro + 1], blk[bo + 1]);
putquadrgb24(addr + 12, blk, yo + 4, blk[ro + 2], blk[bo + 2]);
putquadrgb24(addr + 18, blk, yo + 6, blk[ro + 3], blk[bo + 3]);
putquadrgb24(addr + 24, blk, yo + 64, blk[ro + 4], blk[bo + 4]);
putquadrgb24(addr + 30, blk, yo + 66, blk[ro + 5], blk[bo + 5]);
putquadrgb24(addr + 36, blk, yo + 68, blk[ro + 6], blk[bo + 6]);
putquadrgb24(addr + 42, blk, yo + 70, blk[ro + 7], blk[bo + 7]);
}
};
const mdc = {
r1820: 0,
r1824: 0x80040000,
rl: 0,
STP: 0,
end: 0,
block: new Int32Array(6 * 64),
rd32r1820: () => {
return mdc.r1820;
},
wr32r1820: (data) => {
mdc.r1820 = data;
},
rd32r1824: () => {
return mdc.r1824;
},
wr32r1824: (data) => {
if (data & 0x80000000) {
mdc.r1820 = 0;
mdc.r1824 = 0x80040000;
psx.unsetEvent(mdc.event);
}
},
dmaTransferMode0201: (addr, blck) => {
if (!(addr & 0x007fffff)) return 0x10;
addr = addr & 0x001fffff;
const transferSize = (blck >>> 16) * (blck & 0xffff);
switch (mdc.r1820 >>> 29) {
// case 0x0:
case 0x1:
mdc.rl = addr;
break;
case 0x2:
iqtab_init(addr, transferSize << 2);
if (mdc.r1820 !== 0x40000001) return abort();
break;
default:
console.log(hex(mdc.r1820 >>> 29));
}
mdc.r1820 &= 0xf87fffff;
mdc.r1820 |= (mdc.r1824 & 0x1e000000) >> 2;
return transferSize;
},
dmaTransferMode0200: (addr, blck) => {
if (!(addr & 0x007fffff)) return 0x10;
addr = addr & 0x001fffff;
const numberOfWords = (blck >>> 16) * (blck & 0xffff);
// clearCodeCache(addr, numberOfWords << 2); // optimistice assumption (performance reasons)
const blk = mdc.block;
const end = addr + (numberOfWords << 2);
const depth = (mdc.r1820 >>> 27) & 3;
mdc.end = end;
mdc.STP = (mdc.r1820 & (1 << 25)) ? 0x8000 : 0x0000;
let decodedMacroBlocks = 0;
while (addr < end) {
mdc.rl = rl2blk(blk, mdc.rl);
switch (depth) {
case 0: // todo: implement
addr += (4 * 16) << 1;
break;
case 1: // todo: implement
addr += (8 * 16) << 1;
break;
case 2:
yuv2rgb24(blk, addr);
addr += (24 * 16) << 1;
break;
case 3:
yuv2rgb15(blk, addr);
addr += (16 * 16) << 1;
break;
}
decodedMacroBlocks += 6;
}
// 320x240x30 = 9000 16x16 blocks
const decodingCyclesRemaining = (PSX_SPEED / 9000) * (decodedMacroBlocks / 6);
psx.setEvent(mdc.event, decodingCyclesRemaining >>> 0);
return numberOfWords;
},
event: null,
complete: (self, clock) => {
dma.completeDMA1({});
psx.unsetEvent(self);
}
}
mdc.event = psx.addEvent(0, mdc.complete.bind(mdc));
for (let i = 0; i < 256; ++i) {
scale[0 + i] = 0;
scale[256 + i] = i;
scale[512 + i] = 255;
}
return { mdc };
})
mdlr('enge:psx:gpu', m => {
const debugGame = new URLSearchParams(window.location.search).has('debug-game');
let debugGpuCommandCount = 0;
const $renderer = renderer;
const [drawLine, drawTriangle, drawRectangle, setDrawAreaOF] = [$renderer.drawLine, $renderer.drawTriangle, $renderer.drawRectangle, $renderer.setDrawAreaOF].map(a => a.bind($renderer));
const missing = new Set;
const handlers = [];
const dmaBuffer = new Int32Array(4096);
const renderTexture = (data, cb) => {
const packetId = data[0] >>> 24;
if ((packetId & 6) === 6) {
data[0] |= 0x80000000;
cb();
nextPrimitive();
data[0] &= ~0x02000000;
cb();
}
else {
cb();
}
}
const packetSizes = [
0x01, 0x01, 0x03, 0x01, 0x01, 0x01, 0x01, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x04, 0x04, 0x04, 0x04, 0x07, 0x07, 0x07, 0x07, 0x05, 0x05, 0x05, 0x05, 0x09, 0x09, 0x09, 0x09,
0x06, 0x06, 0x06, 0x06, 0x09, 0x09, 0x09, 0x09, 0x08, 0x08, 0x08, 0x08, 0x0C, 0x0C, 0x0C, 0x0C,
0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05,
0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x02, 0x02, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00,
0x02, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x02, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03,
0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
];
let dmaIndex = 0;
let gpu = {
dispB: 256,
dispL: 0,
dispR: 0,
dispT: 16,
dispX: 0,
dispY: 0,
dispW: 0,
drawAreaX1: 0,
drawAreaX2: 0,
drawAreaY1: 0,
drawAreaY2: 0,
heights: [1, 2, 1, 2],
hline: 0,
img: { w: 0, h: 0, x: 0, y: 0, index: 0, pixelCount: 0, buffer: new Uint16Array(1024 * 512) },
info: new Uint32Array(16),
maxheights: [240, 480, 256, 512],
maxwidths: [256, 368, 320, 368, 512, 368, 640, 368],
packetSize: 0,
result: 2,
status: 0x14802000,
tp: 0,
transferTotal: 0,
twin: 0,
tx: 0,
txflip: 0,
ty: 0,
tyflip: 0,
widths: [10, 7, 8, 7, 5, 7, 4, 7],
frame: 0,
internalFrame: 0,
updated: false,
cyclesToDotClock: function (cycles) {
switch ((gpu.status >> 16) & 7) {
case 0: return +(cycles * 11.0 / 7.0 / 10.0);
case 1: return +(cycles * 11.0 / 7.0 / 7.0);
case 2: return +(cycles * 11.0 / 7.0 / 8.0);
case 3: return +(cycles * 11.0 / 7.0 / 7.0);
case 4: return +(cycles * 11.0 / 7.0 / 5.0);
case 5: return +(cycles * 11.0 / 7.0 / 7.0);
case 6: return +(cycles * 11.0 / 7.0 / 4.0);
case 7: return +(cycles * 11.0 / 7.0 / 7.0);
}
},
getDisplayArea: function () {
if ((gpu.status >> 20) & 1) {
var t = gpu.dispT % 256; var b = Math.min(gpu.dispB, 314);
}
else {
var t = gpu.dispT % 240; var b = Math.min(gpu.dispB, 263);
}
var dispH = b - t;
var dispW = gpu.dispR - gpu.dispL;
var maxwidth = gpu.maxwidths[(gpu.status >> 16) & 7];
var width = dispW / gpu.widths[(gpu.status >> 16) & 7];
width = Math.min(maxwidth, (width + 2) & ~3);
var maxheight = gpu.maxheights[(gpu.status >> 19) & 3];
var height = gpu.heights[(gpu.status >> 19) & 3] * dispH;
height = Math.min(maxheight, height);
return { x: gpu.dispX, y: gpu.dispY, w: width, h: height };
},
onScanLine: function (scanline) {
gpu.hline = scanline;
let interlaced = gpu.status & (1 << 22);
let PAL = ((gpu.status >> 20) & 1) ? true : false;
let vsync = PAL ? 314 : 263;
let halfheight = (gpu.dispB - gpu.dispT) >> 1;
let center = PAL ? 163 : 136;
let vblankend = center - halfheight;
let vblankbegin = center + halfheight;
if (vblankbegin > vsync) vblankbegin = vsync;
if (vblankend < 0) vblankend = 0;
if (interlaced) {
if ((gpu.frame & 1) === 1) {
gpu.status |= 0x80000000;
}
else {
gpu.status &= 0x7fffffff;
}
}
else {
const oddLine = gpu.hline + (gpu.frame & 1); // toggle even/odd on every frame
if ((oddLine & 1) === 1) {
gpu.status |= 0x80000000;
}
else {
gpu.status &= 0x7fffffff;
}
}
if (gpu.hline === vblankbegin) {
renderer.onVBlankBegin();
}
if (gpu.hline === vblankend) {
renderer.onVBlankEnd();
}
if ((gpu.hline >= vblankbegin) || (gpu.hline < vblankend)) {
// always even during vlbank.
gpu.status &= 0x7fffffff;
}
if (++gpu.hline >= vsync) {
const frameUpdated = gpu.updated;
if (gpu.updated) {
++gpu.internalFrame;
}
gpu.updated = false;
cpu.istat |= 0x0001;
gpu.hline = 0;
++gpu.frame;
if (debugGame && (gpu.frame % 60) === 0) {
console.debug('[GPU] frame', JSON.stringify({
frame: gpu.frame,
internalFrame: gpu.internalFrame,
updated: frameUpdated,
status: `0x${(gpu.status >>> 0).toString(16)}`,
display: gpu.getDisplayArea()
}));
}
}
},
rd32r1810: function () {
if (gpu.rR1814 & 0x08000000) {
abort('gpu.rd32r1810 not implemented');
}
return gpu.result;
},
rd32r1814: function () {
return gpu.status;
},
wr32r1810: data => {
if (debugGame && debugGpuCommandCount < 64) {
console.debug('[GPU] GP0', `0x${(data >>> 0).toString(16).padStart(8, '0')}`);
debugGpuCommandCount++;
}
if (gpu.status & 0x10000000) {
dmaBuffer[dmaIndex++] = data;
if (dmaIndex === 1) {
gpu.packetSize = packetSizes[data >>> 24];
}
if (dmaIndex === gpu.packetSize) {
var packetId = dmaBuffer[0] >>> 24;
nextPrimitive();
handlers[packetId].call(gpu, dmaBuffer);
dmaIndex = 0;
}
}
else {
gpu.img.buffer[gpu.img.index++] = (data >>> 0) & 0xffff;
if (--gpu.transferTotal <= 0) { gpu.imgTransferComplete(gpu.img); return; }
gpu.img.buffer[gpu.img.index++] = (data >>> 16) & 0xffff;
if (--gpu.transferTotal <= 0) { gpu.imgTransferComplete(gpu.img); return; }
}
},
wr32r1814: data => {
if (debugGame && debugGpuCommandCount < 128) {
console.debug('[GPU] GP1', `0x${(data >>> 0).toString(16).padStart(8, '0')}`);
debugGpuCommandCount++;
}
switch (data >>> 24) {
case 0x00: gpu.status = 0x14820000;
dmaIndex = 0;
/*
GP1(01h)      ;clear fifo
GP1(02h)      ;ack irq (0)
GP1(03h)      ;display off (1)
GP1(04h)      ;dma off (0)
GP1(05h)      ;display address (0)
GP1(06h)      ;display x1,x2 (x1=200h, x2=200h+256*10)
GP1(07h)      ;display y1,y2 (y1=010h, y2=010h+240)
GP1(08h)      ;display mode 320x200 NTSC (0)
GP0(E1h..E6h) ;rendering attributes (0)
*/
gpu.dispL = 512;
gpu.dispR = 512 + 2560;
gpu.dispW = 320;
gpu.dispT = 16;
gpu.dispB = 256;
gpu.dispX = 0;
gpu.dispY = 0;
gpu.pcktE1([0]);
gpu.pcktE2([0]);
gpu.pcktE3([0]);
gpu.pcktE4([0]);
gpu.pcktE5([0]);
gpu.pcktE6([0]);
renderer.updateDrawArea?.call(renderer);
break;
case 0x01: gpu.status |= 0x70000000;
dmaIndex = 0;
break;
case 0x02: break;
case 0x03: gpu.status &= 0xFF7FFFFF;
gpu.status |= ((data & 0x01) << 0x17);
break;
case 0x04: gpu.status &= 0x9FFFFFFF;
gpu.status |= ((data & 0x03) << 0x1D);
break;
case 0x05: gpu.dispX = (data >> 0) & 0x3FF;
gpu.dispY = (data >> 10) & 0x1FF;
break;
case 0x06: gpu.dispL = (data >> 0) & 0xFFF;
gpu.dispR = (data >> 12) & 0xFFF;
var dispW = gpu.dispR - gpu.dispL;
var maxwidth = gpu.maxwidths[(gpu.status >> 16) & 7];
var width = dispW / gpu.widths[(gpu.status >> 16) & 7];
gpu.dispW = Math.min(maxwidth, (width + 2) & ~3);
break;
case 0x07: gpu.dispT = (data >> 0) & 0x3FF;
gpu.dispB = (data >> 10) & 0x3FF;
if (gpu.dispB < gpu.dispT) gpu.dispB += 288;
break;
case 0x08:
gpu.status &= 0xFF80FFFF;
gpu.status |= ((data & 0x3F) << 0x11);
gpu.status |= ((data & 0x40) ? 0x010000 : 0x000000);
break;
case 0x10:
gpu.result = gpu.info[data & 0xf];
break;
case 0x40: break; // ???
default: console.warn('gpu.cmnd' + hex(data >>> 24, 2));
}
// gpu.updateTexturePage();
},
invalidPacketHandler: data => {
// abort('gpu.' + gpu.getPacketHandlerName(data));
},
updateTexturePage: function (bitfield) {
if (bitfield !== undefined) gpu.status = (gpu.status & ~0x9FF) | (bitfield & 0x9FF);
gpu.tx = ((gpu.status >>> 0) & 15) << 6;
gpu.ty = ((gpu.status >>> 4) & 1) << 8;
gpu.tp = ((gpu.status >>> 7) & 3);
switch (gpu.tp) {
case 0: gpu.tx <<= 2; break;
case 1: gpu.tx <<= 1; break;
case 2: gpu.tx <<= 0; break;
case 3: gpu.tx <<= 0; break;
}
},
pckt00: data => {
// intentionally left blank
},
// Clear Cache
pckt01: data => {
gpu.status = (gpu.status | 0x10000000) & ~0x08000000;
},
// Framebuffer Rectangle draw
pckt02: data => {
renderer.fillRectangle(data);
},
pckt03: data => {
// intentionally left blank
},
pckt04: data => {
// intentionally left blank
},
pckt05: data => {
// intentionally left blank
},
pckt08: data => {
// intentionally left blank
},
pckt09: data => {
// intentionally left blank
},
pckt0D: data => {
// intentionally left blank
},
// Monochrome 3 point polygon
pckt20: data => {
drawTriangle(data, 0, 1, 0, 2, 0, 3);
},
// Textured 3 point polygon
pckt24: data => {
gpu.updateTexturePage(data[4] >>> 16);
renderTexture(data, () => {
drawTriangle(data, 0, 1, 0, 3, 0, 5, gpu.tx, gpu.ty, 2, 4, 6, data[2] >>> 16);
});
},
// Monochrome 4 point polygon
pckt28: data => {
drawTriangle(data, 0, 1, 0, 2, 0, 3);
drawTriangle(data, 0, 2, 0, 3, 0, 4);
},
// Textured 4 point polygon
pckt2C: data => {
gpu.updateTexturePage(data[4] >>> 16);
renderTexture(data, () => {
drawTriangle(data, 0, 1, 0, 3, 0, 5, gpu.tx, gpu.ty, 2, 4, 6, data[2] >>> 16);
drawTriangle(data, 0, 3, 0, 5, 0, 7, gpu.tx, gpu.ty, 4, 6, 8, data[2] >>> 16);
});
},
// Gradated 3 point polygon
pckt30: data => {
drawTriangle(data, 0, 1, 2, 3, 4, 5);
},
// Gradated textured 3 point polygon
pckt34: data => {
gpu.updateTexturePage(data[5] >>> 16);
renderTexture(data, () => {
drawTriangle(data, 0, 1, 3, 4, 6, 7, gpu.tx, gpu.ty, 2, 5, 8, data[2] >>> 16);
});
},
// Gradated 4 point polygon
pckt38: data => {
drawTriangle(data, 0, 1, 2, 3, 4, 5);
drawTriangle(data, 2, 3, 4, 5, 6, 7);
},
// Gradated textured 4 point polygon
pckt3C: data => {
gpu.updateTexturePage(data[5] >>> 16);
renderTexture(data, () => {
drawTriangle(data, 0, 1, 3, 4, 6, 7, gpu.tx, gpu.ty, 2, 5, 8, data[2] >>> 16);
drawTriangle(data, 3, 4, 6, 7, 9, 10, gpu.tx, gpu.ty, 5, 8, 11, data[2] >>> 16);
});
},
// Monochrome line
pckt40: data => {
drawLine(data, 0, 1, 0, 2);
},
// Monochrome polyline
pckt48: function (data, size) {
for (var i = 2; i < size; i += 1) {
drawLine(data, 0, i - 1, 0, i);
}
},
// Gradated line
pckt50: data => {
drawLine(data, 0, 1, 2, 3);
},
// Gradated polyline
pckt58: function (data, size) {
for (var i = 3; i < size; i += 2) {
drawLine(data, i - 3, i - 2, i - 1, i);
}
},
// Rectangle
pckt60: data => {
drawRectangle([data[0], data[1], data[2]], 0, 0, 0 >>> 0);
},
// Sprite
pckt64: data => {
const tx = (data[2] >>> 0) & 255;
const ty = (data[2] >>> 8) & 255;
renderTexture(data, () => {
drawRectangle([data[0], data[1], data[3]], tx, ty, data[2] >>> 16);
});
},
// Dot
pckt68: data => {
drawRectangle([data[0], data[1], 0x00010001], 0, 0, 0 >>> 0);
},
// 8*8 rectangle
pckt70: data => {
drawRectangle([data[0], data[1], 0x00080008], 0, 0, 0 >>> 0);
},
// 8*8 sprite
pckt74: data => {
const tx = (data[2] >>> 0) & 255;
const ty = (data[2] >>> 8) & 255;
renderTexture(data, () => {
drawRectangle([data[0], data[1], 0x00080008], tx, ty, data[2] >>> 16);
});
},
// 16*16 rectangle
pckt78: data => {
drawRectangle([data[0], data[1], 0x00100010], 0, 0, 0 >>> 0);
},
// 16*16 sprite
pckt7C: data => {
const tx = (data[2] >>> 0) & 255;
const ty = (data[2] >>> 8) & 255;
renderTexture(data, () => {
drawRectangle([data[0], data[1], 0x00100010], tx, ty, data[2] >>> 16);
});
},
// Move image in framebuffer
pckt80: data => {
if (data[1] !== data[2]) {
var sx = (data[1] >> 0);
var sy = (data[1] >> 16);
var dx = (data[2] >> 0);
var dy = (data[2] >> 16);
var w = (data[3] >> 0);
var h = (data[3] >> 16);
w = ((w - 1) & 0x3ff) + 1;
h = ((h - 1) & 0x1ff) + 1;
dx = (dx & 0x3ff);
dy = (dy & 0x1ff);
sx = (sx & 0x3ff);
sy = (sy & 0x1ff);
if (w * h) renderer.moveImage(sx, sy, dx, dy, w, h);
}
},
// Send image to frame buffer
pcktA0: data => {
gpu.status &= ~0x10000000;
var x = ((data[1] << 16) >>> 16);
var y = ((data[1] << 0) >>> 16);
var w = ((data[2] << 16) >>> 16);
var h = ((data[2] << 0) >>> 16);
gpu.img.w = ((w - 1) & 0x3ff) + 1;
gpu.img.h = ((h - 1) & 0x1ff) + 1;
gpu.img.x = (x & 0x3ff);
gpu.img.y = (y & 0x1ff);
gpu.img.index = 0;
gpu.transferTotal = ((gpu.img.w * gpu.img.h) + 1) & ~1;
gpu.img.pixelCount = gpu.transferTotal;
},
// Copy image from frame buffer
pcktC0: data => {
gpu.status |= 0x08000000;
var x = ((data[1] << 16) >>> 16);
var y = ((data[1] << 0) >>> 16);
var w = ((data[2] << 16) >>> 16);
var h = ((data[2] << 0) >>> 16);
gpu.img.w = ((w - 1) & 0x3ff) + 1;
gpu.img.h = ((h - 1) & 0x1ff) + 1;
gpu.img.x = (x & 0x3ff);
gpu.img.y = (y & 0x1ff);
gpu.img.index = 0;
gpu.transferTotal = ((gpu.img.w * gpu.img.h) + 1) & ~1;
gpu.img.pixelCount = gpu.transferTotal;
renderer.loadImage(gpu.img.x, gpu.img.y, gpu.img.w, gpu.img.h, gpu.img.buffer);
},
// Draw mode setting
pcktE1: data => {
gpu.status = (gpu.status & 0xfffff800) | (data[0] & 0x7ff);
gpu.txflip = (data[0] >>> 12) & 1;
gpu.tyflip = (data[0] >>> 13) & 1;
gpu.updateTexturePage();
},
// Texture window setting
pcktE2: data => {
gpu.info[2] = data[0] & 0x000fffff;
var maskx = ((data[0] >> 0) & 0x1f) << 3;
var masky = ((data[0] >> 5) & 0x1f) << 3;
var offsx = ((data[0] >> 10) & 0x1f) << 3;
var offsy = ((data[0] >> 15) & 0x1f) << 3;
// Texcoord = (Texcoord AND (NOT (Mask*8))) OR ((Offset AND Mask)*8)
const twin = (maskx << 0) + (masky << 8) + (offsx << 16) + (offsy << 24);
gpu.twin = twin;
},
// Set drawing area top left
pcktE3: data => {
gpu.info[3] = data[0] & 0x000fffff;
gpu.drawAreaX1 = (data[0] << 22) >>> 22;
gpu.drawAreaY1 = (data[0] << 12) >>> 22;
renderer.setDrawAreaTL(gpu.drawAreaX1, gpu.drawAreaY1);
},
// Set drawing area bottom right
pcktE4: data => {
gpu.info[4] = data[0] & 0x000fffff;
gpu.drawAreaX2 = (data[0] << 22) >>> 22;
gpu.drawAreaY2 = (data[0] << 12) >>> 22;
renderer.setDrawAreaBR(gpu.drawAreaX2, gpu.drawAreaY2);
},
// Drawing offset
pcktE5: (data) => {
gpu.info[5] = data[0] & 0x003fffff;
const drawOffsetX = (data[0] << 21) >> 21;
const drawOffsetY = (data[0] << 11) >> 22;
setDrawAreaOF(drawOffsetX, drawOffsetY);
},
// Mask setting
pcktE6: data => {
gpu.status &= 0xffffe7ff;
gpu.status |= ((data[0] & 3) << 11);
},
imgTransferComplete: function (img) {
renderer.storeImage(gpu.img);
gpu.status |= 0x10000000;
},
dmaTransferMode0200: function (addr, blck) {
if (!(addr & 0x007fffff)) return 0x10;
var transferSize = (blck >> 16) * (blck & 0xFFFF) << 1;
// clearCodeCache( addr, transferSize << 1); // optimistice assumption (performance reasons)
gpu.transferTotal -= transferSize;
const img = gpu.img;
while (--transferSize >= 0) {
const data = gpu.img.buffer[img.index++];
map16[(addr & 0x001fffff) >>> 1] = data;
addr += 2;
}
if (gpu.transferTotal <= 0) {
gpu.status &= ~0x08000000;
}
return (blck >> 16) * (blck & 0xFFFF);
},
dmaTransferMode0201: function (addr, blck) {
if (!(addr & 0x007fffff)) return 0x10;
if ((addr & ~3) === 0) {
return (blck >> 16) * (blck & 0xFFFF);
}
var transferSize = (blck >> 16) * (blck & 0xFFFF) << 1;
gpu.transferTotal -= transferSize;
const img = gpu.img;
while (--transferSize >= 0) {
const data = map16[(addr & 0x001fffff) >>> 1];
img.buffer[img.index++] = data;
addr += 2;
}
if (gpu.transferTotal <= 0) {
gpu.imgTransferComplete(gpu.img);
gpu.updated = true;
}
return (blck >> 16) * (blck & 0xFFFF);
},
dmaTransferMode0401: function (addr, blck) {
if (!(addr & 0x007fffff)) return 0x10;
if (dmaIndex !== 0) abort('not implemented')
if ((addr & ~3) === 0) {
return (blck >> 16) * (blck & 0xFFFF);
}
const seen = new Set();
const data = dmaBuffer;
let words = 0;
for (; ;) {
addr = addr & 0x001fffff;
// seen.add(addr);
let header = ram.getInt32(addr, true);
let nitem = header >>> 24;
addr = addr + 4; ++words;
while (nitem > 0) {
if (seen.has(addr)) return words;
seen.add(addr);
const packetWord = ram.getInt32(addr, true) >>> 0;
const packetId = packetWord >>> 24;
if (packetSizes[packetId] === 0) {
if (missing.has(packetId)) return words;
missing.add(packetId);
console.warn('invalid packetId:', hex(packetId, 2), hex(header), hex(packetWord));
return words;
}
else if (((packetId >= 0x48) && (packetId < 0x50)) || ((packetId >= 0x58) && (packetId < 0x60))) {
let i = 0;
for (; i < 4096; ++i) {
const value = ram.getInt32(addr, true);
addr += 4; --nitem; ++words;
if (value === 0x55555555) break;
if (value === 0x50005000) break;
data[i] = value;
}
if (nitem < 0) return words;
nextPrimitive();
handlers[packetId].call(gpu, data, i);
gpu.updated = true;
}
else {
for (var i = 0; i < packetSizes[packetId]; ++i) {
data[i] = ram.getInt32(addr, true);
addr += 4; --nitem;
++words;
}
if (nitem < 0) return words;
nextPrimitive();
handlers[packetId].call(gpu, data, 0);
gpu.updated = true;
}
}
if (header & 0x00800000) { break; } //end dma transfer
// if (!nnext || (nnext == 0x001fffff)) break;
addr = header & 0x001fffff;
}
return words;
},
dmaLinkedListMode0002: function (addr, blck) {
if (!addr) return;
if ((addr & ~3) === 0) {
//return (blck >> 16) * (blck & 0xFFFF);
throw 43;
}
if (blck >= 0x10000) abort('unexpected blck size');
if (blck === 0) blck = 0x10000;
addr = addr & 0x001fffff;
let transferSize = blck;
while (--blck >= 1) {
const next = (addr - 4) & 0x001fffff;
ram.setInt32(addr, next, true);
addr = next;
}
ram.setInt32(addr, 0x00ffffff, true);
// clearCodeCache(addr, transferSize << 2); // optimistice assumption (performance reasons)
return transferSize;
},
}
gpu.pckt21 = gpu.pckt20;
gpu.pckt22 = gpu.pckt20;
gpu.pckt23 = gpu.pckt20;
gpu.pckt25 = gpu.pckt24;
gpu.pckt26 = gpu.pckt24;
gpu.pckt27 = gpu.pckt24;
gpu.pckt29 = gpu.pckt28;
gpu.pckt2A = gpu.pckt28;
gpu.pckt2B = gpu.pckt28;
gpu.pckt2D = gpu.pckt2C;
gpu.pckt2E = gpu.pckt2C;
gpu.pckt2F = gpu.pckt2C;
gpu.pckt31 = gpu.pckt30;
gpu.pckt32 = gpu.pckt30;
gpu.pckt33 = gpu.pckt30;
gpu.pckt35 = gpu.pckt34;
gpu.pckt36 = gpu.pckt34;
gpu.pckt37 = gpu.pckt34;
gpu.pckt39 = gpu.pckt38;
gpu.pckt3A = gpu.pckt38;
gpu.pckt3B = gpu.pckt38;
gpu.pckt3D = gpu.pckt3C;
gpu.pckt3E = gpu.pckt3C;
gpu.pckt3F = gpu.pckt3C;
gpu.pckt41 = gpu.pckt40;
gpu.pckt42 = gpu.pckt40;
gpu.pckt43 = gpu.pckt40;
gpu.pckt44 = gpu.pckt40;
gpu.pckt45 = gpu.pckt40;
gpu.pckt46 = gpu.pckt40;
gpu.pckt47 = gpu.pckt40;
gpu.pckt49 = gpu.pckt48;
gpu.pckt4A = gpu.pckt48;
gpu.pckt4B = gpu.pckt48;
gpu.pckt4C = gpu.pckt48;
gpu.pckt4D = gpu.pckt48;
gpu.pckt4E = gpu.pckt48;
gpu.pckt4F = gpu.pckt48;
gpu.pckt51 = gpu.pckt50;
gpu.pckt52 = gpu.pckt50;
gpu.pckt53 = gpu.pckt50;
gpu.pckt54 = gpu.pckt50;
gpu.pckt55 = gpu.pckt50;
gpu.pckt56 = gpu.pckt50;
gpu.pckt57 = gpu.pckt50;
gpu.pckt59 = gpu.pckt58;
gpu.pckt5A = gpu.pckt58;
gpu.pckt5B = gpu.pckt58;
gpu.pckt5C = gpu.pckt58;
gpu.pckt5D = gpu.pckt58;
gpu.pckt5E = gpu.pckt58;
gpu.pckt5F = gpu.pckt58;
gpu.pckt61 = gpu.pckt60;
gpu.pckt62 = gpu.pckt60;
gpu.pckt63 = gpu.pckt60;
gpu.pckt65 = gpu.pckt64;
gpu.pckt66 = gpu.pckt64;
gpu.pckt67 = gpu.pckt64;
gpu.pckt69 = gpu.pckt68;
gpu.pckt6A = gpu.pckt68;
gpu.pckt6B = gpu.pckt68;
gpu.pckt71 = gpu.pckt70;
gpu.pckt72 = gpu.pckt70;
gpu.pckt73 = gpu.pckt70;
gpu.pckt75 = gpu.pckt74;
gpu.pckt76 = gpu.pckt74;
gpu.pckt77 = gpu.pckt74;
gpu.pckt79 = gpu.pckt78;
gpu.pckt7A = gpu.pckt78;
gpu.pckt7B = gpu.pckt78;
gpu.pckt7D = gpu.pckt7C;
gpu.pckt7E = gpu.pckt7C;
gpu.pckt7F = gpu.pckt7C;
for (let i = 0; i < 256; ++i) {
var packetHandlerName = 'pckt' + hex(i, 2).toUpperCase();
handlers[i] = gpu[packetHandlerName] || gpu.invalidPacketHandler;
}
for (let i = 0x81; i <= 0x9f; ++i) {
handlers[i] = gpu.pckt80;
}
for (let i = 0xA1; i <= 0xbf; ++i) {
handlers[i] = gpu.pcktA0;
}
for (let i = 0xC1; i <= 0xdf; ++i) {
handlers[i] = gpu.pcktC0;
}
gpu.info[7] = 2;
gpu.info[8] = 0;
return { gpu };
})
mdlr('enge:psx:gte', m => {
let lm;
let sf;
let isf;
let zsf3 = 0.0;
let zsf4 = 0.0;
let lzcr = 0;
const v0 = new Int32Array(4);
const v1 = new Int32Array(4);
const v2 = new Int32Array(4);
const ll = new Int32Array(9);
const lc = new Int32Array(9);
const rt = new Int32Array(9);
const zr = new Int32Array(9);
const bk = new Int32Array(3);
const fc = new Int32Array(3);
const tr = new Int32Array(3);
const rgb = new Int32Array(4);
const ir = new Float64Array(4);
const mac = new Float64Array(4);
const regs = new Int32Array(64);
const flag = new Int32Array(32);
const sx = new Int32Array(3);
const sy = new Int32Array(3);
const sz = new Int32Array(4);
const $mat = [rt, ll, lc, zr];
const $vec = [v0, v1, v2, ir];
const $add = [tr, bk, fc, zr];
const $cycles = new Map([
[0x01, 15],
[0x06, 8],
[0x0c, 6],
[0x10, 8],
[0x11, 8],
[0x12, 8],
[0x13, 19],
[0x14, 13],
[0x16, 44],
[0x1b, 17],
[0x1c, 11],
[0x1e, 14],
[0x20, 30],
// [0x28, 5],
[0x29, 8],
[0x2a, 17],
// [0x2d, 5],
[0x2e, 6],
[0x30, 23],
// [0x3d, 5],
// [0x3e, 5],
[0x3f, 39],
]);
const lim = (value, lowerBound, lowerBit, upperBound, upperBit) => {
if (value < lowerBound) { regs[0x3f] |= flag[lowerBit]; return lowerBound; }
if (value > upperBound) { regs[0x3f] |= flag[upperBit]; return upperBound; }
return value;
};
const countLeadingZeros = (value) => {
if (value & 0x80000000) {
value ^= 0xFFFFFFFF;
}
if (value === 0) {
lzcr = 32;
}
else {
for (var idx = 31; (value & (1 << idx)) === 0 && idx >= 0; --idx);
lzcr = 31 - idx;
}
};
const limit = (bit) => {
const lm = bit ? 0.0 : -32768.0;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
ir[1] = lim(mac[1], lm, 24, 32767.0, 24);
ir[2] = lim(mac[2], lm, 23, 32767.0, 23);
ir[3] = lim(mac[3], lm, 22, 32767.0, 22);
};
const overflow = () => {
if (mac[0] > (0x7fffffff >> 0)) regs[0x3f] |= flag[16];
if (mac[0] < (0x80000000 >> 0)) regs[0x3f] |= flag[15];
}
const depthCue = () => {
// [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
ir[1] = ((fc[0] * 4096.0) - mac[1]) / sf;
ir[2] = ((fc[1] * 4096.0) - mac[2]) / sf;
ir[3] = ((fc[2] * 4096.0) - mac[3]) / sf;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
ir[1] = lim(ir[1], -32768.0, 24, 32767.0, 24);
ir[2] = lim(ir[2], -32768.0, 23, 32767.0, 23);
ir[3] = lim(ir[3], -32768.0, 22, 32767.0, 22);
};
const interpolate = () => {
// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
mac[1] = (mac[1] + (ir[1] * ir[0])) / sf;
mac[2] = (mac[2] + (ir[2] * ir[0])) / sf;
mac[3] = (mac[3] + (ir[3] * ir[0])) / sf;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
limit(lm);
};
const transform = (add, mat, vec) => {
// [MAC1,MAC2,MAC3] = (Tx*1000h + Mx*Vx) SAR (sf*12)
mac[1] = ((add[0] * 4096.0) + (mat[0] * vec[1]) + (mat[1] * vec[2]) + (mat[2] * vec[3])) / sf;
mac[2] = ((add[1] * 4096.0) + (mat[3] * vec[1]) + (mat[4] * vec[2]) + (mat[5] * vec[3])) / sf;
mac[3] = ((add[2] * 4096.0) + (mat[6] * vec[1]) + (mat[7] * vec[2]) + (mat[8] * vec[3])) / sf;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
limit(lm);
};
const updateColorFifo = () => {
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
const c = rgb[3] >>> 24;
const r = lim((mac[1] / 16.0), 0.0, 21, 255.0, 21);
const g = lim((mac[2] / 16.0), 0.0, 20, 255.0, 20);
const b = lim((mac[3] / 16.0), 0.0, 19, 255.0, 19);
rgb[0] = rgb[1];
rgb[1] = rgb[2];
rgb[2] = (c << 24) | (b << 16) | (g << 8) | (r << 0);
};
/// COMMANDS
const avsz3 = () => {
// MAC0 = ZSF3*(SZ1+SZ2+SZ3)
mac[0] = zsf3 * (sz[1] + sz[2] + sz[3]);
overflow();
// OTZ  =  MAC0/1000h
regs[0x07] = lim(mac[0] / 4096.0, 0.0, 18, 65535.0, 18);
};
const avsz4 = () => {
// MAC0 =  ZSF4*(SZ0+SZ1+SZ2+SZ3)
mac[0] = zsf4 * (sz[0] + sz[1] + sz[2] + sz[3]);
overflow();
// OTZ  =  MAC0/1000h
regs[0x07] = lim(mac[0] / 4096.0, 0.0, 18, 65535.0, 18);
};
const cc = () => { // todo: validate
// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
transform(bk, lc, ir);
// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;
// [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
mac[1] = mac[1] / sf;
mac[2] = mac[2] / sf;
mac[3] = mac[3] / sf;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
limit(lm);
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const cdp = () => { // todo: validate
// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
transform(bk, lc, ir);
// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;
// [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
depthCue();
// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
interpolate();
// [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
mac[1] = mac[1] / sf;
mac[2] = mac[2] / sf;
mac[3] = mac[3] / sf;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
limit(lm);
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const dcpl = () => {
// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;
// [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
depthCue();
// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
interpolate();
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const dpcs = (rgb) => {
// [MAC1,MAC2,MAC3] = [R,G,B] SHL 16
mac[1] = ((rgb >> 0) & 0xff) * 65536.0;
mac[2] = ((rgb >> 8) & 0xff) * 65536.0;
mac[3] = ((rgb >> 16) & 0xff) * 65536.0;
// [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
depthCue();
// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
interpolate();
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const gpf = () => {
// [MAC1,MAC2,MAC3] = [0,0,0]
mac[1] = 0.0;
mac[2] = 0.0;
mac[3] = 0.0;
// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
interpolate();
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const gpl = () => {
// [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SHL (sf*12)
mac[1] = mac[1] * sf;
mac[2] = mac[2] * sf;
mac[3] = mac[3] * sf;
// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
interpolate();
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const intpl = () => {
// [MAC1,MAC2,MAC3] = [IR1,IR2,IR3] SHL 12
mac[1] = ir[1] * 4096.0;
mac[2] = ir[2] * 4096.0;
mac[3] = ir[3] * 4096.0;
// [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
depthCue();
// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
interpolate();
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const mvmva = (commandId) => {
const mat = $mat[(commandId >> 17) & 3];
const vec = $vec[(commandId >> 15) & 3];
const add = $add[(commandId >> 13) & 3];
transform(add, mat, vec);
};
const nccs = (vec) => {
// [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
transform(zr, ll, vec);
// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
transform(bk, lc, ir);
// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;
// [MAC1,MAC2,MAC3] = [MAC1,MAC2,MAC3] SAR (sf*12)
mac[1] = mac[1] / sf;
mac[2] = mac[2] / sf;
mac[3] = mac[3] / sf;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
limit(lm);
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const ncds = (vec) => {
// [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
transform(zr, ll, vec);
// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
transform(bk, lc, ir);
// [MAC1,MAC2,MAC3] = [R*IR1,G*IR2,B*IR3] SHL 4
mac[1] = (((rgb[3] >> 0) & 0xff) * ir[1]) * 16.0;
mac[2] = (((rgb[3] >> 8) & 0xff) * ir[2]) * 16.0;
mac[3] = (((rgb[3] >> 16) & 0xff) * ir[3]) * 16.0;
// [IR1,IR2,IR3] = (([RFC,GFC,BFC] SHL 12) - [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
depthCue();
// [MAC1,MAC2,MAC3] = (([IR1,IR2,IR3] * IR0) + [MAC1,MAC2,MAC3]) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
interpolate();
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const nclip = () => {
// MAC0 = SX0*SY1 + SX1*SY2 + SX2*SY0 - SX0*SY2 - SX1*SY0 - SX2*SY1
mac[0] = sx[0] * (sy[1] - sy[2]) + sx[1] * (sy[2] - sy[0]) + sx[2] * (sy[0] - sy[1]);
overflow();
};
const ncs = (vec) => {
// [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
transform(zr, ll, vec);
// [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
transform(bk, lc, ir);
// Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE]
updateColorFifo();
};
const op = () => {
// [MAC1,MAC2,MAC3] = [IR3*D2-IR2*D3, IR1*D3-IR3*D1, IR2*D1-IR1*D2] SAR (sf*12)
mac[1] = ((ir[3] * rt[4]) - (ir[2] * rt[8])) / sf;
mac[2] = ((ir[1] * rt[8]) - (ir[3] * rt[0])) / sf;
mac[3] = ((ir[2] * rt[0]) - (ir[1] * rt[4])) / sf;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
limit(lm);
};
const MAXRTPS = 8796093022207;
const MINRTPS = -8796093022208;
const rtps = (vec) => {
const h = regs[0x3a] & 0xffff;
const ofx = regs[0x38];
const ofy = regs[0x39];
const dqa = regs[0x3b];
const dqb = regs[0x3c];
// [MAC1,MAC2,MAC3] = (TR*1000h + RT*Vx) SAR (sf*12)
mac[1] = ((tr[0] * 4096.0) + (rt[0] * vec[1]) + (rt[1] * vec[2]) + (rt[2] * vec[3])) / sf;
if (mac[1] > MAXRTPS) regs[0x3f] |= flag[30];
if (mac[1] < MINRTPS) regs[0x3f] |= flag[27];
mac[2] = ((tr[1] * 4096.0) + (rt[3] * vec[1]) + (rt[4] * vec[2]) + (rt[5] * vec[3])) / sf;
if (mac[2] > MAXRTPS) regs[0x3f] |= flag[29];
if (mac[2] < MINRTPS) regs[0x3f] |= flag[26];
mac[3] = ((tr[2] * 4096.0) + (rt[6] * vec[1]) + (rt[7] * vec[2]) + (rt[8] * vec[3])) / sf;
if (mac[3] > MAXRTPS) regs[0x3f] |= flag[28];
if (mac[3] < MINRTPS) regs[0x3f] |= flag[25];
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
limit(lm);
sx[0] = sx[1];
sx[1] = sx[2];
sy[0] = sy[1];
sy[1] = sy[2];
sz[0] = sz[1];
sz[1] = sz[2];
sz[2] = sz[3];
let zs3 = mac[3] / isf;
sz[3] = lim(zs3, 0.0, 18, 65535.0, 18);
let hsz3 = 131072.0;
hsz3 = ((h * 131072.0 / sz[3]) + 1.0) / 2.0;
if (hsz3 > 131071.0) {
regs[0x3f] |= flag[17];
hsz3 = 131071.0;
}
mac[0] = (hsz3 * ir[1]) + ofx; sx[2] = mac[0] / 65536.0;
overflow();
mac[0] = (hsz3 * ir[2]) + ofy; sy[2] = mac[0] / 65536.0;
overflow();
mac[0] = (hsz3 * dqa) + dqb; ir[0] = mac[0] / 4096.0;
overflow();
sx[2] = lim(sx[2], -1024.0, 14, 1023.0, 14);
sy[2] = lim(sy[2], -1024.0, 13, 1023.0, 13);
ir[0] = lim(ir[0], 0.0, 12, 4096.0, 12);
};
const sqr = () => {
//[MAC1,MAC2,MAC3] = [IR1*IR1,IR2*IR2,IR3*IR3] SHR (sf*12)
mac[1] = (ir[1] * ir[1]) / sf;
mac[2] = (ir[2] * ir[2]) / sf;
mac[3] = (ir[3] * ir[3]) / sf;
// [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
limit(lm);
};
const s16lo = data => (data << 16) >> 16;
const s16hi = data => (data << 0) >> 16;
const s32 = data => (data << 0) >> 0;
const u16lo = data => (data << 16) >>> 16;
const gte = {
get: (regId) => {
switch (regId) {
case 0x07: return u16lo(regs[regId]);
case 0x08: return s16lo(ir[0]);
case 0x09: return s16lo(ir[1]);
case 0x0a: return s16lo(ir[2]);
case 0x0b: return s16lo(ir[3]);
case 0x0c: return (sx[0] & 0xffff) | (sy[0] << 16);
case 0x0d: return (sx[1] & 0xffff) | (sy[1] << 16);
case 0x0e: return (sx[2] & 0xffff) | (sy[2] << 16);
case 0x0f: return (sx[2] & 0xffff) | (sy[2] << 16);
case 0x10: return u16lo(sz[0]);
case 0x11: return u16lo(sz[1]);
case 0x12: return u16lo(sz[2]);
case 0x13: return u16lo(sz[3]);
case 0x14: return rgb[0];
case 0x15: return rgb[1];
case 0x16: return rgb[2];
case 0x18: return mac[0];
case 0x19: return mac[1];
case 0x1a: return mac[2];
case 0x1b: return mac[3];
case 0x1d: let value = 0;
value |= ((ir[1] >> 7) << 0);
value |= ((ir[2] >> 7) << 5);
value |= ((ir[3] >> 7) << 10);
return value;
case 0x1f: return lzcr;
case 0x3a: return s16lo(regs[regId]);
default: return regs[regId];
}
},
set: (regId, data) => {
regs[regId] = data;
switch (regId) {
case 0x00: v0[1] = s16lo(data); v0[2] = s16hi(data); break;
case 0x01: v0[3] = s16lo(data); break;
case 0x02: v1[1] = s16lo(data); v1[2] = s16hi(data); break;
case 0x03: v1[3] = s16lo(data); break;
case 0x04: v2[1] = s16lo(data); v2[2] = s16hi(data); break;
case 0x05: v2[3] = s16lo(data); break;
case 0x06: rgb[3] = data; break;
case 0x07: break;
case 0x08: ir[0] = s16lo(data); break;
case 0x09: ir[1] = s16lo(data); break;
case 0x0a: ir[2] = s16lo(data); break;
case 0x0b: ir[3] = s16lo(data); break;
case 0x0c: sx[0] = s16lo(data); sy[0] = s16hi(data); break;
case 0x0d: sx[1] = s16lo(data); sy[1] = s16hi(data); break;
case 0x0e: sx[2] = s16lo(data); sy[2] = s16hi(data); break;
case 0x0f: sx[0] = sx[1]; sy[0] = sy[1];
sx[1] = sx[2]; sy[1] = sy[2];
sx[2] = s16lo(data); sy[2] = s16hi(data);
break;
case 0x10: sz[0] = u16lo(data); break;
case 0x11: sz[1] = u16lo(data); break;
case 0x12: sz[2] = u16lo(data); break;
case 0x13: sz[3] = u16lo(data); break;
case 0x14: rgb[0] = data; break;
case 0x15: rgb[1] = data; break;
case 0x16: rgb[2] = data; break;
case 0x17: break;
case 0x18: mac[0] = s32(data); break;
case 0x19: mac[1] = s32(data); break;
case 0x1a: mac[2] = s32(data); break;
case 0x1b: mac[3] = s32(data); break;
case 0x1c: ir[1] = (data & 0x001f) << 7;
ir[2] = (data & 0x03e0) << 2;
ir[3] = (data & 0x7c00) >> 3;
break;
case 0x1d: break; // readonly
case 0x1e: countLeadingZeros(data); break;
case 0x1f: break; // readonly
case 0x20: rt[0] = s16lo(data); rt[1] = s16hi(data); break;
case 0x21: rt[2] = s16lo(data); rt[3] = s16hi(data); break;
case 0x22: rt[4] = s16lo(data); rt[5] = s16hi(data); break;
case 0x23: rt[6] = s16lo(data); rt[7] = s16hi(data); break;
case 0x24: regs[regId] = rt[8] = s16lo(data); break;
case 0x25: tr[0] = s32(data); break;
case 0x26: tr[1] = s32(data); break;
case 0x27: tr[2] = s32(data); break;
case 0x28: ll[0] = s16lo(data); ll[1] = s16hi(data); break;
case 0x29: ll[2] = s16lo(data); ll[3] = s16hi(data); break;
case 0x2a: ll[4] = s16lo(data); ll[5] = s16hi(data); break;
case 0x2b: ll[6] = s16lo(data); ll[7] = s16hi(data); break;
case 0x2c: regs[regId] = ll[8] = s16lo(data); break;
case 0x2d: bk[0] = s32(data); break;
case 0x2e: bk[1] = s32(data); break;
case 0x2f: bk[2] = s32(data); break;
case 0x30: lc[0] = s16lo(data); lc[1] = s16hi(data); break;
case 0x31: lc[2] = s16lo(data); lc[3] = s16hi(data); break;
case 0x32: lc[4] = s16lo(data); lc[5] = s16hi(data); break;
case 0x33: lc[6] = s16lo(data); lc[7] = s16hi(data); break;
case 0x34: regs[regId] = lc[8] = s16lo(data); break;
case 0x35: fc[0] = s32(data); break;
case 0x36: fc[1] = s32(data); break;
case 0x37: fc[2] = s32(data); break;
case 0x38: regs[regId] = s32(data); break;
case 0x39: regs[regId] = s32(data); break;
case 0x3a: regs[regId] = u16lo(data); break;
case 0x3b: regs[regId] = s16lo(data); break;
case 0x3c: regs[regId] = s32(data); break;
case 0x3d: regs[regId] = zsf3 = s16lo(data); break;
case 0x3e: regs[regId] = zsf4 = s16lo(data); break;
case 0x3f: regs[regId] = data & 0x7ffff000;
if (regs[regId] & 0x7f87e000) {
regs[regId] |= 0x80000000;
}
break;
default: abort(hex(regId, 2));
}
},
command: (commandId) => {
sf = (commandId >> 19) & 1 ? 4096.0 : 1.0;
isf = (commandId >> 19) & 1 ? 1.0 : 4096.0;
lm = (commandId >> 10) & 1;
regs[0x3f] = 0;
$command.get(commandId & 0x3f)(commandId);
},
cycles: (commandId) => $cycles.get(commandId & 0x3f) || 5
};
const f1 = f => { f(v0) };
const f3 = f => { f(v0); f(v1); f(v2) };
const $command = new Map([
[0x01, _ => f1(rtps)],
[0x06, _ => nclip()],
[0x0c, _ => op()],
[0x10, _ => dpcs(rgb[3])],
[0x11, _ => intpl()],
[0x12, _ => mvmva(_)],
[0x13, _ => f1(ncds)],
[0x14, _ => cdp()],
[0x16, _ => f3(ncds)],
[0x1b, _ => f1(nccs)],
[0x1c, _ => cc()],
[0x1e, _ => f1(ncs)],
[0x20, _ => f3(ncs)],
[0x28, _ => sqr()],
[0x29, _ => dcpl()],
[0x2a, _ => {dpcs(rgb[0]); dpcs(rgb[0]); dpcs(rgb[0])}],
[0x2d, _ => avsz3()],
[0x2e, _ => avsz4()],
[0x30, _ => f3(rtps)],
[0x3d, _ => gpf()],
[0x3e, _ => gpl()],
[0x3f, _ => f3(nccs)],
]);
// flag bits
for (let i = 0; i <= 31; ++i) {
flag[i] = (1 << i);
}
for (let i = 23; i <= 30; ++i) {
flag[i] |= 0x80000000;
}
for (let i = 13; i <= 18; ++i) {
flag[i] |= 0x80000000;
}
return { gte };
})
mdlr('enge:psx:mmu', m => {
const irqDebug = new URLSearchParams(window.location.search).has('debug-cd');
const irqLog = (...args) => {
if (irqDebug) console.debug('[IRQ]', ...args);
};
const { dma } = m.require('enge:psx:dma');
const { rtc } = m.require('enge:psx:rtc');
window.dma = dma; // todo: fix this dependency of mdec
const map = new Int32Array(0x02000000 >> 2);
const map8 = new Int8Array(map.buffer);
const map16 = new Int16Array(map.buffer);
const ram = new DataView(map.buffer, 0, 2 * 1024 * 1024);
const rom = new DataView(map.buffer, 0x01c00000, 512 * 1024);
const hwRead8 = (addr) => {
const reg = addr & 0x3fff;
psx.clock += 3;
switch (true) {
case reg >= 0x1080 && reg < 0x1100:
return dma.rd08(reg);
case reg >= 0x1100 && reg < 0x1130:
return rtc.rd32(reg);
case reg >= 0x1C00 && reg < 0x2000:
return !(reg & 1) && spu.getInt16(reg);
}
switch (addr & 0x3fff) {
case 0x2080: return 0x50; // PCSX-Redux expansion ID: 'P'
case 0x2081: return 0x43; // 'C'
case 0x2082: return 0x53; // 'S'
case 0x2083: return 0x58; // 'X'
case 0x1040: return joy.rd08r1040();
case 0x1044: return (joy.rd16r1044() << 24) >> 24;
case 0x1054: return 0 >> 0;
case 0x1060: return map8[addr >>> 0] >> 0;
case 0x1070: return (cpu.istat << 24) >> 24;
case 0x1800: return cdr.rd08r1800();
case 0x1801: return cdr.rd08r1801();
case 0x1802: return cdr.rd08r1802();
case 0x1803: return cdr.rd08r1803();
case 0x1814: return gpu.rd32r1814();
case 0x1824: return mdc.rd32r1824();
default:
if (addr < 0x01801000) {
psx.clock -= 3;
return map8[addr >>> 0];
}
if (addr >= 0x01802000) {
psx.clock += 10;
return map8[addr >>> 0];
}
break;
}
}
const memRead8 = (base) => {
if (base < 0x00800000) {
psx.clock += 2;
return ram.getInt8(base & 0x001fffff);
}
if ((base >= 0x01800000) && (base < 0x01803000)) {
return (hwRead8(base) << 24) >> 24;
}
if (base >= 0x01A00000 && base < 0x01A80000) {
psx.clock += 5;
return map8[base >>> 0] >> 0;
}
if (base >= 0x01C00000 && base < 0x01C80000) {
psx.clock += 8;
return map8[base >>> 0] >> 0;
}
if (base >= 0x01000000 && base < 0x01080000) {
psx.clock += 6;
return map8[base >>> 0] >> 0;
}
if (base === 0x01fe0130) {
return map8[base >>> 0] >> 0;
}
abort(hex(base, 8));
}
const hwRead16 = (addr) => {
const reg = addr & 0x3fff;
psx.clock += 3;
switch (true) {
case reg >= 0x1080 && reg < 0x1100:
return dma.rd16(reg);
case reg >= 0x1100 && reg < 0x1130:
return rtc.rd32(reg);
case reg >= 0x1C00 && reg < 0x2000:
return spu.getInt16(reg);
}
switch (addr & 0x3fff) {
case 0x1014: return map16[addr >>> 1];
case 0x1044: return joy.rd16r1044();
case 0x104a: return joy.rd16r104a();
case 0x104e: return joy.rd16r104e();
case 0x1054: return 0x00;
case 0x105a: return 0;
case 0x105e: return 0;
case 0x1060: return map16[addr >>> 1] >> 0;
case 0x1070: return cpu.istat;
case 0x1074: return cpu.imask;
case 0x1130: return 0;
case 0x1800: return cdr.rd08r1800();
case 0x1814: return gpu.rd32r1814();
case 0x1824: return mdc.rd32r1824();
default:
if (addr < 0x01801000) {
psx.clock -= 3;
return map16[addr >>> 1];
}
if (addr >= 0x01802000) {
psx.clock += 24;
return map16[addr >>> 1];
}
break;
}
}
const memRead16 = (base) => {
if (base < 0x00800000) {
psx.clock += 3;
return ram.getInt16(base & 0x001fffff, true);
// return map16[(base & 0x001fffff) >>> 1];
}
if ((base >= 0x01800000) && (base < 0x01803000)) {
return (hwRead16(base) << 16) >> 16;
}
if (base >= 0x01A00000 && base < 0x01A80000) {
psx.clock += 5;
return map16[base >>> 1] >> 0;
}
if (base >= 0x01C00000 && base < 0x01C80000) {
psx.clock += 12;
return map16[base >>> 1];
}
if (base >= 0x01000000 && base < 0x01080000) {
psx.clock += 12;
return map16[base >>> 1];
}
if (base === 0x01fe0130) {
return map16[base >>> 1] >> 0;
}
abort(hex(base, 8));
}
const hwRead32 = (addr) => {
const reg = addr & 0x3fff;
psx.clock += 3;
switch (true) {
case reg >= 0x1080 && reg < 0x1100:
return dma.rd32(reg);
case reg >= 0x1100 && reg < 0x1130:
return rtc.rd32(reg);
// case reg >= 0x1C00 && reg < 0x2000:
//   spu.setInt16(reg, data >>> 0);
//   return;
}
switch (addr & 0x3fff) {
case 0x1014: return map[addr >>> 2] >> 0;
case 0x1020: return map[addr >>> 2] >> 0;
case 0x101c: return 0x00070777; // EXP2_DELAY_SIZE / DEV8 delay
case 0x2080: return 0x58534350; // PCSX-Redux expansion ID: 'PCSX'
case 0x1044: return joy.rd16r1044() >> 0;
case 0x1054: return 0x00;
case 0x1060: return map[addr >>> 2] >> 0;
case 0x1070: return cpu.istat >> 0;
case 0x1074: return cpu.imask >> 0;
case 0x1800: return cdr.rd08r1800();
case 0x1810: return gpu.rd32r1810() >> 0;
case 0x1814: return gpu.rd32r1814() >> 0;
case 0x1820: return mdc.rd32r1820() >> 0;
case 0x1824: return mdc.rd32r1824() >> 0;
default:
if (addr < 0x01801000) {
psx.clock -= 3;
return map[addr >>> 2] >> 0;
}
if (addr >= 0x01802000) {
psx.clock += 56;
return map[addr >>> 2] >> 0;
}
if ((addr >= 0x01801C00) && (addr < 0x01802000)) {
return (spu.getInt16(addr & 0x3fff) & 0xffff) | (spu.getInt16((addr + 2) & 0x3fff) << 16);
}
break;
}
abort(hex(addr, 8));
}
const memRead32 = (base) => {
if (base < 0x00800000) {
psx.clock += 5;
return ram.getInt32(base & 0x001fffff, true);
// return map[(base & 0x001fffff) >>> 2] >> 0;
}
if ((base >= 0x01800000) && (base < 0x01803000)) {
return hwRead32(base) >> 0;
}
if (base >= 0x01A00000 && base < 0x01A80000) {
psx.clock += 9;
return map[base >>> 2] >> 0;
}
if (base >= 0x01C00000 && base < 0x01C80000) {
psx.clock += 24;
return map[base >>> 2] >> 0;
}
if (base === 0x01fe0130) {
return map[base >>> 2] >> 0;
}
if (base >= 0x01000000 && base < 0x01080000) {
psx.clock += 24;
return map[base >>> 2];
}
abort(hex(base, 8));
}
const hwWrite8 = (addr, data) => {
const reg = addr & 0x3fff;
switch (true) {
case reg >= 0x1080 && reg < 0x1100:
dma.wr08(reg, data);
return;
}
switch (addr & 0x3fff) {
case 0x1040: return joy.wr08r1040(data);
case 0x1800: return cdr.wr08r1800(data);
case 0x1801: return cdr.wr08r1801(data);
case 0x1802: return cdr.wr08r1802(data);
case 0x1803: return cdr.wr08r1803(data);
}
abort(hex(addr, 8));
}
const memWrite8 = (base, data) => {
if (base < 0x00800000) {
const addr = base & 0x001fffff;
map8[(addr | cpu.forceWriteBits) >>> 0] = data;
fastCache[addr] = 0;
return;
}
if ((base >= 0x01800000) && (base < 0x01802000)) {
map8[base >>> 0] = data;
if (base >= 0x01801000) hwWrite8(base, data);
return;
}
if ((base >= 0x01802000) && (base < 0x01803000)) {
// PCSX-Redux expansion/debug registers. OpenBIOS writes diagnostic
// output here; keep the access harmless for normal emulation.
map8[base >>> 0] = data;
return;
}
if (base === 0x1802041) {
map8[base >>> 0] = data;
return;
}
abort(hex(base, 8));
}
const hwWrite16 = (addr, data) => {
const reg = addr & 0x3fff;
switch (true) {
case reg >= 0x1080 && reg < 0x1100:
dma.wr16(reg, data);
return;
case reg >= 0x1100 && reg < 0x1130:
rtc.wr32(reg, data);
return;
case reg >= 0x1C00 && reg < 0x2000:
spu.setInt16(reg, data >>> 0);
return;
}
switch (addr & 0x3fff) {
case 0x1014: return map16[addr >>> 1] = data;
case 0x1048: return joy.wr16r1048(data);
case 0x104a: return joy.wr16r104a(data);
case 0x104e: return joy.wr16r104e(data);
case 0x1058: return;
case 0x105a: return;
case 0x105e: return;
case 0x1070:
cpu.istat &= ((data & 0xffff) & cpu.imask);
irqLog('I_STAT acknowledge16', `0x${(data & 0xffff).toString(16)}`, `istat=0x${(cpu.istat >>> 0).toString(16)}`);
return;
case 0x1074:
cpu.imask = data;
irqLog('I_MASK write16', `0x${(data >>> 0).toString(16)}`);
return;
}
abort(hex(addr, 8));
}
const memWrite16 = (base, data) => {
if (base < 0x00800000) {
const addr = base & 0x001fffff;
map16[(addr | cpu.forceWriteBits) >>> 1] = data;
fastCache[addr] = 0;
return;
}
if ((base >= 0x01800000) && (base < 0x01802000)) {
map16[base >>> 1] = data;
if (base >= 0x01801000) hwWrite16(base, data);
return;
}
if ((base >= 0x01802000) && (base < 0x01803000)) {
map16[base >>> 1] = data;
return;
}
abort(hex(base, 8));
}
const hwWrite32 = (addr, data) => {
const reg = addr & 0x3fff;
switch (true) {
case reg >= 0x1080 && reg < 0x1100:
dma.wr32(reg, data);
return;
case reg >= 0x1100 && reg < 0x1130:
rtc.wr32(reg, data);
return;
case reg >= 0x1C00 && reg < 0x2000:
spu.setInt16(reg + 0, data >>> 0);
spu.setInt16(reg + 2, data >>> 16);
return;
}
switch (reg) {
case 0x1000: return;
case 0x1004: return;
case 0x1008: return;
case 0x100c: return;
case 0x1010: return;
case 0x1014: return;
case 0x1018: return;
case 0x101c: return;
case 0x1020: return;
case 0x1060: return;
case 0x1070:
cpu.istat &= (data & cpu.imask);
irqLog('I_STAT acknowledge32', `0x${(data >>> 0).toString(16)}`, `istat=0x${(cpu.istat >>> 0).toString(16)}`);
return;
case 0x1074:
cpu.imask = data >>> 0;
irqLog('I_MASK write32', `0x${(data >>> 0).toString(16)}`);
return;
case 0x1810: gpu.wr32r1810(data); return;
case 0x1814: gpu.wr32r1814(data); return;
case 0x1820: mdc.wr32r1820(data); return;
case 0x1824: mdc.wr32r1824(data); return;
}
abort(hex(addr, 8));
}
const memWrite32 = (base, data) => {
if (base < 0x00800000) {
const addr = base & 0x001fffff;
map[(addr | cpu.forceWriteBits) >>> 2] = data;
fastCache[addr] = 0;
return;
}
if ((base >= 0x01800000) && (base < 0x01802000)) {
map[base >>> 2] = data;
if (base >= 0x01801000) hwWrite32(base, data);
return;
}
if ((base >= 0x01802000) && (base < 0x01803000)) {
map[base >>> 2] = data;
return;
}
if (base === 0x01fe0130) {
map[base >>> 2] = data;
return;
}
abort(hex(base, 8));
}
return {
map, map8, map16, ram, rom, memRead8, memRead16, memRead32, memWrite8, memWrite16, memWrite32
}
})
mdlr('enge:psx:rec', m => {
const getOF = (opcode) => {
const offset = ((opcode << 16) >> 16);
return `(${offset} + ${getRS()}) & 0x01ffffff`;
};
const getRS = () => {
return state.reg(state.rs);
};
const getRT = () => {
return state.reg(state.rt);
}
const setReg = (nr, value) => {
return (nr ? state.reg(nr) + ' = ' : '') + `${value};`;
};
const createFunction = (pc, code, jumps) => {
const lines = [
"  return function $" + hex(pc).toUpperCase() + "(psx) { ++calls;\n    " + code.replace(/[\r\n]/g, '\n    ') + "\n  }"
];
lines.unshift('');
const points = [...new Set(jumps?.filter(a => a) || [])];
points.forEach(addr => {
lines.unshift(`  const _${hex(addr)} = getCacheEntry(0x${hex(addr)});`);
});
lines.unshift(`'use strict;'`);
var generator = new Function(lines.join('\n'));
return generator();
}
const rec = {
'02': (rec, opc) => {
rec.stop = true;
rec.jump = true;
rec.skipNext = true;
rec.branchTarget = (opc & 0x007FFFFF) << 2;
const code = setReg(0, `target = _${hex(rec.branchTarget)}`);
return code;
},
'03': (rec, opc) => {
rec.stop = true;
rec.jump = true;
rec.branchTarget = (opc & 0x007FFFFF) << 2;
const code = setReg(0, `target = _${hex(rec.branchTarget)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
return code;
},
'04': (rec, opc) => {
rec.stop = true;
rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
const code = setReg(0, `target = (${getRS()} === ${getRT()}) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
return code;
},
'05': (rec, opc) => {
rec.stop = true;
rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
const code = setReg(0, `target = (${getRS()} !== ${getRT()}) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
return code;
},
'06': (rec, opc) => {
rec.stop = true;
rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
const code = setReg(0, `target = (${getRS()} <= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
return code;
},
'07': (rec, opc) => {
rec.stop = true;
rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
const code = setReg(0, `target = (${getRS()} > 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
return code;
},
'08': (rec, opc) => {
const code = setReg(rec.rt, ((opc << 16) >> 16) + ' + ' + getRS());
return code;
},
'09': (rec, opc) => {
const code = setReg(rec.rt, ((opc << 16) >> 16) + ' + ' + getRS());
return code;
},
'0A': (rec, opc) => {
const code = setReg(rec.rt, '(' + getRS() + ' < ' + ((opc << 16) >> 16) + ') ? 1 : 0');
return code;
},
'0B': (rec, opc) => {
const code = setReg(rec.rt, '((' + getRS() + ' >>> 0) < (' + ((opc << 16) >> 16) + ' >>> 0)) ? 1 : 0');
return code;
},
'0C': (rec, opc) => {
const code = setReg(rec.rt, getRS() + ' & 0x' + hex(opc, 4));
return code;
},
'0D': (rec, opc) => {
const code = setReg(rec.rt, getRS() + ' | 0x' + hex(opc, 4));
return code;
},
'0E': (rec, opc) => {
const code = setReg(rec.rt, getRS() + ' ^ 0x' + hex(opc, 4));
return code;
},
'0F': (rec, opc) => {
const code = setReg(rec.rt, '0x' + hex((opc & 0xffff) << 16), true);
return code;
},
'20': (rec, opc) => {
const code = setReg(rec.rt, '(memRead8(' + getOF(opc) + ') << 24) >> 24');
return code;
},
'21': (rec, opc) => {
const code = setReg(rec.rt, '(memRead16 (' + getOF(opc) + ') << 16) >> 16');
return code;
},
'22': (rec, opc) => {
const code = setReg(0, 'cpu.lwl(' + rec.rt + ', ' + getOF(opc) + ')');
return code;
},
'23': (rec, opc) => {
const code = setReg(rec.rt, 'memRead32(' + getOF(opc) + ')');
return code;
},
'24': (rec, opc) => {
const code = setReg(rec.rt, 'memRead8(' + getOF(opc) + ') & 0xff');
return code;
},
'25': (rec, opc) => {
const code = setReg(rec.rt, 'memRead16(' + getOF(opc) + ') & 0xffff');
return code;
},
'26': (rec, opc) => {
const code = setReg(0, 'cpu.lwr(' + rec.rt + ', ' + getOF(opc) + ')');
return code;
},
'28': (rec, opc) => {
const code = setReg(0, 'memWrite8(' + getOF(opc) + ', ' + getRT() + ')');
return code;
},
'29': (rec, opc) => {
const code = setReg(0, 'memWrite16(' + getOF(opc) + ', ' + getRT() + ')');
return code;
},
'2A': (rec, opc) => {
const code = setReg(0, 'cpu.swl(' + rec.rt + ', ' + getOF(opc) + ')');
return code;
},
'2B': (rec, opc) => {
const code = setReg(0, `memWrite32(${getOF(opc)}, ${getRT()})`);
return code;
},
'2E': (rec, opc) => {
const code = setReg(0, 'cpu.swr(' + rec.rt + ', ' + getOF(opc) + ')');
return code;
},
'32': (rec, opc) => {
const code = setReg(0, 'gte.set(' + rec.rt + ', memRead32(' + getOF(opc) + '))');
return code;
},
'3A': (rec, opc) => {
const code = setReg(0, 'memWrite32(' + getOF(opc) + ', gte.get(' + rec.rt + '))');
return code;
},
'40': (rec, opc) => {
if (opc === 0) return ''; // nop
const code = setReg(rec.rd, getRT() + ' << ' + ((opc >> 6) & 0x1f));
return code;
},
'42': (rec, opc) => {
const code = setReg(rec.rd, getRT() + ' >>> ' + ((opc >> 6) & 0x1f));
return code;
},
'43': (rec, opc) => {
const code = setReg(rec.rd, getRT() + ' >> ' + ((opc >> 6) & 0x1f));
return code;
},
'44': (rec, opc) => {
const code = setReg(rec.rd, getRT() + ' << (' + getRS() + ' & 0x1f)');
return code;
},
'46': (rec, opc) => {
const code = setReg(rec.rd, getRT() + ' >>> (' + getRS() + ' & 0x1f)');
return code;
},
'47': (rec, opc) => {
const code = setReg(rec.rd, getRT() + ' >> (' + getRS() + ' & 0x1f)');
return code;
},
'48': (rec, opc) => {
rec.stop = true;
rec.jump = true;
rec.skipNext = true;
const code = setReg(0, 'target = getCacheEntry(' + getRS() + ')');
return code;
},
'49': (rec, opc) => {
rec.stop = true;
rec.jump = true;
const code = setReg(rec.rd, '0x' + hex(rec.pc + 8) + ';\ntarget = getCacheEntry(' + getRS() + ')');
return code;
},
'4C': (rec, opc) => {
rec.stop = true;
rec.syscall = true;
const code = setReg(0, 'target = cpuException(8 << 2, 0x' + hex(rec.pc) + ')');
return code;
},
'4D': (rec, opc) => {
return '//break';
},
'50': (rec, opc) => {
const code = setReg(rec.rd, 'cpu.hi');
return code;
},
'51': (rec, opc) => {
const code = setReg(0, 'cpu.hi = ' + getRS());
return code;
},
'52': (rec, opc) => {
const code = setReg(rec.rd, 'cpu.lo');
return code;
},
'53': (rec, opc) => {
const code = setReg(0, 'cpu.lo = ' + getRS());
return code;
},
'58': (rec, opc) => {
const code = setReg(0, 'cpu.mult(' + getRS() + ', ' + getRT() + ')');
rec.cycles += 8;
return code;
},
'59': (rec, opc) => {
const code = setReg(0, 'cpu.multu(' + getRS() + ', ' + getRT() + ')');
rec.cycles += 8;
return code;
},
'5A': (rec, opc) => {
const code = setReg(0, 'cpu.div(' + getRS() + ', ' + getRT() + ')');
rec.cycles += 35;
return code;
},
'5B': (rec, opc) => {
const code = setReg(0, 'cpu.divu(' + getRS() + ', ' + getRT() + ')');
rec.cycles += 35;
return code;
},
'60': (rec, opc) => {
const code = setReg(rec.rd, getRS() + ' + ' + getRT());
return code;
},
'61': (rec, opc) => {
const code = setReg(rec.rd, getRS() + ' + ' + getRT());
return code;
},
'62': (rec, opc) => {
const code = setReg(rec.rd, getRS() + ' - ' + getRT());
return code;
},
'63': (rec, opc) => {
const code = setReg(rec.rd, getRS() + ' - ' + getRT());
return code;
},
'64': (rec, opc) => {
const code = setReg(rec.rd, getRS() + ' & ' + getRT());
return code;
},
'65': (rec, opc) => {
const code = setReg(rec.rd, getRS() + ' | ' + getRT());
return code;
},
'66': (rec, opc) => {
const code = setReg(rec.rd, getRS() + ' ^ ' + getRT());
return code;
},
'67': (rec, opc) => {
const code = setReg(rec.rd, '~(' + getRS() + ' | ' + getRT() + ')');
return code;
},
'6A': (rec, opc) => {
const code = setReg(rec.rd, '(' + getRS() + ' < ' + getRT() + ') ? 1 : 0');
return code;
},
'6B': (rec, opc) => {
const code = setReg(rec.rd, '((' + getRS() + ' >>> 0) < (' + getRT() + ' >>> 0)) ? 1 : 0');
return code;
},
'80': (rec, opc) => {
rec.stop = true;
rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
const code = setReg(0, `target = (${getRS()} < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
return code;
},
'81': (rec, opc) => {
rec.stop = true;
rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
const code = setReg(0, `target = (${getRS()} >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)}`);
return code;
},
'90': (rec, opc) => {
rec.stop = true;
rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
const code = setReg(0, `target = (${getRS()} < 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
return code;
},
'91': (rec, opc) => {
rec.stop = true;
rec.branchTarget = rec.pc + 4 + 4 * ((opc << 16) >> 16);
const code = setReg(0, `target = (${getRS()} >= 0) ? _${hex(rec.branchTarget)} : _${hex(rec.pc + 8)};\n` + rec.reg(31) + ' = 0x' + hex(rec.pc + 8));
return code;
},
'A0': (rec, opc) => {
const code = setReg(rec.rt, 'cpu.getCtrl(' + rec.rd + ')');
return code;
},
'A4': (rec, opc) => {
const code = setReg(0, 'cpu.setCtrl(' + rec.rd + ', ' + getRT() + ')');
return code;
},
'B0': (rec, opc) => { // simplicity
const code = setReg(0, 'cpu.rfe()');
return code;
},
'C0': (rec, opc) => {
const code = setReg(rec.rt, 'gte.get(' + rec.rd + ')');
return code;
},
'C2': (rec, opc) => {
const code = setReg(rec.rt, 'gte.get(' + (32 + rec.rd) + ')');
return code;
},
'C4': (rec, opc) => {
const code = setReg(0, 'gte.set(' + rec.rd + ', ' + getRT() + ')');
return code;
},
'C6': (rec, opc) => {
const code = setReg(0, 'gte.set(' + (32 + rec.rd) + ', ' + getRT() + ')');
return code;
},
'D0': (rec, opc) => {
rec.cycles += gte.cycles(opc & 0x1ffffff);
const code = setReg(0, 'gte.command(0x' + hex(opc & 0x1ffffff) + ')');
return code;
},
'invalid': (rec, opc) => {
abort('invalid instruction');
}
}
rec.D1 = rec.D0;
rec.D2 = rec.D0;
rec.D3 = rec.D0;
rec.D4 = rec.D0;
rec.D5 = rec.D0;
rec.D6 = rec.D0;
rec.D7 = rec.D0;
rec.D8 = rec.D0;
rec.D9 = rec.D0;
rec.DA = rec.D0;
rec.DB = rec.D0;
rec.DC = rec.D0;
rec.DD = rec.D0;
rec.DE = rec.D0;
rec.DF = rec.D0;
const recmap = new Array(256);
for (let i = 0; i < 256; ++i) {
recmap[i] = rec[`${hex(i, 2).toUpperCase()}`] || rec.invalid;
}
function compileInstruction(state, lines) {
const iwordIndex = getCacheIndex(state.pc);
const opcode = map[iwordIndex >> 2];
let opc = 0;
switch ((opcode >>> 26) & 0x3f) {
default: opc = 0x00 + ((opcode >>> 26) & 0x3f); break;
case 0x00: opc = 0x40 + ((opcode >>> 0) & 0x3f); break;
case 0x01: opc = 0x80 + ((opcode >>> 16) & 0x1f); break;
case 0x10: opc = 0xA0 + ((opcode >>> 21) & 0x1f); break;
case 0x12: opc = 0xC0 + ((opcode >>> 21) & 0x1f); break;
}
state.rd = (opcode >>> 11) & 0x1F;
state.rs = (opcode >>> 21) & 0x1F;
state.rt = (opcode >>> 16) & 0x1F;
lines.push(recmap[opc](state, opcode));
}
const state = {
'pc': 0,
'rt': 0,
'rs': 0,
'rd': 0,
'stop': false,
'break': false,
'syscall': false,
'cause': false,
'sr': false,
'cycles': 0,
'skipNext': false,
entry: null,
branchTarget: 0,
jump: false,
entryPC: 0,
reg: (r) => {
return r ? 'gpr[' + r + ']' : '0';
},
clear: function () {
state.branchTarget = 0;
state.jump = false;
state.stop = false;
state.break = false;
state.syscall = false;
state.cause = false;
state.sr = false;
state.cycles = 0;
state.skipNext = false;
}
};
const compileBlockLines = (entry) => {
const pc = entry.pc >>> 0;
state.clear();
state.pc = pc;
state.entryPC = pc;
state.entry = entry;
const lines = [];
// todo: limit the amount of cycles per block
while (!state.stop && state.cycles < 2048) {
compileInstruction(state, lines, false);
state.cycles += 1;
state.pc += 4;
}
if (!state.stop && state.cycles >= 64) {
state.branchTarget = (state.pc >>> 0) & 0x01ffffff;
state.skipNext = true;
state.jump = true;
const code = setReg(0, `target = _${hex(state.branchTarget)}`);
lines.push(code);
// console.log('abort', lines);
// debugger;
}
if (state.stop && (!state.break && !state.syscall && !state.sr)) {
compileInstruction(state, lines, true);
state.cycles += 1;
state.pc += 4;
}
if (pc === 0xa0 || pc === 0xb0 || pc === 0xc0) {
lines.unshift(`trace(${pc}, gpr[9]);`);
}
lines.push('psx.clock += ' + state.cycles + ';');
return lines;
}
const compileBlock = (entry) => {
const pc = entry.pc >>> 0;
let lines = compileBlockLines(entry).join('\n').split('\n');
// entry.jump = getCacheEntry(state.branchTarget);
// entry.next = state.skipNext ? null : getCacheEntry(state.pc);
let jumps = [
state.branchTarget >>> 0,
state.skipNext ? 0 : state.pc >>> 0,
// pc
].filter(a => a !== null || a !== undefined);
lines.push(' ');
lines.push('return target;');
// lines.unshift(`const gpr = cpu.gpr; let target = _${hex(pc)};\n`);
lines.unshift(`const gpr = cpu.gpr; let target;\n`);
if (pc < 0x00200000) {
lines.unshift(`if (!fastCache[${pc}]) { return invalidateCache(this); }`);
fastCache[pc] = 1;
}
return createFunction(pc, lines.filter(a => a).join('\n'), jumps);
}
const cached = new Map();
const fastCache = new Uint8Array(0x00200000);
fastCache.fill(0);
function getCacheIndex(pc) {
let ipc = pc & 0x01ffffff;
if (ipc < 0x800000) ipc &= 0x1fffff;
return ipc;
}
let clears = 0;
function clearCodeCache(addr, size) {
const ibase = getCacheIndex(addr);
if (ibase < 0x00200000) {
fastCache.fill(0, ibase, ibase + size);
}
// The BIOS is mapped above the fast-cache range.  Its translated blocks
// live in the Map cache, so replacing a BIOS must evict those entries too.
for (const pc of cached.keys()) {
if (pc >= ibase && pc < ibase + size) cached.delete(pc);
}
++clears;
}
function lazyCompile() {
this.code = compileBlock(this);
return this;
}
function getCacheEntry(pc) {
const lutIndex = getCacheIndex(pc);
let entry = cached.get(lutIndex);
if (!entry) {
cached.set(lutIndex, entry = CacheEntryFactory.createCacheEntry(lutIndex));
entry.code = lazyCompile;
}
return entry;
}
const CacheEntryFactory = {
createCacheEntry: pc => ({
pc: pc >>> 0,
code: null,
// jump: null,
// next: null,
})
};
const cyclesPerTrace = 33868800;
const local = window.location.href.indexOf('file://') === 0;
let prevCounter = 0;
let prevFpsCounter = 0;
let prevFpsRenderCounter = 0;
psx.addEvent(0, self => {
const renderCounter = renderer.fpsRenderCounter - prevFpsRenderCounter;
prevFpsRenderCounter = renderer.fpsRenderCounter;
if (local) console.log(`${calls} ${(cyclesPerTrace / calls).toFixed(1)} ${clears} ${context.counter - prevCounter}/${renderer.fpsCounter - prevFpsCounter}/${renderCounter}`);
psx.setEvent(self, cyclesPerTrace);
prevCounter = context.counter;
prevFpsCounter = renderer.fpsCounter;
clears = 0;
calls = 0;
});
window.calls = 0;
window.vector = null;
window.fastCache = fastCache;
window.cached = cached;
window.invalidateCache = entry => {
entry.code = lazyCompile;
return entry;
}
window.resetCacheEntry = entry => {
entry.code = lazyCompile;
return entry;
}
return {
getCacheEntry,
clearCodeCache,
}
})
mdlr('enge:psx:spu', m => {
const reverb = m.require('enge:psx:spu-reverb');
const frameCount = (1.0 * 44100) >> 1;
const memory = new Uint8Array(512 * 1024);
const voices = new Array(24);
const view = new DataView(memory.buffer);
const regs = new Map;
const init = () => {
const context = new AudioContext();
const gainNode = context.createGain();
const buffer = context.createBuffer(2, frameCount, context.sampleRate);
const source = context.createBufferSource();
left = buffer.getChannelData(0);
left.fill(0);
right = buffer.getChannelData(1);
right.fill(0)
source.playbackRate.value = 44100 / context.sampleRate;
source.buffer = buffer;
source.loop = true;
source.connect(gainNode);
gainNode.connect(context.destination);
source.start();
spu.setVolume = (volume) => gainNode.gain.setValueAtTime(volume, context.currentTime);
spu.setVolume(0.75);
}
psx.addEvent(0, (self) => {
psx.updateEvent(self, 768); // 1 sample
if (!left || !right) return;
SPUSTAT &= ~(0x003F);
SPUSTAT |= (SPUSTATm & 0x003F);
++totalSamples;
let l = 0, r = 0;
const captureIndex = (totalSamples % 0x200) << 1;
spu.checkIrq();
let audio = [0.0, 0.0];
let reverbLeft = 0.0, reverbRight = 0.0;
for (let voice of voices) {
if (!voice.advance(memory, audio)) continue;
l += audio[0];
r += audio[1];
if (voice.reverb) {
reverbLeft += audio[0];
reverbRight += audio[1];
}
if (voice.capture) {
// todo: verify cacpture left or right channel
const mono = (audio[0] * 0x8000) >> 0;
view.setInt16(voice.capture + captureIndex, mono, true);
}
}
var cdxa = [0.0, 0.0];
cdr.nextpcm(cdxa);
let cdSampleL = (cdxa[0] * cdVolumeLeft);
let cdSampleR = (cdxa[1] * cdVolumeRight);
{
const mono = (cdSampleL * 0x8000) >>> 0;
view.setInt16(0x0000 + captureIndex, mono, true);
}
{
const mono = (cdSampleR * 0x8000) >>> 0;
view.setInt16(0x0400 + captureIndex, mono, true);
}
l += cdSampleL;
r += cdSampleR;
if (SPUCNT & 0x04) {
reverbLeft += cdSampleL;
reverbRight += cdSampleR;
}
if (SPUCNT & 0x80) {
const [rl, rr] = reverb.advance(totalSamples, reverbLeft, reverbRight, view);
l += rl;
r += rr;
}
l = (l * mainVolumeLeft);
r = (r * mainVolumeRight);
left[writeIndex] = l;//Math.max(Math.min(l, 1.0), -1.0);
right[writeIndex] = r;//Math.max(Math.min(r, 1.0), -1.0);
writeIndex = (writeIndex + 1) % frameCount;
if (captureIndex === 0x000) {
SPUSTAT &= ~0x0800;
}
if (captureIndex === 0x200) {
SPUSTAT |= 0x0800;
}
});
let left = null;
let right = null;
let ramOffset = 0;
let irqOffset = 0;
let writeIndex = (44100 * 0.125) >> 0;
let totalSamples = 0;
let SPUCNT = 0x0000;
let SPUSTAT = 0x0000;
let SPUSTATm = 0x0000;
let mainVolumeLeft = 0.0;
let mainVolumeRight = 0.0;
let cdVolumeLeft = 0.0;
let cdVolumeRight = 0.0;
let extVolumeLeft = 0.0;
let extVolumeRight = 0.0;
let spu = {
ENDX: 0x00ffffff,
silence: () => {
if (left && right) {
for (var i = 0; i < frameCount; ++i) {
left[i] = right[i] = 0.0;
}
}
},
getVolume: data => {
return Math.abs((data << 17) >> 16) / 0x8000;
},
getInt16: addr => {
switch (addr) {
case 0x1daa: return SPUCNT;
case 0x1dae: return (SPUSTAT & ~0x3f) | (SPUCNT & 0x3f);
case 0x1d9c: return spu.ENDX;
default:
if ((addr >= 0x1c00) && (addr < 0x1d80)) {
const id = (addr - 0x1c00) >> 4;
return voices[id].rd16(addr & 0xf);
}
if ((addr >= 0x1dc0) && (addr < 0x1e00)) {
return reverb.rd16(addr);
}
return regs.get(addr);
}
},
setInt16: (addr, data) => {
data &= 0xffff;
regs.set(addr, data);
switch (addr) {
case 0x1d80:
mainVolumeLeft = spu.getVolume(data);
break;
case 0x1d82:
mainVolumeRight = spu.getVolume(data);
break;
case 0x1d84:
reverb.wr16(addr, data);
break;
case 0x1d86:
reverb.wr16(addr, data);
break;
case 0x1d88: for (let i = 0; i < 16; ++i) {
if ((data & (1 << i)) === 0) continue;
voices[i].keyOn()
spu.ENDX &= ~(1 << i);
}
break
case 0x1d8a: for (let i = 0; i < 8; ++i) {
if ((data & (1 << i)) === 0) continue;
voices[16 + i].keyOn()
spu.ENDX &= ~(1 << (16 + i));
}
break
case 0x1d8c: for (let i = 0; i < 16; ++i) {
if ((data & (1 << i)) === 0) continue;
voices[i].keyOff()
}
break
case 0x1d8e: for (let i = 0; i < 8; ++i) {
if ((data & (1 << i)) === 0) continue;
voices[16 + i].keyOff()
}
break
case 0x1d90: for (let i = 0; i < 16; ++i) {
if ((data & (1 << i)) === 0) continue;
voices[i].modOn()
}
break
case 0x1d92: for (let i = 0; i < 8; ++i) {
if ((data & (1 << i)) === 0) continue;
voices[16 + i].modOn()
}
break
case 0x1d94: for (let i = 0; i < 16; ++i) {
if ((data & (1 << i)) === 0) continue;
voices[i].noiseOn()
}
break
case 0x1d96: for (let i = 0; i < 8; ++i) {
if ((data & (1 << i)) === 0) continue;
voices[16 + i].noiseOn()
}
break
case 0x1d98: for (let i = 0; i < 16; ++i) {
// if ((data & (1 << i)) === 0) continue;
voices[i].echoOn(data & (1 << i))
}
break
case 0x1d9a: for (let i = 0; i < 8; ++i) {
// if ((data & (1 << i)) === 0) continue;
voices[16 + i].echoOn(data & (1 << i))
}
break
case 0x1d9c:  // readonly Voice 0..15 on/off
break
case 0x1d9e:  // readonly Voice 16..23 on/off
break
case 0x1da0:  // ??? Legend of Dragoon
break
case 0x1da2:
reverb.wr16(addr, data);
break
case 0x1da4: irqOffset = data << 3;
break
case 0x1da6: ramOffset = data << 3;
break
case 0x1da8:
ramOffset = ramOffset % memory.byteLength;
view.setInt16(ramOffset, data, true);
ramOffset += 2;
spu.checkIrq();
break
case 0x1dac: break
case 0x1daa:
if (!(SPUCNT & 0x80) && (data & 0x80)) {
console.log('reverb', 'on');
}
if ((SPUCNT & 0x80) && !(data & 0x80)) {
console.log('reverb', 'off');
}
SPUCNT = data;
if ((!left || !right) && SPUCNT & 0x8000) {
init();
}
if (SPUCNT & (1 << 6)) {
SPUSTAT &= ~(0x0040);
}
// todo: delayed application of bits 0-5
SPUSTATm = (SPUCNT & 0x003F);
break
case 0x1dae:  // SPUSTAT (read-only)
break
case 0x1db0:
cdVolumeLeft = ((data << 16) >> 16) / 0x8000;
break
case 0x1db2:
cdVolumeRight = ((data << 16) >> 16) / 0x8000;
break
case 0x1db4:
extVolumeLeft = ((data << 16) >> 16) / 0x8000;
break
case 0x1db6:
extVolumeRight = ((data << 16) >> 16) / 0x8000;
break
case 0x1db8:  // ??? Legend of Dragoon
break
case 0x1dba:  // ??? Legend of Dragoon
break
case 0x1dbc:  // ??? Legend of Dragoon
break
case 0x1dbe:  // ??? Legend of Dragoon
break
default:
if ((addr >= 0x1c00) && (addr < 0x1d80)) {
const id = (addr - 0x1c00) >>> 4;
const voice = voices[id];
voice.wr16(addr & 15, data);
break;
}
if ((addr >= 0x1dc0) && (addr < 0x1e00)) {
reverb.wr16(addr, data);
break;
}
console.log('spu.setInt16:', hex(addr, 4), hex(data));
// abort(hex(addr, 4));
}
},
dmaTransferMode0200: (addr, blck) => {
if (!(addr & 0x007fffff)) return 0x10;
let transferSize = ((blck >> 16) * (blck & 0xFFFF) * 4) >>> 0;
// clearCodeCache(addr, transferSize); // optimistice assumption (performance reasons)
while (transferSize > 0) {
ramOffset = ramOffset % memory.byteLength;
const data = view.getInt16(ramOffset, true);
map16[(addr & 0x001fffff) >>> 1] = data;
ramOffset += 2;
transferSize -= 2;
addr += 2;
}
return (blck >> 16) * (blck & 0xFFFF);
},
dmaTransferMode0201: (addr, blck) => {
if (!(addr & 0x007fffff)) return 0x10;
let transferSize = ((blck >> 16) * (blck & 0xFFFF) * 4) >>> 0;
while (transferSize > 0) {
ramOffset = ramOffset % memory.byteLength;
const data = map16[(addr & 0x001fffff) >>> 1];
view.setInt16(ramOffset, data, true);
spu.checkIrq();
ramOffset += 2;
transferSize -= 2;
addr += 2;
}
return (blck >> 16) * (blck & 0xFFFF);
},
checkIrq: voice => {
if ((SPUCNT & 0x8040) !== 0x8040) return;
const captureIndex = (totalSamples % 0x200) << 1;
let irq = false;
if (voice !== undefined) {
irq = voice.checkIrq(irqOffset);
}
else {
if (ramOffset === irqOffset) {
irq = true;
}
if (captureIndex === irqOffset) {
irq = true;
}
}
if (irq) {
cpu.istat |= 0x200;
SPUSTAT |= 0x0040;
}
}
}
//- init
for (let i = 0; i < 24; ++i) {
// mdlr does not cache compiled modules, so this works perfectly
const { voice } = m.require('enge:psx:spu-voice');
voices[i] = voice.setId(i);
}
//- lookup tables
const xa2flt = new Float32Array(16 * 2);
xa2flt.fill(0.0);
xa2flt[2] = 60 / 64; xa2flt[3] = 0 / 64; //- [K0:+0.953125][K1:+0.000000]
xa2flt[4] = 115 / 64; xa2flt[5] = -52 / 64; //- [K0:+1.796875][K1:-0.812500]
xa2flt[6] = 98 / 64; xa2flt[7] = -55 / 64; //- [K0:+1.531250][K1:-0.859375]
xa2flt[8] = 122 / 64; xa2flt[9] = -60 / 64; //- [K0:+1.906250][K1:-0.937500]
const xa2pcm = new Float32Array(16 * 256 * 2);
const factor = 32768.0;
for (let shift = 0; shift < 16; ++shift) {
for (let index = 0; index < 256; ++index) {
const offset = ((shift << 8) + index) << 1;
var sample = (index & 0xF0) << 8;
if (sample & 0x8000) { sample |= 0xFFFF0000 };
xa2pcm[offset + 1] = (sample >> shift) / factor;
var sample = (index & 0x0F) << 12;
if (sample & 0x8000) { sample |= 0xFFFF0000 };
xa2pcm[offset + 0] = (sample >> shift) / factor;
}
}
return { spu, xa2flt, xa2pcm };
})
mdlr('enge:psx:index', m => {
let running = false;
let canvas = undefined;
const cpuDebug = new URLSearchParams(window.location.search).has('debug-cd') ||
new URLSearchParams(window.location.search).has('debug-game');
let lastCpuDebugTime = 0;
const PSX_SPEED = 44100 * 768; // 33868800 cyles
const abort = (...args) => {
const message = [...args].join(' ');
canvas.style.borderColor = 'red';
running = false;
spu.silence();
console.error(message);
alert(`eNGE stopped: ${message}`);
throw new Error(message);
}
let endAnimationFrame = false;
let hasFocus = true;
document.addEventListener("visibilitychange", () => {
if (document.visibilityState === 'visible') {
hasFocus = true;
} else {
hasFocus = false;
spu.silence();
}
});
const context = {
timeStamp: 0,
realtime: 0,
emutime: 0,
counter: 0
};
// function isTouchEnabled() {
//   return ('ontouchstart' in window) ||
//     (navigator.maxTouchPoints > 0) ||
//     (navigator.msMaxTouchPoints > 0);
// }
const frameEvent = psx.addEvent(0, (self) => {
endAnimationFrame = true;
psx.unsetEvent(self);
});
const mainLoop = (stamp) => {
const delta = stamp - context.timeStamp;
context.timeStamp = stamp;
if (!running || !hasFocus || delta > 250) return;
context.realtime += delta;
const diffTime = context.realtime - context.emutime;
const totalCycles = diffTime * (PSX_SPEED / 1000);
endAnimationFrame = false;
psx.setEvent(frameEvent, +totalCycles);
let entry = getCacheEntry(cpu.pc);
if (!entry) return abort();
handleGamePads();
const $ = psx;
while (!endAnimationFrame) {
entry = entry.code($);
if ($.clock >= $.eventClock) {
entry = $.handleEvents(entry);
}
}
cpu.pc = entry.pc;
if (cpuDebug && stamp - lastCpuDebugTime >= 1000) {
lastCpuDebugTime = stamp;
console.debug('[CPU]', JSON.stringify({
pc: `0x${(cpu.pc >>> 0).toString(16).padStart(8, '0')}`,
ra: `0x${(cpu.gpr[31] >>> 0).toString(16).padStart(8, '0')}`,
a0: `0x${(cpu.gpr[4] >>> 0).toString(16).padStart(8, '0')}`,
v0: `0x${(cpu.gpr[2] >>> 0).toString(16).padStart(8, '0')}`,
sr: `0x${(cpu.sr >>> 0).toString(16)}`,
cause: `0x${(cpu.cause >>> 0).toString(16).padStart(8, '0')}`,
epc: `0x${(cpu.epc >>> 0).toString(16).padStart(8, '0')}`,
istat: `0x${(cpu.istat >>> 0).toString(16)}`,
imask: `0x${(cpu.imask >>> 0).toString(16)}`
}));
}
context.emutime = psx.clock / (PSX_SPEED / 1000);
++context.counter;
}
const emulate = (stamp) => {
mainLoop(stamp);
requestAnimationFrame(emulate);
}
const bios = () => {
running = false;
let entry = getCacheEntry(0xbfc00000);
const $ = psx;
while (entry.pc !== 0x00030000) {
entry = entry.code($);
if ($.clock >= $.eventClock) {
entry = $.handleEvents(entry);
}
}
context.realtime = context.emutime = psx.clock / (PSX_SPEED / 1000);
vector = getCacheEntry(0x80);
cpu.pc = entry.pc;
}
const openFile = (file) => {
var reader = new FileReader();
reader.onload = (event) => {
loadFileData(event.target.result, file.name)
};
reader.readAsArrayBuffer(file);
}
const cueTimeToSector = value => {
const parts = value.split(':').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
throw new Error(`Invalid CUE index time: ${value}`);
}
return parts[0] * 60 * 75 + parts[1] * 75 + parts[2];
};
const parseCue = (text, cueURL) => {
const files = [];
let currentFile;
let currentTrack;
const parsedTracks = [];
for (const rawLine of text.split(/\r?\n/)) {
const line = rawLine.trim();
let match = line.match(/^FILE\s+"([^"]+)"\s+(?:BINARY|MOTOROLA)$/i);
if (match) {
currentFile = { name: match[1], url: new URL(match[1], cueURL).href, index: files.length };
files.push(currentFile);
continue;
}
match = line.match(/^TRACK\s+(\d+)\s+(\S+)/i);
if (match) {
currentTrack = {
id: Number(match[1]),
begin: 0,
type: match[2].toUpperCase(),
fileIndex: currentFile?.index ?? 0,
fileBegin: 0
};
parsedTracks.push(currentTrack);
continue;
}
match = line.match(/^INDEX\s+01\s+(\d+:\d+:\d+)/i);
if (match && currentTrack) {
currentTrack.fileBegin = cueTimeToSector(match[1]);
}
}
if (!files.length || !parsedTracks.length) {
throw new Error('CUE sheet has no supported FILE/TRACK/INDEX entries');
}
return { files, tracks: parsedTracks };
};
const loadCueFromURL = async cueURL => {
const response = await fetch(cueURL);
if (!response.ok) throw new Error(`CUE request returned HTTP ${response.status}`);
const cue = parseCue(await response.text(), cueURL);
const image = await cdr.setCdImageURLs(cue.files.map(file => file.url));
const fileBases = [];
let base = 0;
for (const file of image.files) {
fileBases.push(base);
base += file.size / 2352;
}
const tracks = cue.tracks.map((track, index) => {
const begin = fileBases[track.fileIndex] + track.fileBegin;
const next = cue.tracks[index + 1];
const sameFile = next && next.fileIndex === track.fileIndex;
const end = sameFile
? fileBases[next.fileIndex] + next.fileBegin
: fileBases[track.fileIndex] + image.files[track.fileIndex].size / 2352;
return {
id: track.id,
begin,
end,
fileIndex: track.fileIndex,
fileBegin: track.fileBegin,
...(track.type === 'AUDIO' ? { audio: true } : { data: true })
};
});
cdr.setTOC([
{ id: 0, begin: 0, end: image.sectors },
...tracks
]);
};
const loadCueFromFiles = async (cueFile, selectedFiles) => {
const cue = parseCue(await cueFile.text(), 'http://local-disc.invalid/');
const filesByName = new Map(selectedFiles.map(file => [file.name.toLowerCase(), file]));
const dataBuffers = [];
for (const cueFileEntry of cue.files) {
const name = cueFileEntry.name.replace(/\\/g, '/').split('/').pop().toLowerCase();
const selectedFile = filesByName.get(name);
if (!selectedFile) throw new Error(`CUE references missing BIN file: ${cueFileEntry.name}`);
dataBuffers.push(await selectedFile.arrayBuffer());
}
const image = cdr.setCdImages(dataBuffers);
const fileBases = [];
let base = 0;
for (const file of image.files) {
fileBases.push(base);
base += file.byteLength / 2352;
}
const tracks = cue.tracks.map((track, index) => {
const begin = fileBases[track.fileIndex] + track.fileBegin;
const next = cue.tracks[index + 1];
const sameFile = next && next.fileIndex === track.fileIndex;
const end = sameFile
? fileBases[next.fileIndex] + next.fileBegin
: fileBases[track.fileIndex] + image.files[track.fileIndex].byteLength / 2352;
return {
id: track.id,
begin,
end,
fileIndex: track.fileIndex,
fileBegin: track.fileBegin,
...(track.type === 'AUDIO' ? { audio: true } : { data: true })
};
});
cdr.setTOC([
{ id: 0, begin: 0, end: image.sectors },
...tracks
]);
loadedGameId = `local:${cueFile.name}:${selectedFiles.length}`;
bootBiosIfReady();
running = true;
scheduleStateReady();
};
const loadFileFromURL = async (url) => {
running = false;
try {
if (/\.cue(?:$|[?#])/i.test(url)) {
await loadCueFromURL(url);
}
else {
const image = await cdr.setCdImageURL(url);
cdr.setTOC([
{ id: 0, begin: 0, end: image.sectors },
{ id: 1, begin: 0, end: image.sectors, data: true }
]);
}
loadedGameId = new URL(url, document.baseURI).href;
bootBiosIfReady();
running = true;
scheduleStateReady();
}
catch (error) {
abort('Unable to load CD image:', error.message);
}
}
const loadBiosFromURL = async url => {
const response = await fetch(url);
if (!response.ok) throw new Error(`BIOS request returned HTTP ${response.status}`);
loadFileData(await response.arrayBuffer(), new URL(url, document.baseURI).href);
};
const stateStorageKey = 'enge-psx-save-state-v1';
const stateBuild = 'enge-save-state-v3-renderer-v1';
const stateStartupDelay = 15000;
const emulatorVariant = [...document.scripts].some(script => script.src.includes('index-webgl2'))
? 'webgl2'
: 'webgl';
let loadedBiosId = 'unloaded';
let loadedGameId = 'unloaded';
let biosBooted = false;
const bootBiosIfReady = () => {
if (biosBooted || loadedBiosId === 'unloaded' || loadedGameId === 'unloaded') return;
bios();
biosBooted = true;
running = true;
};
let stateReady = false;
let stateReadyTimer;
let stateCountdownTimer;
let stateReadyAt = 0;
const updateStateStatus = text => {
const status = document.getElementById('state-status');
if (status) status.textContent = text;
};
const updateStateControls = () => {
for (const id of ['save-state', 'load-state', 'download-state', 'upload-state', 'cloud-save-state', 'cloud-load-state']) {
const button = document.getElementById(id);
if (button) button.disabled = !stateReady;
}
};
const scheduleStateReady = () => {
stateReady = false;
clearTimeout(stateReadyTimer);
clearInterval(stateCountdownTimer);
stateReadyAt = Date.now() + stateStartupDelay;
const updateCountdown = () => {
const seconds = Math.max(1, Math.ceil((stateReadyAt - Date.now()) / 1000));
updateStateStatus(`State controls unlock in ${seconds} second${seconds === 1 ? '' : 's'}`);
};
updateCountdown();
stateCountdownTimer = setInterval(updateCountdown, 250);
updateStateControls();
stateReadyTimer = setTimeout(() => {
stateReady = true;
clearInterval(stateCountdownTimer);
updateStateStatus('State controls ready');
updateStateControls();
}, stateStartupDelay);
};
const bufferIdentity = arrayBuffer => {
const bytes = new Uint8Array(arrayBuffer);
let hash = 2166136261;
for (const byte of bytes) {
hash ^= byte;
hash = Math.imul(hash, 16777619);
}
return `${bytes.byteLength}:${hash >>> 0}`;
};
const currentStateCompatibility = () => ({
build: stateBuild,
variant: emulatorVariant,
bios: loadedBiosId,
game: loadedGameId
});
const bytesToBase64 = bytes => {
let binary = '';
for (let offset = 0; offset < bytes.length; offset += 0x8000) {
binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
}
return btoa(binary);
};
const base64ToBytes = value => {
const binary = atob(value);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
return bytes;
};
const snapshotValue = (value, seen = new WeakSet()) => {
if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
return value;
}
if (typeof value === 'function' || value === undefined) return undefined;
if (ArrayBuffer.isView(value)) {
return {
type: value.constructor.name,
data: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
};
}
if (seen.has(value)) return undefined;
seen.add(value);
if (Array.isArray(value)) return value.map(item => snapshotValue(item, seen));
const result = {};
for (const [key, item] of Object.entries(value)) {
const snapshot = snapshotValue(item, seen);
if (snapshot !== undefined) result[key] = snapshot;
}
return result;
};
const restoreValue = (target, snapshot) => {
if (!target || !snapshot) return;
if (ArrayBuffer.isView(target) && snapshot.type) {
const bytes = base64ToBytes(snapshot.data);
new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(bytes.subarray(0, target.byteLength));
return;
}
if (Array.isArray(target) && Array.isArray(snapshot)) {
snapshot.forEach((value, index) => restoreValue(target[index], value));
return;
}
for (const [key, value] of Object.entries(snapshot)) {
if (!(key in target) || typeof target[key] === 'function') continue;
if (value && value.type && ArrayBuffer.isView(target[key])) {
restoreValue(target[key], value);
}
else if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') {
restoreValue(target[key], value);
}
else if (typeof value !== 'object') {
target[key] = value;
}
}
};
const restoreSnapshot = snapshot => {
if (snapshot === null || typeof snapshot !== 'object') return snapshot;
if (snapshot.type && snapshot.data) {
const bytes = base64ToBytes(snapshot.data);
const Type = globalThis[snapshot.type];
return Type ? new Type(bytes.buffer) : bytes;
}
if (Array.isArray(snapshot)) return snapshot.map(restoreSnapshot);
return Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, restoreSnapshot(value)]));
};
const saveState = () => {
const wasRunning = running;
running = false;
spu.silence();
try {
const gpuState = snapshotValue(gpu);
delete gpuState.img?.buffer;
const state = {
version: 3,
compatibility: currentStateCompatibility(),
ram: bytesToBase64(new Uint8Array(map.buffer, 0, 2 * 1024 * 1024)),
cpu: snapshotValue(cpu),
gpu: gpuState,
rendererVram: renderer.getVramState ? snapshotValue(renderer.getVramState()) : undefined,
psx: snapshotValue(psx),
scheduler: psx.getState(),
cdr: snapshotValue(cdr.getState()),
context: snapshotValue(context)
};
localStorage.setItem(stateStorageKey, JSON.stringify(state));
return true;
}
finally {
running = wasRunning;
}
};
const loadState = (encoded = localStorage.getItem(stateStorageKey)) => {
if (!stateReady) {
throw new Error('The game is still booting; wait for the Sony and PlayStation screens to finish before loading a state');
}
if (loadedBiosId === 'unloaded' || loadedGameId === 'unloaded') {
throw new Error('PlayStation is not ready yet; wait for the BIOS and game to finish loading before loading a state');
}
if (!encoded) return false;
const state = JSON.parse(encoded);
if (state.version !== 3) throw new Error('Save state was created by an incompatible emulator build');
const expected = currentStateCompatibility();
const actual = state.compatibility || {};
for (const key of Object.keys(expected)) {
if (actual[key] !== expected[key]) {
throw new Error(`Save state mismatch: ${key} does not match the currently loaded emulator`);
}
}
const wasRunning = running;
running = false;
spu.silence();
try {
new Uint8Array(map.buffer, 0, 2 * 1024 * 1024).set(base64ToBytes(state.ram));
restoreValue(cpu, state.cpu);
restoreValue(gpu, state.gpu);
if (state.rendererVram && renderer.setVramState) {
renderer.setVramState(restoreSnapshot(state.rendererVram));
}
restoreValue(psx, state.psx);
cdr.setState(state.cdr && restoreSnapshot(state.cdr));
psx.setState(state.scheduler);
restoreValue(context, state.context);
clearCodeCache(0, 2 * 1024 * 1024);
context.timeStamp = performance.now();
return true;
}
finally {
running = wasRunning;
}
};
const updateStateButton = (button, text) => {
if (!button) return;
const original = button.textContent;
button.textContent = text;
setTimeout(() => { button.textContent = original; }, 1200);
};
const downloadFile = (data, filename, type) => {
const blob = new Blob([data], { type });
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = filename;
link.click();
setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
const loadFileData = (arrayBuffer, sourceId = '') => {
const view = new DataView(arrayBuffer);
if (view.getUint16(0, true) === 0x5350) { // PS
cpu.pc = view.getInt32(0x10, true);
cpu.gpr[28] = view.getInt32(0x14, true);
cpu.gpr[29] = view.getInt32(0x30, true) || 0x801ffff0;
cpu.gpr[30] = view.getInt32(0x30, true) || 0x801ffff0;
cpu.gpr[31] = cpu.pc;
var textSegmentOffset = view.getInt32(0x18, true);
var fileContentLength = view.getInt32(0x1C, true);
for (var i = 0; i < fileContentLength; ++i) {
if (0x800 + i >= arrayBuffer.byteLength) continue;
ram.setInt8(textSegmentOffset++ & 0x001fffff, view.getInt8(0x800 + i, true), true);
}
clearCodeCache(view.getInt32(0x18, true), arrayBuffer.byteLength);
running = true;
}
else if (view.getUint32(0, true) === 0x0000434d) { // MEMCARD
var copy = new Uint8Array(arrayBuffer);
let card = joy.devices ? joy.devices[0].data : joy.cardOneMemory;
for (var i = 0; i < copy.length; ++i) {
card[i] = copy[i];
}
}
else if (arrayBuffer.byteLength === 524288) {
biosBooted = false;
loadedBiosId = bufferIdentity(arrayBuffer);
writeStorageStream('bios', arrayBuffer);
clearCodeCache(0x01c00000, 0x00080000);
for (var i = 0; i < 0x00080000; i += 4) {
const data = view.getInt32(i, true);
rom.setInt32(i, data, true);
}
// Sony BIOS traditionally starts as soon as it is loaded. OpenBIOS
// needs the disc present before starting, so defer only that BIOS.
const biosText = new TextDecoder().decode(new Uint8Array(arrayBuffer));
const isOpenBios = /openbios|pcsx-redux/i.test(biosText);
if (isOpenBios) {
bootBiosIfReady();
}
else {
bios();
biosBooted = true;
running = true;
}
let header = document.querySelector('span.nobios');
if (header) {
header.classList.remove('nobios');
}
}
else if (true || view.getUint32(0, true) === (0xffffff00 >>> 0)) { // ISO
// auto build TOC (attempt to not need .cue files)
let lastLoc = (arrayBuffer.byteLength / 4) / (2352 / 4);
let tracks = [];
tracks.push({ id: 0, begin: 0, end: lastLoc });
const sectorLength = 2352;
const isDataSector = (startLoc) => {
let mask1 = view.getInt32(startLoc * sectorLength + 0, true) >>> 0;
let mask2 = view.getInt32(startLoc * sectorLength + 4, true) >>> 0;
let mask3 = view.getInt32(startLoc * sectorLength + 8, true) >>> 0;
return (mask1 === 0xffffff00 && mask2 === 0xffffffff && mask3 === 0x00ffffff) || (!mask1 && !mask2 && !mask3);
}
const isEmptySector = (startLoc) => {
let mask = 0;
for (let i = 0; i < sectorLength; i += 4) {
mask |= view.getInt32(startLoc * sectorLength + i, true);
}
return (mask >>> 0) === (0x00000000 >>> 0);
}
let begin, end, lead;
let i = 0;
begin = i;
while ((i < lastLoc) && isDataSector(i)) ++i;
end = i;
while ((i < lastLoc) && isEmptySector(i)) ++i;
tracks.push({ id: 1, begin, end, data: true });
let id = 2;
if (i < lastLoc) {
begin = i;
while (i < lastLoc) {
while ((i < lastLoc) && !isEmptySector(i)) ++i;
end = i;
while ((i < lastLoc) && isEmptySector(i)) ++i;
lead = i;
if ((lead - end) < 75) continue;
tracks.push({ id, begin, end, audio: true });
begin = i;
id++;
}
if (begin < lastLoc) {
end = lead = lastLoc
tracks.push({ id, begin, end, audio: true });
}
}
cdr.setCdImage(view);
cdr.setTOC(tracks);
loadedGameId = sourceId ? `local:${sourceId}:${arrayBuffer.byteLength}` : `local-image:${arrayBuffer.byteLength}`;
bootBiosIfReady();
running = true;
scheduleStateReady();
}
else {
abort();
}
}
const handleFileSelect = async (evt) => {
evt.stopPropagation();
evt.preventDefault();
const fileList = evt.dataTransfer ? evt.dataTransfer.files : evt.target.files;
const selectedFiles = [...fileList];
const biosFile = selectedFiles.find(file => file.size === 0x80000);
if (biosFile) {
loadFileData(await biosFile.arrayBuffer(), biosFile.name);
}
const cueFile = selectedFiles.find(file => /\.cue$/i.test(file.name));
if (cueFile) {
try {
await loadCueFromFiles(cueFile, selectedFiles);
} catch (error) {
abort('Unable to load local CUE:', error.message);
}
return;
}
for (const file of selectedFiles) {
openFile(file);
}
}
const handleDragOver = (evt) => {
evt.stopPropagation();
evt.preventDefault();
}
const init = () => {
canvas = document.getElementById('display');
document.addEventListener('dragover', handleDragOver, false);
document.addEventListener('drop', handleFileSelect, false);
const fileElem = document.getElementById('file');
fileElem?.addEventListener('change', handleFileSelect, false);
const loadBiosButton = document.getElementById('load-bios');
loadBiosButton?.addEventListener('click', async () => {
loadBiosButton.disabled = true;
loadBiosButton.textContent = 'Loading...';
try {
await loadBiosFromURL(loadBiosButton.dataset.url);
loadBiosButton.textContent = 'BIOS Loaded';
}
catch (error) {
const message = `Unable to load BIOS: ${error.message}`;
console.error(message, error);
alert(message);
loadBiosButton.disabled = false;
loadBiosButton.textContent = 'Load BIOS';
}
});
const loadOpenBiosButton = document.getElementById('load-openbios');
loadOpenBiosButton?.addEventListener('click', async () => {
loadOpenBiosButton.disabled = true;
loadOpenBiosButton.textContent = 'Loading...';
try {
await loadBiosFromURL(loadOpenBiosButton.dataset.url);
loadOpenBiosButton.textContent = 'OpenBIOS Loaded';
}
catch (error) {
const message = `Unable to load OpenBIOS: ${error.message}`;
console.error(message, error);
alert(message);
loadOpenBiosButton.disabled = false;
loadOpenBiosButton.textContent = 'Load OpenBIOS';
}
});
const loadGameButton = document.getElementById('load-game');
const loadGameFromButton = async (button, url, loadedText = 'Game Loaded') => {
const originalText = button.textContent;
button.disabled = true;
button.textContent = 'Loading...';
try {
await loadFileFromURL(url);
button.textContent = loadedText;
}
catch (error) {
const message = `Unable to load game: ${error.message}`;
console.error(message, error);
alert(message);
button.disabled = false;
button.textContent = originalText;
}
};
loadGameButton?.addEventListener('click', () => loadGameFromButton(loadGameButton, loadGameButton.dataset.url));
const cloudBase = window.location.origin;
const gameListBase = window.location.origin;
const gamesCsvUrl = `${gameListBase}/games.csv`;
const biosCsvUrl = `${window.location.origin}/bios.csv`;
const parseCsv = text => {
const rows = [];
let row = [];
let field = '';
let quoted = false;
for (let index = 0; index < text.length; index += 1) {
const character = text[index];
if (character === '"') {
if (quoted && text[index + 1] === '"') {
field += '"';
index += 1;
} else {
quoted = !quoted;
}
} else if (character === ',' && !quoted) {
row.push(field);
field = '';
} else if ((character === '\n' || character === '\r') && !quoted) {
if (character === '\r' && text[index + 1] === '\n') index += 1;
row.push(field);
if (row.some(value => value.trim())) rows.push(row);
row = [];
field = '';
} else {
field += character;
}
}
if (field || row.length) {
row.push(field);
if (row.some(value => value.trim())) rows.push(row);
}
if (!rows.length) return [];
const headers = rows.shift().map(value => value.trim().toLowerCase());
const nameIndex = headers.indexOf('name');
const urlIndex = headers.indexOf('url');
if (nameIndex < 0 || urlIndex < 0) throw new Error('games.csv must have name and url columns');
return rows.map(values => ({
name: (values[nameIndex] || '').trim(),
url: (values[urlIndex] || '').trim(),
})).filter(game => game.name && game.url);
};
const loadBiosCatalog = async () => {
const biosList = document.getElementById('bios-list');
const biosListStatus = document.getElementById('bios-list-status');
if (!biosList || biosList.dataset.loaded === 'true') return;
biosListStatus && (biosListStatus.textContent = 'Loading BIOS files...');
try {
const response = await fetch(biosCsvUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
const bios = parseCsv(await response.text());
biosList.replaceChildren();
for (const biosFile of bios) {
const button = document.createElement('button');
button.type = 'button';
button.textContent = `Load ${biosFile.name}`;
button.addEventListener('click', async () => {
button.disabled = true;
button.textContent = 'Loading...';
try {
await loadBiosFromURL(new URL(biosFile.url, `${window.location.origin}/`).href);
button.textContent = `${biosFile.name} Loaded`;
} catch (error) {
console.error(`Unable to load ${biosFile.name}:`, error);
alert(`Unable to load ${biosFile.name}: ${error.message}`);
button.disabled = false;
button.textContent = `Load ${biosFile.name}`;
}
});
const item = document.createElement('div');
item.append(button);
biosList.append(item);
}
biosList.dataset.loaded = 'true';
if (biosListStatus) {
biosListStatus.textContent = '';
biosListStatus.hidden = true;
}
} catch (error) {
console.error('Unable to load bios.csv:', error);
if (biosListStatus) {
biosListStatus.hidden = false;
biosListStatus.textContent = `Unable to load BIOS list: ${error.message}`;
}
}
};
const loadGameCatalog = async () => {
const gameList = document.getElementById('game-list');
const gameListStatus = document.getElementById('game-list-status');
if (!gameList || gameList.dataset.loaded === 'true') return;
gameListStatus && (gameListStatus.textContent = 'Loading games...');
try {
const response = await fetch(gamesCsvUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
const games = parseCsv(await response.text());
gameList.replaceChildren();
for (const game of games) {
const button = document.createElement('button');
button.type = 'button';
button.textContent = game.name;
button.addEventListener('click', () => loadGameFromButton(button, new URL(game.url, `${gameListBase}/`).href, 'Game Loaded'));
const item = document.createElement('div');
item.append(button);
gameList.append(item);
}
gameList.dataset.loaded = 'true';
if (gameListStatus) {
gameListStatus.textContent = '';
gameListStatus.hidden = true;
}
} catch (error) {
console.error('Unable to load games.csv:', error);
if (gameListStatus) {
gameListStatus.hidden = false;
gameListStatus.textContent = `Unable to load games: ${error.message}`;
}
}
};
const cloudRequest = (path, options = {}) => fetch(`${cloudBase}${path}`, {
cache: 'no-store',
...options,
}).then(async response => {
if (!response.ok) {
let message = response.statusText;
try { message = (await response.text()) || message; } catch (_) { }
throw new Error(`${response.status} ${message}`);
}
return response;
});
const cloudSaveStateButton = document.getElementById('cloud-save-state');
cloudSaveStateButton?.addEventListener('click', async () => {
try {
if (!saveState()) throw new Error('Save state is unavailable');
await cloudRequest('/api/state', {
method: 'PUT',
headers: { 'Content-Type': 'application/json' },
body: localStorage.getItem(stateStorageKey),
});
updateStateButton(cloudSaveStateButton, 'Cloud Saved');
}
catch (error) {
console.error('Unable to save state to cloud:', error);
updateStateButton(cloudSaveStateButton, 'Cloud Save Failed');
alert(`Unable to save state to cloud: ${error.message}`);
}
});
const cloudLoadStateButton = document.getElementById('cloud-load-state');
cloudLoadStateButton?.addEventListener('click', async () => {
try {
const encoded = await (await cloudRequest('/api/state')).text();
loadState(encoded);
localStorage.setItem(stateStorageKey, encoded);
updateStateButton(cloudLoadStateButton, 'Cloud State Loaded');
}
catch (error) {
console.error('Unable to load state from cloud:', error);
updateStateButton(cloudLoadStateButton, 'Cloud Load Failed');
alert(`Unable to load state from cloud: ${error.message}`);
}
});
const cloudSaveMemoryCardButton = document.getElementById('cloud-save-memorycard');
cloudSaveMemoryCardButton?.addEventListener('click', async () => {
try {
const card = joy.devices[0].getMemoryCard?.();
if (!card) throw new Error('Memory card is unavailable');
await cloudRequest('/api/memorycard', {
method: 'PUT',
headers: { 'Content-Type': 'application/octet-stream' },
body: card,
});
updateStateButton(cloudSaveMemoryCardButton, 'Cloud Saved');
}
catch (error) {
console.error('Unable to save memory card to cloud:', error);
updateStateButton(cloudSaveMemoryCardButton, 'Cloud Save Failed');
alert(`Unable to save memory card to cloud: ${error.message}`);
}
});
const cloudLoadMemoryCardButton = document.getElementById('cloud-load-memorycard');
cloudLoadMemoryCardButton?.addEventListener('click', async () => {
try {
const buffer = await (await cloudRequest('/api/memorycard')).arrayBuffer();
if (buffer.byteLength !== 128 * 1024) throw new Error('Cloud memory card must be exactly 128 KB');
joy.devices[0].setMemoryCard(new Uint8Array(buffer));
writeStorageStream('card1', buffer);
updateStateButton(cloudLoadMemoryCardButton, 'Cloud Card Loaded');
}
catch (error) {
console.error('Unable to load memory card from cloud:', error);
updateStateButton(cloudLoadMemoryCardButton, 'Cloud Load Failed');
alert(`Unable to load memory card from cloud: ${error.message}`);
}
});
const saveStateButton = document.getElementById('save-state');
saveStateButton?.addEventListener('click', () => {
try {
updateStateButton(saveStateButton, saveState() ? 'State Saved' : 'Save Failed');
}
catch (error) {
console.error('Unable to save state:', error);
updateStateButton(saveStateButton, 'Save Failed');
}
});
const loadStateButton = document.getElementById('load-state');
loadStateButton?.addEventListener('click', () => {
try {
updateStateButton(loadStateButton, loadState() ? 'State Loaded' : 'No State');
}
catch (error) {
console.error('Unable to load state:', error);
const reason = error.message || 'Unknown error';
const shortReason = reason.startsWith('Save state mismatch:')
? 'State Mismatch'
: reason.includes('incompatible emulator build')
? 'Incompatible Build'
: 'Load Failed';
updateStateButton(loadStateButton, shortReason);
alert(`Unable to load save state: ${reason}`);
}
});
const downloadStateButton = document.getElementById('download-state');
downloadStateButton?.addEventListener('click', () => {
try {
if (!saveState()) {
updateStateButton(downloadStateButton, 'Save Failed');
return;
}
downloadFile(localStorage.getItem(stateStorageKey), 'enge-save-state.json', 'application/json');
updateStateButton(downloadStateButton, 'Downloaded');
}
catch (error) {
console.error('Unable to download state:', error);
updateStateButton(downloadStateButton, 'Download Failed');
}
});
const downloadMemoryCardButton = document.getElementById('download-memorycard');
downloadMemoryCardButton?.addEventListener('click', () => {
try {
const card = joy.devices[0].getMemoryCard?.();
if (!card) throw new Error('Memory card is unavailable');
downloadFile(card, 'enge-memory-card-1.mcr', 'application/octet-stream');
updateStateButton(downloadMemoryCardButton, 'Downloaded');
}
catch (error) {
console.error('Unable to download memory card:', error);
updateStateButton(downloadMemoryCardButton, 'Download Failed');
}
});
const uploadStateButton = document.getElementById('upload-state');
const uploadStateInput = document.getElementById('upload-state-file');
uploadStateButton?.addEventListener('click', () => uploadStateInput?.click());
uploadStateInput?.addEventListener('change', () => {
const file = uploadStateInput.files?.[0];
if (!file) return;
file.text().then(encoded => {
loadState(encoded);
localStorage.setItem(stateStorageKey, encoded);
updateStateButton(uploadStateButton, 'State Loaded');
}).catch(error => {
console.error('Unable to upload state:', error);
updateStateButton(uploadStateButton, error.message.includes('mismatch') ? 'State Mismatch' : 'Load Failed');
alert(`Unable to upload save state: ${error.message}`);
}).finally(() => { uploadStateInput.value = ''; });
});
const uploadMemoryCardButton = document.getElementById('upload-memorycard');
const uploadMemoryCardInput = document.getElementById('upload-memorycard-file');
uploadMemoryCardButton?.addEventListener('click', () => uploadMemoryCardInput?.click());
uploadMemoryCardInput?.addEventListener('change', () => {
const file = uploadMemoryCardInput.files?.[0];
if (!file) return;
file.arrayBuffer().then(buffer => {
if (buffer.byteLength !== 128 * 1024) throw new Error('Memory card must be exactly 128 KB');
joy.devices[0].setMemoryCard(new Uint8Array(buffer));
writeStorageStream('card1', buffer);
updateStateButton(uploadMemoryCardButton, 'Card Loaded');
}).catch(error => {
console.error('Unable to upload memory card:', error);
updateStateButton(uploadMemoryCardButton, 'Load Failed');
alert(`Unable to upload memory card: ${error.message}`);
}).finally(() => { uploadMemoryCardInput.value = ''; });
});
const menuButton = document.getElementById('menu-button');
const controlMenu = document.getElementById('control-menu');
const closeMenuButton = document.getElementById('close-menu');
const closeMenu = () => {
if (!controlMenu) return;
controlMenu.classList.remove('open');
controlMenu.hidden = true;
menuButton?.setAttribute('aria-expanded', 'false');
};
menuButton?.addEventListener('click', () => {
if (!controlMenu) return;
controlMenu.hidden = false;
controlMenu.classList.add('open');
menuButton.setAttribute('aria-expanded', 'true');
});
document.getElementById('reload-window')?.addEventListener('click', () => window.location.reload());
const cloudButton = document.getElementById('cloud-button');
const networkMenu = document.getElementById('network-menu');
const closeNetworkMenuButton = document.getElementById('close-network-menu');
const closeNetworkMenu = () => {
if (!networkMenu) return;
networkMenu.classList.remove('open');
networkMenu.hidden = true;
cloudButton?.setAttribute('aria-expanded', 'false');
};
cloudButton?.addEventListener('click', () => {
if (!networkMenu) return;
networkMenu.hidden = false;
networkMenu.classList.add('open');
cloudButton.setAttribute('aria-expanded', 'true');
void loadBiosCatalog();
void loadGameCatalog();
});
const overlayToggle = document.getElementById('overlay-toggle');
overlayToggle?.addEventListener('click', () => {
const hidden = document.body.classList.toggle('touch-overlay-hidden');
overlayToggle.setAttribute('aria-pressed', String(hidden));
overlayToggle.setAttribute('aria-label', hidden ? 'Show touch controls' : 'Hide touch controls');
overlayToggle.title = hidden ? 'Show touch controls' : 'Hide touch controls';
});
closeMenuButton?.addEventListener('click', closeMenu);
controlMenu?.addEventListener('click', event => {
if (event.target === controlMenu) closeMenu();
});
closeNetworkMenuButton?.addEventListener('click', closeNetworkMenu);
networkMenu?.addEventListener('click', event => {
if (event.target === networkMenu) closeNetworkMenu();
});
const fullscreenButton = document.getElementById('fullscreen');
const updateFullscreenLabel = () => {
const nativeFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
const pseudoFullscreen = document.documentElement.classList.contains('enge-pseudo-fullscreen');
const fullscreenActive = nativeFullscreen || pseudoFullscreen;
fullscreenButton.textContent = fullscreenActive
? 'Exit Fullscreen'
: 'Fullscreen';
fullscreenButton.setAttribute('aria-label', fullscreenActive ? 'Exit fullscreen' : 'Fullscreen');
fullscreenButton.title = fullscreenActive ? 'Exit fullscreen' : 'Fullscreen';
};
fullscreenButton?.addEventListener('click', async () => {
try {
const nativeFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
const pseudoFullscreen = document.documentElement.classList.contains('enge-pseudo-fullscreen');
if (nativeFullscreen) {
const exit = document.exitFullscreen || document.webkitExitFullscreen;
if (exit) await exit.call(document);
}
else if (pseudoFullscreen) {
document.documentElement.classList.remove('enge-pseudo-fullscreen');
}
else {
const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
if (request) {
try {
await request.call(document.documentElement);
}
catch (error) {
document.documentElement.classList.add('enge-pseudo-fullscreen');
}
}
else {
document.documentElement.classList.add('enge-pseudo-fullscreen');
}
}
updateFullscreenLabel();
}
catch (error) {
console.error('Fullscreen request failed:', error);
document.documentElement.classList.add('enge-pseudo-fullscreen');
updateFullscreenLabel();
}
});
document.addEventListener('fullscreenchange', updateFullscreenLabel);
document.addEventListener('webkitfullscreenchange', updateFullscreenLabel);
settings.updateQuality();
const qualityElem = document.getElementById('quality');
qualityElem?.addEventListener('click', event => {
settings.updateQuality(true);
event.preventDefault();
});
emulate(performance.now());
canvas.addEventListener("dblclick", () => {
running = !running;
if (!running) {
spu.silence();
}
});
canvas.addEventListener("touchstart", () => {
running = !running;
if (!running) {
spu.silence();
}
});
window.addEventListener("keydown", e => {
if (e.key === 'F12') return; // allow developer tools
if (e.key === 'F11') return; // allow full screen
if (e.key === 'F5') return; // allow page refresh
}, false);
window.addEventListener("keyup", e => {
if (e.key === '1' && e.ctrlKey) renderer.setMode('disp');
if (e.key === '2' && e.ctrlKey) renderer.setMode('draw');
if (e.key === '3' && e.ctrlKey) renderer.setMode('clut8');
if (e.key === '4' && e.ctrlKey) renderer.setMode('clut4');
if (e.key === '0' && e.ctrlKey) renderer.setMode('page2');
if (e.key === 'F12') return; // allow developer tools
if (e.key === 'F11') return; // allow full screen
if (e.key === 'F5') return; // allow page refresh
}, false);
readStorageStream('bios', data => {
if (data) {
loadedBiosId = bufferIdentity(data.buffer);
let data32 = new Uint32Array(data.buffer);
for (var i = 0; i < 0x80000; i += 4) {
map[(0x01c00000 + i) >>> 2] = data32[i >>> 2];
}
let header = document.querySelector('span.nobios');
if (header) {
header.classList.remove('nobios');
}
bootBiosIfReady();
}
});
readStorageStream('card1', data => {
if (data) {
joy.devices[0].setMemoryCard(data);
}
});
readStorageStream('card2', data => {
if (data) {
joy.devices[1].setMemoryCard(data);
}
});
// BIOS loading is explicit now. This avoids silently replacing a BIOS
// selected by the user with the bundled OpenBIOS file.
// loadBiosFromURL('openbios.bin').catch(error => {
//   console.error('Unable to auto-load local OpenBIOS:', error);
// });
}
return { init, PSX_SPEED, abort, context, loadFileFromURL, loadCueFromURL, loadBiosFromURL };
})
mdlr('enge:psx:serial-device', m => {
const { encode } = m.require('base64');
const memory = new Uint8Array(128 * 1024);
const setResponseBlock = (before, after) => {
response.push(...before);
for (let i = 0; i < 128; ++i) {
response.push(-1);
}
response.push(...after);
}
let id = 0;
let mode = 0;
let response = [];
let received = [];
let checkSum = 0;
let addr = 0;
return {
lo: 0xff,
hi: 0xff,
setId: function (deviceId) {
id = deviceId;
return this;
},
setMemoryCard: buffer => {
for (let i = 0; i < buffer.length; ++i) {
memory[i] = buffer[i];
}
},
// UI-only snapshot accessor for save/download/upload features. It does not
// alter the serial memory-card protocol or card initialization behavior.
getMemoryCard: () => new Uint8Array(memory),
init: () => {
mode = 0x00;
response = [];
received = [];
},
buildMemCardResponse: byte => {
mode = byte;
switch (byte) {
case 0x52:
setResponseBlock([0x00, 0x5a, 0x5d, 0x00, -1, 0x5c, -1, -1, -1], [-1, 0x47]);
break;
case 0x57:
setResponseBlock([0x00, 0x5a, 0x5d, -1, -1], [-1, 0x5c, 0x5d, 0x47]);
break;
default:
response.push(0xff);
break;
}
},
buildControllerResponse: function (byte) {
mode = byte;
switch (byte) {
case 0x42:
response.push(0x41, 0x5a, this.lo, this.hi/*, 0x00, 0x00, 0x00, 0x00*/);
break;
case 0x43:  // todo: Exit/Enter configuration
response.push(0xff);
break;
default:
return abort(hex(byte, 2));
}
},
sendReceiveByte:  byte => {
if (response.length <= 0) console.log(`#${id}: reading unexpected in mode $${hex(mode, 2)}`);
let data = response.shift() || 0;
if (mode === 0x52) {
if (data === -1) {
const dataIndex = received.length;
switch (true) {
case (dataIndex === 4):
data = received[3];
break;
case (dataIndex === 6):
data = 0x5d;
break;
case (dataIndex === 7):
data = received[3];
checkSum = data;
break;
case (dataIndex === 8):
addr = (received[3] << 8) | received[4];
data = received[4];
checkSum ^= data;
break;
case (dataIndex >= 9 && dataIndex < 137):
const offset = (addr * 128) + dataIndex - 9;
data = memory[offset];
checkSum ^= data;
break;
case (dataIndex === 137):
data = checkSum & 0xff;
break;
}
}
}
if (mode === 0x57) {
if (data === -1) {
const dataIndex = received.length;
switch (true) {
case (dataIndex === 3):
data = received[3];
checkSum = data;
break;
case (dataIndex === 4):
data = received[3];
checkSum ^= data;
addr = (data << 8) | byte;
break;
case (dataIndex >= 5 && dataIndex < 133):
const offset = (addr * 128) + dataIndex - 5;
data = memory[offset - 1];
memory[offset] = byte;
checkSum ^= byte;
break;
case (dataIndex === 133):
// todo: check checkSum
data = memory[132];
localStorage.setItem(`card${id + 1}`, encode(memory));
break;
}
}
}
received.push(byte);
return data & 0xff;
},
hasMore: () => response.length > 0
}
})
mdlr('enge:psx:dma', m => {
const dmaDebug = new URLSearchParams(window.location.search).has('debug-cd');
const dmaLog = (...args) => {
if (dmaDebug) console.debug('[DMA]', ...args);
};
let dpcr;
let dicr;
let r1080, r1084, r1088, r1080n;
let r1090, r1094, r1098, r1090n;
let r10a0, r10a4, r10a8, r10a0n;
let r10b0, r10b4, r10b8, r10b0n;
let r10c0, r10c4, r10c8, r10c0n;
let r10e0, r10e4, r10e8, r10e0n;
const [addEvent, setEvent, unsetEvent] = [psx.addEvent, psx.setEvent, psx.unsetEvent];
const completeIrq = channel => {
const enable = 1 << (16 + channel);
const flag = (1 << 31) | (enable << 8);
if (dicr & enable) {
cpu.istat |= 0x0008;
dicr |= flag;
}
}
const rd32r10f4 = () => {
// faulty needs more
//IF b15=1 OR (b23=1 AND (b16-22 AND b24-30)>0) THEN b31=1 ELSE b31=0
return dicr & 0x7fffffff;
}
const wr08r10f6 = data => {
data = (data << 16) | (dicr & 0xffff);
dicr = (dicr & (~((data & 0x7f000000) | 0x00ffffff))) | (data & 0x00ffffff);
};
const wr32r10f4 = data => {
dicr = (dicr & (~((data & 0x7f000000) | 0x00ffffff))) | (data & 0x00ffffff);
};
const wr32r1088 = ctrl => {
r1088 = ctrl;
if (dpcr & 0x00000008) {
let transferSize = 10;
switch (ctrl) {
case 0x00000000: break;
case 0x01000201: transferSize = mdc.dmaTransferMode0201(r1080, r1084);
r1080n = r1080 + (transferSize << 2);
break;
default: abort(hex(ctrl));
}
setEvent(eventDMA0, ((transferSize * 0x110) / 0x100) >>> 0);
}
else {
r1088 &= 0xfeffffff;
}
};
const wr32r1098 = ctrl => {
r1098 = ctrl;
if (dpcr & 0x00000080) {
let transferSize = 10;
switch (ctrl) {
case 0x00000000: break;
case 0x01000200: transferSize = mdc.dmaTransferMode0200(r1090, r1094);
r1090n = r1090 + (transferSize << 2);
break;
default: abort(hex(ctrl));
}
}
else {
r1098 &= 0xfeffffff;
}
};
const wr32r10a8 = ctrl => {
r10a8 = ctrl;
if (dpcr & 0x00000800) {
let transferSize = 10;
switch (ctrl) {
case 0x00000000: break;
case 0x00000001: break;
case 0x00000401: break;
case 0x00000201: break;
case 0x01000200: transferSize = gpu.dmaTransferMode0200(r10a0, r10a4) || 10;
r10a0n = r10a0 + (transferSize << 2);
break;
case 0x01000201: transferSize = gpu.dmaTransferMode0201(r10a0, r10a4) || 10;
r10a0n = r10a0 + (transferSize << 2);
break;
case 0x01000401: transferSize = gpu.dmaTransferMode0401(r10a0, r10a4) || 10;
r10a0n = 0x00ffffff;
break;
default: abort(hex(ctrl));
}
setEvent(eventDMA2, ((transferSize * 0x110) / 0x100) >>> 0);
}
else {
r10a8 &= 0xfeffffff;
}
};
const wr32r10b8 = ctrl => {
r10b8 = ctrl;
if (dpcr & 0x00008000) {
let transferSize = 10;
dmaLog('channel 3 start', {
ctrl: `0x${(ctrl >>> 0).toString(16)}`,
addr: `0x${(r10b0 >>> 0).toString(16)}`,
block: `0x${(r10b4 >>> 0).toString(16)}`,
dicr: `0x${(dicr >>> 0).toString(16)}`
});
switch (ctrl) {
case 0x00000000: break;
case 0x11000000: transferSize = cdr.dmaTransferMode0000(r10b0, r10b4);
r10b0n = r10b0 + (transferSize << 2);
break;
case 0x11400100: transferSize = cdr.dmaTransferMode0000(r10b0, r10b4);
r10b0n = r10b0 + (transferSize << 2);
break;
default: abort(hex(ctrl));
}
setEvent(eventDMA3, ((transferSize * (cdr.mode & 0x80) ? 0x1400 : 0x2800) / 0x100) >>> 0);
}
else {
r10b8 &= 0xfeffffff;
}
};
const wr32r10c8 = ctrl => {
r10c8 = ctrl;
if (dpcr & 0x00080000) {
let transferSize = 10;
switch (ctrl) {
case 0x00000201: break;
case 0x01000000:
case 0x01000200: transferSize = spu.dmaTransferMode0200(r10c0, r10c4);
r10c0n = r10c0 + (transferSize << 2);
break;
case 0x01000001:
case 0x01000201: transferSize = spu.dmaTransferMode0201(r10c0, r10c4);
r10c0n = r10c0 + (transferSize << 2);
break;
default: abort(hex(ctrl));
}
setEvent(eventDMA4, ((transferSize * 0x420) / 0x100) >>> 0);
}
else {
r10c8 &= 0xfeffffff;
}
};
const wr32r10e8 = ctrl => {
r10e8 = (ctrl & 0x50000002) | 0x2;
if (dpcr & 0x08000000) {
let transferSize = 10;
switch (r10e8) {
case 0x00000002: r10e0n = r10e0 = map[(r10e0 & 0x01ffffff) >> 2];
break;
case 0x10000002:
case 0x50000002: transferSize = gpu.dmaLinkedListMode0002(r10e0, r10e4);
r10e0n = 0x00ffffff; // todo: update with actual value
break;
default: abort(hex(ctrl) + ' ' + hex(r10e8));
}
setEvent(eventDMA6, ((transferSize * 0x110) / 0x100) >>> 0);
}
else {
r10e8 &= 0xfeffffff;
}
};
const dma = {
// called mby mdec
completeDMA1: (self, clock) => {
completeIrq(1);
r1098 &= 0xfeffffff;
r1090 = r1090n;
unsetEvent(self);
},
rd08: addr => {
switch (addr & 0x3fff) {
case 0x10f6: return (dicr >> 16) & 0xff;
default: return dma.rd32(addr);
}
},
rd16: addr => dma.rd32(addr),
rd32: addr => $rd32.get(addr & 0x3fff)(),
wr08: (addr, data) => {
switch (addr & 0x3fff) {
case 0x10f6: wr08r10f6(data); break;
default: return dma.wr32(addr, data);
}
},
wr16: (addr, data) => dma.wr32(addr, data),
wr32: (addr, data) => $wr32.get(addr & 0x3fff)(data),
};
const $rd32 = new Map([
[0x1080, _ => r1080 >> 0],
[0x1088, _ => r1088 >> 0],
[0x1090, _ => r1090 >> 0],
[0x1098, _ => r1098 >> 0],
[0x10a0, _ => r10a0 >> 0],
[0x10a8, _ => r10a8 >> 0],
[0x10b0, _ => r10b0 >> 0],
[0x10b8, _ => r10b8 >> 0],
[0x10c0, _ => r10c0 >> 0],
[0x10c8, _ => r10c8 >> 0],
[0x10e0, _ => r10e0 >> 0],
[0x10e8, _ => r10e8 >> 0],
[0x10f0, _ => dpcr >> 0],
[0x10f4, _ => rd32r10f4() >> 0],
]);
const $wr32 = new Map([
[0x1080, _ => r1080 = _ >>> 0],
[0x1084, _ => r1084 = _ >>> 0],
[0x1088, _ => wr32r1088(_)],
[0x1090, _ => r1090 = _ >>> 0],
[0x1094, _ => r1094 = _ >>> 0],
[0x1098, _ => wr32r1098(_)],
[0x10a0, _ => r10a0 = _ >>> 0],
[0x10a4, _ => r10a4 = _ >>> 0],
[0x10a8, _ => wr32r10a8(_)],
[0x10b0, _ => r10b0 = _ >>> 0],
[0x10b4, _ => r10b4 = _ >>> 0],
[0x10b8, _ => wr32r10b8(_)],
[0x10c0, _ => r10c0 = _ >>> 0],
[0x10c4, _ => r10c4 = _ >>> 0],
[0x10c8, _ => wr32r10c8(_)],
[0x10e0, _ => r10e0 = _ >>> 0],
[0x10e4, _ => r10e4 = _ >>> 0],
[0x10e8, _ => wr32r10e8(_)],
[0x10f0, _ => dpcr = _ >>> 0],
[0x10f4, _ => wr32r10f4(_)],
]);
const eventDMA0 = addEvent(0, (self) => {
completeIrq(0);
r1088 &= 0xfeffffff;
r1080 = r1080n;
unsetEvent(self);
});
const eventDMA2 = addEvent(0, (self) => {
completeIrq(2);
r10a8 &= 0xfeffffff;
r10a0 = r10a0n;
unsetEvent(self);
});
const eventDMA3 = addEvent(0, (self) => {
completeIrq(3);
dmaLog('channel 3 complete', {
addr: `0x${(r10b0n >>> 0).toString(16)}`,
control: `0x${(r10b8 >>> 0).toString(16)}`,
dicr: `0x${(dicr >>> 0).toString(16)}`,
istat: `0x${(cpu.istat >>> 0).toString(16)}`,
imask: `0x${(cpu.imask >>> 0).toString(16)}`,
sr: `0x${(cpu.sr >>> 0).toString(16)}`
});
r10b8 &= 0xfeffffff;
r10b0 = r10b0n;
unsetEvent(self);
});
const eventDMA4 = addEvent(0, (self) => {
completeIrq(4);
r10c8 &= 0xfeffffff;
r10c0 = r10c0n;
unsetEvent(self);
});
const eventDMA6 = addEvent(0, (self) => {
completeIrq(6);
r10e8 &= 0xfeffffff;
r10e0 = r10e0n;
unsetEvent(self);
});
return { dma };
})
mdlr('enge:psx:rtc', m => {
const r11x0 = new Float64Array(4);
const r11x4 = new Uint32Array(4);
const r11x8 = new Uint32Array(4);
const limitReached = (id, increment, counter) => {
const limitBit = (r11x4[id] & 0x008) ? 11 : 12;
switch (limitBit) {
case 11: var limit = +(r11x8[id] + 1.0);
break;
case 12: var limit = +(+0xffff + 1.0);
break;
}
let value = r11x0[id] + increment;
if (value >= limit) {
counter?.onLimitReached(counter);
r11x4[id] |= (1 << limitBit);
return value %= limit;
}
return value;
}
const rc0 = {
freerun: false,
getValue: () => {
const f = rc0.freerun;
let cyclesToPeek = +0;
switch (r11x4[0] & 0x007) {
case 0x000: // no irq, clock source, target 0xffff+1
cyclesToPeek = +(psx.clock - dot.start);
break;
case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
switch (dot.whereInScanLine()) {
case -1: cyclesToPeek = +0; break;
case 0: cyclesToPeek = +(psx.clock - dot.dispHStart); break;
case 1: cyclesToPeek = +(dot.dispHStop - dot.dispHStart); break;
}
break;
case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
switch (dot.whereInScanLine()) {
case -1: cyclesToPeek = +(psx.clock - dot.start); break;
case 0: cyclesToPeek = +(psx.clock - dot.start); break;
case 1: cyclesToPeek = +(psx.clock - dot.dispHStop); break;
}
break;
case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
switch (dot.whereInScanLine()) {
case -1: cyclesToPeek = +(psx.clock - dot.start); break;
case 0: cyclesToPeek = +(dot.dispHStart - dot.start); break;
case 1: cyclesToPeek = +(psx.clock - dot.dispHStop); break;
}
break;
case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
switch (dot.whereInScanLine()) {
case -1: cyclesToPeek = !f ? +0 : +(psx.clock - dot.start); break;
case 0: cyclesToPeek = !f ? +0 : +(psx.clock - dot.start); break;
case 1: cyclesToPeek = !f ? +(psx.clock - dot.dispHStop) : +(psx.clock - dot.start); break;
}
break;
}
if (r11x4[0] & 0x100) {
return limitReached(0, +gpu.cyclesToDotClock(cyclesToPeek));
}
else {
return limitReached(0, +cyclesToPeek);
}
},
getTarget: () => {
return r11x8[0];
},
getMode: () => {
let result = r11x4[0];
r11x4[0] &= 0xe7ff;
return result;
},
setMode: (bits32) => {
r11x4[0] = (bits32 & 0x3ff) | (1 << 10);
let cyclesToSkip = +0;
switch (bits32 & 0x007) {
case 0x000: // no irq, clock source, target 0xffff+1
cyclesToSkip = +(psx.clock - dot.start);
break;
case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
switch (dot.whereInScanLine()) {
case -1: cyclesToSkip = +0; break;
case 0: cyclesToSkip = +(psx.clock - dot.dispHStart); break;
case 1: cyclesToSkip = +0; break;
}
break;
case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
switch (dot.whereInScanLine()) {
case -1: cyclesToSkip = +0; break;
case 0: cyclesToSkip = +0; break;
case 1: cyclesToSkip = +(psx.clock - dot.dispHStop); break;
}
break;
case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
rc0.freerun = false;
cyclesToSkip = +0;
break;
}
if (r11x4[0] & 0x100) {
r11x0[0] = +0, limitReached(0, -gpu.cyclesToDotClock(cyclesToSkip));
}
else {
r11x0[0] = +0, limitReached(0, -cyclesToSkip);
}
},
setTarget: (bits32) => {
if (!bits32) bits32 = 0xffff;
r11x8[0] = bits32;
},
setValue: (bits32) => {
r11x0[0] = bits32;
},
onLimitReached: () => {
if (r11x4[0] & 0x0030) {
cpu.istat |= 0x0010;
}
},
onScanLine: () => {
const f = rc0.freerun;
let cyclesToAdd = +0;
switch (r11x4[0] & 0x007) {
case 0x000: // no irq, clock source, target 0xffff+1
cyclesToAdd = +(dot.stop - dot.start);
break;
case 0x001: // no irq, clock source, target 0xffff+1, pause in hblank
cyclesToAdd = +(dot.dispHStop - dot.dispHStart);
break;
case 0x003: // no irq, clock source, target 0xffff+1, reset counter at hblank
case 0x005: // no irq, clock source, target 0xffff+1, reset counter at hblank, pause outside hblank
switch (dot.whereInScanLine()) {
case -1: cyclesToAdd = +0; break;
case 0: cyclesToAdd = +0; break;
case 1: cyclesToAdd = - +(psx.clock - dot.dispHStop); break;
}
break;
case 0x007: // no irq, clock source, target 0xffff+1, pause until hblank then switch to free run
cyclesToAdd = !f ? +(dot.stop - dot.dispHStop) : +(dot.stop - dot.start);
rc0.freerun = true;
break;
}
if (r11x4[0] & 0x100) {
r11x0[0] = limitReached(0, gpu.cyclesToDotClock(cyclesToAdd), rc0);
}
else {
r11x0[0] = limitReached(0, cyclesToAdd, rc0);
}
}
}
const rc1 = {
freerun: false,
getValue: () => {
// const factor = dot.isInVBlank() ? 0.0 : 1.0;
switch (r11x4[1] & 0x107) {
case 0x000: // no irq, clock source, target 0xffff+1
return limitReached(1, +(psx.clock - dot.start));
case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
return limitReached(1, dot.isInVBlank() ? +0 : +psx.eventCycles(dot.event));
case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
return limitReached(1, +psx.eventCycles(dot.event));
case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
return limitReached(1, dot.isInVBlank() ? +0 : +0);
case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
if (!rc1.freerun) return limitReached(1, +0);
return limitReached(1, +psx.eventCycles(dot.event));
case 0x100: // no irq, h-blank source, target 0xffff+1
case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
return limitReached(1, +0);
case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
if (!rc1.freerun) return limitReached(1, +0);
return limitReached(1, +0);
}
},
getTarget: () => {
return r11x8[1];
},
getMode: () => {
let result = r11x4[1];
r11x4[1] &= 0xe7ff;
return result;
},
setMode: (bits32) => {
r11x4[1] = ((bits32 & 0x13f) | (1 << 10)) >>> 0;
// todo: implement synchronisation
switch (r11x4[1] & 0x107) {
case 0x000: // no irq, clock source, target 0xffff+1
case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
r11x0[1] = - +(psx.clock - dot.start);
r11x0[1] = limitReached(1, +0);
break;
case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
rc1.freerun = false;
r11x0[1] = +0;
break;
case 0x100: // no irq, h-blank source, target 0xffff+1
case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
r11x0[1] = +0;
break;
case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
rc1.freerun = false;
r11x0[1] = +0;
break;
}
},
setTarget: (bits32) => {
if (!bits32) bits32 = 0xffff;
r11x8[1] = bits32 >>> 0;
},
setValue: (bits32) => {
r11x0[1] = +bits32;
},
onLimitReached: () => {
if (r11x4[1] & 0x0030) {
cpu.istat |= 0x0020;
}
},
onScanLine: (isVBlankStart) => {
const cyclesPerScanLine = +(dot.stop - dot.start);
switch (r11x4[1] & 0x107) {
case 0x000: // no irq, clock source, target 0xffff+1
r11x0[1] = limitReached(1, cyclesPerScanLine, rc1);
break;
case 0x001: // no irq, clock source, target 0xffff+1, pause in vblank
r11x0[1] = limitReached(1, dot.isInVBlank() ? +0 : cyclesPerScanLine, rc1);
break;
case 0x003: // no irq, clock source, target 0xffff+1, reset counter at vblank
r11x0[1] = limitReached(1, cyclesPerScanLine, rc1);
if (isVBlankStart) r11x0[1] = 0;
break;
case 0x005: // no irq, clock source, target 0xffff+1, reset counter at vblank, pause outside vblank
r11x0[1] = limitReached(1, dot.isInVBlank() ? cyclesPerScanLine : +0, rc1);
if (dot.isInVBlank()) r11x0[1] = 0;
break;
case 0x007: // no irq, clock source, target 0xffff+1, pause until vblank then switch to free run
if (rc1.freerun) {
r11x0[1] = limitReached(1, cyclesPerScanLine, rc1);
}
else {
r11x0[1] = limitReached(1, +0, rc1);
if (isVBlankStart) {
rc1.freerun = true;
}
}
break;
case 0x100: // no irq, h-blank source, target 0xffff+1
r11x0[1] = limitReached(1, +1, rc1);
break;
case 0x101: // no irq, h-blank source, target 0xffff+1, pause in vblank
r11x0[1] = limitReached(1, dot.isInVBlank() ? + 0 : +1, rc1);
break;
case 0x103: // no irq, h-blank source, target 0xffff+1, reset counter at vblank
r11x0[1] = limitReached(1, +1, rc1);
if (isVBlankStart) r11x0[1] = 0;
break;
case 0x105: // no irq, h-blank source, target 0xffff+1, reset counter at vblank, pause outside vblank
r11x0[1] = limitReached(1, dot.isInVBlank() ? +0 : +1, rc1);
if (isVBlankStart) r11x0[1] = 0;
break;
case 0x107: // no irq, h-blank source, target 0xffff+1, pause until vblank then switch to free run
if (rc1.freerun) {
r11x0[1] = limitReached(1, +1, rc1);
}
else {
r11x0[1] = limitReached(1, +0, rc1);
if (isVBlankStart) {
rc1.freerun = true;
}
}
break;
}
}
}
const rc2 = {
getValue: () => {
switch (r11x4[2] & 0x207) {
case 0x000: // no irq, clock source, target 0xffff+1
case 0x003: // no irq, clock source, target 0xffff+1, free run
case 0x005: // no irq, clock source, target 0xffff+1, free run
return limitReached(2, +(psx.clock - dot.start));
case 0x001: // no irq, clock source, target 0xffff+1, stop counter
case 0x007: // no irq, clock source, target 0xffff+1, stop counter
return limitReached(2, +0);
case 0x008: // no irq, clock source, reset @ target+1
return limitReached(2, +(psx.clock - dot.start));
case 0x200: // no irq, clock/8 source, target 0xffff+1
return limitReached(2, 0.125 * +(psx.clock - dot.start));
}
},
getTarget: () => {
return r11x8[2];
},
getMode: () => {
let result = r11x4[2];
r11x4[2] &= 0xe7ff;
return result;
},
setMode: (bits32) => {
r11x4[2] = (bits32 & 0x3ff) | (1 << 10);
switch (r11x4[2] & 0x207) {
case 0x000: // no irq, clock source, reset @ 0xffff+1
case 0x003: // no irq, clock source, reset @ 0xffff+1, free run
case 0x005: // no irq, clock source, reset @ 0xffff+1, free run
r11x0[2] = - +(psx.clock - dot.start);
r11x0[2] = limitReached(2, +0);
break;
case 0x001: // no irq, clock source, reset @ 0xffff+1, stop counter
case 0x007: // no irq, clock source, reset @ 0xffff+1, stop counter
r11x0[2] = +0;
break;
case 0x008: // no irq, clock source, reset @ target+1
r11x0[2] = -1.000 * psx.eventCycles(dot.event);
break;
case 0x200: // no irq, clock/8 source, reset @ 0xffff+1
r11x0[2] = -0.125 * psx.eventCycles(dot.event);
break;
}
},
setTarget: (bits32) => {
// todo: check setting target after setMode
if (!bits32) bits32 = 0xffff;
r11x8[2] = bits32 & 0xffff;
},
setValue: (bits32) => {
r11x0[2] = bits32;
},
onLimitReached: () => {
if (r11x4[2] & 0x0030) {
cpu.istat |= 0x0040;
}
},
onScanLine: () => {
switch (r11x4[2] & 0x207) {
case 0x000: // no irq, clock source, target 0xffff+1
case 0x003: // no irq, clock source, target 0xffff+1, free run
case 0x005: // no irq, clock source, target 0xffff+1, free run
r11x0[2] = limitReached(2, +(dot.stop - dot.start), rc2);
break;
case 0x001: // no irq, clock source, target 0xffff+1, stop counter
case 0x007: // no irq, clock source, target 0xffff+1, stop counter
r11x0[2] = limitReached(2, +0, rc2);
break;
case 0x200: // no irq, clock/8 source, reset @ 0xffff+1
r11x0[2] = limitReached(2, 0.125 * +(dot.stop - dot.start), rc2);
break;
}
}
}
const MAX_SAFE_INTEGER = +Number.MAX_SAFE_INTEGER;
const dot = {
event: null,
remainder: 0.0,
scanLine: 0,
vblank: false,
dispHStart: MAX_SAFE_INTEGER,
dispHStop: MAX_SAFE_INTEGER,
start: MAX_SAFE_INTEGER,
stop: MAX_SAFE_INTEGER,
upateToLastGpuState: (self) => {
const videoCycles = ((gpu.status >> 20) & 1) ? 3406.0 : 3413.0;
const cpuCycles = (videoCycles * 7.0 / 11.0) * (PSX_SPEED / (768 * 44100));
dot.start = +self.clock;
dot.stop = +cpuCycles + dot.start;
dot.dispHStart = dot.start + (+gpu.dispL * 7.0 / 11.0);
dot.dispHStop = dot.start + (+gpu.dispR * 7.0 / 11.0);
},
complete: (self) => {
dot.upateToLastGpuState(self);
const linesPerFrame = ((gpu.status >> 20) & 1) ? 314 : 263;
dot.scanLine = (dot.scanLine + 1) % linesPerFrame;
dot.vblank = (dot.scanLine < gpu.dispT) || (dot.scanLine >= gpu.dispB);
rc0.onScanLine();
rc1.onScanLine(dot.scanLine === gpu.dispB);
rc2.onScanLine();
gpu.onScanLine(dot.scanLine);
let scanlineCycles = dot.stop - dot.start;
psx.updateEvent(self, +scanlineCycles);
},
isInVBlank: () => {
return dot.vblank;
},
whereInScanLine: () => {
if (psx.clock < dot.dispHStart) {
return -1 >> 0;
}
if (psx.clock < dot.dispHStop) {
return 0 >> 0;
}
return 1 >> 0;
}
}
const rtc = {
rd32: (reg) => {
switch (true) {
case (reg === 0x1100): return rc0.getValue();
case (reg === 0x1104): return rc0.getMode();
case (reg === 0x1108): return rc0.getTarget();
case (reg === 0x1110): return rc1.getValue();
case (reg === 0x1114): return rc1.getMode();
case (reg === 0x1118): return rc1.getTarget();
case (reg === 0x1120): return rc2.getValue();
case (reg === 0x1124): return rc2.getMode();
case (reg === 0x1128): return rc2.getTarget();
}
},
wr32: (reg, data) => {
switch (true) {
case (reg === 0x1100): return rc0.setValue(data);
case (reg === 0x1104): return rc0.setMode(data);
case (reg === 0x1108): return rc0.setTarget(data);
case (reg === 0x1110): return rc1.setValue(data);
case (reg === 0x1114): return rc1.setMode(data);
case (reg === 0x1118): return rc1.setTarget(data);
case (reg === 0x1120): return rc2.setValue(data);
case (reg === 0x1124): return rc2.setMode(data);
case (reg === 0x1128): return rc2.setTarget(data);
}
}
};
dot.event = psx.addEvent(0, dot.complete.bind(dot));
r11x0.fill(0);
r11x4.fill(0);
r11x8.fill(0xffff);
return { rtc };
})
mdlr('enge:psx:spu-reverb', m => {
let vLOUT;
let vROUT;
let mBASE;
let dAPF1;
let dAPF2;
let vIIR;
let vCOMB1;
let vCOMB2;
let vCOMB3;
let vCOMB4;
let vWALL;
let vAPF1;
let vAPF2;
let mLSAME;
let mRSAME;
let mLCOMB1;
let mRCOMB1;
let mLCOMB2;
let mRCOMB2;
let dLSAME;
let dRSAME;
let mLDIFF;
let mRDIFF;
let mLCOMB3;
let mRCOMB3;
let mLCOMB4;
let mRCOMB4;
let dLDIFF;
let dRDIFF;
let mLAPF1;
let mRAPF1;
let mLAPF2;
let mRAPF2;
let vLIN;
let vRIN;
let memory;
let bufferAddress;
let left;
let right;
const s16 = d => Math.abs(d << 16) >> 16;
const u16d8 = d => (d << 16) >>> 13;
const writeHandlers = new Map([
[0x1d84, data => vLOUT = s16(data)],
[0x1d86, data => vROUT = s16(data)],
[0x1da2, data => bufferAddress = mBASE = u16d8(data)],
[0x1dc0, data => dAPF1 = u16d8(data)],
[0x1dc2, data => dAPF2 = u16d8(data)],
[0x1dc4, data => vIIR = s16(data)],
[0x1dc6, data => vCOMB1 = s16(data)],
[0x1dc8, data => vCOMB2 = s16(data)],
[0x1dca, data => vCOMB3 = s16(data)],
[0x1dcc, data => vCOMB4 = s16(data)],
[0x1dce, data => vWALL = s16(data)],
[0x1dd0, data => vAPF1 = s16(data)],
[0x1dd2, data => vAPF2 = s16(data)],
[0x1dd4, data => mLSAME = u16d8(data)],
[0x1dd6, data => mRSAME = u16d8(data)],
[0x1dd8, data => mLCOMB1 = u16d8(data)],
[0x1dda, data => mRCOMB1 = u16d8(data)],
[0x1ddc, data => mLCOMB2 = u16d8(data)],
[0x1dde, data => mRCOMB2 = u16d8(data)],
[0x1de0, data => dLSAME = u16d8(data)],
[0x1de2, data => dRSAME = u16d8(data)],
[0x1de4, data => mLDIFF = u16d8(data)],
[0x1de6, data => mRDIFF = u16d8(data)],
[0x1de8, data => mLCOMB3 = u16d8(data)],
[0x1dea, data => mRCOMB3 = u16d8(data)],
[0x1dec, data => mLCOMB4 = u16d8(data)],
[0x1dee, data => mRCOMB4 = u16d8(data)],
[0x1df0, data => dLDIFF = u16d8(data)],
[0x1df2, data => dRDIFF = u16d8(data)],
[0x1df4, data => mLAPF1 = u16d8(data)],
[0x1df6, data => mRAPF1 = u16d8(data)],
[0x1df8, data => mLAPF2 = u16d8(data)],
[0x1dfa, data => mRAPF2 = u16d8(data)],
[0x1dfc, data => vLIN = s16(data)],
[0x1dfe, data => vRIN = s16(data)],
]);
const loc = addr => mBASE + (bufferAddress + addr) % (0x80000 - mBASE);
const saturate = data => data < -32768 ? -32768 : data > 32767 ? 32767 : data;
const rd16 = addr => memory.getInt16(loc(addr), true);
const wr16 = (addr, data) => memory.setInt16(loc(addr), saturate(data), true);
const norm = data => (data / 0x8000) >> 0;
const reverbLeft = sample => {
// ___Input from Mixer(Input volume multiplied with incoming data)_____________
// Lin = vLIN * LeftInput;from any channels that have Reverb enabled
const Lin = vLIN * sample;
// ____Same Side Reflection(left - to - left and right - to - right)___________________
// [mLSAME] = (Lin + [dLSAME] * vWALL - [mLSAME - 2]) * vIIR + [mLSAME - 2]; L - to - L
wr16(mLSAME, norm((Lin + norm(rd16(dLSAME) * vWALL) - rd16(mLSAME - 2)) * vIIR) + rd16(mLSAME - 2));
// ___Different Side Reflection(left - to - right and right - to - left)_______________
// [mLDIFF] = (Lin + [dRDIFF] * vWALL - [mLDIFF - 2]) * vIIR + [mLDIFF - 2]; R - to - L
wr16(mLDIFF, norm((Lin + norm(rd16(dRDIFF) * vWALL) - rd16(mLDIFF - 2)) * vIIR) + rd16(mLDIFF - 2));
// ___Early Echo(Comb Filter, with input from buffer) __________________________
// Lout = vCOMB1 * [mLCOMB1] + vCOMB2 * [mLCOMB2] + vCOMB3 * [mLCOMB3] + vCOMB4 * [mLCOMB4]
let Lout = norm(vCOMB1 * rd16(mLCOMB1)) + norm(vCOMB2 * rd16(mLCOMB2)) + norm(vCOMB3 * rd16(mLCOMB3)) + norm(vCOMB4 * rd16(mLCOMB4));
// ___Late Reverb APF1(All Pass Filter 1, with input from COMB) ________________
// Lout = Lout - vAPF1 * [mLAPF1 - dAPF1], [mLAPF1] = Lout, Lout = Lout * vAPF1 + [mLAPF1 - dAPF1]
Lout = Lout - norm(vAPF1 * rd16(mLAPF1 - dAPF1));
wr16(mLAPF1, Lout);
Lout = norm(Lout * vAPF1) + rd16(mLAPF1 - dAPF1);
// ___Late Reverb APF2(All Pass Filter 2, with input from APF1) ________________
// Lout = Lout - vAPF2 * [mLAPF2 - dAPF2], [mLAPF2] = Lout, Lout = Lout * vAPF2 + [mLAPF2 - dAPF2]
Lout = Lout - norm(vAPF2 * rd16(mLAPF2 - dAPF2));
wr16(mLAPF2, Lout);
Lout = norm(Lout * vAPF2) + rd16(mLAPF2 - dAPF2);
// ___Output to Mixer(Output volume multiplied with input from APF2) ___________
// LeftOutput = Lout * vLOUT
return left = norm(Lout * vLOUT) / 0x8000;
};
const reverbRight = sample => {
// ___Input from Mixer(Input volume multiplied with incoming data)_____________
// Rin = vRIN * RightInput;from any channels that have Reverb enabled
const Rin = vRIN * sample;
// ____Same Side Reflection(left - to - left and right - to - right)___________________
// [mRSAME] = (Rin + [dRSAME] * vWALL - [mRSAME - 2]) * vIIR + [mRSAME - 2]; R - to - R
wr16(mRSAME, norm((Rin + norm(rd16(dRSAME) * vWALL) - rd16(mRSAME - 2)) * vIIR) + rd16(mRSAME - 2));
// ___Different Side Reflection(left - to - right and right - to - left)_______________
// [mRDIFF] = (Rin + [dLDIFF] * vWALL - [mRDIFF - 2]) * vIIR + [mRDIFF - 2]; L - to - R
wr16(mRDIFF, norm((Rin + norm(rd16(dLDIFF) * vWALL) - rd16(mRDIFF - 2)) * vIIR) + rd16(mRDIFF - 2));
// ___Early Echo(Comb Filter, with input from buffer) __________________________
// Rout = vCOMB1 * [mRCOMB1] + vCOMB2 * [mRCOMB2] + vCOMB3 * [mRCOMB3] + vCOMB4 * [mRCOMB4]
let Rout = norm(vCOMB1 * rd16(mRCOMB1)) + norm(vCOMB2 * rd16(mRCOMB2)) + norm(vCOMB3 * rd16(mRCOMB3)) + norm(vCOMB4 * rd16(mRCOMB4));
// ___Late Reverb APF1(All Pass Filter 1, with input from COMB) ________________
// Rout = Rout - vAPF1 * [mRAPF1 - dAPF1], [mRAPF1] = Rout, Rout = Rout * vAPF1 + [mRAPF1 - dAPF1]
Rout = Rout - norm(vAPF1 * rd16(mRAPF1 - dAPF1));
wr16(mRAPF1, Rout);
Rout = norm(Rout * vAPF1) + rd16(mRAPF1 - dAPF1);
// ___Late Reverb APF2(All Pass Filter 2, with input from APF1) ________________
// Rout = Rout - vAPF2 * [mRAPF2 - dAPF2], [mRAPF2] = Rout, Rout = Rout * vAPF2 + [mRAPF2 - dAPF2]
Rout = Rout - norm(vAPF2 * rd16(mRAPF2 - dAPF2));
wr16(mRAPF2, Rout);
Rout = norm(Rout * vAPF2) + rd16(mRAPF2 - dAPF2);
// ___Output to Mixer(Output volume multiplied with input from APF2) ___________
// RightOutput = Rout * vROUT
bufferAddress += 2;
return right = norm(Rout * vROUT) / 0x8000;
};
return {
advance: (sampleIndex, sampleLeft, sampleRight, ram) => {
memory = ram;
return (sampleIndex & 1) ? [left, reverbRight(sampleRight)] : [reverbLeft(sampleLeft), right];
},
rd16: (addr) => {
console.log('rd16', hex(addr, 4));
},
wr16: (addr, data) => {
writeHandlers.get(addr)(data);
}
}
})
mdlr('enge:psx:spu-voice', m => {
let BLOCKSIZE = (28 * 0x1000) >>> 0;
let id = 0;
let adsrLevel = 0;
let adsrState = 0;
let adsrAttackMode = 0;
let adsrAttackRate = 0;
let adsrDecayRate = 0;
let adsrSustainMode = 0;
let adsrSustainRate = 0;
let adsrSustainLevel = 0;
let adsrSustainDirection = 0;
let adsrReleaseMode = 0;
let adsrReleaseRate = 0;
let sweepLeft = [];
let sweepRight = [];
let pitchStep = 0;
let pitchCounter = BLOCKSIZE;
let repeatAddress = 0;
let blockAddress = 0;
let buffer = new Float32Array(28);
let s0 = 0.0;
let s1 = 0.0;
let volumeLeft = 0.0;
let volumeRight = 0.0;
let regs = new Uint16Array(16);
const gauss = [
-1, -1, -1, -1, -1, -1, -1, -1,
-1, -1, -1, -1, -1, -1, -1, -1,
0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0001,
0x0001, 0x0001, 0x0001, 0x0002, 0x0002, 0x0002, 0x0003, 0x0003,
0x0003, 0x0004, 0x0004, 0x0005, 0x0005, 0x0006, 0x0007, 0x0007,
0x0008, 0x0009, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E,
0x000F, 0x0010, 0x0011, 0x0012, 0x0013, 0x0015, 0x0016, 0x0018,
0x0019, 0x001B, 0x001C, 0x001E, 0x0020, 0x0021, 0x0023, 0x0025,
0x0027, 0x0029, 0x002C, 0x002E, 0x0030, 0x0033, 0x0035, 0x0038,
0x003A, 0x003D, 0x0040, 0x0043, 0x0046, 0x0049, 0x004D, 0x0050,
0x0054, 0x0057, 0x005B, 0x005F, 0x0063, 0x0067, 0x006B, 0x006F,
0x0074, 0x0078, 0x007D, 0x0082, 0x0087, 0x008C, 0x0091, 0x0096,
0x009C, 0x00A1, 0x00A7, 0x00AD, 0x00B3, 0x00BA, 0x00C0, 0x00C7,
0x00CD, 0x00D4, 0x00DB, 0x00E3, 0x00EA, 0x00F2, 0x00FA, 0x0101,
0x010A, 0x0112, 0x011B, 0x0123, 0x012C, 0x0135, 0x013F, 0x0148,
0x0152, 0x015C, 0x0166, 0x0171, 0x017B, 0x0186, 0x0191, 0x019C,
0x01A8, 0x01B4, 0x01C0, 0x01CC, 0x01D9, 0x01E5, 0x01F2, 0x0200,
0x020D, 0x021B, 0x0229, 0x0237, 0x0246, 0x0255, 0x0264, 0x0273,
0x0283, 0x0293, 0x02A3, 0x02B4, 0x02C4, 0x02D6, 0x02E7, 0x02F9,
0x030B, 0x031D, 0x0330, 0x0343, 0x0356, 0x036A, 0x037E, 0x0392,
0x03A7, 0x03BC, 0x03D1, 0x03E7, 0x03FC, 0x0413, 0x042A, 0x0441,
0x0458, 0x0470, 0x0488, 0x04A0, 0x04B9, 0x04D2, 0x04EC, 0x0506,
0x0520, 0x053B, 0x0556, 0x0572, 0x058E, 0x05AA, 0x05C7, 0x05E4,
0x0601, 0x061F, 0x063E, 0x065C, 0x067C, 0x069B, 0x06BB, 0x06DC,
0x06FD, 0x071E, 0x0740, 0x0762, 0x0784, 0x07A7, 0x07CB, 0x07EF,
0x0813, 0x0838, 0x085D, 0x0883, 0x08A9, 0x08D0, 0x08F7, 0x091E,
0x0946, 0x096F, 0x0998, 0x09C1, 0x09EB, 0x0A16, 0x0A40, 0x0A6C,
0x0A98, 0x0AC4, 0x0AF1, 0x0B1E, 0x0B4C, 0x0B7A, 0x0BA9, 0x0BD8,
0x0C07, 0x0C38, 0x0C68, 0x0C99, 0x0CCB, 0x0CFD, 0x0D30, 0x0D63,
0x0D97, 0x0DCB, 0x0E00, 0x0E35, 0x0E6B, 0x0EA1, 0x0ED7, 0x0F0F,
0x0F46, 0x0F7F, 0x0FB7, 0x0FF1, 0x102A, 0x1065, 0x109F, 0x10DB,
0x1116, 0x1153, 0x118F, 0x11CD, 0x120B, 0x1249, 0x1288, 0x12C7,
0x1307, 0x1347, 0x1388, 0x13C9, 0x140B, 0x144D, 0x1490, 0x14D4,
0x1517, 0x155C, 0x15A0, 0x15E6, 0x162C, 0x1672, 0x16B9, 0x1700,
0x1747, 0x1790, 0x17D8, 0x1821, 0x186B, 0x18B5, 0x1900, 0x194B,
0x1996, 0x19E2, 0x1A2E, 0x1A7B, 0x1AC8, 0x1B16, 0x1B64, 0x1BB3,
0x1C02, 0x1C51, 0x1CA1, 0x1CF1, 0x1D42, 0x1D93, 0x1DE5, 0x1E37,
0x1E89, 0x1EDC, 0x1F2F, 0x1F82, 0x1FD6, 0x202A, 0x207F, 0x20D4,
0x2129, 0x217F, 0x21D5, 0x222C, 0x2282, 0x22DA, 0x2331, 0x2389,
0x23E1, 0x2439, 0x2492, 0x24EB, 0x2545, 0x259E, 0x25F8, 0x2653,
0x26AD, 0x2708, 0x2763, 0x27BE, 0x281A, 0x2876, 0x28D2, 0x292E,
0x298B, 0x29E7, 0x2A44, 0x2AA1, 0x2AFF, 0x2B5C, 0x2BBA, 0x2C18,
0x2C76, 0x2CD4, 0x2D33, 0x2D91, 0x2DF0, 0x2E4F, 0x2EAE, 0x2F0D,
0x2F6C, 0x2FCC, 0x302B, 0x308B, 0x30EA, 0x314A, 0x31AA, 0x3209,
0x3269, 0x32C9, 0x3329, 0x3389, 0x33E9, 0x3449, 0x34A9, 0x3509,
0x3569, 0x35C9, 0x3629, 0x3689, 0x36E8, 0x3748, 0x37A8, 0x3807,
0x3867, 0x38C6, 0x3926, 0x3985, 0x39E4, 0x3A43, 0x3AA2, 0x3B00,
0x3B5F, 0x3BBD, 0x3C1B, 0x3C79, 0x3CD7, 0x3D35, 0x3D92, 0x3DEF,
0x3E4C, 0x3EA9, 0x3F05, 0x3F62, 0x3FBD, 0x4019, 0x4074, 0x40D0,
0x412A, 0x4185, 0x41DF, 0x4239, 0x4292, 0x42EB, 0x4344, 0x439C,
0x43F4, 0x444C, 0x44A3, 0x44FA, 0x4550, 0x45A6, 0x45FC, 0x4651,
0x46A6, 0x46FA, 0x474E, 0x47A1, 0x47F4, 0x4846, 0x4898, 0x48E9,
0x493A, 0x498A, 0x49D9, 0x4A29, 0x4A77, 0x4AC5, 0x4B13, 0x4B5F,
0x4BAC, 0x4BF7, 0x4C42, 0x4C8D, 0x4CD7, 0x4D20, 0x4D68, 0x4DB0,
0x4DF7, 0x4E3E, 0x4E84, 0x4EC9, 0x4F0E, 0x4F52, 0x4F95, 0x4FD7,
0x5019, 0x505A, 0x509A, 0x50DA, 0x5118, 0x5156, 0x5194, 0x51D0,
0x520C, 0x5247, 0x5281, 0x52BA, 0x52F3, 0x532A, 0x5361, 0x5397,
0x53CC, 0x5401, 0x5434, 0x5467, 0x5499, 0x54CA, 0x54FA, 0x5529,
0x5558, 0x5585, 0x55B2, 0x55DE, 0x5609, 0x5632, 0x565B, 0x5684,
0x56AB, 0x56D1, 0x56F6, 0x571B, 0x573E, 0x5761, 0x5782, 0x57A3,
0x57C3, 0x57E2, 0x57FF, 0x581C, 0x5838, 0x5853, 0x586D, 0x5886,
0x589E, 0x58B5, 0x58CB, 0x58E0, 0x58F4, 0x5907, 0x5919, 0x592A,
0x593A, 0x5949, 0x5958, 0x5965, 0x5971, 0x597C, 0x5986, 0x598F,
0x5997, 0x599E, 0x59A4, 0x59A9, 0x59AD, 0x59B0, 0x59B2, 0x59B3
];
const adsrStep = (direction, mode, rate, level = adsrLevel) => {
const table = direction ? envelopeExponentialDecrease : envelopeExponentialIncrease;
const offset = mode ? table[level >>> 28] : 0;
const step = envelopStep[rate + offset];
return direction ? -step : step;
}
const mixADSR = () => {
switch (adsrState) {
case 0x0:
adsrLevel = 0.0;
case 0x1:
adsrLevel += adsrStep(0, adsrAttackMode, adsrAttackRate);
if (adsrLevel >= 0x7FFFFFFF) {
adsrState = 2;
}
break;
case 0x2:
adsrLevel += adsrStep(1, 1, adsrDecayRate);
if (((adsrLevel >>> 27) & 15) <= adsrSustainLevel) {
adsrState = 3;
}
break;
case 0x3:
adsrLevel += adsrStep(adsrSustainDirection, adsrSustainMode, adsrSustainRate);
break;
case 0x4:
adsrLevel += adsrStep(1, adsrReleaseMode, adsrReleaseRate);
if (adsrLevel <= 0) {
adsrState = 0;
}
break;
}
if (adsrLevel > 0x7FFFFFFF) {
adsrLevel = 0x7FFFFFFF;
}
if (adsrLevel < 0) {
adsrLevel = 0;
}
return (regs[0x0c] = adsrLevel >>> 16) / 0x8000;
}
const startAdsrAttack = () => {
adsrState = 1;
adsrLevel = 0;
}
const startAdsrRelease = () => {
adsrState = 4;
}
const decodeBlock = (ram) => {
const shiftFilter = ram[blockAddress + 0];
const flags = ram[blockAddress + 1];
const shift = (shiftFilter & 0x0f) >>> 0;
const filter = (shiftFilter & 0xf0) >>> 3;
const k0 = xa2flt[filter + 0];
const k1 = xa2flt[filter + 1];
let sample = -1;
for (let offset = 2; offset < 16; ++offset) {
let data = ram[blockAddress + offset];
let index = ((shift << 8) + data) << 1;
let value;
value = (s0 * k0) + (s1 * k1) + xa2pcm[index + 0];
s1 = s0; s0 = buffer[++sample] = value;
value = (s0 * k0) + (s1 * k1) + xa2pcm[index + 1];
s1 = s0; s0 = buffer[++sample] = value;
}
if ((flags & 4) === 4) {
repeatAddress = blockAddress;
}
blockAddress += 16;
if ((flags & 1) === 1) {
blockAddress = repeatAddress;
spu.ENDX |= (1 << id);
if ((flags & 2) === 0) {
startAdsrRelease();
adsrLevel = 0;
}
}
}
let $s1, $s2, $s3, $s4;
const voice = {
reverb: 0,
capture: 0,
setId(voiceId) {
id = voiceId;
if (voiceId === 1) voice.capture = 0x0800;
if (voiceId === 3) voice.capture = 0x0c00;
return voice;
},
advance(ram, audio) {
if (!adsrState) return adsrState; // note: this is an optimisation that behave differently then the hardware does.
pitchCounter += pitchStep;
if (pitchCounter >= BLOCKSIZE) {
pitchCounter -= BLOCKSIZE;
decodeBlock(ram);
spu.checkIrq(voice);
}
const sample = buffer[pitchCounter >>> 12];
const adsrVolume = mixADSR();
$s1 = sample * adsrVolume;
const i = (pitchCounter >>> 3) & 0xff;
let out = ((gauss[255 - i] * $s4));
out = out + ((gauss[511 - i] * $s3));
out = out + ((gauss[256 + i] * $s2));
out = out + ((gauss[i] * $s1));
let s = out / 0x8000;
// if (out) console.log(out);
audio[0] = (s * volumeLeft * mixSweep(sweepLeft))
audio[1] = (s * volumeRight * mixSweep(sweepRight));
$s4 = $s3;
$s3 = $s2;
$s2 = $s1;
return adsrState;
},
checkIrq(offset) {
return (blockAddress <= offset) && (offset < (blockAddress + 16));
},
keyOn() {
s0 = 0.0;
s1 = 0.0;
$s1 = 0, $s2 = 0, $s3 = 0, $s4 = 0;
pitchCounter = BLOCKSIZE;
blockAddress = regs[0x6] << 3;
repeatAddress = regs[0xe] << 3;
startAdsrAttack();
},
echoOn(enabled) {
// todo: reverb
voice.reverb = enabled;
},
modOn() {
// todo: pitch modulation
},
noiseOn() {
// todo: noise
},
keyOff() {
startAdsrRelease();
},
rd16(addr) {
return regs[addr & 15];
},
wr16(addr, data) {
regs[addr & 15] = data;
switch (addr % 16) {
case 0x0:
if (data & 0x8000) {
sweepLeft = getEnvelope(data);
}
else {
sweepLeft = [];
volumeLeft = spu.getVolume(data);
}
break;
case 0x2:
if (data & 0x8000) {
sweepRight = getEnvelope(data);
}
else {
sweepRight = [];
volumeRight = spu.getVolume(data);
}
break;
case 0x4:
pitchStep = Math.min(data, 0x4000);
break;
// case 0x6:
//   blockAddress = data << 3;
//   break;
case 0x8:
adsrAttackMode = (data >>> 15) & 1
adsrAttackRate = ((data >>> 8) & 127);
adsrDecayRate = ((data >>> 4) & 15) << 3;
adsrSustainLevel = 1 + (data & 15);
break;
case 0xa:
adsrSustainMode = (data >>> 15) & 1;
adsrSustainDirection = (data >>> 14) & 1;
adsrSustainRate = (data >>> 6) & 127;
adsrReleaseMode = (data >>> 5) & 1;
adsrReleaseRate = (data & 31) << 2;
break;
// case 0xc:
//   adsrLevel = data << 16;
//   break;
case 0xe:
repeatAddress = data << 3;
break;
}
}
}
const envelopStep = [];
const envelopeExponentialIncrease = [0, 0, 0, 0, 0, 0, 8, 8];
const envelopeExponentialDecrease = [12, 8, 6, 4, 3, 2, 1, 0];
const max = (a, b) => a > b ? a : b;
const getEnvelope = (data) => {
const mode = (data & (1 << 14)) ? 1 : 0;
const direction = (data & (1 << 13)) ? 1 : 0;
const rate = (data >> 0) & 127;
return [mode, direction, rate, adsrLevel];
}
const mixSweep = (sweep) => {
const { mode, direction, rate, level } = sweep;
if (mode === undefined) return 1.0;
sweep[3] += adsrStep(direction, mode, rate, level);
return (sweep[3] >>> 16) / 0x8000;
}
for (let i = 0; i < 140; ++i) {
const step = i & 3;
const shift = i >> 2;
const $cycles = 1 << max(0, shift - 11);
const $step = (7 - step) << max(0, 11 - shift);
envelopStep[i] = (($step / $cycles * 0x10000) >>> 0);
}
return { voice };
})
mdlr('enge:psx:webgl');