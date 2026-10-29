# Hardware test gaps

Where enge differs from a real PlayStation, as found by the nugget hardware
tests ported to `code/psx/*.spec.js`. Every item is one or more `xit` cases;
each verified on silicon by nugget and failing in enge. Ordered by how much
they are likely to matter (numbering kept; fixed items move to the end). When
an item is fixed, turn its cases back into
`it` and run the spec.

Counts are skipped cases (131 left; the 5 in `mdec` and `spu` predate the port
and are not listed). Spec names are `[test]enge:psx:<spec>`.

## Crashes and hangs

These stop or hang the emulator instead of giving a wrong value.

1. **A branch or jump in a branch delay slot throws** — the recompiler
   compiles the second branch into the first one's block and references its
   target without declaring it (`ReferenceError: _000100f0 is not defined`).
   Rare in games, fatal when it happens.
   - `cpu-mips`: branch in a branch delay slot, jump in a jump delay slot (2)
   - `cop0`: SYSCALL in a nested delay slot, and the irq-branch-slot cases
     (take/handle/return, EPC = B2 with BD, B2 relative to B1, re-run B2) (5)

2. **A SIO0 mode other than 000Dh aborts** — `serial.js` `wr16r1048` calls
   `abort`.
   - `serial-hardware`: resets port 0 (1)

3. **COP1, COP3 and the coprocessor branches (BCzF/BCzT) stop the
   recompiler** as invalid instructions. Hardware raises Coprocessor Unusable
   when the CU bit is clear and otherwise reads the condition as false.
   - `cop0`: Coprocessor Unusable for COP1/COP3 (2), BC2F in a delay slot (1),
     the cop-branch matrix of 20 probes at three SR.CU settings (60)

## Likely to affect games

11. **Root counter 0 ignores gate modes 1-3** and runs free (or stays paused
    in mode 3); the reset period with target reset differs (201/401 system
    clock cycles, 408/808 on system clock / 8).
    - `rtc-hardware`: timerC0GateMode1ResetAtHblank,
      timerC0GateMode2ResetPauseOutside, timerC0GateMode3FreeAfterHblank,
      reset_period_accumulated (4)

