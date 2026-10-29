mdlr('enge:psx:test-hw', () => {

  // The hardware registers of a test machine (enge:psx:test-machine) under
  // their nugget names (common/hardware/*.h), so ported test code can keep
  // writing `hw.SPU_CTRL = 0x8000` or `hw.DMA_CTRL[4].CHCR`. Every access
  // goes over the bus with its C width.
  //
  // RAM buffers: hw.ram(addr, Type, length) is a typed array over emulated
  // RAM (writes land there directly, without bus timing), and
  // hw.addressOf(array) gives its address back, for DMA.

  const hardware = (m) => {
    const reg = (obj, name, addr, bits, signed = false) => {
      const read = bits === 8 ? m.read8 : bits === 16 ? m.read16 : m.read32;
      const write = bits === 8 ? m.write8 : bits === 16 ? m.write16 : m.write32;
      const mask = bits === 32 ? null : (1 << bits) - 1;
      Object.defineProperty(obj, name, {
        enumerable: true,
        get: () => {
          const v = read(addr);
          if (mask === null) return signed ? v | 0 : v >>> 0;
          return signed ? (v << (32 - bits)) >> (32 - bits) : v & mask;
        },
        set: v => write(addr, v),
      });
    };
    const struct = (base, fields) => {
      const obj = {};
      for (const [name, offset, bits, signed] of fields) reg(obj, name, base + offset, bits, signed);
      return obj;
    };

    const hw = {};
    // hwregs.h
    reg(hw, 'SBUS_DEV4_CTRL', 0x1f801014, 32);
    reg(hw, 'SBUS_DEV5_CTRL', 0x1f801018, 32);
    reg(hw, 'SBUS_COM_CTRL', 0x1f801020, 32);
    reg(hw, 'SPU_DELAY', 0x1f801014, 32);
    reg(hw, 'RAM_SIZE', 0x1f801060, 32);
    reg(hw, 'IREG', 0x1f801070, 32);
    reg(hw, 'IMASK', 0x1f801074, 32);
    reg(hw, 'DPCR', 0x1f8010f0, 32);
    reg(hw, 'DICR', 0x1f8010f4, 32);
    reg(hw, 'GPU_DATA', 0x1f801810, 32);
    reg(hw, 'GPU_STATUS', 0x1f801814, 32);

    // dma.h
    hw.DMA_CTRL = Array.from({ length: 7 }, (_, ch) => struct(0x1f801080 + 16 * ch, [['MADR', 0, 32], ['BCR', 4, 32], ['CHCR', 8, 32]]));
    Object.assign(hw, { DMA_MDECIN: 0, DMA_MDECOUT: 1, DMA_GPU: 2, DMA_CDROM: 3, DMA_SPU: 4, DMA_PIO: 5, DMA_GPUOTC: 6 });

    // irq.h
    Object.assign(hw, {
      IRQ_VBLANK: 1 << 0, IRQ_GPU: 1 << 1, IRQ_CDROM: 1 << 2, IRQ_DMA: 1 << 3, IRQ_TIMER0: 1 << 4,
      IRQ_TIMER1: 1 << 5, IRQ_TIMER2: 1 << 6, IRQ_CONTROLLER: 1 << 7, IRQ_SIO: 1 << 8, IRQ_SPU: 1 << 9, IRQ_PIO: 1 << 10,
    });

    // counters.h
    hw.COUNTERS = Array.from({ length: 3 }, (_, n) => struct(0x1f801100 + 16 * n, [['value', 0, 16], ['mode', 4, 16], ['target', 8, 16]]));

    // sio.h
    hw.SIOS = Array.from({ length: 2 }, (_, n) => struct(0x1f801040 + 16 * n, [['fifo', 0, 8], ['stat', 4, 16], ['mode', 8, 16], ['ctrl', 10, 16], ['baudRate', 14, 16]]));

    // spu.h
    hw.SPU_VOICES = Array.from({ length: 24 }, (_, n) => struct(0x1f801c00 + 16 * n, [
      ['volumeLeft', 0, 16], ['volumeRight', 2, 16], ['sampleRate', 4, 16], ['sampleStartAddr', 6, 16],
      ['adsrLo', 8, 16], ['adsrHi', 10, 16], ['currentVolume', 12, 16], ['sampleRepeatAddr', 14, 16],
    ]));
    hw.SPU_REVERB = struct(0x1f801dc0, [
      'dAPF1', 'dAPF2', 'vIIR', 'vCOMB1', 'vCOMB2', 'vCOMB3', 'vCOMB4', 'vWALL', 'vAPF1', 'vAPF2',
      'mLSAME', 'mRSAME', 'mLCOMB1', 'mRCOMB1', 'mLCOMB2', 'mRCOMB2', 'dLSAME', 'dRSAME', 'mLDIFF', 'mRDIFF',
      'mLCOMB3', 'mRCOMB3', 'mLCOMB4', 'mRCOMB4', 'dLDIFF', 'dRDIFF', 'mLAPF1', 'mRAPF1', 'mLAPF2', 'mRAPF2', 'vLIN', 'vRIN',
    ].map((name, i) => [name, 2 * i, 16]));
    for (const [name, addr] of [
      ['SPU_VOL_MAIN_LEFT', 0x1f801d80], ['SPU_VOL_MAIN_RIGHT', 0x1f801d82], ['SPU_REVERB_LEFT', 0x1f801d84], ['SPU_REVERB_RIGHT', 0x1f801d86],
      ['SPU_KEY_ON_LOW', 0x1f801d88], ['SPU_KEY_ON_HIGH', 0x1f801d8a], ['SPU_KEY_OFF_LOW', 0x1f801d8c], ['SPU_KEY_OFF_HIGH', 0x1f801d8e],
      ['SPU_PITCH_MOD_LOW', 0x1f801d90], ['SPU_PITCH_MOD_HIGH', 0x1f801d92], ['SPU_NOISE_EN_LOW', 0x1f801d94], ['SPU_NOISE_EN_HIGH', 0x1f801d96],
      ['SPU_REVERB_EN_LOW', 0x1f801d98], ['SPU_REVERB_EN_HIGH', 0x1f801d9a], ['SPU_ENDX_LOW', 0x1f801d9c], ['SPU_ENDX_HIGH', 0x1f801d9e],
      ['SPU_REVERB_ADDR', 0x1f801da2], ['SPU_IRQ_ADDR', 0x1f801da4], ['SPU_RAM_DTA', 0x1f801da6], ['SPU_RAM_DATA', 0x1f801da8],
      ['SPU_CTRL', 0x1f801daa], ['SPU_RAM_DTC', 0x1f801dac], ['SPU_STATUS', 0x1f801dae],
      ['SPU_VOL_CD_LEFT', 0x1f801db0], ['SPU_VOL_CD_RIGHT', 0x1f801db2], ['SPU_VOL_EXT_LEFT', 0x1f801db4], ['SPU_VOL_EXT_RIGHT', 0x1f801db6],
    ]) reg(hw, name, addr, 16);
    // VOLX (current volume) per voice, signed: 1F801E00h + 4 * n
    hw.VOLXL = n => { const v = m.read16(0x1f801e00 + 4 * n); return (v << 16) >> 16; };
    hw.VOLXR = n => { const v = m.read16(0x1f801e02 + 4 * n); return (v << 16) >> 16; };

    // RAM buffers
    let next = 0x80180000;
    hw.ram = (addr, Type, length) => {
      const array = new Type(m.ram.buffer, (addr >>> 0) & 0x001fffff, length);
      array.address = addr >>> 0;
      return array;
    };
    // a fresh RAM buffer for C statics and locals (aligned to 16 bytes)
    hw.alloc = (Type, length) => {
      const addr = next;
      next += ((Type.BYTES_PER_ELEMENT * length) + 15) & ~15;
      const array = hw.ram(addr, Type, length);
      array.fill(0);
      return array;
    };
    hw.addressOf = array => array.address >>> 0;

    return hw;
  };

  return { hardware };
})
