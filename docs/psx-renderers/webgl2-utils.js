const utils = (function () {
  /**
   * Creates and compiles a shader.
   *
   * @param {!WebGLRenderingContext} gl The WebGL Context.
   * @param {string} shaderSource The GLSL source code for the shader.
   * @param {number} shaderType The type of shader, VERTEX_SHADER or
   *     FRAGMENT_SHADER.
   * @return {!WebGLShader} The shader.
   */
  function compileShader(gl, shaderSource, shaderType) {
    // Create the shader object
    var shader = gl.createShader(shaderType);
   
    // Set the shader source code.
    gl.shaderSource(shader, shaderSource);
   
    // Compile the shader
    gl.compileShader(shader);
   
    // Check if it compiled
    var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
      // Something went wrong during compilation; get the error
      throw "could not compile shader:" + gl.getShaderInfoLog(shader);
    }
   
    return shader;
  }

  /**
   * Creates a program from 2 shaders.
   *
   * @param {!WebGLRenderingContext) gl The WebGL context.
   * @param {!WebGLShader} vertexShader A vertex shader.
   * @param {!WebGLShader} fragmentShader A fragment shader.
   * @return {!WebGLProgram} A program.
   */
  function createProgram(gl, vertexShader, fragmentShader) {
    // create a program.
    var program = gl.createProgram();
   
    // attach the shaders.
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
   
    // link the program.
    gl.linkProgram(program);
   
    // Check if it linked.
    var success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
        // something went wrong with the link
        throw ("program filed to link:" + gl.getProgramInfoLog (program));
    }
   
    return program;
  };

  /**
   * Creates a shader from the content of a script tag.
   *
   * @param {!WebGLRenderingContext} gl The WebGL Context.
   * @param {string} scriptId The id of the script tag.
   * @param {string} opt_shaderType. The type of shader to create.
   *     If not passed in will use the type attribute from the
   *     script tag.
   * @return {!WebGLShader} A shader.
   */
  function createShaderFromScript(gl, scriptId, opt_shaderType) {
    // look up the script tag by id.
    var shaderScript = document.getElementById(scriptId);
    if (!shaderScript) {
      throw("*** Error: unknown script element: " + scriptId);
    }
   
    // extract the contents of the script tag.
    var shaderSource = shaderScript.text;
   
    // If we didn't pass in a type, use the 'type' from
    // the script tag.
    if (!opt_shaderType) {
      if (shaderScript.type == "x-shader/x-vertex") {
        opt_shaderType = gl.VERTEX_SHADER;
      } else if (shaderScript.type == "x-shader/x-fragment") {
        opt_shaderType = gl.FRAGMENT_SHADER;
      } else if (!opt_shaderType) {
        throw("*** Error: shader type not set");
      }
    }
   
    return compileShader(gl, shaderSource, opt_shaderType);
  };

  /**
   * Creates a program from 2 script tags.
   *
   * @param {!WebGLRenderingContext} gl The WebGL Context.
   * @param {string} vertexShaderId The id of the vertex shader script tag.
   * @param {string} fragmentShaderId The id of the fragment shader script tag.
   * @return {!WebGLProgram} A program
   */
  function createProgramFromScripts(gl, vertexShaderId, fragmentShaderId) {
    var vertexShader = createShaderFromScript(gl, vertexShaderId, gl.VERTEX_SHADER);
    var fragmentShader = createShaderFromScript(gl, fragmentShaderId, gl.FRAGMENT_SHADER);
    return createProgram(gl, vertexShader, fragmentShader);
  }

  /**
   * 
   * @returns vertex-buffer
   */
  function createVertexBuffer() {
    let buffer = new Uint8Array(128 * 1024);
    let view = new DataView(buffer.buffer);

    const bytesPerVertex = 32;
    buffer.addVertex = function(x, y, u, v, c = 0x00808080, cl) {
      view.setInt16(this.index + 0, x, true);
      view.setInt16(this.index + 2, y, true);
      view.setInt16(this.index + 4, u, true);
      view.setInt16(this.index + 6, v, true);
      view.setUint32(this.index + 8, c, true);
      view.setUint32(this.index + 12, gpu.twin, true);
      view.setUint16(this.index + 16, cl >>> 0, true);
      view.setUint8(this.index + 19, ((gpu.status >> 7) & 3) | ((gpu.status & 31) << 2), true);
      this.index += bytesPerVertex;
    }

    buffer.reset = function () {
      this.index = 0;
    }

    buffer.size  = function () {
      return this.index / bytesPerVertex;
    }

    buffer.view = function () {
      return new Uint8Array(this.buffer, 0, this.index);
    }

    buffer.canHold = function(vertices) {
      return (this.index + (vertices * bytesPerVertex)) < this.length;
    }

    buffer.reset();
    return buffer;
  }

  return {
    createProgramFromScripts,
    createVertexBuffer,
  };
})()