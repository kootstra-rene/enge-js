mdlr('enge:psx:serial-device', ({ include }) => {

  const { encode } = include('base64');

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
  let dualShock = false;
  let analog = false;
  let config = false;
  let commandConfig = false;
  let rumbleMap = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

  return {
    lo: 0xff,
    hi: 0xff,
    lx: 0x80, ly: 0x80, rx: 0x80, ry: 0x80,
    get analogMode() { return dualShock && analog; },
    setControllerMode: function (value) {
      dualShock = value === "analog";
      analog = dualShock;
      config = false;
      rumbleMap.fill(0xff);
    },
    setId: function (deviceId) {
      id = deviceId;
      return this;
    },
    setMemoryCard: buffer => {
      for (let i = 0; i < buffer.length; ++i) {
        memory[i] = buffer[i];
      }
    },
    // UI-only snapshot accessor for save/download/upload features. It does not
    // alter the serial memory-card protocol or card initialization behavior.
    getMemoryCard: () => new Uint8Array(memory),
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
      commandConfig = config;
      const buttons = [this.lo, this.hi];
      const inputs = [...buttons, this.rx, this.ry, this.lx, this.ly];
      if (byte === 0x42 || (dualShock && byte === 0x43)) {
        const header = config ? 0xf3 : analog ? 0x73 : 0x41;
        response.push(header, 0x5a, ...(config && byte === 0x43 ? [0, 0, 0, 0, 0, 0] :
          (config || analog) ? inputs : buttons));
        return;
      }
      if (!dualShock || !config) {
        response.push(0xff);
        return;
      }
      switch (byte) {
        case 0x44: response.push(0xf3, 0x5a, 0, 0, 0, 0, 0, 0); break;
        case 0x45: response.push(0xf3, 0x5a, 1, 2, analog ? 1 : 0, 2, 1, 0); break;
        case 0x46: response.push(0xf3, 0x5a, 0, 0, 1, 2, 0, 10); break;
        case 0x47: response.push(0xf3, 0x5a, 0, 0, 2, 0, 1, 0); break;
        case 0x4c: response.push(0xf3, 0x5a, 0, 0, 0, 4, 0, 0); break;
        case 0x4d: response.push(0xf3, 0x5a, ...rumbleMap); break;
        default: response.push(0xff); break;
      }
    },
    sendReceiveByte: byte => {
      const index = received.length;
      if (dualShock && index === 2) {
        if (mode === 0x43 && (byte === 0 || byte === 1)) config = byte === 1;
        if (commandConfig && mode === 0x44 && (byte === 0 || byte === 1)) analog = byte === 1;
        if (commandConfig && mode === 0x46) {
          response.splice(2, 4, ...(byte === 0 ? [1, 2, 0, 10] : byte === 1 ? [1, 1, 1, 20] : [0, 0, 0, 0]));
        }
        if (commandConfig && mode === 0x4c) response[3] = byte === 0 ? 4 : byte === 1 ? 7 : 0;
      }
      if (dualShock && commandConfig && mode === 0x4d && index >= 2 && index < 8) {
        rumbleMap[index - 2] = byte;
      }
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
