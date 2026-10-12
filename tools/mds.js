mdlr('enge:tools:mds', ({ include }) => {

  // MDS/MDF (Alcohol 120% "Media Descriptor") to BIN/CUE converter.
  // Supports MDS v1 CD images; subchannel data is stripped from the sectors.

  const TRACK_AUDIO = 0x9;
  const TRACK_MODE1 = 0xA;

  function view(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return { bytes, dv: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
  }

  function readString(bytes, offset, wide) {
    let text = '';
    if (wide) {
      for (let i = offset; i + 1 < bytes.length; i += 2) {
        const c = bytes[i] | (bytes[i + 1] << 8);
        if (!c) break;
        text += String.fromCharCode(c);
      }
    }
    else {
      for (let i = offset; i < bytes.length && bytes[i]; i++) text += String.fromCharCode(bytes[i]);
    }
    return text;
  }

  // Parses an MDS descriptor and returns its sessions and tracks
  function parse(data) {
    const { bytes, dv } = view(data);
    if (bytes.length < 0x58 || readString(bytes.subarray(0, 16), 0, false) !== 'MEDIA DESCRIPTOR') {
      throw new Error('not an MDS file (signature not found)');
    }
    const version = `${bytes[0x10]}.${bytes[0x11]}`;
    if (bytes[0x10] !== 1) throw new Error(`unsupported MDS version ${version}`);
    const mediumType = dv.getUint16(0x12, true);
    if (mediumType & 0x10) throw new Error('DVD images are not supported');

    const sessionCount = dv.getUint16(0x14, true);
    const sessionsOffset = dv.getUint32(0x50, true);
    const sessions = [];
    for (let s = 0; s < sessionCount; s++) {
      const so = sessionsOffset + s * 24;
      const session = {
        number: dv.getUint16(so + 8, true),
        start: dv.getInt32(so + 0, true),
        end: dv.getInt32(so + 4, true),
        tracks: [],
      };
      const blockCount = bytes[so + 10];
      const tracksOffset = dv.getUint32(so + 20, true);
      for (let b = 0; b < blockCount; b++) {
        const to = tracksOffset + b * 80;
        const point = bytes[to + 4];
        if (point < 1 || point > 99) continue; // skip A0/A1/A2 lead-in entries

        const extraOffset = dv.getUint32(to + 12, true);
        const footerOffset = dv.getUint32(to + 52, true);
        const fileCount = dv.getUint32(to + 48, true);
        if (fileCount > 1) throw new Error(`track ${point}: split image files are not supported`);

        let filename = null;
        if (footerOffset) {
          const filenameOffset = dv.getUint32(footerOffset + 0, true);
          const wide = dv.getUint32(footerOffset + 4, true) !== 0;
          filename = readString(bytes, filenameOffset, wide);
        }

        const subchannel = bytes[to + 1];
        const sectorSize = dv.getUint16(to + 16, true);
        session.tracks.push({
          number: point,
          mode: bytes[to + 0] & 0x0F,
          control: bytes[to + 2] & 0x0F,
          sectorSize,
          subchannelSize: subchannel ? 96 : 0,
          startSector: dv.getUint32(to + 36, true),
          startOffset: Number(dv.getBigUint64(to + 40, true)),
          pregap: extraOffset ? dv.getUint32(extraOffset + 0, true) : 0,
          length: extraOffset ? dv.getUint32(extraOffset + 4, true) : 0,
          filename,
        });
      }
      session.tracks.sort((a, b) => a.number - b.number);
      sessions.push(session);
    }
    return { version, mediumType, sessions };
  }

  function cueType(track, mainSize) {
    if (track.mode === TRACK_AUDIO) return 'AUDIO';
    if (track.mode === TRACK_MODE1) return `MODE1/${mainSize}`;
    return `MODE2/${mainSize}`;
  }

  function msf(sectors) {
    const pad = value => String(value).padStart(2, '0');
    return `${pad(Math.floor(sectors / 4500))}:${pad(Math.floor(sectors / 75) % 60)}:${pad(sectors % 75)}`;
  }

  // Converts an MDS descriptor + MDF image into a single BIN image with a matching CUE sheet
  function convert(mdsData, mdfData, binName) {
    const descriptor = parse(mdsData);
    const mdf = mdfData instanceof Uint8Array ? mdfData : new Uint8Array(mdfData);
    const tracks = descriptor.sessions.flatMap(session => session.tracks);
    if (!tracks.length) throw new Error('no tracks found in MDS');
    if (descriptor.sessions.length > 1) throw new Error('multi-session images are not supported');

    const mainSize = tracks[0].sectorSize - tracks[0].subchannelSize;
    if (tracks.some(track => track.sectorSize - track.subchannelSize !== mainSize)) {
      throw new Error('tracks with different sector sizes are not supported');
    }

    // Work out which file regions to copy: each track starts where the previous one ended in the
    // file, so any pregap stored in front of a track's start offset is kept in the BIN
    let fileEnd = tracks[0].startOffset;
    let binSectors = 0;
    let contiguousLba = null; // LBA directly following the previous region in the BIN
    const regions = [];
    for (const track of tracks) {
      const gapBytes = track.startOffset - fileEnd;
      if (gapBytes < 0 || gapBytes % track.sectorSize) throw new Error(`track ${track.number}: unexpected start offset`);
      const gapSectors = gapBytes / track.sectorSize;
      const count = gapSectors + track.length;
      if (track.startOffset + track.length * track.sectorSize > mdf.length) {
        throw new Error(`track ${track.number}: MDF is truncated`);
      }

      const regionLba = track.startSector - gapSectors;
      // number of sectors in the BIN directly preceding index 01 that are part of the same LBA run
      const available = contiguousLba === regionLba ? binSectors + gapSectors : gapSectors;

      regions.push({ track, offset: fileEnd, count, index1: binSectors + gapSectors, available });
      binSectors += count;
      fileEnd = track.startOffset + track.length * track.sectorSize;
      contiguousLba = track.startSector + track.length;
    }

    const bin = new Uint8Array(binSectors * mainSize);
    let out = 0;
    for (const { track, offset, count } of regions) {
      if (!track.subchannelSize) {
        bin.set(mdf.subarray(offset, offset + count * track.sectorSize), out);
        out += count * track.sectorSize;
        continue;
      }
      for (let i = 0; i < count; i++) {
        const start = offset + i * track.sectorSize;
        bin.set(mdf.subarray(start, start + mainSize), out);
        out += mainSize;
      }
    }

    const cue = [`FILE "${binName}" BINARY`];
    regions.forEach(({ track, index1, available }, i) => {
      cue.push(`  TRACK ${String(track.number).padStart(2, '0')} ${cueType(track, mainSize)}`);
      // track 1 has the standard 2 second lead-in pregap which is never part of the image
      if (i > 0 && track.pregap) {
        if (available > 0) {
          cue.push(`    INDEX 00 ${msf(index1 - Math.min(available, track.pregap))}`);
        }
        else {
          cue.push(`    PREGAP ${msf(track.pregap)}`);
        }
      }
      cue.push(`    INDEX 01 ${msf(index1)}`);
    });

    return { bin, cue: cue.join('\r\n') + '\r\n', descriptor };
  }

  return { mds: { parse, convert } };

})
