1.  vertexBuffer for transparent vertices and vertexBuffer for opague vertices.
    - opaque renders front to back
    - transparency back to front
    - requires depth test and z coordinate (needed for 3d anyhow, like perspective correction and such)
    - first opague then transparency
    - solution should improve rendering performance drastically.
    - question if it should flush vertices per blend mode?

