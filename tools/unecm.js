mdlr('enge:tools:unecm', ({ include }) => {

  // UNECM - Decoder for ECM (Error Code Modeler) format.
  // JavaScript port of unecm.c v1.0, Copyright (C) 2002 Neill Corlett (GPLv2+).
  // https://github.com/qeedquan/ecm/blob/master/unecm.c

  const SECTOR_SIZE = 2352;

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
  function edcPartialComputeBlock(edc, src, offset, size) {
    for (let i = 0; i < size; i++) {
      edc = (edc >>> 8) ^ edc_lut[(edc ^ src[offset + i]) & 0xFF];
    }
    return edc >>> 0;
  }

  function edcComputeBlock(src, offset, size, dest) {
    const edc = edcPartialComputeBlock(0, src, offset, size);
    src[dest + 0] = (edc >>> 0) & 0xFF;
    src[dest + 1] = (edc >>> 8) & 0xFF;
    src[dest + 2] = (edc >>> 16) & 0xFF;
    src[dest + 3] = (edc >>> 24) & 0xFF;
  }

  // Compute ECC for a block (can do either P or Q)
  function eccComputeBlock(sector, src, majorCount, minorCount, majorMult, minorInc, dest) {
    const size = majorCount * minorCount;
    for (let major = 0; major < majorCount; major++) {
      let index = (major >> 1) * majorMult + (major & 1);
      let ecc_a = 0;
      let ecc_b = 0;
      for (let minor = 0; minor < minorCount; minor++) {
        const temp = sector[src + index];
        index += minorInc;
        if (index >= size) index -= size;
        ecc_a ^= temp;
        ecc_b ^= temp;
        ecc_a = ecc_f_lut[ecc_a];
      }
      ecc_a = ecc_b_lut[ecc_f_lut[ecc_a] ^ ecc_b];
      sector[dest + major] = ecc_a;
      sector[dest + major + majorCount] = ecc_a ^ ecc_b;
    }
  }

  // Generate ECC P and Q codes for a block
  function eccGenerate(sector, zeroAddress) {
    let address0, address1, address2, address3;
    // Save the address and zero it out
    if (zeroAddress) {
      address0 = sector[12]; address1 = sector[13]; address2 = sector[14]; address3 = sector[15];
      sector[12] = sector[13] = sector[14] = sector[15] = 0;
    }
    // Compute ECC P code
    eccComputeBlock(sector, 0xC, 86, 24, 2, 86, 0x81C);
    // Compute ECC Q code
    eccComputeBlock(sector, 0xC, 52, 43, 86, 88, 0x8C8);
    // Restore the address
    if (zeroAddress) {
      sector[12] = address0; sector[13] = address1; sector[14] = address2; sector[15] = address3;
    }
  }

  // Generate ECC/EDC information for a sector (must be 2352 = 0x930 bytes)
  function eccedcGenerate(sector, type) {
    switch (type) {
      case 1: // Mode 1
        edcComputeBlock(sector, 0x00, 0x810, 0x810);
        sector.fill(0, 0x814, 0x81C);
        eccGenerate(sector, false);
        break;
      case 2: // Mode 2 form 1
        edcComputeBlock(sector, 0x10, 0x808, 0x818);
        eccGenerate(sector, true);
        break;
      case 3: // Mode 2 form 2
        edcComputeBlock(sector, 0x10, 0x91C, 0x92C);
        break;
    }
  }

  // Walks the ECM block headers; calls onBlock(type, count, offset) and returns final offset
  function parseBlocks(input, onBlock) {
    if (input.length < 4 || input[0] !== 0x45 || input[1] !== 0x43 || input[2] !== 0x4D || input[3] !== 0x00) {
      throw new Error('Header not found! Corrupt ECM file!');
    }
    const uneof = () => new Error('Unexpected EOF! Corrupt ECM file!');
    const inputSizes = [0, 0x803, 0x804, 0x918];
    let offset = 4;
    for (;;) {
      if (offset >= input.length) throw uneof();
      let c = input[offset++];
      let bits = 5;
      const type = c & 3;
      let num = (c >> 2) & 0x1F;
      while (c & 0x80) {
        if (offset >= input.length) throw uneof();
        c = input[offset++];
        if (bits < 32) num = (num | ((c & 0x7F) << bits)) >>> 0;
        bits += 7;
      }
      if (num === 0xFFFFFFFF) break;
      num++;
      if (num >= 0x80000000) throw new Error('Corrupt ECM file!');
      const size = type ? num * inputSizes[type] : num;
      if (offset + size > input.length) throw uneof();
      onBlock(type, num, offset);
      offset += size;
    }
    if (offset + 4 > input.length) throw uneof();
    return offset;
  }

  // Decodes an ECM image (ArrayBuffer or Uint8Array) and returns the raw image as Uint8Array
  function decode(data) {
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);

    // first pass: validate structure and determine output size
    const outputSizes = [1, SECTOR_SIZE, 2336, 2336];
    let outputSize = 0;
    parseBlocks(input, (type, num) => { outputSize += num * outputSizes[type]; });

    const output = new Uint8Array(outputSize);
    const sector = new Uint8Array(SECTOR_SIZE);
    let checkedc = 0;
    let out = 0;

    const end = parseBlocks(input, (type, num, offset) => {
      if (!type) {
        output.set(input.subarray(offset, offset + num), out);
        checkedc = edcPartialComputeBlock(checkedc, output, out, num);
        out += num;
        return;
      }
      while (num--) {
        sector.fill(0);
        sector.fill(0xFF, 1, 11);
        switch (type) {
          case 1:
            sector[0x0F] = 0x01;
            sector.set(input.subarray(offset, offset + 0x003), 0x00C);
            sector.set(input.subarray(offset + 0x003, offset + 0x803), 0x010);
            offset += 0x803;
            eccedcGenerate(sector, 1);
            checkedc = edcPartialComputeBlock(checkedc, sector, 0, SECTOR_SIZE);
            output.set(sector, out);
            out += SECTOR_SIZE;
            break;
          case 2:
          case 3: {
            const size = type === 2 ? 0x804 : 0x918;
            sector[0x0F] = 0x02;
            sector.set(input.subarray(offset, offset + size), 0x014);
            offset += size;
            sector[0x10] = sector[0x14];
            sector[0x11] = sector[0x15];
            sector[0x12] = sector[0x16];
            sector[0x13] = sector[0x17];
            eccedcGenerate(sector, type);
            checkedc = edcPartialComputeBlock(checkedc, sector, 0x10, 2336);
            output.set(sector.subarray(0x10), out);
            out += 2336;
            break;
          }
        }
      }
    });

    const expected = (input[end] | (input[end + 1] << 8) | (input[end + 2] << 16) | (input[end + 3] << 24)) >>> 0;
    if (expected !== checkedc) {
      const hex = value => ('00000000' + value.toString(16).toUpperCase()).slice(-8);
      throw new Error(`EDC error (${hex(checkedc)}, should be ${hex(expected)}) Corrupt ECM file!`);
    }

    return output;
  }

  function isEcm(data) {
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);
    return input.length >= 4 && input[0] === 0x45 && input[1] === 0x43 && input[2] === 0x4D && input[3] === 0x00;
  }

  return { unecm: { decode, isEcm } };

})
