# nugget test suite for eNGE

This runs the test programs from [nugget's `tests/`](https://github.com/pcsx-redux/nugget/tree/main/tests)
in eNGE, headless in Node, and grades them the way nugget's `tests/run-emulator.sh`
grades PCSX-Redux: a run passes on exit code 0 **and** a positive success line, never
on the absence of a failure line.

## Quick start

```sh
npm run build:nugget        # clone nugget, build OpenBIOS and the 136 test ps-exes
npm run test:nugget         # run them in eNGE
```

`build:nugget` (`tests/nugget/build.sh`) needs `git`, `make` and a MIPS cross compiler:
`mipsel-none-elf-gcc`, or `mipsel-linux-gnu-gcc` (Debian/Ubuntu:
`apt install gcc-mipsel-linux-gnu g++-mipsel-linux-gnu`). Without either it uses nugget's
Docker image. Everything lands in `tests/nugget/.nugget/` (git-ignored), pinned to the
nugget revision `suites.js` was written against; pass another commit or branch as the
first argument to try a newer one.

For the GPU tests to see real rasterisation, install the optional WebGL package once:

```sh
npm install --no-save gl    # headless-gl; needs Xvfb (xvfb-run) on Linux without a display
```

Without it the runner uses a stub renderer (see below) and says so.

## Files

| file | what it does |
|------|--------------|
| `headless.js` | runs one ps-exe in eNGE: `node tests/nugget/headless.js --bios openbios.bin test.ps-exe` |
| `run.js` | runs the whole list in parallel and grades it; `--help` lists the options |
| `suites.js` | the suite and skip lists, ported one-to-one from `run-emulator.sh` |
| `build.sh` | fetches and builds nugget |
| `baseline.webgl.json`, `baseline.stub.json` | the expected result of every suite, per renderer |

## How a test is run

`headless.js` loads the modules under `code/` unbundled (with a small loader compatible
with the mdlr bundler) and replaces the browser pieces they touch — DOM, storage,
audio — with stand-ins. It then does what PCSX-Redux does for
`-no-ui -run -stdout -testmode -loadexe`:

- boots the BIOS (nugget's OpenBIOS) to the shell entry and loads the PS-EXE, through
  eNGE's own loader (`loadFileData` in `code/psx/index.js`);
- writes TTY output to stdout: BIOS putchar (A0:3Ch, B0:3Dh, seen through eNGE's existing
  `trace` hook) and the PCSX-Redux debug port byte at `1F802080h`;
- ends the run on `pcsx_exit()` — a 16-bit write to `1F802082h` — and exits with that
  code. Exit 124 means the wall-clock timeout hit, 70 means eNGE stopped with an error
  (`abort`, an exception in a recompiled block). The runner reports a process that has to
  be killed because the emulator spins inside one call (for example an endless DMA
  linked list) as *hung*.

No emulator code is changed for this; the harness only wraps the `memWrite*` and `trace`
globals that recompiled blocks call.

### Differences from `run-emulator.sh`

- eNGE has one CPU core (the recompiler), so each suite runs once instead of once per
  `interpreter` / `dynarec`.
- PCSX-Redux-only flags (`-debugger`, `-pcdrv`, `-2mbvram`, the Lua setup for `rumble`)
  have no eNGE equivalent. They are kept in `suites.js` as `redux`, and `needs` names the
  feature behind them, which the runner prints next to such a suite's failure.
- The skip list and reasons are nugget's. Some skips exist because the PCSX-Redux build
  in nugget's CI lacks a fix (several SPU tests); they stay skipped here so the two lists
  stay comparable.
- A suite added upstream shows up as `UNLISTED`, a removed one as `MISSING`, exactly as
  in nugget.

### Renderers

- **webgl** — the real `code/enge-webgl.js` renderer on a headless-gl context. Used when
  the `gl` package is installed and a display is available; `run.js` starts one Xvfb
  server for the whole run when there is none.
- **stub** — draws are dropped; VRAM uploads, `GP0(C0h)` reads and VRAM-to-VRAM copies
  use the same CPU-side VRAM mirror the WebGL renderer keeps. Everything that does not
  read rendered pixels behaves the same.

Choose with `--renderer auto|webgl|stub`.

## Baselines

eNGE does not pass the whole suite yet, so `run.js` compares against the baseline for the
renderer in use and fails only on a **regression**: a suite that passed in the baseline
and fails now. Suites that start passing are listed; record them with

```sh
npm run test:nugget -- --write-baseline
```

`--no-baseline` grades strictly, like nugget's CI (any failing suite fails the run).

## Where eNGE stands (nugget 41c4805, webgl renderer)

32 of 78 suites pass; 59 ps-exes are skipped for nugget's reasons.

Passing: `basic`, `cpu`, `gte` and all eight `gte-latency*`, `libc`, `load-timings`,
`loadexe`, `memcpy`, `memset`, `memops-unroll`, `modplayer-state`, `memcard`,
`memcard-bios`, `psyqo`, `psyqo-reinit`, `psyqo-spudma`, `sr-write`, `gpu-command`,
`gpu-fbrect`, and six of the `2mb-vram` probes.

Failing, by cause as seen in the logs (`--verbose` or `--log-dir <dir>` to look):

| cause | suites |
|-------|--------|
| GPU reads return the CPU-side VRAM mirror, which holds uploads only, so drawn pixels are never read back (`0xDEAD` fill seen instead) | `gpu-raster-phase1`–`23`, `gpu-polyline`, `gpu-vram-move`, `gpu-async-stress` |
| recompiler stops on an instruction it treats as invalid (coprocessor ops that should raise exceptions) | `cop0`, `cop-branch` |
| recompiler emits a jump to a block label it never declared (`_00016aec is not defined`) | `irq-branch-slot` |
| SIO mode register write other than `0x000D` aborts (`serial.js` `wr16r1048`) | `sio-reset` |
| GPU linked-list DMA (`dmaTransferMode0401` in `gpu.js`) follows a looping list forever inside one register write | `dma`, `gpu-dma-loop` |
| GPU IRQ flag (`GPUSTAT.24`) never set by `GP0(1Fh)` | `gpu-irq` |
| GPU DMA request / block split behaviour | `gpu-dma-dreq`, `psyqo-dmachain` |
| root counter gate modes and reset period | `timers` |
| SPU volume sweep and IRQ re-fire | `spu-volsweep`, `spu-irqrefire` |
| PCSX-Redux-only features | `pcdrv` (PCdrv), `rumble` (Lua pad setup), `alloc-tracker` (command port), five `2mb-vram-*` probes run with `-2mbvram` (2 MB VRAM) |
