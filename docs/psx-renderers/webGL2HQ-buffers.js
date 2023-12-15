class VertexBuffer {
  #mode;
  #writer;
  #index;
  context;

  static #depthId = 65535;

  static get depthId() {
    return VertexBuffer.#depthId;
  }

  static resetDepth() {
    VertexBuffer.#depthId = 65535;
  }
  static updateDepth() {
    --VertexBuffer.#depthId;
  }
  constructor(mode) {
    const buffer = new Uint8Array(1024 * 1024);

    this.#mode = mode; // todo: set actual mode
    this.#index = 0;
    this.#writer = new DataView(buffer.buffer);
  }

  get mode() {
    return this.#mode;
  }

  get view() {
    return this.#writer;
  }

  get length() {
    return this.#index;
  }

  set length(value) {
    this.#index = value;
  }

  addVertex(x, y, u, v, c) {
    const writer = this.#writer;

    // console.log(x,y,VertexBuffer.depthId);
    writer.setInt16(this.#index + 0, x, true);
    writer.setInt16(this.#index + 2, y, true);
    writer.setUint16(this.#index + 4, VertexBuffer.depthId, true);
    // writer.setUint16(this.#index + 4, 0, true);
    writer.setUint32(this.#index + 6, c, true);
    writer.setInt16(this.#index + 10, u ?? x, true);
    writer.setInt16(this.#index + 12, v ?? y, true);

    this.#index += vertexStride;
  }

  setTransparencyMode(gl, mode, program) {
    switch (mode) {
      case 0: {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.SRC_ALPHA, gl.SRC_ALPHA);
        program && gl.uniform1f(program.alpha, 0.50);
      } break;
      case 1: {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE);
        program && gl.uniform1f(program.alpha, 1.00);
      } break;
      case 2: {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
        gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
        program && gl.uniform1f(program.alpha, 1.00);
      } break;
      case 3: {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.ONE);
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

class VertexDirectBuffer extends VertexBuffer {
  init(gl, directContext, renderContext) {
    this.context = { gl, directContext, renderContext };

    gl.bindBuffer(gl.ARRAY_BUFFER, directContext.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.view, gl.STREAM_DRAW, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return this;
  }

  flush() {
    if (this.length <= 0) return;

    const { gl, directContext, renderContext } = this.context;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);

    gl.viewport(0, 0, 4096, 2048);
    gl.useProgram(directContext.program);

    gl.bindVertexArray(directContext.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, directContext.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.view, 0, this.length);

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderContext.mainFramebuffer);
    // gl.bindTexture(gl.TEXTURE_2D, renderContext.mainDepthComponent);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, renderContext.mainDepthComponent, 0);
    // gl.bindTexture(gl.TEXTURE_2D, renderContext.mainTexture);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderContext.mainTexture, 0);
    gl.bindTexture(gl.TEXTURE_2D, renderContext.shadowTexture);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, renderContext.shadowTexture, 0);

    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, directContext.texture);

    this.setTransparencyMode(gl, this.mode);
    gl.drawArrays(gl.TRIANGLES, 0, this.length / vertexStride);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);

    gl.depthFunc(gl.ALWAYS);
    gl.disable(gl.DEPTH_TEST);
    this.length = 0;
  }

}

class VertexDisplayBuffer extends VertexBuffer {
  init(gl, displayContext) {
    this.context = { gl, displayContext };

    gl.bindBuffer(gl.ARRAY_BUFFER, displayContext.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.view, gl.STREAM_DRAW, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return this;
  }

  flush(x, y, w, h, texture) {
    if (this.length <= 0) return;

    const { gl, displayContext } = this.context;

    gl.viewport(0, 0, 4096, 2048);
    gl.useProgram(displayContext.program);

    gl.uniform4i(displayContext.program.displayArea, x, y, x + w - 1, y + h - 1);
    gl.uniform1i(displayContext.program.mode, (gpu.status >> 21) & 0b101);

    gl.bindVertexArray(displayContext.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, displayContext.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.view, 0, this.length);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    this.setTransparencyMode(gl, this.mode);
    gl.drawArrays(gl.TRIANGLES, 0, this.length / vertexStride);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);

    this.length = 0;
  }

}

class VertexRenderBuffer extends VertexBuffer {
  init(gl, renderContext) {
    this.context = { gl, renderContext };

    gl.bindBuffer(gl.ARRAY_BUFFER, renderContext.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.view, gl.STREAM_DRAW, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return this;
  }

  flush() {
    if (this.length <= 0) return;

    // console.log('render', this.mode, this.length);

    const { gl, renderContext } = this.context;
    
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.viewport(0, 0, 4096, 2048);
    gl.useProgram(renderContext.program);

    gl.bindVertexArray(renderContext.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderContext.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.view, 0, this.length);

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderContext.mainFramebuffer);
    // gl.bindTexture(gl.TEXTURE_2D, renderContext.mainDepthComponent);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, renderContext.mainDepthComponent, 0);
    // gl.bindTexture(gl.TEXTURE_2D, renderContext.mainTexture);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderContext.mainTexture, 0);

    this.setTransparencyMode(gl, this.mode, renderContext.program);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, renderContext.shadowTexture);
    gl.drawArrays(gl.TRIANGLES, 0, this.length / vertexStride);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
    gl.depthFunc(gl.ALWAYS);
    gl.disable(gl.DEPTH_TEST);

    this.length = 0;
  }

}