# WebGL2 changes not carried over to WebGL1

## Comparison baseline

This comparison assumes the prepared PR branches from this session are merged into upstream `main`, including the VRAM/texture-addressing proposal (`codex/webgl-vram-texture-fix`). That is a hypothetical merged-source baseline, not the current local test build. The VRAM/texture proposal was reverted locally after gameplay regressions; assuming it merged does not establish its correctness.

The comparison concerns concrete source behaviour and identifiable maintainer changes. A renderer architecture difference is labelled separately from an identified missing backport. Generated bundle freshness and general browser troubleshooting are outside this comparison.

## Identified maintainer changes

| Maintainer change | WebGL2 implementation | WebGL1 after the assumed PR merges | Remaining difference |
| --- | --- | --- | --- |
| [`6b5c423`: transparency rendering](https://github.com/kootstra-rene/enge-js/commit/6b5c423fe72973e25d1aaefb700f8320eb27de04) | GPU command replay and shader filtering split semi-transparent texture pixels from opaque pixels. | The FFVII cursor PR filters the blended pass and draws opaque pixels separately, including direct-colour textures. | The intended opaque/semi-transparent split is backported. Command replay, batch ordering, and framebuffer alpha storage still differ. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/813761d/code/enge-webgl.js#L934), [docs/index-webgl2.html](https://github.com/kootstra-rene/enge-js/blob/724f231/docs/index-webgl2.html#L279). |
| [`724f231`: subtract blending](https://github.com/kootstra-rene/enge-js/commit/724f231f41393816094d95e638894304a8c92215) | Reverse RGB subtraction with source and destination factors both ONE. Separate alpha equation uses source alpha. | Upstream already fixes RGB subtraction in WebGL1 too. Its alpha equation/factors are different. | This is not a missing RGB backport. Framebuffer alpha behaviour remains different. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/4d0ee4a/code/enge-webgl.js#L860), [code/enge-webgl2.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/enge-webgl2.js#L235). |
| [`02c6838`: corrected render colours](https://github.com/kootstra-rene/enge-js/commit/02c6838f2ba463f9a3bda73111414a7725b7dad1) | Changed `getColor()` to preserve all RGB bits for ordinary flat polygons, while masking Gouraud colours and forced-flat rectangle colours with `0xf8f8f8`. | Regular triangle/rectangle paths still mask colours with `0xfefefe`; line handling also differs. The Chrono Trigger PR fixes misuse of the raw-texture flag, not this colour precision policy. | The WebGL2 colour-mask policy has not been equivalently backported. Whether that policy is preferable requires separate validation. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/4d0ee4a/code/enge-webgl.js#L955), [code/enge-webgl2.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/enge-webgl2.js#L506). |

The maintainer's [FFVII issue #47](https://github.com/kootstra-rene/enge-js/issues/47) documents work on the hand cursor, text boxes, textures, and performance. Those reports do not identify a specific commit for every remaining visual symptom.

## Remaining source-behaviour differences

These differences are directly visible in the source. They are not all attributable to a single forgotten backport.

| Behaviour | WebGL1 after assumed merges | WebGL2 | Why the difference matters |
| --- | --- | --- | --- |
| **Framebuffer alpha / texture transparency flag** | Regular drawing outputs `uBlendAlpha`; framebuffer alpha is affected by blending. Subtract mode uses reverse subtraction for alpha and factors ZERO / ONE_MINUS_SRC_ALPHA. | Shader output and separate blend equations/factors handle alpha differently; subtract mode writes source alpha using FUNC_ADD and ONE / ZERO. | Reading or reusing drawn pixels as textures can interpret bit 15 differently even when displayed RGB matches. This needs testing independently of cursor colour. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/4d0ee4a/code/enge-webgl.js#L860), [code/enge-webgl2.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/enge-webgl2.js#L235), [docs/index-webgl2.html](https://github.com/kootstra-rene/enge-js/blob/724f231/docs/index-webgl2.html#L259). |
| **Save-state VRAM capture** | `getVramState()` returns `this.vram`, the CPU mirror. The proposed `loadImage()` readback fix does not change this method. | `getVramState()` calls framebuffer-backed `loadImage()`. | WebGL1 snapshots may omit rendered primitives. A GPU readback fix alone does not make renderer snapshots equivalent. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/4d0ee4a/code/enge-webgl.js#L568), [code/enge-webgl2.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/enge-webgl2.js#L143). |
| **Palette contents and pass selection** | `getClutInfo()` scans CPU VRAM to decide whether opaque and semi-transparent passes are needed. Palette sampling uses the packed-byte texture. | Shader samples texture colours/alpha from shadow VRAM. | GPU-generated or modified palettes require synchronization in WebGL1. Masking and coordinate wrapping do not provide that synchronization. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/4d0ee4a/code/enge-webgl.js#L369), [docs/index-webgl2.html](https://github.com/kootstra-rene/enge-js/blob/724f231/docs/index-webgl2.html#L246). |
| **Texture/framebuffer feedback** | Indexed textures use `tex8vram`; direct-colour textures use rendered RGBA textures. `flushVertexBuffer()` draws through `vramP2` and `tex16draw`. | Uses VRAM, shadow VRAM, and cache framebuffers, with copies on draw-area changes and image operations. | Similar-looking methods operate on different snapshots of VRAM. Porting one read/copy operation can expose stale data elsewhere. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/4d0ee4a/code/enge-webgl.js#L781), [code/enge-webgl2.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/enge-webgl2.js#L524). |
| **Primitive order and batching** | One vertex buffer; render-mode changes flush it. No equivalent primitive-ID depth ordering. | Separate blending-mode buffers, `primitiveId`, and depth testing with GREATER preserve ordering across batches. | Transparency, overlapping polygons, and framebuffer reuse can diverge. Porting the shader logic alone does not port ordering. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/4d0ee4a/code/enge-webgl.js#L873), [code/enge-webgl2.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/enge-webgl2.js#L580), [code/enge-webgl2.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/enge-webgl2.js#L553). |
| **Internal render resolution** | Rendered VRAM dimensions follow the quality setting: 1024 × quality by 512 × quality. | Main VRAM/shadow textures use 4096 × 2048, or 8192 × 4096 at Q8 when the GPU supports it; display output follows quality. | Equal quality settings do not imply equal internal rendering or identical sampling/rounding. Code: [code/enge-webgl.js](https://github.com/kootstra-rene/enge-js/blob/4d0ee4a/code/enge-webgl.js#L20), [code/enge-webgl2.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/enge-webgl2.js#L717). |

Code links name the files and point to verified lines in fixed commits. WebGL1 links use the prepared PR commits where needed; WebGL2 links use upstream `724f231`. Shared command replay is in [code/psx/gpu.js](https://github.com/kootstra-rene/enge-js/blob/724f231/code/psx/gpu.js#L14).

## Differences addressed by the assumed PRs

The following should **not** be listed as still missing after the assumed merges:

- The opaque-versus-semi-transparent texture-pixel split, addressed by the FFVII cursor PR.
- Masked texture-window offsets, addressed by the FFVII border PR and included as support in the VRAM/texture proposal.
- Full texture-window masks, direct-colour window handling, UV wrapping, and VRAM-address wrapping, addressed by the VRAM/texture proposal.
- GPU-to-CPU readback of rendered pixels, addressed by the same proposal.
- VRAM-to-VRAM copies of drawn pixels, addressed by the SimCity cursor PR.
- Restricting raw-texture colour overrides to textured primitives, addressed by the Chrono Trigger PR.
- The image-upload conversion inheriting drawing texture depth, addressed by the Tomb Raider II artwork PR.
- Save-state localStorage quota failures, addressed in shared emulator UI code by the storage PR; this is not a renderer-specific fix.

These close the named behaviour gaps on paper. The failed FFVII ports show that surrounding cache and framebuffer assumptions still need review.

## What needs a targeted comparison next

1. Framebuffer alpha and bit-15 preservation during drawing, readback, and texture reuse.
2. Packed texture / CPU palette synchronization after GPU writes.
3. Primitive ordering and framebuffer snapshot selection for FFVII's battle transition and effects.
4. The maintainer's WebGL2 colour-precision change, tested separately from the three items above.

Use the same memory-card save and a fresh boot to compare these behaviours. The correct target is matching PSX output; matching WebGL2 implementation details alone is not proof of correctness.