16. **Voice captures are one LSB off the goldens** — the voice is now
    decoded, interpolated and enveloped in integers as on hardware and the
    capture buffers hold the enveloped sample before the voice volume, but
    the rounding of interpolation times envelope is not matched exactly (a
    sine's top reads 14279 against 14278; other samples one high or low).
    Further, ADPCM filters 2-4 drift by up to 11 LSB within a block (the
    prediction's rounding), and shifts 13-15 decode as shift 9 where hardware
    gives something else. Inaudible; listed for exactness.
    - `spu-hardware`: adpcm_decode_* (6), adpcm_edge_* (14),
      voice_sample_rate* and voice_volume_does_not_affect_capture (5)

## Accuracy

17. **CPU exceptions**
    - EPC holds the physical address (0001xxxxh) rather than the address the
      code runs at (8001xxxxh), and Cause.BD is never set: an exception in a
      delay slot returns to the wrong place.
      `cop0`: SYSCALL in a delay slot, software interrupt before the next
      instruction, software interrupt in a delay slot, syscall control probe (4)
    - ADD/ADDI/SUB never raise Overflow (compiled as ADDU), BREAK is a no-op.
      `cop0`: Overflow in a delay slot, BREAK in a delay slot (2)
    - No address error exceptions: unaligned stores go ahead.
      `cop0`: address error on an unaligned store (1)
    - SR keeps every bit written, including those hardware holds at 0.
      `cop0`: should keep only the writable SR bits (1)
    - The debug unit (breakpoint registers) is not emulated.
      `cop0`: the three breakpoint cases (3)

18. **Cycles are counted per recompiled block** — `rec.js` adds a block's
    cycles to the clock at the end of the block, so a timer read in the
    middle of a block does not see the instructions before it. Load costs
    per target, load shadows and interlocks cannot be measured, and the
    expansion delay registers (1F801008h-1F801020h) do not change any cost.
    - `load-timings`: loadShadow, loadInterlocked, loadShadowByTarget,
      loadInterlockedByTarget, busDelaySweep (5)

20. **SIO1 is not emulated** — its status reads 0.
    - `serial-hardware`: resets port 1 (1)

## Rarely matters

21. **No instruction cache** — code runs from RAM as it is, so a write to
    code takes effect at once where hardware keeps running the cached copy,
    and the cache tag test mode (BIU FFFE0130h with SR.IsC) cannot read tags
    or code words back. Stores with the cache isolated go to an unused
    memory location (`cpu.js` `forceWriteBits`). Matters for the BIOS cache
    flush and for self-modifying code that relies on stale cache.
    - `icache`: every case but biu_default (11)

22. **No data cache mode for the scratchpad** — with the BIU set to DS
    without RAM, loads do not fill the scratchpad.
    - `dcache`: h01_mapping_full_sweep, i01_stride16_at_offset_zero,
      m01_address_aliasing (3)

## Not covered

Not ported, so not checked: the CD-ROM controller suite (needs nugget's
generated test disc), multitap (expectations come from pcsx-redux's own
emulation), gpu-timing (needs GPU draw timing and pixel readback), anything
compared on rendered pixels (the gpu-raster phases and related suites), and
the tests of nugget's own libraries.

## Fixed

- **The SPU IRQ is acknowledged by writing SPUCNT bit 6 as 0, and fires
  once per arming** (`spu.js`). Was: cleared on bit 6 written as 1, refired
  on every pass. `spu-hardware` irq_voice_read_pointer_block_aligned,
  irq_voice_read_pointer_ack_rearms; `spu-voices` refire rules.
- **A voice keeps reading SPU RAM after it ends or is keyed off**
  (`spu-voice.js`), and the IRQ address matches while the voice plays the
  block holding it. `spu-voices` B: end without repeat, IRQ from a silent
  voice.
- **ADSR envelopes and voice volume sweeps follow the hardware's integer
  envelope** (`spu-voice.js`): step and rate as psx-spx describes them,
  exponential decrease scaled by the level and increase slowed above 6000h,
  a phase ends on the step that reaches its end (decay once the top four
  bits are at or below the sustain level). VOLX (1F801E00h + 4n) reads the
  current volumes. `spu-hardware` adsr_* (11); `spu-voices` the volume
  sweeps (14).
- **Key-on is serviced every other sample, a sample or more after the
  write** (`spu.js`); KON is a register, so a second write before the
  service replaces the first. The voice fetches the first block header for
  three samples (taking its loop start whatever the CPU wrote), then starts
  its envelope. A repeat address the CPU writes while the voice plays is
  kept against later loop-start flags. The voice capture buffers are written
  every sample. `spu-voices` repeat address latching and key-on timing.
- **Voice decoding** (`spu-voice.js`): blocks decode in integers, ADPCM
  filters 5-7 decode as filter 0, the gaussian interpolation runs over the
  decoded samples (with three carried over from the previous block) rather
  than over enveloped output samples, the position moves by the pitch
  before each sample and a key-on starts at the fourth sample of the
  block, ENDX latches once the end block has played. Captures went from
  silence (written after the voice volume) to within one LSB of silicon.
- **Linked-list GPU DMA runs a stretch at a time** (`dma.js`, `gpu.js`
  dmaLinkedListStep): about a word a cycle, alongside the CPU, so MADR
  follows the walk, a looping list keeps the channel busy and clearing CHCR
  bit 24 stops it. Bits 0-1 of the links are ignored (unaligned links hung
  the emulator), and a list that ends on a link other than FFFFFFh keeps it
  in MADR and sets DICR bit 15. `dma-hardware` linked_dma_*; `gpu-hardware`
  the gpu-dma-loop and gpu-dma-ring cases.
- **Block-mode GPU DMA writes every word to GP0** (`gpu.js`), commands
  included, not only the data of a VRAM transfer in progress.
  `dma-hardware` normal_dma*.
- **DMA start and DPCR** (`dma.js`): a transfer started while its channel is
  disabled stays pending (CHCR busy, MADR/BCR untouched) and starts when DPCR
  enables the channel; OTC keeps its start address in MADR and does not run
  without the trigger bit in sync mode 0; the completion events no longer
  fire once at power-on (they cleared the busy bits and set MADR to
  undefined). `dma-hardware` disabled_dma*, otc_*.
- **GP0(1Fh) sets GPUSTAT.24 and raises IRQ1; GP1(02h) acknowledges it**
  (`gpu.js`). `gpu-hardware` irq_* (3).
- **The VBlank IRQ comes at the start of the vertical blank** (the line
  GP1(07h) ends the display on, as the root counters gate on), not at the
  end of the frame; in 480i GPUSTAT.31 is the odd field while it is being
  displayed (0 in the vertical blank) and GPUSTAT.13 the field, which
  changes two lines before the frame ends; GPUSTAT.13 reads 1 when not
  interlaced (`gpu.js`). `gpu-hardware` bit31RisesAtLine23,
  bit13FollowsShortField.
- **Block-mode GPU DMA waits for GPUSTAT.28 before each block** (`dma.js`
  blocksToGpu, `gpu.js` dmaBlockReady): the bit is low while a polygon or
  line command is incomplete, so a block boundary inside one stops the
  channel (until the command is completed), with MADR and BCR showing the
  blocks sent. `gpu-hardware` the gpu-dma-dreq stall cases (8).
- **GTE write-to-use delays** (`gte.js`, data in `gte-latency.data.js`
  from the nugget measurements): MTC2, CTC2 and LWC2 note when they write,
  COP2 when it runs, and a command within three instructions of a write runs
  on the old value of an input where silicon does, or on a mix: the outputs
  of a run on the old value and one on the new value, or the old low half
  (low byte for a 16-bit register) when a single output depends on it. LZCR
  reads the previous count on the instruction right after the MTC2 to LZCS.
  `gte-write-to-use` every cell (85); `gte-latency` lzcs_sweep_cached.
- **GP0 FIFO and line drawing time** (`gpu.js`): words the CPU writes to
  GP0 queue in a FIFO that the GPU drains while it is not drawing, a line
  segment keeping it busy for its length (one pixel per GPU cycle) plus a
  setup time. The FIFO holds 16 words and words written to a full FIFO are
  lost; GPUSTAT.25 (DMA direction 1) drops earlier, with six words queued
  (counting a word a few cycles after its store), and bits 26 and 28 stay
  low while words wait or a line is drawn (bit 26 also during a poly-line).
  DMA still feeds the command buffer directly and polygons take no time.
  The bit 25 threshold, latency and setup time are fitted to the two cases;
  whether the overflow loses the terminator itself depends on where the
  segments fall. `gpu-hardware` pline_cpu_paced (its pixel readback is not
  compared), pline_cpu_unpaced.
