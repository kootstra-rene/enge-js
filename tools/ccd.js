mdlr('enge:tools:ccd', ({ include }) => {

  // CloneCD (.ccd/.img/.sub) to CUE converter.
  // The .img is a plain 2352 byte/sector image starting at LBA 0 (identical to a .bin), so only a CUE
  // sheet is needed; the .sub file (96 bytes deinterleaved subchannel per sector) is not used.

  const SECTOR_SIZE = 2352;

  // Parses the INI style .ccd text into { 'section name': { key: value } } (keys lowercased)
  function parseIni(text) {
    const sections = {};
    let current = null;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';')) continue;
      const header = /^\[(.+)\]$/.exec(line);
      if (header) {
        current = sections[header[1].trim().toLowerCase()] = {};
        continue;
      }
      const eq = line.indexOf('=');
      if (current && eq > 0) current[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
    }
    return sections;
  }

  function int(value) {
    if (value === undefined) return undefined;
    const number = /^-?0x/i.test(value) ? parseInt(value, 16) : parseInt(value, 10);
    if (Number.isNaN(number)) throw new Error(`invalid number '${value}' in CCD`);
    return number;
  }

  // Parses a .ccd descriptor and returns its tracks
  function parse(text) {
    const ini = parseIni(typeof text === 'string' ? text : new TextDecoder().decode(text));
    if (!ini.clonecd || !ini.disc) throw new Error('not a CloneCD descriptor ([CloneCD] / [Disc] missing)');

    const disc = ini.disc;
    const sessionCount = int(disc.sessions) || 1;
    const entryCount = int(disc.tocentries) || 0;
    const scrambled = int(disc.datatracksscrambled) === 1;

    // TOC entries: points 1..99 are tracks, point 0xA2 is the lead-out
    const tracks = [];
    let leadout;
    for (let i = 0; i < entryCount; i++) {
      const entry = ini[`entry ${i}`];
      if (!entry) throw new Error(`[Entry ${i}] missing`);
      const point = int(entry.point);
      const plba = int(entry.plba);
      if (point === 0xA2) leadout = Math.max(leadout || 0, plba);
      if (point < 1 || point > 99) continue;
      tracks.push({ number: point, session: int(entry.session), control: int(entry.control), index1: plba });
    }
    tracks.sort((a, b) => a.number - b.number);

    // optional [TRACK n] sections (CloneCD v3) carry the mode and index 0 (pregap) positions
    for (const track of tracks) {
      const section = ini[`track ${track.number}`] || {};
      track.mode = section.mode !== undefined ? int(section.mode) : (track.control & 0x04 ? 2 : 0);
      if (section['index 1'] !== undefined) track.index1 = int(section['index 1']);
      if (section['index 0'] !== undefined) track.index0 = int(section['index 0']);
    }

    return { version: int(ini.clonecd.version), sessionCount, scrambled, tracks, leadout };
  }

  function cueType(track) {
    if (!(track.control & 0x04) || track.mode === 0) return 'AUDIO';
    return track.mode === 1 ? `MODE1/${SECTOR_SIZE}` : `MODE2/${SECTOR_SIZE}`;
  }

  function msf(sectors) {
    const pad = value => String(value).padStart(2, '0');
    return `${pad(Math.floor(sectors / 4500))}:${pad(Math.floor(sectors / 75) % 60)}:${pad(sectors % 75)}`;
  }

  // Builds a CUE sheet for a .ccd descriptor; imgName is the image file referenced by the CUE
  function toCue(text, imgName) {
    const descriptor = parse(text);
    if (!descriptor.tracks.length) throw new Error('no tracks found in CCD');
    if (descriptor.sessionCount > 1) throw new Error('multi-session images are not supported');
    if (descriptor.scrambled) throw new Error('scrambled data tracks are not supported');

    const cue = [`FILE "${imgName}" BINARY`];
    for (const track of descriptor.tracks) {
      cue.push(`  TRACK ${String(track.number).padStart(2, '0')} ${cueType(track)}`);
      if (track.index0 !== undefined && track.index0 < track.index1) cue.push(`    INDEX 00 ${msf(track.index0)}`);
      cue.push(`    INDEX 01 ${msf(track.index1)}`);
    }
    return { cue: cue.join('\r\n') + '\r\n', descriptor };
  }

  return { ccd: { parse, toCue, SECTOR_SIZE } };

})
