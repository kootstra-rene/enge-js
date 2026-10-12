# EDI — enge disc image (draft v0)

A single-file, streamable, compressed CD image that replaces cue/bin/sub (and ecm/mdf/ccd), and
holds all discs of a multi-disc game. Design goals, in order:

1. **Zero dependency** — decodable with browser/Node native code only (`DecompressionStream('deflate-raw')`, `DataView`, `fetch` with `Range`).
2. **Lossless** — the original 2352-byte sectors and 96-byte subchannel are reproduced bit-exact.
3. **Streamable** — one range request gets everything needed to pick a disc, one more gets that disc's index, and any sector is then reachable with one request.
4. **Small** — ECM-style removal of predictable data before compression, and block deduplication within and across discs.

All integers are little-endian.

## File layout

```
+---------------------------+  offset 0
| header (64 bytes)         |
+---------------------------+  0x40
| disc table (32 bytes/disc)|
+---------------------------+
| manifest (JSON)           |  UTF-8, uncompressed
+---------------------------+
| block index, disc 0       |  8 bytes per block
| block index, disc 1       |
| ...                       |
+---------------------------+  data offset
| blocks                    |  shared by all discs
+---------------------------+
```

Startup: fetch the first 64 KB (header, disc table, manifest and usually part of the first index),
then the index of the disc being inserted (~88 KB for a full CD). Indexes of other discs are only
fetched when a disc is swapped in.

### Header (64 bytes)

| offset | type   | field                                                    |
|-------:|--------|----------------------------------------------------------|
| 0x00   | u8[8]  | magic `ENGEDISC`                                         |
| 0x08   | u16    | version (0)                                              |
| 0x0A   | u16    | flags — bit 0: subchannel present                        |
| 0x0C   | u16    | sectors per block (default 16)                           |
| 0x0E   | u16    | disc count                                               |
| 0x10   | u32    | manifest length in bytes                                 |
| 0x14   | u32    | reserved (0)                                             |
| 0x18   | u64    | data offset (file offset of the block area)              |
| 0x20   | u8[32] | reserved (0)                                             |

### Disc table (32 bytes per disc)

| offset | type   | field                                                    |
|-------:|--------|----------------------------------------------------------|
| 0x00   | u32    | sector count (LBA 0 .. count-1)                          |
| 0x04   | u32    | block count = ceil(sector count / sectors per block)     |
| 0x08   | u64    | file offset of this disc's block index                   |
| 0x10   | u32    | EDC of the complete original disc image (2352-byte sectors) |
| 0x14   | u8[12] | reserved (0)                                             |

The manifest follows the disc table directly.

### Manifest (JSON)

```json
{
  "title": "Final Fantasy VII",
  "discs": [
    {
      "serial": "SCUS_941.63",
      "tracks": [
        { "number": 1, "session": 1, "type": "MODE2/2352", "index0": null, "index1": 0 }
      ],
      "leadout": 330000
    },
    { "serial": "SCUS_941.64", "tracks": [ ... ], "leadout": 330000 },
    { "serial": "SCUS_941.65", "tracks": [ ... ], "leadout": 330000 }
  ],
  "meta": { "source": "cue" }
}
```

`discs` is in the same order as the disc table. `type` uses CUE track types (`AUDIO`, `MODE1/2352`,
`MODE2/2352`). All positions are LBAs within the disc image (0 = first sector of track 1, after the
standard 150-sector lead-in). The tracks are the single source of truth for the TOC, and also drive
the subchannel predictor.

`session` is optional and defaults to 1. v0 encoders only write single-session discs (every PSX game
disc is single-session); the field exists so multi-session discs (Enhanced CD, multi-burn CD-R) can
be added later without breaking v0 files — the gap between sessions would simply be blocks absent
from the index.

`title`, `serial` and `meta` are informational and ignored by decoders.

### Block index

One 8-byte entry per block of the disc, read as two `u32`:

