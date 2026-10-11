# GPU emulation improvements

Remaining issues in `code/psx/gpu.js` and the WebGL2 renderer (`code/enge-webgl2.js`, shaders in `docs/index-webgl2.html`), ordered by likely visual impact. Found by reading the code against hardware behaviour (nocash psx-spx); not yet verified by running games.

Already fixed: subtractive blending (mode 2) now computes `dst − src` in both renderers; polylines written to the GP0 port are collected until the terminator; the polyline terminator matches `(w & 0xF000F000) === 0x50005000` at each vertex start; NOP opcodes (0x00–0x1F, 0xE0–0xFF) are 1-word packets instead of aborting the display list, and the textured 1×1 sprite (0x6C–0x6F) is implemented.

## Wrong rendering

2. **Mask bits (GP0 E6) are stored in the status register but never used by the renderer** — neither "set bit 15 on draw" nor "skip pixels with bit 15 set" is applied, for primitives or for CPU→VRAM uploads. Games that protect screen regions with the mask bit get overdrawn (possibly Silent Hill's white transparent square).
3. **Bit 15 is written wrongly** — untextured semi-transparent primitives write alpha 1 (should be 0), and the opaque-texel pass of semi-transparent textured primitives writes 1 (should be 0). Affects 2 and any 16-bit texture read of that area.
4. **Textures are sampled from a stale VRAM copy** — primitives read `vramShadow`, which is only refreshed on draw-area change, upload/move/fill, and (display area only) at vblank. Anything drawn earlier in the same draw area and then used as a texture in the same frame (render-to-texture, feedback/blur effects) reads old data.
5. **`primitiveId` overflows at 32767** — it is written as `Int16` (`enge-webgl2.js:873`) and used as depth with `depthFunc(GREATER)`; after wrapping, primitives fail the depth test and vanish. It is only reset at vblank or draw-area change, and `nextPrimitive()` runs for every packet (including E1–E6) and twice for semi-transparent textured primitives.
6. **Flipped sprites (E1 bits 12/13) are stretched by one texel** (`enge-webgl2.js:356-366`) — the edge texcoords are `tx … tx−w+1`, so interpolation to pixel centres skips/repeats texels. Should be `tx+1 … tx+1−w`.
7. **Sprite width/height are sign-extended and unmasked** (`enge-webgl2.js:344-345`) — should be unsigned 10/9 bits.
8. **No dithering** — E1 bit 9 is ignored, so Gouraud surfaces band compared to hardware.
9. **`getSBGRfromRGBA` overflows** — `int(c*32)` gives 32 for a channel of 1.0, spilling into the next channel when rendered pixels are read back as 4/8-bit texture indices or as 24-bit display data. Uploaded data (max 248/255) is safe.

## Command and DMA handling

13. **Block DMA to the GPU assumes pixel data** — `dmaTransferMode0201` writes into the image buffer even when no GP0(A0) is active. Games sending command packets with DMA2 sync mode 1 lose them; those words should go through `wr32r1810`.
14. **GPUREAD (`0x1f801810`) never returns VRAM data** — `rd32r1810` checks `gpu.rR1814`, which does not exist, so CPU reads after GP0(C0) return the last GP1(10) result. Only the DMA readback path works.
15. **VRAM upload/copy/fill don't wrap at 1024×512** — parts past the edge are clipped instead of wrapping to x/y = 0.
16. **`dmaTransferMode0401` aborts** when a DMA starts while a CPU-written packet is half complete (`dmaIndex !== 0`).

## Status, timing and display

17. **GP1(01) (clear FIFO) sets status bits 28–30** (`|= 0x70000000`), changing the DMA direction field to 3.
18. **Status bits don't follow hardware** — bit 25 (DMA request) is never computed, bit 28 doubles as an internal "not in image transfer" flag, bit 13 (interlace field) never toggles.
19. **VBlank IRQ fires at line 263/314 (top of frame)** rather than at the start of vblank; vblank begin/end lines come from a centre-based heuristic (`center = 136/163`). Games timing against vblank or Timer1 can drift.
20. Minor: the E5 Y offset reads 10 of its 11 bits; 24-bit display divides by 256 instead of 255; texture modulation divides by 127.5 instead of 128.

## Save states

21. **Renderer state is not saved** — draw area/offset (`$gpu.daL…daY`) and `dmaIndex`/`dmaBuffer` are not stored. Usually self-heals within a frame because games rewrite E3–E5 every frame.

## Suggested order

5 next (cheap, makes heavy scenes lose polygons), then 13–14. 2–4 are larger renderer changes but plausible causes of the text/menu glitches listed in `compatability.md`.
