# DMA emulation improvements

Remaining issues in `code/psx/dma.js`, ordered by severity (numbering kept from the original review; 5–9 are fixed). Found by reading the code against hardware behaviour (nocash psx-spx); not yet verified by running games.

## Crashes and state corruption

1. **DMA state is not part of save states** — `dpcr`, `dicr` and all `r10xx` registers are private to the module and `saveState` (`code/psx/index.js:434`) never stores them. The scheduler does save pending `eventDMAx` events, so after a load the completion handlers copy stale `r10x0n` values into MADR. Channels mid-transfer (CD sector reads, GPU uploads) come back inconsistent.
2. **Missing register handlers throw** — `$rd32` has no entries for channel 5 (`0x10d0–0x10d8`) or `0x10f8`/`0x10fc`. `$rd32.get(...)` returns `undefined` and calling it throws a `TypeError`. `$wr32` has the same gap for channel 5 and `0x10f8`/`0x10fc` (the BIOS touches these).
3. **8/16-bit access is broken**
    - `rd16`/`wr16` pass the raw address to the 32-bit maps; `0x10f6` (upper half of DICR) throws.
    - A 16-bit write to `0x10f4` goes through `wr32r10f4` with bits 16–31 zero, **clearing all channel IRQ enables and the master enable**.
    - `rd08`/`wr08` only handle `0x10f6`. A byte write to `0x10f7` (used to acknowledge IRQ flags) falls through to `wr32` and throws.
    - Narrow accesses never shift data into the correct byte lane.
4. **Unknown CHCR values `abort()`** — each channel switches on exact control values. Any unseen combination (chopping, other trigger bits, other sync modes) aborts instead of decoding direction / step / sync mode / start / trigger fields.

## Minor

10. **Transfers are instantaneous** — data moves when the channel starts; only completion is delayed. The CPU is never stalled and DPCR priorities are ignored. CPU writes during a "running" transfer see already-copied data.
11. **Channel 1 has no completion of its own** — it relies on `mdec.js:350` calling `completeDMA1`. A channel 1 start without a matching MDEC decode stays busy forever.
12. **`dpcr` / `dicr` start as `undefined`** — DPCR reset value is `0x07654321`.
13. **`dmaDebug` reads `window.location` at module load** — throws in a worker or Node.
14. Comment typo "called mby mdec" (`dma.js:199`).

## Suggested order

1, 2 and 3 first: they are the remaining crashes.

Still open from the fixed section: channel 6 MADR after completion is hardcoded to `0x00ffffff` (`todo` in code).
