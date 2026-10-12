mdlr('enge:tools:ecm', ({ include }) => {

  // ECM - Encoder for ECM (Error Code Modeler) format.
  // JavaScript port of ecm.c v1.0, Copyright (C) 2002 Neill Corlett (GPLv2+).
  // https://github.com/qeedquan/ecm/blob/master/ecm.c

  // LUTs used for computing ECC/EDC
  const ecc_f_lut = new Uint8Array(256);
  const ecc_b_lut = new Uint8Array(256);
  const edc_lut = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    const j = ((i << 1) ^ (i & 0x80 ? 0x11D : 0)) & 0xFF;
    ecc_f_lut[i] = j;
    ecc_b_lut[i ^ j] = i;
    let edc = i;
    for (let k = 0; k < 8; k++) edc = (edc >>> 1) ^ (edc & 1 ? 0xD8018001 : 0);
    edc_lut[i] = edc >>> 0;
  }

  // Compute EDC for a block
  function edcComputeBlock(edc, src, offset, size) {
    for (let i = 0; i < size; i++) {
      edc = (edc >>> 8) ^ edc_lut[(edc ^ src[offset + i]) & 0xFF];
    }
    return edc >>> 0;
  }

  // Check ECC for a block (can do either P or Q); src is the offset of the sector header (sector + 0xC).
  // With zeroAddress the 4 header bytes are treated as zero instead of being read.
  function eccCheckBlock(data, src, zeroAddress, majorCount, minorCount, majorMult, minorInc, dest) {
    const size = majorCount * minorCount;
    for (let major = 0; major < majorCount; major++) {
      let index = (major >> 1) * majorMult + (major & 1);
      let ecc_a = 0;
      let ecc_b = 0;
      for (let minor = 0; minor < minorCount; minor++) {
        const temp = (zeroAddress && index < 4) ? 0 : data[src + index];
        index += minorInc;
        if (index >= size) index -= size;
        ecc_a ^= temp;
        ecc_b ^= temp;
        ecc_a = ecc_f_lut[ecc_a];
      }
      ecc_a = ecc_b_lut[ecc_f_lut[ecc_a] ^ ecc_b];
      if (data[dest + major] !== ecc_a) return false;
      if (data[dest + major + majorCount] !== (ecc_a ^ ecc_b)) return false;
    }
    return true;
  }

  // Check ECC P and Q codes for a block; sector is the offset of the (virtual) 2352 byte sector
  function eccCheck(data, sector, zeroAddress, dest) {
    return eccCheckBlock(data, sector + 0xC, zeroAddress, 86, 24, 2, 86, dest)
        && eccCheckBlock(data, sector + 0xC, zeroAddress, 52, 43, 86, 88, dest + 0x8C8 - 0x81C);
  }

  function edcMatches(data, offset, edc) {
    return data[offset + 0] === ((edc >>> 0) & 0xFF)
        && data[offset + 1] === ((edc >>> 8) & 0xFF)
        && data[offset + 2] === ((edc >>> 16) & 0xFF)
        && data[offset + 3] === ((edc >>> 24) & 0xFF);
  }

  // sector types:
  // 00 - literal bytes
  // 01 - 2352 mode 1         predict sync, mode, reserved, edc, ecc
  // 02 - 2336 mode 2 form 1  predict redundant flags, edc, ecc
  // 03 - 2336 mode 2 form 2  predict redundant flags, edc
  function checkType(data, s, canBeType1) {
    let canBeType2 = true;
    let canBeType3 = true;
    // Check for mode 1
    if (canBeType1) {
      if (data[s + 0x00] !== 0x00 || data[s + 0x0B] !== 0x00 || data[s + 0x0F] !== 0x01) {
        canBeType1 = false;
      }
      for (let i = 0x01; canBeType1 && i <= 0x0A; i++) {
        if (data[s + i] !== 0xFF) canBeType1 = false;
      }
      for (let i = 0x814; canBeType1 && i <= 0x81B; i++) {
        if (data[s + i] !== 0x00) canBeType1 = false;
      }
    }
    // Check for mode 2
    if (
      data[s + 0x0] !== data[s + 0x4] ||
      data[s + 0x1] !== data[s + 0x5] ||
      data[s + 0x2] !== data[s + 0x6] ||
      data[s + 0x3] !== data[s + 0x7]
    ) {
      canBeType2 = false;
      canBeType3 = false;
      if (!canBeType1) return 0;
    }
    // Check EDC
    let edc = edcComputeBlock(0, data, s, 0x808);
    if (canBeType2 && !edcMatches(data, s + 0x808, edc)) canBeType2 = false;
    edc = edcComputeBlock(edc, data, s + 0x808, 8);
    if (canBeType1 && !edcMatches(data, s + 0x810, edc)) canBeType1 = false;
    edc = edcComputeBlock(edc, data, s + 0x810, 0x10C);
    if (canBeType3 && !edcMatches(data, s + 0x91C, edc)) canBeType3 = false;
    // Check ECC
    if (canBeType1 && !eccCheck(data, s, false, s + 0x81C)) canBeType1 = false;
    if (canBeType2 && !eccCheck(data, s - 0x10, true, s + 0x80C)) canBeType2 = false;
    if (canBeType1) return 1;
    if (canBeType2) return 2;
    if (canBeType3) return 3;
    return 0;
  }

  // Growable output buffer
  function createWriter(capacity) {
    let buffer = new Uint8Array(capacity);
    let length = 0;
    const reserve = size => {
      if (length + size <= buffer.length) return;
      const grown = new Uint8Array(Math.max(buffer.length * 2, length + size));
      grown.set(buffer.subarray(0, length));
      buffer = grown;
    };
    return {
      byte(value) { reserve(1); buffer[length++] = value; },
      bytes(src, start, end) { reserve(end - start); buffer.set(src.subarray(start, end), length); length += end - start; },
      result() { return buffer.slice(0, length); },
    };
  }

  // Encode a type/count combo
  function writeTypeCount(out, type, count) {
    count = (count - 1) >>> 0;
    out.byte(((count >= 32) << 7) | ((count & 31) << 2) | type);
    count >>>= 5;
    while (count) {
      out.byte(((count >= 128) << 7) | (count & 127));
      count >>>= 7;
    }
  }

  // Encode a run of sectors/literals of the same type
  function flush(out, input, type, count, start) {
    writeTypeCount(out, type, count);
    if (!type) {
      out.bytes(input, start, start + count);
      return;
    }
    while (count--) {
      switch (type) {
        case 1:
          out.bytes(input, start + 0x00C, start + 0x00F);
          out.bytes(input, start + 0x010, start + 0x810);
          start += 2352;
          break;
        case 2:
          out.bytes(input, start + 0x004, start + 0x808);
          start += 2336;
          break;
        case 3:
          out.bytes(input, start + 0x004, start + 0x91C);
          start += 2336;
          break;
      }
    }
  }

  // Encodes a raw CD image (ArrayBuffer or Uint8Array) and returns the ECM image as Uint8Array
  function encode(data) {
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);
    const out = createWriter(input.length + 64);
    const stride = [1, 2352, 2336, 2336];

    // Magic identifier
    out.byte(0x45); out.byte(0x43); out.byte(0x4D); out.byte(0x00);

    let curType = -1;
    let curTypeCount = 0;
    let curTypeStart = 0;
    let pos = 0;
    while (pos < input.length) {
      const avail = input.length - pos;
      const detectType = avail < 2336 ? 0 : checkType(input, pos, avail >= 2352);
      if (detectType !== curType) {
        if (curTypeCount) flush(out, input, curType, curTypeCount, curTypeStart);
        curType = detectType;
        curTypeStart = pos;
        curTypeCount = 1;
      }
      else {
        curTypeCount++;
      }
      pos += stride[curType];
    }
    if (curTypeCount) flush(out, input, curType, curTypeCount, curTypeStart);

    // End-of-records indicator
    writeTypeCount(out, 0, 0);
    // Input file EDC
    const edc = edcComputeBlock(0, input, 0, input.length);
    out.byte((edc >>> 0) & 0xFF);
    out.byte((edc >>> 8) & 0xFF);
    out.byte((edc >>> 16) & 0xFF);
    out.byte((edc >>> 24) & 0xFF);

    return out.result();
  }

  return { ecm: { encode } };

})
