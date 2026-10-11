# CD-ROM emulation improvements

Remaining issues in `code/psx/cdr.js` (numbering kept from the original review; 1–9, 22–26 and 33–35 are fixed).

## Command semantics

10. **Setloc `00:00:00` is ignored** — treated as "keep current position", but it is a valid MSF. No BCD validation either.
11. **Play with track `0`** hits the `params.length === 1` branch and plays from `tracks[0]` (whole-disc pseudo track). An invalid track number throws on `undefined.begin`.
12. **SetSession (`0x12`) second response** sends INT1 with an 8-byte report; it should be INT2 with the stat byte. The first response also leaves busy (`0x80`) set.
13. **GetlocP (`0x11`)**
    - Absolute time uses `currLoc - 150` (2 s too low; absolute MSF = LBA + 150).
    - Minutes are `% 60` (wrong past 60 minutes).
    - `currTrack.id` is `undefined` before the first read → NaN.
    - Negative relative time in pregaps goes through `itob` → garbage (should count down, index 0).
14. **Play report (INT1)** — absolute time is 2 s too low; index is always 1, peak bytes are 0, stat is hardcoded `0x82`.
15. **Wrong error codes**
    - GetTD invalid track: should be `stat|1, 0x10`, sends `0x11, 0x80`.
    - GetID no disc: should be `0x08, 0x40, …`.
    - GetStat no disc returns INT5 instead of INT3 with stat.
16. **`statusCode` keeps `0x10` (shell open)** after any error until a new image loads; GetTN/GetTD/SetSession then report the lid open.
17. **Stat byte is not modelled** — most responses use hardcoded `0x02/0x42/0x82/0x22`. `statusCode` never gets read/seek/play bits; Stop doesn't clear motor-on; Pause relies on a `|0x20` hack.
18. **Init (`0x0A`)** does not reset `mode` (nocash: mode = `0x20`) or the XA filter.
19. **GetID region string is `eNGE`** — real discs return `SCEI`/`SCEA`/`SCEE`; region-checking games can fail. Audio CDs / unlicensed discs are not modelled.
20. **Test (`0x19`)** ignores the sub-function and always returns the `0x20` version reply.
21. **First-response delay is `0x200` cycles** for most commands; hardware is ~20k–50k cycles (only Nop uses `0xc4e1`).

## Register interface

27. **`1803` read at index 2/3** returns `undefined` (should mirror enable / flag). Flag read lacks the always-set bits `0xE0`.
28. **Parameter FIFO status** — `PRMEMPT` (`0x08`) never clears when params are written; `PRMWRDY` (`0x10`) is never set again after being cleared at 16 params.
29. **Busy (`0x80`) stays set during the whole second-response wait** (Pause, Seek, Stop, Standby, Init). Hardware clears it after the first response.
30. **Request register (`1803` index 0)**
    - Only exactly `0x80` is recognised (other bits ignored).
    - Writing `0` does not clear the data FIFO / DRQ (`0x40`).
    - The sector is not latched at request time; DMA reads the live buffer that the next read event overwrites.
31. **Data FIFO (`1802`) byte reads** never clear DRQ and ignore `sectorEnd`. DMA uses 16-bit indexing, so an odd number of prior byte reads drops a byte.
32. **`sectorIndex`/`sectorEnd` are reset for every sector**, including XA audio and filtered sectors that are not delivered to the CPU.

## XA-ADPCM / CDDA audio

36. **No XA ring buffer** — every XA sector does `pcm.fill(0)` and restarts at index 0, so leftover samples are dropped and late sectors repeat the last sample. Output also persists (DC) after the stream stops.
37. **Decoder accuracy**
    - No clamp to int16 before feeding filter history (overflow can blow up).
    - Filter index uses `& 0xf0`; XA filters are 2 bits.
    - Shift 13–15 not treated as 9.
    - 8-bit samples and emphasis not implemented.
    - Nearest-neighbour resampling instead of the hardware zigzag interpolation.
38. **Mute is ignored** — `mute` (Mute/Demute) is never applied; ADPCM mute (`1803` index 3 bit 0) not handled; SPU `SPUCNT` bit 0 (CD audio enable) not checked in `spu.js`.
39. **XA filter compares signed `Int8` bytes** against unsigned params, so file/channel ≥ `0x80` never match.

## Timing and misc

40. **No seek time for ReadN/ReadS** (first sector after one sector period regardless of distance). No spin-up delay on speed change. Pause while already paused takes the full pause time.
41. **Reads stall while an IRQ is pending** (retry every 64 cycles without advancing). Hardware keeps spinning and buffers/overruns sectors, which changes streaming timing.
42. **Inconsistent timing constants** — `PSX_SPEED` in `completeCmd` vs hardcoded `33868800` in `completeRead`. ReadTOC completes in `0x1000` cycles.
43. **No end-of-disc handling during Play** without auto-pause, and no error for ReadN on an audio track without `mode & 0x01`.
44. **State handling** — `getState` returns live `pcm`/`xa` references (not copies); `resetForNewImage` keeps `mode`, filter, `irqEnable`, and XA history from the previous disc.
45. **CUE parsing (`index.js`)** — `PREGAP`/`POSTGAP` and `INDEX 00` are ignored, so LBAs are wrong for cues that use them.
