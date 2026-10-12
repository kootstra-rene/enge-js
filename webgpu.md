# Experimental native WebGPU renderer

Build the WebGPU bundle with `./build.sh` (requires the configured mdlr bundler), then open <http://localhost:8000/index-webgpu.html> in a browser with WebGPU enabled. Use Cloud to load the BIOS and a game, and import the same memory-card file used for WebGL testing. The WebGL and WebGL2 pages remain available.

This backend draws PSX lines, triangles, rectangles, textures, and blended pixels through WebGPU render pipelines and WGSL shaders. It does not use a hidden WebGL renderer or copy WebGL screenshots into WebGPU. Command interpretation, geometry generation, raw-texture handling, and opaque/semi-transparent passes derive from the current working WebGL1 renderer.

## Files

- `code/enge-webgpu.js`: native renderer, WGSL drawing/display shaders, GPU uploads/copies, and async readback helper.
- `docs/index-webgpu.html`: separate experimental entry page using the existing controls.
- `docs/index-webgpu.js`: locally generated test bundle; regenerate from backing source.
- `code/psx/index.js`: recognises WebGPU as a separate save-state variant.
- `build.sh`: includes the `enge:psx:webgpu` bundle target.

## Current capabilities

- Flat and Gouraud polygons, lines, and rectangles with WebGL1 geometry handling.
- Palette textures (4-bit and 8-bit) and direct-colour textures.
- Four PSX blending modes and separate opaque/semi-transparent texture passes.
- GPU VRAM uploads and overlapping/wrapped VRAM copies.
- 15-bit display output and packed 24-bit movie display.
- Quality settings 1x, 2x, and 4x.
- Shared CPU, CD-ROM, audio, controller, and game-loading code.

## Prototype limitations

- Synchronous GPU-to-CPU reads and save-state VRAM snapshots still use the CPU upload mirror, as the regular WebGL baseline does. Drawn graphics can be absent from those snapshots. The native `readRenderedImageAsync()` helper reads actual GPU pixels, but the emulator's synchronous readback interface does not yet await it.
- Texture windows intentionally retain the working WebGL1 modulo approximation; the failed full-mask backport is not included. Direct-colour textures retain the baseline window bypass.
- Texture words and palettes are decoded from a rendered RGBA snapshot rather than WebGL1's separate packed-byte texture. This is a backend difference requiring gameplay validation.
- Textured batches synchronize the modified VRAM bounding region to a GPU sampling snapshot; untextured batches skip that copy. Vertex/uniform buffers and bind groups are reused. A dynamic-offset vertex arena batches drawing submissions until presentation, upload, copy, readback, or arena capacity requires a flush. Further performance tuning remains necessary.
- Mask-bit drawing restrictions, PSX dithering, and all renderer-specific debug views are not fully implemented. This is not a claim of hardware-accurate rendering.
- Memory cards are suitable for cross-renderer testing. Save states are tagged as WebGPU and should not be assumed interchangeable with WebGL snapshots.
- WebGPU requires an available adapter and localhost or HTTPS. An ordinary HTTP LAN address may not provide it. Startup reports an error instead of silently falling back to WebGL.

## Validation

Native GPU checks pass for triangles and rectangles at all three texture depths and all four blend modes, including opaque pixels, semi-transparent pixels, transparent zero, and semi-transparent black. These pass at 1x, 2x, and 4x.

GPU copies preserve all 65,536 uploaded pixel values; overlapping copies and wrapped source/destination copies pass at those three resolutions. A 24-bit display test confirms RGB byte preservation, including high-bit bytes. No WebGPU validation errors were observed in these checks.

FFVII was locally tested through startup, title, and Continue slot selection; borders were visually checked. Tekken 2 also reached a rendered 3D fight locally. Full gameplay and the user's problematic FFVII battle scenes still need validation. Synthetic tests are not a substitute for those scenes.

All four existing npm tests pass. Diagnostic scripts and screenshots remain local and are not required by the backend.

The latest batching optimizations pass targeted GPU checks, but the reported Chrono Trigger stutter after naming Crono has not yet been verified as resolved.
