'use strict';

// The nugget test suite (https://github.com/pcsx-redux/nugget/tree/main/tests)
// as graded by its tests/run-emulator.sh, ported to eNGE.
//
// Every ps-exe the nugget tests build is listed here once, either as a suite
// to run or as a skip with nugget's own reason, so a test added upstream
// shows up as UNLISTED instead of being silently left out.
//
// Differences from run-emulator.sh:
//   - eNGE has a single CPU core (the recompiler), so each suite runs once
//     instead of once per `interpreter` / `dynarec`.
//   - `redux` keeps the PCSX-Redux command-line flags the suite runs with.
//     eNGE has no equivalent for them; `needs` names the feature they stand
//     for so a failure can be read in that light.

const CESTER = '^Synthesis: SUCCESS Tests: [0-9]+ \\| Passing: [1-9][0-9]* \\| Failing: 0';
const PROBE = '^SUMMARY name=[^ ]+ passed=[1-9][0-9]* failed=0';

const suite = (name, exe, success = CESTER, extra = {}) => ({ name, exe, success, timeout: undefined, redux: '', needs: '', ...extra });

const SUITES = [
  suite('basic', 'basic/basic'),
  suite('cop0', 'cop0/cop0', CESTER, { redux: '-debugger' }),
  suite('cop-branch', 'cop-branch/cop-branch', CESTER, { redux: '-debugger' }),
  suite('cpu', 'cpu/cpu'),
  suite('dma', 'dma/dma', CESTER, { redux: '-debugger' }),
  suite('gpu-command', 'gpu-command/gpu-command'),
  suite('gpu-dma-dreq', 'gpu-dma-dreq/gpu-dma-dreq'),
  suite('gpu-dma-loop', 'gpu-dma-loop/gpu-dma-loop'),
  suite('gpu-fbrect', 'gpu-fbrect/gpu-fbrect'),
  suite('gpu-irq', 'gpu-irq/gpu-irq'),
  suite('gpu-polyline', 'gpu-polyline/gpu-polyline'),
  suite('gpu-vram-move', 'gpu-vram-move/gpu-vram-move'),
  suite('gpu-async-stress', 'gpu-async-stress/gpu-async-stress'),
  suite('sio-reset', 'sio-reset/sio-reset', '^SIORST-PASS'),
  suite('alloc-tracker', 'alloc-tracker/alloc-tracker', '^alloc-tracker: all [0-9]+ checks passed', { redux: '-debugger', needs: 'PCSX-Redux command port allocation reports' }),
  suite('gte', 'gte/gte'),
  suite('gte-latency', 'gte-latency/gte-latency'),
  suite('gte-latency-color', 'gte-latency-color/gte-latency-color'),
  suite('gte-latency-dpc', 'gte-latency-dpc/gte-latency-dpc'),
  suite('gte-latency-math', 'gte-latency-math/gte-latency-math'),
  suite('gte-latency-misc', 'gte-latency-misc/gte-latency-misc'),
  suite('gte-latency-mvmva', 'gte-latency-mvmva/gte-latency-mvmva'),
  suite('gte-latency-perspective', 'gte-latency-perspective/gte-latency-perspective'),
  suite('gte-latency-singles', 'gte-latency-singles/gte-latency-singles'),
  suite('irq-branch-slot', 'irq-branch-slot/irq-branch-slot'),
  suite('libc', 'libc/libc'),
  suite('load-timings', 'load-timings/load-timings'),
  suite('loadexe', 'loadexe/loadexe'),
  suite('memcpy', 'memcpy/memcpy'),
  suite('modplayer-state', 'modplayer-state/modplayer-state'),
  suite('memops-unroll', 'memops-unroll/memops-unroll'),
  suite('memcard', 'memcard/memcard', '^memcard port 0: all [0-9]+ checks passed', { timeout: 240 }),
  suite('memcard-bios', 'memcard-bios/memcard-bios', '^memcard-bios port 0: all [0-9]+ checks passed', { timeout: 120 }),
  suite('memset', 'memset/memset'),
  suite('pcdrv', 'pcdrv/pcdrv', CESTER, { redux: '-pcdrv -pcdrvbase <dir>', needs: 'PCdrv host file system' }),
  suite('psyqo', 'psyqo/psyqo-tests', '^All tests passed!'),
  suite('psyqo-dmachain', 'psyqo-dmachain/dmachain', '^All 3 arms passed'),
  suite('psyqo-reinit', 'psyqo-reinit/reinit', '^All reinitialize checks passed'),
  suite('psyqo-spudma', 'psyqo-spudma/spudma', '^All SPU DMA checks passed'),
  suite('rumble', 'rumble/rumble', CESTER, { redux: "-exec dofile('tests/rumble/setup.lua')", needs: 'Lua-scripted pad setup' }),
  suite('spu-volsweep', 'spu-volsweep/spu-volsweep', '^SPUVOLSWEEP: PASS \\(0 failures\\)'),
  suite('spu-irqrefire', 'spu-irqrefire/spu-irqrefire', '^SPUIRQREFIRE: PASS \\(0 failures\\)'),
  suite('sr-write', 'sr-write/sr-write'),
  suite('timers', 'timers/timers'),
  suite('gpu-raster-phase23', 'gpu-raster-phase23/gpu-raster-phase23',
    '^=== phase23 complete === Checks: [0-9]+ \\| Passing: [1-9][0-9]* \\| Failing: 0'),
];

