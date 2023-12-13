class VertexBuffer {
  #mode;
  #writer;
  #index;
  context;

  constructor(mode) {
    const buffer = new Uint8Array(256 * 1024);

    this.#mode = mode; // todo: set actual mode
    this.#index = 0;
    this.#writer = new DataView(buffer.buffer);
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

  addVertex(x, y, u = x, v = y) {
    const writer = this.#writer;

    writer.setInt16(this.#index + 0, x, true);
    writer.setInt16(this.#index + 2, y, true);
    writer.setInt16(this.#index + 4, 0, true);
    writer.setUint32(this.#index + 6, 0, true);
    writer.setInt16(this.#index + 10, u, true);
    writer.setInt16(this.#index + 12, v, true);

    this.#index += vertexStride;
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

    gl.viewport(0, 0, 4096, 2048);
    gl.useProgram(directContext.program);

    gl.bindVertexArray(directContext.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, directContext.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.view, 0, this.length);
    // gl.bufferData(gl.ARRAY_BUFFER, this.#writer, gl.STREAM_DRAW, 0, this.#index);

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderContext.mainFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderContext.mainTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, renderContext.shadowTexture, 0);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, this.vramDepth, 0);

    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, directContext.texture);
    gl.drawArrays(gl.TRIANGLES, 0, this.length / vertexStride);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);

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
    gl.drawArrays(gl.TRIANGLES, 0, this.length / vertexStride);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);

    this.length = 0;
  }

}