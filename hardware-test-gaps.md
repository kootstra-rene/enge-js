# Hardware test gaps

Where enge differs from a real PlayStation, as found by the nugget hardware
tests ported to `code/psx/*.spec.js`. Every item is one or more `xit` cases;
each verified on silicon by nugget and failing in enge. Ordered by how much
they are likely to matter. When an item is fixed, turn its cases back into
`it` and run the spec.

Counts are skipped cases (293 in all; the 5 in `mdec` and `spu` predate the port
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

4. **Linked-list DMA runs the whole list inside the CHCR write**
   (`gpu.js` `dmaTransferMode0401`).
   - With bits 0-1 set in a link the walk reads unaligned headers and never
     ends: the emulator hangs. Hardware ignores those bits.
     `dma-hardware`: linked_dma_3_oddlinks, linked_dma_odd_terminator (2)
   - A list that loops back on itself hangs (empty nodes), or stops at the
     first packet sent twice. On hardware the channel stays busy, MADR keeps
     walking, the CPU can rewrite nodes behind it, and a CHCR write stops it.
     `gpu-hardware`: loopStaysBusy, loopKeepsWalking, loopRaisesNoDmaError,
     chcrWriteStopsTheLoop (gpu-dma-loop, 4); ringStaysBusy, dmaLapsTheRing,
     cpuKeepsProducing (gpu-dma-ring, 3)

## Likely to affect games

5. **The SPU IRQ is not acknowledged by clearing SPUCNT bit 6** — `spu.js`
   clears SPUSTAT bit 6 when bit 6 is written as 1, hardware when it is
   written as 0. While the flag is set the IRQ also fires again on every
   pass over the address; hardware raises it once per arming. Affects games
   that stream audio on the SPU IRQ.
   - `spu-hardware`: irq_voice_read_pointer_block_aligned,
     irq_voice_read_pointer_ack_rearms (2)
   - `spu-voices`: refire rules, IRQ from a silent voice (2, together with 6)

6. **A voice that has ended or is keyed off stops reading SPU RAM** —
   `spu-voice.js` `advance` returns early without an envelope. On hardware
   the voice keeps decoding at ENVX 0, so the IRQ address still matches and
   a repeat address written later still applies.
   - `spu-voices`: B: end without repeat (spu-endredirect), IRQ from a silent
     voice (spu-offvoice) (2)

7. **ADSR envelopes differ from the first sample** — attack, decay, sustain
   and release steps all read off: the first attack sample is 2 where silicon
   reads 5, sustain level 07FFh holds at 7FBAh, release starts from 7FFFh
   instead of 7FF7h.
   - `spu-hardware`: adsr_attack_linear_step, adsr_attack_linear_shift,
     adsr_attack_exponential, adsr_decay_shift, adsr_sustain_level,
     adsr_sustain_up/down_linear, adsr_sustain_up/down_exponential,
     adsr_release_linear, adsr_release_exponential (11)

8. **Current voice volume (VOLX, 1F801E00h + 4n) is not emulated** — reads
   0, so volume sweeps cannot be observed.
   - `spu-voices`: every voice volume sweep case (14)

9. **GP0(1Fh) and the GPU IRQ are not implemented** — GPUSTAT.24 is never
   set.
   - `gpu-hardware`: irq_clear_after_reset, irq_gp0_1f_sets_flag,
     irq_gp1_02_acknowledges (3)

10. **Block-mode GPU DMA only feeds a VRAM transfer in progress** — commands
    sent by block DMA (CHCR 01000201h) never reach GP0, and GPUSTAT.28 (DMA
    request) does not pace the blocks.
    - `dma-hardware`: normal_dma, normal_dma_with_3_upper_bits,
      normal_dma_with_8_upper_bits, normal_dma_odd_address,
      normal_dma_dicr_toggle (5)
    - `gpu-hardware`: lines_bs16_split, lines_bs1, tris_nop_bs1,
      tris_2nop_bs2_split, gtris_bs16_split, pline_bs16_split, pline_bs1,
      gpline_bs16_split (8)

11. **Root counter 0 ignores gate modes 1-3** and runs free (or stays paused
    in mode 3); the reset period with target reset differs (201/401 system
    clock cycles, 408/808 on system clock / 8).
    - `rtc-hardware`: timerC0GateMode1ResetAtHblank,
      timerC0GateMode2ResetPauseOutside, timerC0GateMode3FreeAfterHblank,
      reset_period_accumulated (4)

12. **GPUSTAT bits 31 and 13 in 480i** — bit 31 rises at line 17 and falls
    at line 257; hardware raises it around line 23 and holds it to vblank.
    Bit 13 never changes. Matters for interlaced games that sync on GPUSTAT.
    - `gpu-hardware`: bit31RisesAtLine23, bit13FollowsShortField (2)

13. **SPU key-on happens at once** — no key-on service latency on the
    two-sample grid, no attack delay after ENDX clears, no header fetches
    that latch the repeat address.
    - `spu-voices`: repeat address latching and key-on timing (1)

14. **The GP0 FIFO is not emulated** — GPUSTAT.25 never drops and a
    poly-line streamed by the CPU never fills it; unpaced, hardware loses the
    terminator.
    - `gpu-hardware`: pline_cpu_paced, pline_cpu_unpaced (2)

15. **DMA register corner cases**
    - A transfer started while the channel is disabled in DPCR: hardware
      keeps it pending (CHCR busy, MADR/BCR untouched, no IRQ) and starts it
      when DPCR enables the channel; enge drops the start bit (block mode
      even runs it).
      `dma-hardware`: disabled_dma, disabled_dma_odd_address, otc_chcr_readback,
      otc_start_disabled, otc_start_disabled_then_enabled (5)
    - Any link with bit 23 set ends a list; hardware keeps that address in
      MADR and sets DICR bit 15. enge ends at 00FFFFFFh with bit 15 clear.
      `dma-hardware`: linked_dma_fffff0_terminator, linked_dma_800000_terminator,
      linked_dma_800001_terminator, linked_dma_800000_terminator_dicr_toggle (4)
    - OTC (channel 6): MADR keeps the start address after the table is
      written (enge leaves 00FFFFFFh), and without the trigger bit (28) the
      transfer does not run (enge runs it).
      `dma-hardware`: otc_start_11000002, otc_start_11000000,
      otc_start_51000f07, otc_start_11000f05, otc_start_41000002,
      otc_start_01000002, otc_start_01000000 (7)

16. **The voice capture buffers are written after the voice volume** — SPU
    RAM 800h/C00h hold the enveloped sample before the volume on hardware,
    so with the volume at 0 enge captures silence. Moved before the volume,
    the waveforms have the right shape but not the amplitude (a sine peaks
    at 16064 against 14278), so the decoder or the gaussian interpolation
    also differs. Few games read the capture buffers; it is listed for the
    decoder accuracy the goldens check.
    - `spu-hardware`: adpcm_decode_* (6), adpcm_edge_predictor_0-4 (5), the
      other adpcm_edge_* cases (9), voice_sample_rate* and
      voice_volume_does_not_affect_capture (5)

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

19. **GTE inputs are used at once** — a command reads the value written to
    its input however close the write; hardware still reads the old value,
    or a mix, for up to three instructions on some inputs. LZCR is ready on
    the MTC2 that writes LZCS, where hardware needs one instruction.
    - `gte-write-to-use`: the cells with O, o or X letters (85)
    - `gte-latency`: lzcs_sweep_cached (1)

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
