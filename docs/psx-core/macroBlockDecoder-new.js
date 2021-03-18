'use strict';

const decoder = {
  k: 0,
  q: 0,
  f: true, //- first value
  b: 0, // block cr,cb,y1,y2,y3,y4


  dataIn: function (rle) {
    if (this.f) {
      if (rle != 0xfe00) {
        this.k = 0;
        this.q = rle >>> 10;
        const dc = (rle << 22) >> 22;
        console.log(psx.clock, 'b:', this.b, 'k:', this.k, 'dc:', dc)
        this.f = false;
      }
      else {
//        return abort('unexpected rle')
        return;
      }
    }
    else {
      this.k += ((rle >> 10) + 1); // takes care of 0xfe00
      if (this.k <= 63) {
        const dc = (rle << 22) >> 22;
        console.log(psx.clock, 'b:', this.b, 'k:', this.k, 'dc:', dc)
      }
      if (this.k > 63) {
        // todo: idct
        this.f = true;
        this.b++;
      }
    }

    if (this.b >= 6) {
      console.log('data-in: full');
      this.b = 0;
      // mdc.r1824 |= (1 << 30);
      // mdc.r1824 &= ~(1 << 31);
    }
  }
}

class Fifo {
  constructor(size) {
    this.data = new Uint32Array(size);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.bytesInFifo = 0;
  }

  push(bits32) {
    this.data[this.writeIndex++] = bits32;
    this.writeIndex %= this.data.length;
    ++this.bytesInFifo;
  }

  pop() {
    const bits32 = this.data[this.readIndex++];
    this.readIndex %= this.data.length;
    --this.bytesInFifo;
    return bits32;
  }

  reset() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.bytesInFifo = 0;
  }

  empty() {
    return this.bytesInFifo === 0;
  }

  full() {
    return this.bytesInFifo >= this.data.length;
  }
}

var mdc = {
  r1820: 0,
  r1824: 0x80040000,
  commandIndex: 0,
  commandSize: 0,
  dataOutFifo: new Fifo(32),
  dataInFifo: new Fifo(32),

  rd32r1820: function() {
    return mdc.r1820;
  },

  wr32r1820: function(data) {
    if (0 === (mdc.r1824 & (1 << 29))) {
      mdc.r1820 = data;
      mdc.r1824 |= (1 << 29); // set command busy
      console.log('wr32r1820(c):', hex(data));
      switch (mdc.r1820 >>> 29) {
        case  1:  // Decode
                  mdc.commandIndex = 0;
                  mdc.commandSize = (mdc.r1820 & 0xffff) >>> 0;

                  mdc.r1824 |= (1 << 28); // data-in request
                  mdc.r1824 = (mdc.r1824 & 0xfe8f0000);
                  mdc.r1824 |= ((mdc.r1820 & 0xffff) - 1);
                  mdc.r1824 |= (((mdc.r1820 >> 25) & 15) << 23);
                  break;
        case  2:  // Set Quant Table
                  mdc.commandIndex = 0;
                  mdc.commandSize = (64 >>> 2);
                  if (mdc.r1820 & 1) {
                    mdc.commandSize += (64 >>> 2);
                  }
                  break;
        case  3:  // Set Scale Table
                  mdc.commandIndex = 0;
                  mdc.commandSize = (128 >>> 2);
                  break;
        default:  return abort(`unknown command: ${hex(data)}`)
      }
    }
    else {
      console.log('wr32r1820(p):', hex(data));
      let wordsLeft = mdc.commandSize - 1 - (++mdc.commandIndex);
      if (wordsLeft < 0) wordsLeft = 0xffff;

      switch (mdc.r1820 >>> 29) {
        case 1: mdc.r1824 = (mdc.r1824 & 0xffff0000) | (wordsLeft & 0xffff);
                mdc.dataInFifo.push(data);
                if (mdc.dataInFifo.full()) {

                  mdc.r1824 |= (1 << 30); // data-in fifo full

                  while (!mdc.dataInFifo.empty()) {
                    let bits32 = mdc.dataInFifo.pop();
                    decoder.dataIn((bits32 >>  0) & 0xffff);
                    decoder.dataIn((bits32 >> 16) & 0xffff);
                  }

                  mdc.r1824 &= 0xfff8ffff;
                  mdc.r1824 |= (((4 + decoder.b) % 6) << 16);
                  mdc.r1824 &= ~(1 << 31); // data-out fifo not empty
                  mdc.r1824 |= (1 << 27); // data-out request
                  debugger;
                }
                break;

        case 2: 
        case 3: if (mdc.commandIndex >= mdc.commandSize) {
                  mdc.r1824 &= ~(1 << 29); // clear command busy
                }
                break;
      }
    }
  },

  rd32r1824: function() {
    return mdc.r1824;
  },

  wr32r1824: function(data) {
    console.log('wr32r1824:', hex(data));

    if (data & 0x80000000) {
      mdc.r1820 = 0;
      mdc.r1824 = 0x80040000;
      mdc.event.active = false;
      mdc.dataInFifo.reset();
      mdc.dataOutFifo.reset();
    }
  },

  dmaTransferMode0201: function(addr, blck) {
    addr = addr & 0x001fffff; // ram always
    //console.log("[mdec-in] addr:"+hex(addr)+" blck:"+hex(blck));

    const transferSize = (blck >>> 16) * (blck & 0xffff);
    return transferSize;
  },

  dmaTransferMode0200: function(addr, blck) {
    addr = addr & 0x001fffff; // ram always
    const numberOfWords = (blck >>> 16) * (blck & 0xffff);
    clearCodeCache(addr, numberOfWords << 2);
    return numberOfWords;
  },

  event: null,
  complete: function(self, clock) {
    self.active = false;
  }
}

Object.seal(mdc);
