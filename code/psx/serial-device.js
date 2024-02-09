mdlr('enge:psx:serial-device', m => {

  const { encode } = m.require('base64');

  const memory = new Uint8Array(128 * 1024);

  const setResponseBlock = (before, after) => {
    response.push(...before);
    for (let i = 0; i < 128; ++i) {
      response.push(-1);
    }
    response.push(...after);
  }

  let id = 0;
  let mode = 0;
  let response = [];
  let received = [];
  let checkSum = 0;
  let addr = 0;

  return {
    lo: 0xff,
    hi: 0xff,
    setId: function (deviceId) {
      id = deviceId;
      return this;
    },
    setMemoryCard: buffer => {
      for (let i = 0; i < buffer.length; ++i) {
        memory[i] = buffer[i];
      }
    },
    init: () => {
      mode = 0x00;
      response = [];
      received = [];
    },
    buildMemCardResponse: byte => {
      mode = byte;
      switch (byte) {
        case 0x52:
          setResponseBlock([0x00, 0x5a, 0x5d, 0x00, -1, 0x5c, -1, -1, -1], [-1, 0x47]);
          break;
        case 0x57:
          setResponseBlock([0x00, 0x5a, 0x5d, -1, -1], [-1, 0x5c, 0x5d, 0x47]);
          break;
        default:
          response.push(0xff);
          break;
      }
    },
    buildControllerResponse: function (byte) {
      mode = byte;
      switch (byte) {
        case 0x42:
          response.push(0x41, 0x5a, this.lo, this.hi/*, 0x00, 0x00, 0x00, 0x00*/);
          break;
        case 0x43:  // todo: Exit/Enter configuration
          response.push(0xff);
          break;
        default:
          return abort(hex(byte, 2));
      }
    },
    sendReceiveByte:  byte => {
      if (response.length <= 0) console.log(`#${id}: reading unexpected in mode $${hex(mode, 2)}`);
      let data = response.shift() || 0;

      if (mode === 0x52) {
        if (data === -1) {
          const dataIndex = received.length;
          switch (true) {
            case (dataIndex === 4):
              data = received[3];
              break;
            case (dataIndex === 6):
              data = 0x5d;
              break;
            case (dataIndex === 7):
              data = received[3];
              checkSum = data;
              break;
            case (dataIndex === 8):
              addr = (received[3] << 8) | received[4];
              data = received[4];
              checkSum ^= data;
              break;

            case (dataIndex >= 9 && dataIndex < 137):
              const offset = (addr * 128) + dataIndex - 9;
              data = memory[offset];
              checkSum ^= data;
              break;

            case (dataIndex === 137):
              data = checkSum & 0xff;
              break;
          }
        }
      }
      if (mode === 0x57) {
        if (data === -1) {
          const dataIndex = received.length;
          switch (true) {
            case (dataIndex === 3):
              data = received[3];
              checkSum = data;
              break;
            case (dataIndex === 4):
              data = received[3];
              checkSum ^= data;
              addr = (data << 8) | byte;
              break;
            case (dataIndex >= 5 && dataIndex < 133):
              const offset = (addr * 128) + dataIndex - 5;
              data = memory[offset - 1];
              memory[offset] = byte;
              checkSum ^= byte;
              break;
            case (dataIndex === 133):
              // todo: check checkSum
              data = memory[132];
              localStorage.setItem(`card${id + 1}`, encode(memory));
              break;
          }
        }
      }

      received.push(byte);
      return data & 0xff;
    },
    hasMore: () => response.length > 0
  }
})