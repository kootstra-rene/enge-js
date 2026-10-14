mdlr("enge:webgpu", () => {
  Uint32Array.prototype.addVertexDisp = function (x, y, u, v) {
    var xy = (y << 16) | (x & 0xffff);
    var uv = (v << 16) | (u & 0xffff);

    var index = this.index >>> 2;
    this[index + 0] = xy;
    this[index + 1] = uv;

    this.index += 8;
  };

  Uint32Array.prototype.addVertex = function (x, y, c) {
    x = x * 16;
    y = y * 16;
    var xy = (y << 16) | (x & 0xffff);

    var index = this.index >>> 2;

    this[index + 0] = (c & 0xffffff) | 0x03000000;
    this[index + 1] = xy;

    this.index += 24;
  };

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
    // Texture-window offsets only replace coordinate bits selected by the mask.
    this[index + 5] = (gpu.twin & 0xffff) | (gpu.twin & (gpu.twin << 16));

    this.index += 24;
  };

  Uint32Array.prototype.getNumberOfVertices = function () {
    return this.index / 24;
  };

  Uint32Array.prototype.canHold = function (cnt) {
    return this.index + 24 * cnt * 2 < this.length * 4;
  };

  Uint32Array.prototype.reset = function () {
    this.index = 0;
  };

  Uint32Array.prototype.view = function () {
    return new Uint32Array(this.buffer, 0, this.index >> 2);
  };

  const quality = Math.max(1, Math.min(4, settings.quality || 1));
  const shader = `
struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec3f, @location(1) uv: vec2f,
 @location(2) @interpolate(flat) clut: vec2u, @location(3) @interpolate(flat) page: vec2u,
 @location(4) @interpolate(flat) window: vec4u, @location(5) @interpolate(flat) mode: u32 };
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> vertices: array<u32>;
@group(0) @binding(2) var<uniform> params: vec4f;
fn signed16(v:u32)->f32 { return f32(i32(v << 16u) >> 16); }
@vertex fn vertex(@builtin(vertex_index) i:u32)->Vertex {
 let n=i*6u; let c=vertices[n]; let xy=vertices[n+1u]; let uv=vertices[n+2u];
 let cl=vertices[n+3u]; let page=vertices[n+4u]; let win=vertices[n+5u]; var o:Vertex;
 // Match PS1's half-pixel vertex sampling when rasterizing at pixel centers.
 o.position=vec4f((signed16(xy)+8.0)/8192.0-1.0,1.0-(signed16(xy>>16u)+8.0)/4096.0,0.0,1.0);
 o.color=vec3f(f32(c&255u),f32((c>>8u)&255u),f32((c>>16u)&255u))/256.0;
 o.uv=vec2f(signed16(uv),signed16(uv>>16u)); o.clut=vec2u(cl&65535u,cl>>16u);
 o.page=vec2u(page&65535u,page>>16u);o.window=vec4u(win&255u,(win>>8u)&255u,(win>>16u)&255u,win>>24u);
 o.mode=c>>24u;return o;
}
fn pixel(x:u32,y:u32)->vec4f {return textureLoad(source,vec2i(i32(x&1023u)*${quality},i32(y&511u)*${quality}),0);}
fn word(x:u32,y:u32)->u32 {let c=pixel(x,y);let rgb=vec3u(clamp(round(c.rgb*32.0),vec3f(0.0),vec3f(31.0)));
 return rgb.r|(rgb.g<<5u)|(rgb.b<<10u)|select(0u,32768u,c.a>=0.5);}
@fragment fn fragment(i:Vertex)->@location(0) vec4f {
 let depth=i.mode&7u; if(depth==3u){return vec4f(i.color,params.x);}
 var uv=vec2u(vec2i(floor(i.uv+vec2f(0.001))));if(depth!=2u && any(i.window.xy!=vec2u(0u))){
 // Preserve the working WebGL1 modulo window behaviour in this initial backend.
 uv=uv%(vec2u(256u)-i.window.xy);}
 let t=i.page+i.window.zw+uv;var c:vec4f;
 if(depth==2u){c=pixel(t.x,t.y);}else {
 var index:u32;if(depth==0u){let packed=word(t.x/4u,t.y);index=(packed>>((t.x&3u)*4u))&15u;}
 else {let packed=word(t.x/2u,t.y);index=(packed>>((t.x&1u)*8u))&255u;}
 c=pixel(i.clut.x+index,i.clut.y);}
 if(all(c==vec4f(0.0))){discard;}
 let stp=i.mode/8u;if((stp==3u&&c.a<0.5)||(stp==2u&&c.a>=0.5)){discard;}
 return vec4f(2.0*i.color*c.rgb,params.x);
}`;
  const displayShader = `
struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f };
struct Display {area:vec4u,flags:vec4u};
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> display:Display;
@vertex fn vertex(@builtin(vertex_index) i:u32)->Output {
 var points=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));var o:Output;
 o.uv=points[i];o.position=vec4f(o.uv.x*2.0-1.0,1.0-o.uv.y*2.0,0,1);return o;}
fn word(x:u32,y:u32)->u32 {let c=textureLoad(source,vec2i(i32(x&1023u)*${quality},i32(y&511u)*${quality}),0);
 let rgb=vec3u(clamp(round(c.rgb*32.0),vec3f(0),vec3f(31)));return rgb.r|(rgb.g<<5u)|(rgb.b<<10u)|select(0u,32768u,c.a>=0.5);}
fn byte(x:u32,y:u32)->f32 {return f32((word(x/2u,y)>>((x&1u)*8u))&255u)/255.0;}
@fragment fn fragment(i:Output)->@location(0) vec4f {
 if(display.flags.x==1u){return vec4f(0,0,0,1);}
 let offset=vec2u(i.uv*vec2f(display.area.zw));let p=display.area.xy+offset;
 if(display.flags.y==1u){let x=display.area.x*2u+offset.x*3u;return vec4f(byte(x,p.y),byte(x+1u,p.y),byte(x+2u,p.y),1);}
 return vec4f(textureLoad(source,vec2i(i32(p.x&1023u)*${quality},i32(p.y&511u)*${quality}),0).rgb,1);}
`;
  class WebGPURenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.vram = new Uint16Array(1024 * 512);
      this.vertexBuffer = new Uint32Array((18 * 1024) >> 2);
      this.vertexBuffer.reset();
      this.drawOffsetX = 0;
      this.drawOffsetY = 0;
      this.drawAreaL = 0;
      this.drawAreaT = 0;
      this.drawAreaR = 1023;
      this.drawAreaB = 511;
      this.renderMode = 4;
      this.displaymode = 2;
      this.fpsCounter = 0;
      this.fpsRenderCounter = 0;
      this.ready = this.initialize();
    }
    async initialize() {
      if (!navigator.gpu)
        throw new Error(
          "WebGPU is unavailable. Open this page in a WebGPU-capable browser on localhost or HTTPS.",
        );
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("No WebGPU adapter is available.");
      this.device = await adapter.requestDevice();
      const d = this.device;
      this.context = this.canvas.getContext("webgpu");
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: d,
        format: this.format,
        alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      d.addEventListener("uncapturederror", (e) => {
        console.error("WebGPU:", e.error);
        this.error = e.error.message;
      });
      d.lost.then((info) => {
        this.error = "WebGPU device lost: " + info.message;
        console.error(this.error);
        window.spu?.silence();
      });
      const texture = {
        size: [1024 * quality, 512 * quality],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      };
      this.target = d.createTexture(texture);
      this.source = d.createTexture(texture);
      const module = d.createShaderModule({ code: shader });
      const errors = (await module.getCompilationInfo()).messages.filter(
        (m) => m.type === "error",
      );
      if (errors.length)
        throw new Error(errors.map((m) => m.message).join("\n"));
      const drawLayout=d.createBindGroupLayout({entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
        {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage',hasDynamicOffset:true}},
        {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
      ]});
      const pipelineLayout=d.createPipelineLayout({bindGroupLayouts:[drawLayout]});
      this.pipelines = [];
      for (let mode = 0; mode < 5; mode++) {
        let blend;
        const component = (srcFactor, dstFactor, operation = "add") => ({
          srcFactor,
          dstFactor,
          operation,
        });
        if (mode === 0) blend = component("src-alpha", "src-alpha");
        if (mode === 1) blend = component("one", "one");
        if (mode === 2) blend = component("one", "one", "reverse-subtract");
        if (mode === 3) blend = component("one-minus-src-alpha", "one");
        this.pipelines.push(
          d.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module, entryPoint: "vertex" },
            fragment: {
              module,
              entryPoint: "fragment",
              targets: [
                {
                  format: "rgba8unorm",
                  blend: blend ? { color: blend, alpha: blend } : undefined,
                },
              ],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
          }),
        );
      }
      const screen = d.createShaderModule({ code: displayShader });
      this.displayPipeline = d.createRenderPipeline({
        layout: "auto",
        vertex: { module: screen, entryPoint: "vertex" },
        fragment: {
          module: screen,
          entryPoint: "fragment",
          targets: [{ format: this.format }],
        },
        primitive: { topology: "triangle-list" },
      });
    }
    getClutInfo() {
      return 3;
    }
    setBlendMode(mode) {
      // Texture depth is stored per vertex and does not affect the pipeline.
      mode &= 15;
      if (this.renderMode !== mode) {
        this.flushVertexBuffer(true);
        this.renderMode = mode;
      }
    }
    needsTextureSync(data) {
      if (!this.dirty) return false;

      const [left, top, right, bottom] = this.dirty;
      const overlapsWrapped = (start, size, min, max, limit) => {
        start = ((start % limit) + limit) % limit;
        const end = start + size;
        if (end <= limit) return start < max && end > min;
        return (start < max && limit > min) || (end - limit > min && max > 0);
      };
      const overlapsVram = (x, y, width, height) =>
        overlapsWrapped(x, width, left, right, 1024) &&
        overlapsWrapped(y, height, top, bottom, 512);

      for (let i = 0; i < data.length; i += 6) {
        const depth = (data[i] >>> 24) & 7;
        if (depth === 3) continue;

        const page = data[i + 4];
        const window = data[i + 5];
        const divisor = depth === 0 ? 4 : depth === 1 ? 2 : 1;
        const textureX = Math.floor(
          ((page & 0xffff) + ((window >>> 16) & 0xff)) / divisor,
        );
        const textureY = (page >>> 16) + (window >>> 24);
        const textureWidth = Math.ceil(256 / divisor) + 1;
        if (overlapsVram(textureX, textureY, textureWidth, 256)) return true;

        if (depth < 2) {
          const clut = data[i + 3];
          const clutX = clut & 0xffff;
          const clutY = clut >>> 16;
          const clutWidth = depth === 0 ? 16 : 256;
          if (overlapsVram(clutX, clutY, clutWidth, 1)) return true;
        }
      }

      return false;
    }
    flushVertexBuffer(clip = true) {
      if (!this.vertexBuffer.index) return;
      const d = this.device;
      const mode = this.renderMode & 15;
      const data = this.vertexBuffer.view();
      if (!this.gpuVertices) {
        this.gpuVertices = d.createBuffer({
          size: this.vertexBuffer.byteLength * 256,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.drawGroups = this.pipelines.map((pipeline, index) => {
          const params = d.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          d.queue.writeBuffer(
            params,
            0,
            new Float32Array([[0.5, 1, 1, 0.75, 0][index], 0, 0, 0]),
          );
          return d.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: this.source.createView() },
              { binding: 1, resource: { buffer: this.gpuVertices, size:this.vertexBuffer.byteLength } },
              { binding: 2, resource: { buffer: params } },
            ],
          });
        });
      }
      // Give each pending draw a distinct slot until its command list is submitted.
      if((this.drawSlot||0)>=256)this.submitDrawing();
      const offset=(this.drawSlot||0)*this.vertexBuffer.byteLength;
      this.drawSlot=(this.drawSlot||0)+1;
      d.queue.writeBuffer(this.gpuVertices, offset, data);
      const pipeline = this.pipelines[mode],
        group = this.drawGroups[mode];
      const encoder = this.drawingEncoder ||= d.createCommandEncoder();
      let textured = false;
      for (let i = 0; i < data.length; i += 6)
        if (((data[i] >>> 24) & 7) !== 3) {
          textured = true;
          break;
        }
      // Untextured primitives never sample VRAM; snapshot only when it is read.
      if (textured && this.dirty) {
        if (this.needsTextureSync(data)) {
          if (this.drawingPass) {
            this.drawingPass.end();
            this.drawingPass = null;
          }
          const [x, y, r, b] = this.dirty;
          encoder.copyTextureToTexture(
            { texture: this.target, origin: [x * quality, y * quality] },
            { texture: this.source, origin: [x * quality, y * quality] },
            [(r - x) * quality, (b - y) * quality],
          );
          this.dirty = null;
        }
      }
      const pass = this.drawingPass ||= encoder.beginRenderPass({
        colorAttachments: [
          { view: this.target.createView(), loadOp: "load", storeOp: "store" },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group, [offset]);
      let l = 0,
        t = 0,
        r = 1024,
        b = 512;
      if (clip) {
        l = Math.max(0, this.drawAreaL);
        t = Math.max(0, this.drawAreaT);
        r = Math.min(1024, this.drawAreaR + 1);
        b = Math.min(512, this.drawAreaB + 1);
      }
      if (r > l && b > t) {
        pass.setScissorRect(
          l * quality,
          t * quality,
          (r - l) * quality,
          (b - t) * quality,
        );
        pass.draw(this.vertexBuffer.getNumberOfVertices());
      }
      let minX = r,
        minY = b,
        maxX = l,
        maxY = t;
      for (let i = 1; i < data.length; i += 6) {
        const packed = data[i],
          x = ((packed << 16) >> 16) / 16,
          y = (packed >> 16) / 16;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      minX = Math.max(l, Math.floor(minX));
      minY = Math.max(t, Math.floor(minY));
      maxX = Math.min(r, Math.ceil(maxX));
      maxY = Math.min(b, Math.ceil(maxY));
      if (maxX > minX && maxY > minY) {
        const old = this.dirty;
        this.dirty = old
          ? [
              Math.min(old[0], minX),
              Math.min(old[1], minY),
              Math.max(old[2], maxX),
              Math.max(old[3], maxY),
            ]
          : [minX, minY, maxX, maxY];
      }
      this.vertexBuffer.reset();
    }
    submitDrawing(){
      if (this.drawingPass) {
        this.drawingPass.end();
        this.drawingPass = null;
      }
      if(this.drawingEncoder){this.device.queue.submit([this.drawingEncoder.finish()]);this.drawingEncoder=null;}
      this.drawSlot=0;
    }
    storeImage(img) {
      this.flushVertexBuffer(true);
      this.submitDrawing();
      for (let j = 0; j < img.h; j++)
        for (let i = 0; i < img.w; i++)
          this.vram[((img.y + j) & 511) * 1024 + ((img.x + i) & 1023)] =
            img.buffer[j * img.w + i];
      for (let j = 0; j < img.h; ) {
        const y = (img.y + j) & 511,
          h = Math.min(img.h - j, 512 - y);
        for (let i = 0; i < img.w; ) {
          const x = (img.x + i) & 1023,
            w = Math.min(img.w - i, 1024 - x);
          const pixels = new Uint8Array(w * h * quality * quality * 4);
          for (let row = 0; row < h * quality; row++)
            for (let col = 0; col < w * quality; col++) {
              const value =
                this.vram[
                  (y + Math.floor(row / quality)) * 1024 +
                    x +
                    Math.floor(col / quality)
                ];
              const n = (row * w * quality + col) * 4;
              pixels[n] = Math.round(((value & 31) * 255) / 32);
              pixels[n + 1] = Math.round((((value >> 5) & 31) * 255) / 32);
              pixels[n + 2] = Math.round((((value >> 10) & 31) * 255) / 32);
              pixels[n + 3] = value & 32768 ? 255 : 0;
            }
          this.device.queue.writeTexture(
            { texture: this.target, origin: [x * quality, y * quality] },
            pixels,
            { bytesPerRow: w * quality * 4 },
            [w * quality, h * quality],
          );
          i += w;
        }
        j += h;
      }
      this.dirty = [0, 0, 1024, 512];
    }
    async readRenderedImageAsync(x, y, w, h, buffer = new Uint16Array(w * h)) {
      this.flushVertexBuffer(true);
      this.submitDrawing();
      for (let row = 0; row < h; ) {
        const y0 = (y + row) & 511,
          rows = Math.min(h - row, 512 - y0);
        for (let column = 0; column < w; ) {
          const x0 = (x + column) & 1023,
            columns = Math.min(w - column, 1024 - x0);
          const width = columns * quality,
            height = rows * quality,
            pitch = Math.ceil((width * 4) / 256) * 256;
          const staging = this.device.createBuffer({
            size: pitch * height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          const encoder = this.device.createCommandEncoder();
          encoder.copyTextureToBuffer(
            { texture: this.target, origin: [x0 * quality, y0 * quality] },
            { buffer: staging, bytesPerRow: pitch },
            [width, height],
          );
          this.device.queue.submit([encoder.finish()]);
          await staging.mapAsync(GPUMapMode.READ);
          const bytes = new Uint8Array(staging.getMappedRange());
          for (let j = 0; j < rows; j++)
            for (let i = 0; i < columns; i++) {
              const n =
                (j * quality + (quality >> 1)) * pitch +
                (i * quality + (quality >> 1)) * 4;
              const r = Math.min(31, Math.round((bytes[n] * 32) / 255)),
                g = Math.min(31, Math.round((bytes[n + 1] * 32) / 255)),
                b = Math.min(31, Math.round((bytes[n + 2] * 32) / 255));
              buffer[(row + j) * w + column + i] =
                r | (g << 5) | (b << 10) | (bytes[n + 3] >= 128 ? 32768 : 0);
            }
          staging.unmap();
          staging.destroy();
          column += columns;
        }
        row += rows;
      }
      return buffer;
    }
    loadImage(x, y, w, h, buffer) {
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++)
          buffer[j * w + i] =
            this.vram[((y + j) & 511) * 1024 + ((x + i) & 1023)];
    }
    getVramState() {
      return new Uint16Array(this.vram);
    }
    setVramState(buffer) {
      this.storeImage({ x: 0, y: 0, w: 1024, h: 512, buffer });
    }
    moveImage(sx, sy, dx, dy, w, h) {
      this.flushVertexBuffer(true);
      this.submitDrawing();
      const words = new Uint16Array(w * h);
      this.loadImage(sx, sy, w, h, words);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++)
          this.vram[((dy + j) & 511) * 1024 + ((dx + i) & 1023)] =
            words[j * w + i];
      const d = this.device,
        temp = d.createTexture({
          size: [w * quality, h * quality],
          format: "rgba8unorm",
          usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        });
      const encoder = d.createCommandEncoder();
      const copy = (x, y, toTemp) => {
        for (let row = 0; row < h; ) {
          const yy = (y + row) & 511,
            rows = Math.min(h - row, 512 - yy);
          for (let col = 0; col < w; ) {
            const xx = (x + col) & 1023,
              cols = Math.min(w - col, 1024 - xx);
            const vram = {
                texture: this.target,
                origin: [xx * quality, yy * quality],
              },
              tmp = { texture: temp, origin: [col * quality, row * quality] };
            encoder.copyTextureToTexture(
              toTemp ? vram : tmp,
              toTemp ? tmp : vram,
              [cols * quality, rows * quality],
            );
            col += cols;
          }
          row += rows;
        }
      };
      copy(sx, sy, true);
      copy(dx, dy, false);
      d.queue.submit([encoder.finish()]);
      temp.destroy();
      this.dirty = [0, 0, 1024, 512];
    }
    clearVRAM(x, y, w, h, color, clip) {
      if (clip) {
        const r = Math.min(x + w, this.drawAreaR + 1),
          b = Math.min(y + h, this.drawAreaB + 1);
        x = Math.max(x, this.drawAreaL);
        y = Math.max(y, this.drawAreaT);
        w = r - x;
        h = b - y;
      }
      if (w <= 0 || h <= 0) return;
      const value =
        ((color >> 3) & 31) |
        (((color >> 11) & 31) << 5) |
        (((color >> 19) & 31) << 10);
      this.storeImage({
        x,
        y,
        w,
        h,
        buffer: new Uint16Array(w * h).fill(value),
      });
    }
    fillRectangle(data) {
      let x = data[1] & 0x3f0,
        y = (data[1] >>> 16) & 511,
        w = ((data[2] & 1023) + 15) & ~15,
        h = (data[2] >>> 16) & 511;
      this.clearVRAM(x, y, w, h, data[0] & 0xffffff, false);
    }
    setDrawAreaOF(x, y) {
      this.drawOffsetX = x;
      this.drawOffsetY = y;
    }
    setDrawAreaTL(x, y) {
      this.flushVertexBuffer(true);
      this.drawAreaL = x;
      this.drawAreaT = y;
    }
    setDrawAreaBR(x, y) {
      this.flushVertexBuffer(true);
      this.drawAreaR = x;
      this.drawAreaB = y;
    }
    setMode(mode) {
      this.displaymode = mode === "disp" ? 2 : mode === "page2" ? 3 : 1;
    }
    onVBlankEnd() {}
    onVBlankBegin() {
      if (this.error) return;
      this.flushVertexBuffer(true);
      this.submitDrawing();
      let area =
        this.displaymode === 2
          ? gpu.getDisplayArea()
          : { x: 0, y: 0, w: 1024, h: 512 };
      if (!area.w || !area.h) return;
      const is24 = !!(gpu.status & (1 << 21)),
        d = this.device;
      const width = area.w * (is24 ? 1 : quality),
        height = area.h * (is24 ? 1 : quality);
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      if (!this.displayParams) {
        this.displayParams = d.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.displayGroup = d.createBindGroup({
          layout: this.displayPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.target.createView() },
            { binding: 1, resource: { buffer: this.displayParams } },
          ],
        });
      }
      const params = this.displayParams;
      d.queue.writeBuffer(
        params,
        0,
        new Uint32Array([
          area.x,
          area.y,
          area.w,
          area.h,
          (gpu.status >>> 23) & 1,
          is24 ? 1 : 0,
          0,
          0,
        ]),
      );
      const group = this.displayGroup;
      const encoder = d.createCommandEncoder(),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: this.context.getCurrentTexture().createView(),
              loadOp: "clear",
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              storeOp: "store",
            },
          ],
        });
      pass.setPipeline(this.displayPipeline);
      pass.setBindGroup(0, group);
      pass.draw(6);
      pass.end();
      d.queue.submit([encoder.finish()]);
      this.fpsCounter++;
      if (this.seenRender) this.fpsRenderCounter++;
      this.seenRender = false;
    }
    outsideDrawArea(x1, y1, x2, y2, x3, y3) {
      if (x1 < this.drawAreaL && x2 < this.drawAreaL && x3 < this.drawAreaL)
        return true;
      if (x1 > this.drawAreaR && x2 > this.drawAreaR && x3 > this.drawAreaR)
        return true;
      if (y1 < this.drawAreaT && y2 < this.drawAreaT && y3 < this.drawAreaT)
        return true;
      if (y1 > this.drawAreaB && y2 > this.drawAreaB && y3 > this.drawAreaB)
        return true;
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
    getVertexBuffer(cnt, pid) {
      var select =
        ((pid || 0) & 0x02000000 ? (gpu.status >> 5) & 3 : 4) | (gpu.tp << 4);

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
        } else {
          buffer.addVertex(x1 + 0, y1, data[c1]);
          buffer.addVertex(x1 + 1, y1, data[c1]);
          buffer.addVertex(x2 + 1, y2, data[c2]);

          buffer.addVertex(x2 + 1, y2, data[c2]);
          buffer.addVertex(x2 + 0, y2, data[c2]);
          buffer.addVertex(x1 + 0, y1, data[c1]);
        }
      } else {
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

      if ((data[0] & 0x05000000) === 0x05000000)
        data[c1] = (data[c1] & 0xff000000) | 0x00808080; //- raw-texture
      if ((data[0] & 0x05000000) === 0x05000000)
        data[c2] = (data[c2] & 0xff000000) | 0x00808080; //- raw-texture
      if ((data[0] & 0x05000000) === 0x05000000)
        data[c3] = (data[c3] & 0xff000000) | 0x00808080; //- raw-texture

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

      var u1 = ((data[uv1] >>> 0) & 255) + gpu.quadU;
      var v1 = ((data[uv1] >>> 8) & 255) + gpu.quadV;
      var u2 = ((data[uv2] >>> 0) & 255) + gpu.quadU;
      var v2 = ((data[uv2] >>> 8) & 255) + gpu.quadV;
      var u3 = ((data[uv3] >>> 0) & 255) + gpu.quadU;
      var v3 = ((data[uv3] >>> 8) & 255) + gpu.quadV;
      var cx = ((cl >>> 0) & 0x03f) * 16;
      var cy = (cl >>> 6) & 0x1ff;

      var tm = Math.min((gpu.status >> 7) & 3, 2);

      var semi_transparent = (data[0] & 0x02000000) === 0x02000000;

      var info = 3;
      if (semi_transparent) {
        info = this.getClutInfo(cl, tm);
      }

      if (!semi_transparent || (info & 2) === 2) {
        var buffer = this.getVertexBuffer(3, data[0]);
        buffer.addVertexUV(
          x1,
          y1,
          data[c1] & 0xfefefe,
          tm | (semi_transparent ? 24 : 8),
          u1,
          v1,
          cx,
          cy,
        );
        buffer.addVertexUV(
          x2,
          y2,
          data[c2] & 0xfefefe,
          tm | (semi_transparent ? 24 : 8),
          u2,
          v2,
          cx,
          cy,
        );
        buffer.addVertexUV(
          x3,
          y3,
          data[c3] & 0xfefefe,
          tm | (semi_transparent ? 24 : 8),
          u3,
          v3,
          cx,
          cy,
        );
      }

      if (semi_transparent && (info & 1) === 1) {
        // Opaque texels bypass blending, including direct-colour textures.
        var buffer = this.getVertexBuffer(3, 0);
        buffer.addVertexUV(
          x1,
          y1,
          data[c1] & 0xfefefe,
          tm | 16,
          u1,
          v1,
          cx,
          cy,
        );
        buffer.addVertexUV(
          x2,
          y2,
          data[c2] & 0xfefefe,
          tm | 16,
          u2,
          v2,
          cx,
          cy,
        );
        buffer.addVertexUV(
          x3,
          y3,
          data[c3] & 0xfefefe,
          tm | 16,
          u3,
          v3,
          cx,
          cy,
        );
      }
    }
    drawRectangle(data, tx, ty, cl) {
      this.seenRender = true;

      if ((data[0] & 0x82000000) === 0x80000000 >> 0) return; //WebGL2 improvement fix;
      if ((data[0] & 0x05000000) === 0x05000000)
        data[0] = (data[0] & 0xff000000) | 0x00808080; //- raw-texture

      var x = this.drawOffsetX + ((data[1] << 21) >> 21);
      var y = this.drawOffsetY + ((data[1] << 5) >> 21);
      var c = data[0] & 0xfefefe;
      var w = (data[2] << 16) >> 16;
      var h = data[2] >> 16;
      if (!w || !h) return;

      var showT1 = !this.outsideDrawArea(
        x + 0,
        y + 0,
        x + w - 1,
        y + 0,
        x + 0,
        y + h - 1,
      );
      var showT2 = !this.outsideDrawArea(
        x + 0,
        y + h - 1,
        x + w - 1,
        y + 0,
        x + w - 1,
        y + h - 1,
      );
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
      var cy = (cl >>> 6) & 0x1ff;

      var tm = Math.min((gpu.status >> 7) & 3, 2);

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

      var semi_transparent = (data[0] & 0x02000000) === 0x02000000;

      var info = 3;
      if (semi_transparent) {
        info = this.getClutInfo(cl, tm);
      }

      if (!semi_transparent || (info & 2) === 2) {
        var buffer = this.getVertexBuffer(6, data[0]);
        buffer.addVertexUV(
          x + 0,
          y + 0,
          c,
          tm | (semi_transparent ? 24 : 8),
          tl,
          tt,
          cx,
          cy,
        );
        buffer.addVertexUV(
          x + w,
          y + 0,
          c,
          tm | (semi_transparent ? 24 : 8),
          tr,
          tt,
          cx,
          cy,
        );
        buffer.addVertexUV(
          x + 0,
          y + h,
          c,
          tm | (semi_transparent ? 24 : 8),
          tl,
          tb,
          cx,
          cy,
        );

        buffer.addVertexUV(
          x + w,
          y + 0,
          c,
          tm | (semi_transparent ? 24 : 8),
          tr,
          tt,
          cx,
          cy,
        );
        buffer.addVertexUV(
          x + 0,
          y + h,
          c,
          tm | (semi_transparent ? 24 : 8),
          tl,
          tb,
          cx,
          cy,
        );
        buffer.addVertexUV(
          x + w,
          y + h,
          c,
          tm | (semi_transparent ? 24 : 8),
          tr,
          tb,
          cx,
          cy,
        );
      }

      if (semi_transparent && (info & 1) === 1) {
        // Opaque texels bypass blending, including direct-colour textures.
        var buffer = this.getVertexBuffer(6, 0);
        buffer.addVertexUV(x + 0, y + 0, c, tm | 16, tl, tt, cx, cy);
        buffer.addVertexUV(x + w, y + 0, c, tm | 16, tr, tt, cx, cy);
        buffer.addVertexUV(x + 0, y + h, c, tm | 16, tl, tb, cx, cy);

        buffer.addVertexUV(x + w, y + 0, c, tm | 16, tr, tt, cx, cy);
        buffer.addVertexUV(x + 0, y + h, c, tm | 16, tl, tb, cx, cy);
        buffer.addVertexUV(x + w, y + h, c, tm | 16, tr, tb, cx, cy);
      }
    }
  }
  window.primitiveId = 0;
  window.nextPrimitive = () => {};
  window.renderer = new WebGPURenderer(document.getElementById("display"));
  return { ready: window.renderer.ready };
});
mdlr("enge:psx:webgpu", ({ include }) => {
  Object.assign(window, include("enge:utils"));
  const rendererModule = include("enge:webgpu");
  window.startWebGPU = async () => {
    await rendererModule.ready;
    include("enge:psx");
    window.init();
  };
  return {};
});