| bits          | field                                                        |
|---------------|--------------------------------------------------------------|
| lo 0-31       | block offset relative to data offset, low 32 bits            |
| hi 0-7        | block offset, high 8 bits (40-bit offset, 1 TB)              |
| hi 8-30       | compressed size in bytes (max 8 MB)                          |
| hi 31         | stored: block is not deflated (deflate didn't make it smaller) |

Because every entry has its own offset, **several entries may point to the same block** —
within one disc (silence, padding, duplicated files) and across discs (multi-disc games often
repeat most of their data on every disc). Deduplication is optional for encoders; decoders don't
need to know about it.

## Block format

A block covers `sectorsPerBlock` consecutive sectors (the last block of a disc may be shorter).
Compressed with `deflate-raw` independently of every other block. Uncompressed layout:

```
u8   sector types   [n]      one per sector, see below
...  sector payloads         concatenated, sizes depend on type
...  subchannel residual     only when header flag bit 0 is set: n * 96 bytes
u32  EDC                     of the reconstructed n * 2352 sector bytes (integrity check)
```

**Block payloads must not depend on the block's position** — sector addresses and the subchannel
are predicted from the LBA, never stored — so identical content at different positions (or on
different discs) produces identical blocks and can be deduplicated. Exception: the stored EDC is
over the reconstructed sectors, which include the address; to keep blocks position independent it
is computed with the 4 header bytes (sync excluded, offset 12-15) of every sector treated as zero.

### Sector types

The encoder predicts each sector, regenerates it from the reduced payload, and only uses the
reduced type if the result is bit-identical; otherwise it falls back to type 0. Lossless by construction.

| type | name           | payload                         | bytes | reconstructed                                  |
|-----:|----------------|---------------------------------|------:|------------------------------------------------|
| 0    | raw            | full sector                     | 2352  | as is                                          |
| 1    | mode 1         | user data                       | 2048  | sync, header (MSF from LBA, mode 1), EDC, zero, ECC P/Q |
| 2    | mode 2 form 1  | subheader (4) + user data       | 2052  | sync, header (MSF from LBA, mode 2), subheader copy, EDC, ECC P/Q |
| 3    | mode 2 form 2  | subheader (4) + user data       | 2328  | sync, header, subheader copy, EDC              |
| 4    | mode 2 form 2, no EDC | subheader (4) + user data | 2328  | as type 3 but EDC left zero (common on PSX XA audio) |
| 5    | zero           | —                               | 0     | 2352 zero bytes (unwritten / pregap silence)   |
| 6    | audio          | delta-coded PCM                 | 2352  | see below                                      |

ECC/EDC regeneration is the code in `tools/unecm.js`; type 1-4 differ from ECM only in that the
header address is predicted from the LBA instead of stored (saves 3 bytes, removes a high-entropy
field per sector, and makes the payload position independent).

**Audio (type 6):** 588 stereo 16-bit samples, stored as per-channel differences from the
previous sample (the first sample of a sector is relative to 0, so sectors stay independent).
Deflate has no PCM model; delta coding before it is the cheap native-only substitute for FLAC.

### Subchannel residual

Stored deinterleaved (P, Q, R, S, T, U, V, W — 12 bytes each, the CloneCD `.sub` layout) and
XOR-ed with the predicted subchannel:

- **P**: all `0xFF` for sectors in a pregap (index 0) and the lead-out, else all `0x00`
- **Q**: mode-1 position: control/ADR from the track type, track number, index,
  relative MSF (counting down in the pregap), `0x00`, absolute MSF (LBA + 150), CRC-16 (CCITT, inverted)
- **R-W**: zero

For a clean dump the residual is all zeros and deflates to almost nothing. LibCrypt sectors and
read errors survive as the only non-zero bytes, so the `.sbi` information is implicitly kept
without having to tell protection from noise at conversion time. Decoders that don't need the
full subchannel can just look at non-zero Q residuals.

## Streaming

- Startup: `GET` bytes `0-65535` → header, disc table, manifest; then `GET` the index of the
  inserted disc (offset and size from the disc table).
- Read of LBA `n`: block `b = floor(n / sectorsPerBlock)`, offset/size from the index,
  `GET` that byte range, inflate, reconstruct, cache.
- Sequential reads (the PSX reads ahead linearly): consecutive index entries usually point to
  adjacent blocks, so several blocks can be fetched in one range request. A small LRU of decoded
  blocks (e.g. 64 blocks ≈ 2.4 MB) is enough; key it on block offset so deduplicated blocks are
  cached once.
- `server.js` already serves byte ranges.

## Tooling (planned)

- `tools/edi.js` — mdlr module `enge:tools:edi`: `encode({ discs, manifest })`,
  `open(reader)` → `{ manifest, disc(i) → { readSector(lba), readSubchannel(lba) } }`.
- `tools/edi-cli.js` — convert from cue/bin, ccd/img/sub, mds/mdf, ecm (one or more discs into
  one file); and back to cue/bin(+sub) per disc.

## Open issues

1. **Disc swapping in the emulator** — done: `cdr.openShell()` / `cdr.closeShell(delayCycles)` and
   "Change Disc" in the menu (local files). Not yet hooked up to the network game list.
2. Block size: 16 sectors (~37 KB) vs 32 (~74 KB) — better ratio vs finer seeking, and smaller
   blocks deduplicate better (shared files must be at the same offset within a block).
3. Measure the deduplication gain on real multi-disc games (FF7, Legend of Dragoon) to see if
   it's worth the 8-byte index entries over 4-byte size-only entries.
4. File extension: `.edi` is a placeholder.
5. Should the manifest include redump hashes (CRC32/SHA-1 per disc) for verification?
