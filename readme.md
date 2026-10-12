# Why this emulator
Everybody said you can't run a PSone emulator in JavaScript at full speed in the browser. It's too slow...
You have the emscriptem based ones but that is not pure JavaScript and also those emulators don't seem to run at full speed.  So to learn JavaScript and further my programming knowledge I decided to build a PSone emulator in JavaScript. Keep in mind it is a work in progress but at this point it is good enough to publish.

# About the code
All the code resides in the docs folder so that, when pushing to GitHub, the emulator gets automatically deployed to GitHub pages. Keep in mind it is a hobby project and does not have tests nor is it very structured. When I will find the time some parts will be rewritten using TDD and more ES6 style coding.

# How to run
Just go to [the latest release](https://kootstra-rene.github.io/enge-js/). You can also try the experimental [WebGL2](https://kootstra-rene.github.io/enge-js/index-webgl2.html) and [WebGPU](https://kootstra-rene.github.io/enge-js/index-webgpu.html) versions. Note you'll need Chrome for running this emulator and read the rest of this readme before you do. On a Mac use Safari instead of Chrome and give the permission to play audio on the site.

## Loading the BIOS
When the emulator is running and no BIOS has been loaded the eNGE logo will be pulsating with a red color.
You can load the BIOS by dragging and dropping a PSX BIOS file (SCHP1001) on the emulator page. If all went well the eNGE logo stops pulsating. If you press F5 or everythime you start the emulator again it will use the previous loaded BIOS.

## Loading a demo
Same as with the BIOS drag and drop the .psx-exe file on the emulator page and it will automatically start running

## Loading a cdrom
Same as with the BIOS drag and drop the .bin file on the emulator page and it will automatically start running. Only raw .iso and .bin files are supported currently. The emulator will try to build it's own table of contents a.k.a track information and as such a lot of games have cd audio but it could not work in all cases.

## Hosting locally

The included server is written in Node.js and serves the emulator, game files, generated catalogs, save states, and memory cards from one port. It has no npm runtime dependencies and requires Node.js 18 or newer.

```sh
node server.js
```

The default URL is `http://<your-lan-ip>:8000/`. The server prints the detected LAN address when it starts. See [SERVER.md](./SERVER.md) for command-line options, catalog generation, range requests, and cloud endpoints.

## Improving quality
Click the Qx button to cycle through Q1, Q2, and Q4, with Q4 as the highest quality. The red border indicates that you need to reload the emulator for the change to take effect.

## Controls

Keyboard: circle = D, cross = X, square = S, triangle = E, R1 = R, R2 = T, L1 = W, L2 = Q, start = Enter, select = Space, D-pad directions = arrow keys (also left stick), right stick up/left/down/right = I/J/K/L.

When using the gamepad just connect it, press a button on the gamepad and the border around the gamepad/keyboardicon should become blueish and you are ready to go.

## Handy info
Double clicking the emulator page will stop/resume the emulator. This can be handy when the sound is really crappy.

## Memory Card
Only one memory card is supported at this time. You can load it the same as the BIOS or CD

# Which games run

I have started a [compatibility list](./compatability.md). So feel free to update it.

# Release notes

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