for (let p = 1; p <= 22; ++p) {
  SUITES.push(suite(`gpu-raster-phase${p}`, `gpu-raster-phase${p}/gpu-raster-phase${p}`));
}

SUITES.push(suite('2mb-vram-bank-probe-1mb', '2mb-vram/bank-probe/bank-probe', PROBE));
for (const d of ['bank-probe', 'drawing-area-y', 'drawing-offset-y', 'gate-flip-queued', 'primitives-cross',
  'texpage-upper', 'transfer-h-quirk', 'transfer-wrap-y', 'vram-blit-y', 'vram-transfers-y']) {
  SUITES.push(suite(`2mb-vram-${d}`, `2mb-vram/${d}/${d}`, PROBE, { redux: '-2mbvram', needs: '2 MB VRAM' }));
}

// ps-exe -> reason, as in run-emulator.sh
const SKIPS = new Map([
  ['bsdec/bsdec', 'hardware rig: needs a captured bs-in.bin staged beside it'],
  ['bcc-bits/bcc-bits', 'hardware probe: the emulator does not model bus timing, prints timings, no verdict'],
  ['cdrom/cd-cmd-latency/cd-cmd-latency', 'probe: prints CD command timings, no verdict'],
  ['cop0-sr/cop0-sr', 'hardware probe: prints what each SR bit does, no verdict, and ends in the ROM through BEV'],
  ['cdrom/cdrom', 'needs the disc from cdrom/create-test-iso.lua and the CD-ROM code from pcsx-redux#1129'],
  ['dma-modes/dma-modes', 'hardware probe: prints DMA register states per sync mode, loops forever, no verdict'],
  ['dma-priority/dma-priority', 'hardware probe: prints DMA arbitration timings, loops forever, no verdict'],
  ['spu-wide-writes/spu-wide-writes', 'hardware probe: prints SPU write miss counts, loops forever, no verdict'],
  ['dcache/dcache', 'emulator gap: the BIU d-cache-as-scratchpad modes are not modelled'],
  ['icache/icache', 'emulator gap: i-cache tag and code-word access through BCC TAG/IS1 with SR.IsC is not modelled'],
  ['gpu/gpu', 'probe: loops forever, no verdict'],
  ['gpu-nop/gpu-nop', 'probe: loops forever, no verdict'],
  ['gpu-fifo/gpu-fifo', 'hardware probe: prints FIFO readings, no verdict'],
  ['gte-latency-lzcs/gte-latency-lzcs', 'emulator gap: the GTE store delay is not modelled, so the cached negative control reads correct at N=0'],
  ['gte-math-bench/gte-math-bench', 'benchmark: prints timings, no verdict'],
  ['gte-write-to-use/gte-write-to-use', 'emulator gap: GTE write-to-use delay per command and register; run by the pcsx-redux gtests'],
  ['gpu-dfe-480i/gpu-dfe-480i', 'emulator gap: GP0(E1h).10 row skipping in 480i; run by the pcsx-redux gtests'],
  ['gpustat10/gpustat10', 'emulator gap: GPUSTAT.10 on a textured polygon; run by the pcsx-redux gtests'],
  ['gpu-dma-ring/gpu-dma-ring', 'emulator gap: a GPU linked list used as a ring needs GPU timing and back-pressure (every assert is hardware-only)'],
  ['gpu-timing/gpu-timing', 'emulator gap: GPU draw and transfer time per primitive (the size-growth asserts are hardware-only)'],
  ['gpustat-480i/gpustat-480i', 'emulator gap: GPUSTAT bits 13 and 31 by beam position in 480i; run by the pcsx-redux gtests'],
  ['psyqo-irq-cop2/irqcop2', 'takeover probe: psyqo owns the kernel, results over polled SIO1, spins at the end; run by hand on hardware'],
  ['psyqo-irq-cost/irqcost', 'takeover probe: psyqo owns the kernel, prints VBlank interrupt costs over polled SIO1, no verdict'],
  ['psyqo-480i-flip/flip480i', 'emulator gap: GP0(E1h).10 row skipping in 480i; run by the pcsx-redux gtests'],
  ['shell-480i-wait/shell-480i-wait', 'emulator gap: GP0(E1h).10 row skipping in 480i; run by the pcsx-redux gtests'],
  ['mult-timing/mult-timing', 'hardware probe: prints multiply latency timings, no verdict'],
  ['gte-timing/gte-timing', 'hardware probe: prints GTE command timings, no verdict'],
  ['pocketstation-memmap/pocketstation-memmap', 'hardware probe: needs a PocketStation in a card slot, prints readings, no verdict'],
  ['spu/spu', 'nugget skips it until the SPU from pcsx-redux#2077 is in the dev AppImage'],
  ['spu-endx/spu-endx', 'nugget skips it until the SPU from pcsx-redux#2077 is in the dev AppImage'],
  ['spu-endmute/spu-endmute', 'nugget skips it until the ENVX end-block fix is in pcsx-redux'],
  ['spu-endredirect/spu-endredirect', 'nugget skips it until the end-block redirect from pcsx-redux#2355 is in the dev AppImage'],
  ['spu-konlatch/spu-konlatch', 'nugget skips it until the key-on timeline is in pcsx-redux'],
  ['spu-offvoice/spu-offvoice', 'nugget skips it until the SPU from pcsx-redux#2077 is in the dev AppImage'],
  ['spu-upload-tail/spu-upload-tail', 'hardware probe: prints per-arm tail loss across wait strategies, verdict only on its own controls'],
  ['modplayer-upload-tail/modplayer-upload-tail', 'hardware probe: prints per-arm tail loss across wait strategies, verdict only on its own controls'],
  ['regwrites/regwrites', 'probe: loops forever, no verdict'],
  ['autoinc/autoinc', 'hardware probe: prints what Delay/Size bit 13 does to split accesses, no verdict'],
  ['bcc-narrow/bcc-narrow', 'hardware probe: prints BCC narrow-read results, no verdict'],
  ['dma-chopping/dma-chopping', 'hardware probe: prints CPU progress during a chopped DMA2 transfer, no verdict'],
  ['exp2-width/exp2-width', 'hardware probe: prints every access width to the EXP2 region, no verdict'],
  ['gpu-info8/gpu-info8', 'hardware probe: prints GP1(10h) index 08h readings, no verdict'],
  ['mdec-roundtrip/mdec-roundtrip', 'rig: needs a job file over pcdrv, writes the decoded output back, no verdict'],
  ['scanline-timing/scanline-timing', 'hardware probe: prints scanline and frame lengths, loops forever, no verdict'],
  ['spu-capring/spu-capring', 'hardware probe: prints capture ring readings, no verdict'],
  ['spu-envx/spu-envx', 'hardware probe: prints ENVX readings beside the expected values, always exits 0'],
  ['spu-revread/revread', 'hardware probe: graded on the digital audio tap, loops forever, no verdict'],
  ['spu-revstream/revstream', 'reverb stimulus for the digital audio tap: loops forever, no verdict'],
  ['msan/msan', 'needs the PCSX-Redux memory sanitizer (1F80208Ch ports)'],
  ['msan-trip/msan-trip', 'expects exit 1 from the PCSX-Redux memory sanitizer, run by the pcsx-redux gtests'],
  ['memcard-slot2/memcard-slot2', 'the memcard test built for slot 2, for the farm console whose test card is there'],
  ['memcard-bios-slot2/memcard-bios-slot2', 'the memcard-bios test built for slot 2, for the farm console whose test card is there'],
  ['pcdrv-net/pcdrv-net', 'needs a TCP echo peer on 127.0.0.1:37373, run by the pcsx-redux gtests'],
  ['pcdrv-net-off/pcdrv-net-off', 'needs PCdrv networking from pcsx-redux#2327'],
  ['multitap/multitap', 'needs -shmdisplay host input and multitap from pcsx-redux#2471, run by the pcsx-redux gtests'],
]);
for (const d of ['display-area-y', 'fast-fill-h-quirk', 'fast-fill-y', 'gp1-09-matrix']) {
  SKIPS.set(`2mb-vram/${d}/${d}`, 'probe for 2MB-VRAM hardware: loops forever, no verdict');
}

module.exports = { SUITES, SKIPS, CESTER, PROBE };
