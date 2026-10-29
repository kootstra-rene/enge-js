# Why this emulator
Everybody said you can't run a PSone emulator in JavaScript at full speed in the browser. It's too slow...
You have the emscriptem based ones but that is not pure JavaScript and also those emulators don't seem to run at full speed.  So to learn JavaScript and further my programming knowledge I decided to build a PSone emulator in JavaScript. Keep in mind it is a work in progress but at this point it is good enough to publish.

# About the code
All the code resides in the docs folder so that, when pushing to GitHub, the emulator gets automatically deployed to GitHub pages. Keep in mind it is a hobby project and does not have tests nor is it very structured. When I will find the time some parts will be rewritten using TDD and more ES6 style coding.

# How to run
Just go to [the latest release](https://kootstra-rene.github.io/enge-js/). You can also try the experimental [WebGL2](https://kootstra-rene.github.io/enge-js/index-webgl2.html) and [WebGPU](https://kootstra-rene.github.io/enge-js/index-webgpu.html) versions. 

## Loading the BIOS
When the emulator is running and no BIOS has been loaded the eNGE logo will be pulsating with a red color.
You can load the BIOS by dragging and dropping a PSX BIOS file (SCHP1001) on the emulator page. If all went well the eNGE logo stops pulsating. The BIOS is saved in local storage so every time you reload the page again it will use the previously loaded BIOS. Experimental compatibility has also been added for [OpenBIOS](https://libreboot.org/docs/install/playstation.html).

## Loading a demo
Same as with the BIOS drag and drop the .psx-exe file on the emulator page and it will automatically start running

## Loading a cdrom
Same as with the BIOS drag and drop all the .bin and .cue files on the emulator page and it will automatically start running.  The emulator will attempt to build it's own table of contents a.k.a track information if only a single .bin is provided. 

## Hosting locally

The included server is written in Node.js and serves the emulator, game files, generated catalogs, save states, and memory cards from one port. It requires Node.js 18 or newer and has no npm dependencies.

```sh
node server.js
```

The default URL is `https://<your-lan-ip>:8000/`. The server generates a self-signed certificate on first start and prints the detected LAN address. Your browser must trust that certificate for secure-context features such as AudioWorklet. To use plain HTTP instead, run `node server.js --http`. See [SERVER.md](./SERVER.md) for command-line options, catalog generation, range requests, and cloud endpoints.

## Improving Graphics Quality

Click the Qx button to cycle through Q1, Q2, and Q4, with Q4 as the highest quality. With the WebGL2 renderer, Q8 is added when the GPU can render VRAM at 8192 × 4096; it switches the internal render resolution live and needs about 320 MB of GPU memory. The red border indicates that you need to reload the emulator for the change to take effect.

## Controls

Keyboard: circle = D, cross = X, square = S, triangle = E, R1 = R, R2 = T, L1 = W, L2 = Q, start = Enter, select = Space, D-pad directions = arrow keys (also left stick), right stick up/left/down/right = I/J/K/L.

When using a gamepad just connect it, press a button on the gamepad and the border around the gamepad/keyboardicon should become blueish and you are ready to go. 

Double clicking the emulator page will stop/resume the emulator. 

# Which games run

I have started a [compatibility list](./compatability.md). So feel free to update it.

# Release notes
- **2026-10-30:** CD-ROM commands are now acknowledged with the drive's current status, and the XA filter matches file and channel numbers of 80h and up; MediEvil II restarted its New Game dialogue stream over and over because of this. Polygons, rectangles, fills and VRAM copies now take drawing time and GPU DMA is paced by it, which fixes Dukes of Hazzard stalling in DrawSync. The GPU, DMA, SPU and GTE now behave much closer to hardware, checked by a new suite of hardware tests ported from nugget and ps1-tests: the GP0 FIFO, the GP0(1Fh) and VBlank interrupts and the 480i status bits, linked-list and block-mode GPU DMA, SPU voices decoded and enveloped in integers as on hardware (voice captures now within one LSB of real hardware), the SPU IRQ acknowledge, and GTE write-to-use delays. For debugging: `?debug-stall=N`, `stallCapture()` and `stallStatus()` in DevTools, every hardware register access in the stall report, and `?debug-cd` now logs the first sectors of every read.
- **2026-10-28:** The local server now uses HTTPS by default, with no external dependencies. When the page is served over plain HTTP, audio falls back to a ScriptProcessorNode instead of staying silent. Fixed interrupt handling (GTE commands on an interrupt, interrupt latency and the CD-ROM interrupt edge), the DMA interrupt (DICR) flags and narrow register writes, and GPUSTAT bit 28 during VRAM uploads, which made psyqo-based homebrew hang.
- **2026-10-19:** The [WebGL2 renderer](https://kootstra-rene.github.io/enge-js/index-webgl2.html) gains a screen filter (xBR, Super-xBR) that upscales native-resolution content: the whole picture at Q1, and sprites, 2D backgrounds and text at higher quality, while 3D edges and shading keep the rendered pixels. Fixed the slowdown that the texture, sprite and FMV filters caused even when switched off: shaders now only contain the filters in use, and the per-primitive CPU cost is back to what it was before PGXP. All filters are off by default. Audio now plays through an AudioWorklet, which fixes silent audio in Firefox and also works when the page is opened from a local file.
- **2026-10-17:** Added PGXP sub-pixel polygon vertices (opt-in with `?pgxp`), now at 1/16-pixel precision, to reduce polygon jitter. The [WebGL2 renderer](https://kootstra-rene.github.io/enge-js/index-webgl2.html) gains an 8x render scale (Q8) on GPUs that support it, texture and sprite filters (Bilinear, Sharp bilinear, Bicubic, xBR, MMPX) without halos or atlas bleeding, and an FMV filter (Smooth, xBR) for 24-bit video. All new filters are off by default.
- **2026-10-16:** Made the [WebGL2 renderer](https://kootstra-rene.github.io/enge-js/index-webgl2.html) more correct and lighter on the GPU: overlapping primitives now draw in a consistent order, effects that sample freshly drawn VRAM now see up-to-date pixels, and much less VRAM is copied. Off-screen primitives are skipped and draw-area clipping uses the GPU scissor. WebGL2 now supports the GP0(E6h) mask bits for drawing, uploads and VRAM copies, and fills, uploads and readbacks that run past the VRAM edges now wrap around as on hardware. Fixed primitives disappearing after very long command streams and a crash when the vertex buffer overflowed. Fills and uploads are faster and the staging textures use about 60 MB less memory. Added an option to turn off the ambilight. Shadow Master is now marked as playable.
- **2026-10-14:** Various bug fixes to audio and graphics that increase game compatibility
- **2026-10-12:** Added an experimental [WebGPU renderer](https://kootstra-rene.github.io/enge-js/index-webgpu.html), then improved its performance. Also improved GPU/MDEC handling and PSX-style texture sampling, added WebGL renderer options and a WebGL2 TV-effect toggle, added CD image conversion and disc-swap tools, and updated compatibility metrics.
- **2026-10-11:** Improved compatibility across multiple games. Added the Node.js local server and improved cloud controls, save-state storage, and CD/audio handling.
- **2026-10-10:** Improved Crash Bash startup compatibility and updated compatibility results for multiple games.
- **2026-10-09:** Added CUE-based and range-streamed CD loading, OpenBIOS support, keyboard and dual-controller input, save-state foundations, optional DMA/GPU diagnostics, and a responsive interface.
- **2026-10-08:** Updated the compatibility list with more games and their status.
- **2026-06-24:** Fixed SPU reverb issues and migrated module loading to the new include API.
- **2026-05-11:** Fixed CD read handling when changing disc locations.
- **2024-02-16:** Refactored DMA handling into a dedicated module.
- **2024-02-15:** Corrected rendered colors and added Gaussian interpolation using the last four audio samples.
- **2024-02-13:** Refactored SPU envelopes and added SPU reverb for voices and CD audio.
- **2024-01-31:** Published latest state. [WebGL2](https://kootstra-rene.github.io/enge-js/index-webgl2.html) is running smoothly if your hardware supports it.
- **2023-11 to 2023-12:** Fixed a reproducible Final Fantasy VII crash and advanced the WebGL2 renderer with performance, transparency, depth-buffer, blitting, blending, and display-timing improvements.
- **2022-01 to 2022-11:** Expanded the compatibility list and developed WebGL2 rendering, including texture handling, transparency, and primitive drawing. Improved CD and DMA timing.
- **2021-01 to 2021-12:** Started the project and published its first browser release. Built out core CPU/GPU emulation, recompilation, graphics, CD/audio handling, gamepad support, and quality settings; began the compatibility list.
