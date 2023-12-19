const vertexStride = 24;

class VertexBuffer {
  #mode;
  #writer;
  #index;
  context;
  #reversed;

  static #depthId = 1;

  static get depthId() {
    return VertexBuffer.#depthId;
  }

  static resetDepth() {
    VertexBuffer.#depthId = 1;
  }
  static updateDepth() {
    ++VertexBuffer.#depthId;
  }

  constructor(mode) {
    const buffer = new Uint8Array(1024 * 1024);

    this.#mode = mode; // todo: set actual mode
    this.#writer = new DataView(buffer.buffer);
    this.#reversed = mode === 4; // opaque reverses vertex rendering
    this.length = 0;
  }

  get mode() {
    return this.#mode;
  }

  get base() {
    if (this.#reversed) {
      return this.#index;
    }
    return 0;
  }

  get view() {
    return this.#writer;
  }

  get length() {
    if (this.#reversed) {
      return this.#writer.byteLength - this.#index;
    }
    return this.#index;
  }

  set length(value) {
    if (this.#reversed) {
      this.#index = this.#writer.byteLength - value;
    }
    else {
      this.#index = value;
    }
  }

  addVertex(x, y, u, v, c, cl) {
    const writer = this.#writer;

    if (this.#reversed) {
      this.#index -= vertexStride;
    }

    // console.log(x,y,VertexBuffer.depthId);
    writer.setInt16(this.#index + 0, x, true);
    writer.setInt16(this.#index + 2, y, true);
    writer.setUint16(this.#index + 4, VertexBuffer.depthId, true);
    writer.setUint32(this.#index + 6, c, true);
    writer.setInt16(this.#index + 10, u ?? x, true);
    writer.setInt16(this.#index + 12, v ?? y, true);
    writer.setUint16(this.#index + 14, cl >>> 0, true);

    writer.setUint32(this.#index + 16, gpu.twin, true);
    writer.setUint8(this.#index + 23, ((gpu.status >> 7) & 3) | ((gpu.status & 31) << 2), true);

    if (!this.#reversed) {
      this.#index += vertexStride;
    }
  }

  setTransparencyMode(gl, mode, program) {
    switch (mode) {
      case 0: {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.SRC_ALPHA, gl.ONE, gl.ZERO);
        program && gl.uniform1f(program.alpha, 0.50);
      } break;
      case 1: {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ZERO);
        program && gl.uniform1f(program.alpha, 1.00);
      } break;
      case 2: {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
        gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ZERO);
        program && gl.uniform1f(program.alpha, 1.00);
      } break;
      case 3: {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE, gl.ZERO);
        program && gl.uniform1f(program.alpha, 0.75);
      } break;
      case 4: {
        gl.disable(gl.BLEND);
        program && gl.uniform1f(program.alpha, 0.00);
      } break;
    }
  }

  init() {
    throw new Error('should implement this');
  }

  flush() {
    throw new Error('should implement this');
  }

}

class VertexRenderBuffer extends VertexBuffer {
  init(gl, renderContext) {
    this.context = { gl, renderContext };

    gl.bindBuffer(gl.ARRAY_BUFFER, renderContext.draw.arrayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.view, gl.STREAM_DRAW, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return this;
  }

  flush() {
    if (this.length <= 0) {
      return;
    }
    const { gl, renderContext } = this.context;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.GREATER);
    this.setTransparencyMode(gl, this.mode, renderContext.draw.program);

    gl.viewport(0, 0, 4096, 2048);
    gl.useProgram(renderContext.draw.program);

    gl.bindVertexArray(renderContext.draw.vertexArrayBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderContext.draw.arrayBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.view, this.base, this.length);

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderContext.draw.framebuffer);
    // gl.bindTexture(gl.TEXTURE_2D, renderContext.texture.main);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderContext.texture.main, 0);
    // gl.bindTexture(gl.TEXTURE_2D, renderContext.draw.depth);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, renderContext.draw.depth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderContext.texture.data);
    gl.drawArrays(gl.TRIANGLES, 0, this.length / vertexStride);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);


    this.length = 0;
  }

}