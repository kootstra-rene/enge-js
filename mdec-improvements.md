# MDEC emulation improvements

Remaining issues in `code/psx/mdec.js`, ordered by severity. Found by reading the code against hardware behaviour (nocash psx-spx) and DuckStation's `mdec.cpp`; not yet verified by running games.

Already fixed: input queueing when the next frame is sent before the current one is decoded, and the status register (`0x1f801824`) reporting busy / words remaining from decode progress (fixes FF9 FMVs showing only the left 32 pixels).

Also fixed (the former "Wrong output" section): command bits 25/26 are no longer cleared after DMA0, so 15-bit output gets STP; 4-bit and 8-bit monochrome output (one Y block per macroblock); signed output (command bit 26); hardware dequantisation (`q = 0` path, `(val * q * qt + 4) / 8` rounding, clamp to `-0x400..0x3ff`); the hardware matrix IDCT using the scale table uploaded with command 3 (defaults to the standard table); and psx-spx YUV→RGB coefficients with saturation.

## Command handling

7. **Command 2 (set IQ table) aborts unless it is exactly `0x40000001`** (`mdec.js:272`) — `0x40000000` (luma table only, 16 words) is valid and crashes the emulator.
8. **Commands 0/4–7 are only `console.log`ged** — their parameter words are not consumed.
9. **Commands only run on DMA0 start** — parameters written by the CPU to `0x1f801820`, or a command word sent inside the DMA0 stream, are not supported; `wr32r1820` just stores the value.
10. **Reading `0x1f801820` returns the last command** — on hardware it is the data-out FIFO, so CPU-driven (non-DMA) MDEC output reads garbage. 8/16-bit reads of `0x1820` are not mapped in `mmu.js`.
11. **Decoding reads past the end of the input** — `rl2blk` has no bound against `rlEnd`; a DMA1 that asks for more macroblocks than the remaining data decodes whatever follows in RAM instead of waiting.

## Status / control register

12. **Status bits 27/28 (data-out / data-in request) and 30 (input full) are never set; bit 31 (output empty) is always 1; current block (16–18) is fixed at 4.** Games polling these before starting DMA see wrong values.
13. **DMA enable bits (30/29) written to `0x1f801824` are ignored** — DMA0/DMA1 run even when the game has disabled them.

## Timing and data flow

14. **Decode is instantaneous at DMA1 start and DMA0 completes instantly** — on hardware DMA0 only finishes as the MDEC consumes input. Input is read from RAM at decode time, so a game that refills its DMA0 buffer as soon as DMA0 completes gets corrupted frames. The queue covers FF9's pattern only.
15. **Queue lag limit drops data** — if a third frame arrives while one is already queued, the rest of the current frame is skipped.
16. **Decode time is `PSX_SPEED / 9000` per macroblock** (~3760 cycles); DuckStation uses 448 per block (2688 per macroblock).
17. **DMA1 writes to RAM don't invalidate the recompiler cache** (`clearCodeCache` commented out) — harmless unless code is executed from a decode buffer.

## Save states

18. **MDEC state is not saved** — `index.js` never stores `mdc` (command, IQ table, read position, queue, pending event). Loading a state mid-FMV loses the IQ table and decode position, giving garbled video until the next movie re-initialises the MDEC.

## Minor

19. `mdecDebug` reads `window.location` at module load (throws in a worker or Node).
20. `mdc.end` is written but never read.

## Suggested order

7 and 18 first (cheap, clear bugs), then 14 if more games show FMV corruption.
