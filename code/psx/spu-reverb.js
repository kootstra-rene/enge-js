mdlr('enge:psx:spu-reverb', m => {

  let vLOUT;
  let vROUT;
  let mBASE;
  let dAPF1;
  let dAPF2;
  let vIIR;
  let vCOMB1;
  let vCOMB2;
  let vCOMB3;
  let vCOMB4;
  let vWALL;
  let vAPF1;
  let vAPF2;
  let mLSAME;
  let mRSAME;
  let mLCOMB1;
  let mRCOMB1;
  let mLCOMB2;
  let mRCOMB2;
  let dLSAME;
  let dRSAME;
  let mLDIFF;
  let mRDIFF;
  let mLCOMB3;
  let mRCOMB3;
  let mLCOMB4;
  let mRCOMB4;
  let dLDIFF;
  let dRDIFF;
  let mLAPF1;
  let mRAPF1;
  let mLAPF2;
  let mRAPF2;
  let vLIN;
  let vRIN;

  let memory;
  let bufferAddress;
  let left;
  let right;

  const s16 = d => (d << 16) >> 16;
  const s16d8 = d => (d << 16) >>> 13;
  const u16d8 = d => (d << 16) >>> 13;

  const writeHandlers = new Map([
    [0x1d84, data => vLOUT = s16(data)],
    [0x1d86, data => vROUT = s16(data)],
    [0x1da2, data => bufferAddress = mBASE = u16d8(data)],
    [0x1dc0, data => dAPF1 = s16d8(data)],
    [0x1dc2, data => dAPF2 = s16d8(data)],
    [0x1dc4, data => vIIR = s16(data)],
    [0x1dc6, data => vCOMB1 = s16(data)],
    [0x1dc8, data => vCOMB2 = s16(data)],
    [0x1dca, data => vCOMB3 = s16(data)],
    [0x1dcc, data => vCOMB4 = s16(data)],
    [0x1dce, data => vWALL = s16(data)],
    [0x1dd0, data => vAPF1 = s16(data)],
    [0x1dd2, data => vAPF2 = s16(data)],
    [0x1dd4, data => mLSAME = s16d8(data)],
    [0x1dd6, data => mRSAME = s16d8(data)],
    [0x1dd8, data => mLCOMB1 = s16d8(data)],
    [0x1dda, data => mRCOMB1 = s16d8(data)],
    [0x1ddc, data => mLCOMB2 = s16d8(data)],
    [0x1dde, data => mRCOMB2 = s16d8(data)],
    [0x1de0, data => dLSAME = s16d8(data)],
    [0x1de2, data => dRSAME = s16d8(data)],
    [0x1de4, data => mLDIFF = s16d8(data)],
    [0x1de6, data => mRDIFF = s16d8(data)],
    [0x1de8, data => mLCOMB3 = s16d8(data)],
    [0x1dea, data => mRCOMB3 = s16d8(data)],
    [0x1dec, data => mLCOMB4 = s16d8(data)],
    [0x1dee, data => mRCOMB4 = s16d8(data)],
    [0x1df0, data => dLDIFF = s16d8(data)],
    [0x1df2, data => dRDIFF = s16d8(data)],
    [0x1df4, data => mLAPF1 = s16d8(data)],
    [0x1df6, data => mRAPF1 = s16d8(data)],
    [0x1df8, data => mLAPF2 = s16d8(data)],
    [0x1dfa, data => mRAPF2 = s16d8(data)],
    [0x1dfc, data => vLIN = s16(data)],
    [0x1dfe, data => vRIN = s16(data)],
  ]);

  const loc = addr => mBASE + (bufferAddress + addr) % (0x80000 - mBASE);
  const saturate = data => data < -32768 ? -32768 : data > 32767 ? 32767 : data;

  const rd16 = addr => memory.getInt16(loc(addr), true);
  const wr16 = (addr, data) => memory.setInt16(loc(addr), saturate(data), true);

  const norm = data => (data / 0x8000) >> 0;

  const reverbLeft = sample => {
    // ___Input from Mixer(Input volume multiplied with incoming data)_____________
    // Lin = vLIN * LeftInput;from any channels that have Reverb enabled
    const Lin = vLIN * sample;
    // ____Same Side Reflection(left - to - left and right - to - right)___________________
    // [mLSAME] = (Lin + [dLSAME] * vWALL - [mLSAME - 2]) * vIIR + [mLSAME - 2]; L - to - L
    wr16(mLSAME, norm((Lin + norm(rd16(dLSAME) * vWALL) - rd16(mLSAME - 2)) * vIIR) + rd16(mLSAME - 2));
    // ___Different Side Reflection(left - to - right and right - to - left)_______________
    // [mLDIFF] = (Lin + [dRDIFF] * vWALL - [mLDIFF - 2]) * vIIR + [mLDIFF - 2]; R - to - L
    wr16(mLDIFF, norm((Lin + norm(rd16(dRDIFF) * vWALL) - rd16(mLDIFF - 2)) * vIIR) + rd16(mLDIFF - 2));
    // ___Early Echo(Comb Filter, with input from buffer) __________________________
    // Lout = vCOMB1 * [mLCOMB1] + vCOMB2 * [mLCOMB2] + vCOMB3 * [mLCOMB3] + vCOMB4 * [mLCOMB4]
    let Lout = norm(vCOMB1 * rd16(mLCOMB1)) + norm(vCOMB2 * rd16(mLCOMB2)) + norm(vCOMB3 * rd16(mLCOMB3)) + norm(vCOMB4 * rd16(mLCOMB4));
    // ___Late Reverb APF1(All Pass Filter 1, with input from COMB) ________________
    // Lout = Lout - vAPF1 * [mLAPF1 - dAPF1], [mLAPF1] = Lout, Lout = Lout * vAPF1 + [mLAPF1 - dAPF1]
    Lout = Lout - norm(vAPF1 * rd16(mLAPF1 - dAPF1));
    wr16(mLAPF1, Lout);
    Lout = norm(Lout * vAPF1) + rd16(mLAPF1 - dAPF1);
    // ___Late Reverb APF2(All Pass Filter 2, with input from APF1) ________________
    // Lout = Lout - vAPF2 * [mLAPF2 - dAPF2], [mLAPF2] = Lout, Lout = Lout * vAPF2 + [mLAPF2 - dAPF2]
    Lout = Lout - norm(vAPF2 * rd16(mLAPF2 - dAPF2));
    wr16(mLAPF2, Lout);
    Lout = norm(Lout * vAPF2) + rd16(mLAPF2 - dAPF2);
    // ___Output to Mixer(Output volume multiplied with input from APF2) ___________
    // LeftOutput = Lout * vLOUT

    return left = norm(Lout * vLOUT) / 0x8000;
  };

  const reverbRight = sample => {
    // ___Input from Mixer(Input volume multiplied with incoming data)_____________
    // Rin = vRIN * RightInput;from any channels that have Reverb enabled
    const Rin = vRIN * sample;
    // ____Same Side Reflection(left - to - left and right - to - right)___________________
    // [mRSAME] = (Rin + [dRSAME] * vWALL - [mRSAME - 2]) * vIIR + [mRSAME - 2]; R - to - R
    wr16(mRSAME, norm((Rin + norm(rd16(dRSAME) * vWALL) - rd16(mRSAME - 2)) * vIIR) + rd16(mRSAME - 2));
    // ___Different Side Reflection(left - to - right and right - to - left)_______________
    // [mRDIFF] = (Rin + [dLDIFF] * vWALL - [mRDIFF - 2]) * vIIR + [mRDIFF - 2]; L - to - R
    wr16(mRDIFF, norm((Rin + norm(rd16(dLDIFF) * vWALL) - rd16(mRDIFF - 2)) * vIIR) + rd16(mRDIFF - 2));
    // ___Early Echo(Comb Filter, with input from buffer) __________________________
    // Rout = vCOMB1 * [mRCOMB1] + vCOMB2 * [mRCOMB2] + vCOMB3 * [mRCOMB3] + vCOMB4 * [mRCOMB4]
    let Rout = norm(vCOMB1 * rd16(mRCOMB1)) + norm(vCOMB2 * rd16(mRCOMB2)) + norm(vCOMB3 * rd16(mRCOMB3)) + norm(vCOMB4 * rd16(mRCOMB4));
    // ___Late Reverb APF1(All Pass Filter 1, with input from COMB) ________________
    // Rout = Rout - vAPF1 * [mRAPF1 - dAPF1], [mRAPF1] = Rout, Rout = Rout * vAPF1 + [mRAPF1 - dAPF1]
    Rout = Rout - norm(vAPF1 * rd16(mRAPF1 - dAPF1));
    wr16(mRAPF1, Rout);
    Rout = norm(Rout * vAPF1) + rd16(mRAPF1 - dAPF1);
    // ___Late Reverb APF2(All Pass Filter 2, with input from APF1) ________________
    // Rout = Rout - vAPF2 * [mRAPF2 - dAPF2], [mRAPF2] = Rout, Rout = Rout * vAPF2 + [mRAPF2 - dAPF2]
    Rout = Rout - norm(vAPF2 * rd16(mRAPF2 - dAPF2));
    wr16(mRAPF2, Rout);
    Rout = norm(Rout * vAPF2) + rd16(mRAPF2 - dAPF2);
    // ___Output to Mixer(Output volume multiplied with input from APF2) ___________
    // RightOutput = Rout * vROUT

    bufferAddress += 2;

    return right = norm(Rout * vROUT) / 0x8000;
  };

  return {
    advance: (sampleIndex, sampleLeft, sampleRight, ram) => {
      memory = ram;
      return (sampleIndex & 1) ? [left, reverbRight(sampleRight)] : [reverbLeft(sampleLeft), right];
    },
    rd16: (addr) => {
      console.log('rd16', hex(addr, 4));
    },
    wr16: (addr, data) => {
      writeHandlers.get(addr)(data);
    }

  }

})