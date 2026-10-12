mdlr('enge:psx:cdr', () => {

  const cdDebug = new URLSearchParams(window.location.search).has('debug-cd') ||
    window.localStorage.getItem('enge-debug-cdrom') === '1';
  const cdLog = (...args) => {
    if (cdDebug) console.debug('[CDR]', ...args.map(value =>
      typeof value === 'object' ? JSON.stringify(value) : value));
  };

  let sectorData8 = new Int8Array(0);
  let sectorData16 = new Int16Array(0);

  // Remote discs are kept as a small LRU of HTTP range chunks. The current
  // sector remains in this fixed 2352-byte buffer for the synchronous CDR
  // register and DMA paths below.
  const remoteChunkSize = Math.floor((8 * 1024 * 1024) / 2352) * 2352;
  const remoteMaxChunks = 3;
  const remoteSectorSize = 2352;
  const remoteSector = new Uint8Array(remoteSectorSize);
  let remoteImage;
  let localImage;
  let remoteRead;
  let debugSectorLogCount = 0;
  let debugDmaLogCount = 0;
  let debugResponseLogCount = 0;

  const READ_MISSING = 0;
  const READ_DATA = 1;
  const READ_AUDIO = 2;
  const READ_PENDING = 3;

  const INVALID_COMMAND = 0x1000;

  // Cue files are laid out back to back; maps an LBA to [fileIndex, fileSector].
  const locateSector = (fileSectors, lba) => {
    if (lba < 0) return null;
    for (let i = 0; i < fileSectors.length; ++i) {
      if (lba < fileSectors[i]) return [i, lba];
      lba -= fileSectors[i];
    }
    return null;
  };

  const touchRemoteChunk = (file, chunkIndex) => {
    const lru = remoteImage.lru;
    const index = lru.findIndex(entry => entry.file === file && entry.chunkIndex === chunkIndex);
    if (index !== -1) lru.splice(index, 1);
    lru.push({ file, chunkIndex });
  };

  const fetchRemoteChunk = (file, fileIndex, chunkIndex) => {
    const cached = file.chunks.get(chunkIndex);
    if (cached) return Promise.resolve(cached);
    if (file.pending.has(chunkIndex)) return file.pending.get(chunkIndex);

    const start = chunkIndex * remoteChunkSize;
    const end = Math.min(start + remoteChunkSize, file.size);
    cdLog('HTTP range', { file: fileIndex, chunk: chunkIndex, start, end: end - 1 });
    const request = fetch(file.url, {
      headers: { Range: `bytes=${start}-${end - 1}` }
    }).then(async response => {
      if (response.status !== 206) {
        throw new Error(`CD image server returned HTTP ${response.status}; byte ranges are required`);
      }
      const data = new Uint8Array(await response.arrayBuffer());
      cdLog('HTTP range complete', { file: fileIndex, chunk: chunkIndex, bytes: data.byteLength });
      file.chunks.set(chunkIndex, data);
      if (!remoteImage?.files.includes(file)) return data;
      touchRemoteChunk(file, chunkIndex);
      while (remoteImage.lru.length > remoteMaxChunks) {
        const oldest = remoteImage.lru.shift();
        oldest.file.chunks.delete(oldest.chunkIndex);
      }
      return data;
    });
    file.pending.set(chunkIndex, request);
    request.then(
      () => file.pending.delete(chunkIndex),
      () => file.pending.delete(chunkIndex),
    );
    return request;
  };

  let status = 0x18;
  let statusCode = 0x00;

  let ncmdread = 0;
  let ncmdctrl = 0;
  let cmdClock = 0;
  // Second responses (INT2/INT4) run independently of the next command's first response.
  let asyncCode = 0;
  let asyncClock = 0;
  let testSubcommand = 0;

  let sectorOffset = 0;
  let sectorIndex = 0;
  let sectorEnd = 0;

  let playIndex = 0;

  let irq = 0;
  let irqEnable = 0xff;

  let mode = 0;
  let mute = false; // todo: implement mute

  let currLoc = 0;
  let seekLoc = 0;
  // Read/Play resume from currLoc unless a Setloc was issued since the last seek.
  let setlocPending = false;

  let volCdLeft2SpuLeft = 1.0;
  let volCdLeft2SpuRight = 0.0;
  let volCdRight2SpuLeft = 0.0;
  let volCdRight2SpuRight = 1.0;
  let volConfigCdLeft2SpuLeft = 1.0;
  let volConfigCdLeft2SpuRight = 0.0;
  let volConfigCdRight2SpuLeft = 0.0;
  let volConfigCdRight2SpuRight = 1.0;

  let pcmidx = 0;
  let pcmmax = 0;

  let filterFile = 0;
  let filterChan = 0;

  let currTrack = {};

  const [addEvent, setEvent, unsetEvent] = [psx.addEvent, psx.setEvent, psx.unsetEvent];

  const floor = a => a >> 0;

  const itob = i => floor(i / 10) * 16 + floor(i % 10);
  const btoi = b => floor(b / 16) * 10 + floor(b % 16);

  // Seek time scales with head travel distance. Full-disc seek ~= 80ms (~2.7M cycles);
  // short seeks bottom out at a small fixed latency. 330000 ~= sectors across a full disc.
  const seekCycles = (targetLoc, currentLoc) => {
    const distance = Math.abs(targetLoc - currentLoc);
    return Math.min(2700000, (distance / 330000) * 2700000 + 20000) >>> 0;
  };

  const results = new Array(16);
  const pushResults = results.push.bind(results);

  const params = new Array(16);

  const pcm = new Float32Array(8064 * 44100 / 18900);
  const xa = new Float32Array(8064);

  const tracks = [];

  const sl = [0.0, 0.0];
  const sr = [0.0, 0.0];

  const getCdVolume = (data) => ((data & 0xff) >>> 0) / 0x80;

  const setIrq = (data) => {
    irq = (irq & 0xE0) | (data & 0x1F);
    if (irq & (0x1F & irqEnable)) {
      cpu.istat |= 0x0004;
    }
    if (cdDebug && (data & 0x1F)) {
      cdLog('interrupt asserted', {
        requested: data & 0x1F,
        irq,
        irqEnable,
        istat: cpu.istat >>> 0,
      });
    }
  };

  const acknowledgeInterrupt = (data) => {
    const before = irq;
    irq &= ~(data & 0x1F);
    if (cdDebug && (data & 0x1F)) {
      cdLog('interrupt acknowledged', {
        requested: data & 0x1F,
        before,
        after: irq,
        irqEnable,
        istat: cpu.istat >>> 0,
      });
    }
  };

  const enqueueEvent = (irq, ...params) => {
    // if (results.length) abort('not yet read all results');
    status = (status & ~0x80) | 0x20;
    pushResults(...params);
    setIrq(irq);
  };

  const resetparams = () => {
    params.length = 0;
  };

  const rearmCmdEvent = () => {
    let next = Infinity;
    if (ncmdctrl) next = cmdClock;
    if (asyncCode && asyncClock < next) next = asyncClock;
    if (next === Infinity) unsetEvent(eventCmd);
    else setEvent(eventCmd, Math.max(0, next - psx.clock));
  };

  const scheduleAsync = (cycles, code) => {
    asyncCode = code;
    asyncClock = psx.clock + cycles;
    rearmCmdEvent();
  };

  const completeCmd = (self) => {
    unsetEvent(self);
    if (irq & 0x1f) {
      setEvent(self, 64);
      return;
    }
    const readCycles = PSX_SPEED / ((mode & 0x80) ? 150 : 75);
    const loc = currLoc - 150;

    const isCommand = ncmdctrl !== 0 && psx.clock >= cmdClock;
    if (!isCommand && !(asyncCode !== 0 && psx.clock >= asyncClock)) {
      rearmCmdEvent();
      return;
    }
    let currentCommand;
    if (isCommand) {
      currentCommand = ncmdctrl;
      ncmdctrl = 0;
    }
    else {
      currentCommand = asyncCode;
      asyncCode = 0;
    }
    // Each new response replaces any unread bytes of the previous one.
    results.length = 0;
    cdLog('complete command', `0x${currentCommand.toString(16).padStart(2, '0')}`, {
      status,
      statusCode,
      irq,
      loc: currLoc,
      results: results.length
    });
    switch (currentCommand) {
      case 0x00: break;
      case 0x01:
        if (!sectorData8.length) {
          enqueueEvent(5, 0x01);
        }
        else {
          enqueueEvent(3, statusCode | 0x02);
        }
        break;

      case 0x02:
        if (!((params[0] === 0) && (params[1] === 0) && (params[2] === 0))) {
          seekLoc = (btoi(params[0]) * (60 * 75)) +
            (btoi(params[1]) * (75)) +
            (btoi(params[2]));
        }
        else {
          seekLoc = currLoc;
        }
        setlocPending = true;
        enqueueEvent(3, 0x02);
        break;

      case 0x03:
        if ((params.length === 0 || params[0] === 0) && setlocPending) {
          currLoc = seekLoc;
        }
        setlocPending = false;
        if (params.length === 1) {
          currTrack = tracks[btoi(params[0])];
          currLoc = seekLoc = currTrack.begin + 150;
        }
        setReadEvent(readCycles >>> 0);
        ncmdread = 0x03;
        enqueueEvent(3, 0x82);
        break;

      case 0x06:
        setReadEvent(readCycles >>> 0);
        ncmdread = 0x06;
        enqueueEvent(3, 0x42);
        if (setlocPending) currLoc = seekLoc;
        setlocPending = false;
        break;

      case 0x07:
        enqueueEvent(3, 0x00);
        scheduleAsync(0x1000, 0x70);
        status |= 0x80;
        break

      case 0x70:
        enqueueEvent(2, 0x02);
        break;

      case 0x08:
        enqueueEvent(3, 0x02);
        scheduleAsync(((mode & 0x80) ? 0x18a6076 : 0xd38aca) >>> 0, 0x80);
        status |= 0x80;
        break;
      case 0x80:
        enqueueEvent(2, 0x00);
        break;

      case 0x09:
        pushResults(statusCode | 0x20);
        scheduleAsync(((mode & 0x80) ? 0x10bd93 : 0x21181c) >>> 0, 0x90);
        status |= 0xA0;
        setIrq(3);
        break;
      case 0x90:
        statusCode = (statusCode & ~0x20) | 0x02;
        pushResults(statusCode);
        status = (status & ~0x80) | 0x20;
        setIrq(2);
        break;
      case 0x99:
        statusCode = (statusCode & ~0xA0) | 0x02;
        pushResults(statusCode);
        status = (status & ~0x80) | 0x20;
        setIrq(4);
        break;

      case 0x0A:
        enqueueEvent(3, 0x02);
        scheduleAsync(0x1000, 0xA0);
        status |= 0x80;
        break;
      case 0xA0:
        enqueueEvent(2, 0x02);
        break;

      case 0x0B:
        enqueueEvent(3, 0x02);
        mute = true;
        break;

      case 0x0C:
        enqueueEvent(3, 0x02);
        mute = false;
        break;

      case 0x0D:
        filterFile = params[0];
        filterChan = params[1];
        enqueueEvent(3, 0x02);
        break;

      case 0x0E:
        enqueueEvent(3, 0x02);
        mode = params[0];
        break;

      case 0x0F:
        enqueueEvent(3, 0x02, mode, 0, filterFile, filterChan);
        break;

      case 0x10: {
        const offset = sectorOffset + 12;
        pushResults(
          sectorData8[offset + 0],
          sectorData8[offset + 1],
          sectorData8[offset + 2],
          sectorData8[offset + 3],
          sectorData8[offset + 4],
          sectorData8[offset + 5],
          sectorData8[offset + 6],
          sectorData8[offset + 7],
        );
        status = (status & ~0x80) | 0x20;
        setIrq(3);
      } break;

      case 0x11: {
        // Pregap (index 0) counts down to the track's index 1 start.
        const relativeLoc = currLoc - 150 - currTrack.begin;
        const loc = Math.abs(relativeLoc);
        let mm = (loc / (60 * 75)) >> 0;
        let ss = ((loc / (75)) >> 0) % 60;
        let st = loc % 75;
        pushResults(itob(currTrack.id), relativeLoc < 0 ? 0x00 : 0x01, itob(mm), itob(ss), itob(st));
        // Absolute MSF includes the disc's 150-sector lead-in.
        pushResults(itob((currLoc / 75) / 60));
        pushResults(itob((currLoc / 75) % 60));
        pushResults(itob(currLoc % 75));
        status = (status & ~0x80) | 0x20;
        setIrq(3);
      } break;

      case 0x12:
        scheduleAsync(0x1000, 0x120);
        statusCode |= 0x02;
        pushResults(statusCode);
        status |= 0x20;
        setIrq(3);
        break;
      case 0x120:
        statusCode |= 0x02;
        let amm = (loc / (60 * 75)) >> 0;
        let ass = ((loc / (75)) >> 0) % 60;
        let ast = loc % 75;
        pushResults(0x82, itob(currTrack.id), 1, itob(amm), itob(ass), itob(ast), 0, 0);
        status = (status & ~0x80) | 0x20;
        setIrq(1);
        break;

      case 0x13:
        statusCode |= 0x02;
        pushResults(statusCode, 0x01, itob(tracks.length - 1));
        status = (status & ~0x80) | 0x20;
        setIrq(3);
        break;

      case 0x14: {
        let mmss = 0;
        let track = tracks[btoi(params[0])];
        if (!track) {
          statusCode |= 0x10;
          pushResults(0x11, 0x80);
          status = (status & ~0x80) | 0x20;
          setIrq(5);
          break;
        }
        if (params[0] === 0) {
          mmss = floor((track.end + 150) / 75);
        }
        else {
          mmss = floor((track.begin + 150) / 75);
        }
        statusCode |= 0x02;
        pushResults(statusCode, itob(floor(mmss / 60)), itob(floor(mmss % 60)));
        status = (status & ~0x80) | 0x20;
        setIrq(3);
      } break;

      case 0x15:
        setlocPending = false;
        scheduleAsync(seekCycles(seekLoc, currLoc), 0x150);
        enqueueEvent(3, 0x42);
        status |= 0x80;
        break;
      case 0x150:
        enqueueEvent(2, 0x2);
        currLoc = seekLoc;
        selectTrack(currLoc);
        break;

      case 0x16:
        setlocPending = false;
        scheduleAsync(seekCycles(seekLoc, currLoc), 0x160);
        enqueueEvent(3, 0x42);
        status |= 0x80;
        break;
      case 0x160:
        enqueueEvent(2, 0x2);
        currLoc = seekLoc;
        selectTrack(currLoc);
        break;

      case 0x19:
        // Test 04h starts SCEx reading and returns status, not the controller
        // version. Dragoon retries drive initialization if it sees 99h here.
        // Test 05h stops SCEx reading and returns total/success counters.
        if (testSubcommand === 0x04) {
          statusCode |= 0x02; // Test 04h forces the spindle motor on.
          pushResults(statusCode);
        }
        else if (testSubcommand === 0x05) {
          // SCEx exists only in the lead-in. Dragoon deliberately seeks into
          // the data track to verify that the counters remain zero there.
          const licensed = currLoc < 150 && sectorData8.length && tracks.some(track => track.data) ? 1 : 0;
          pushResults(licensed, licensed);
        }
        else {
          pushResults(0x99, 0x02, 0x01, 0xc3);
        }
        status = (status & ~0x80) | 0x20;
        setIrq(3);
        break;

      case 0x1A:
        scheduleAsync(0x4a00, 0x1A0);
        pushResults(statusCode);
        status |= 0x20;
        setIrq(3);
        break;
      case 0x1A0:
        if (sectorData8.length) {
          // Keep the historical eNGE branding in the CD-ROM response. Crash
          // Bash was tested with this marker and still passes its startup
          // checks, so compatibility does not require replacing it with SCEA.
          pushResults(0x02, 0x00, 0x20, 0x00, 0x65, 0x4e, 0x47, 0x45); // eNGE
          cdLog('GetID response', '02 00 20 00 65 4e 47 45 (eNGE)');
          status = (status & ~0x80) | 0x20;
          setIrq(2);
        }
        else {
          statusCode |= 0x10;
          pushResults(0x11, 0x80);
          status = (status & ~0x80) | 0x20;
          setIrq(5);
        }
        break;

      case 0x1B:
        setReadEvent(readCycles >>> 0);
        ncmdread = 0x1B;
        enqueueEvent(3, 0x42);
        if (setlocPending) currLoc = seekLoc;
        setlocPending = false;
        break;

      case 0x1E:
        scheduleAsync(0x1000, 0x1E0);
        enqueueEvent(3, 0x02);
        break;
      case 0x1E0:
        enqueueEvent(2, 0x02);
        break;

      case INVALID_COMMAND:
        enqueueEvent(5, 0x03, 0x40);
        break;

      default: abort(hex(currentCommand, 2));
    }
    if (isCommand) resetparams();
    rearmCmdEvent();
  };

  // Returns true when the read event must not continue this tick.
  const handleReadFailure = (self, result) => {
    if (result === READ_PENDING) {
      unsetEvent(self);
      return true;
    }
    if (result === READ_MISSING) {
      stopReading();
      scheduleAsync(0x200, 0x99);
      return true;
    }
    return false;
  };

  const completeRead = (self) => {
    if (irq & 0x1f) {
      psx.updateEvent(self, 64);
      return;
    }

    let readCycles = 33868800 / ((mode & 0x80) ? 150 : 75);
    let loc = currLoc - 150;
    switch (ncmdread) {
      case 0x00:
        unsetEvent(eventRead);
        break;
      case 0x03: {
        playIndex = 0;
        if ((mode & 0x02) && loc >= currTrack.end) {
          stopReading();
          scheduleAsync(0x200, 0x99);
          return;
        }
        if (handleReadFailure(self, readSector(currLoc))) return;
        statusCode = (statusCode & ~0x60) | 0x82;
        if (mode & 0x04) {
          switch (loc % 75) {
            case 0:
            case 20:
            case 40:
            case 60: {
              let amm = (loc / (60 * 75)) >> 0;
              let ass = ((loc / (75)) >> 0) % 60;
              let ast = loc % 75;
              results.length = 0;
              pushResults(0x82, itob(currTrack.id), 1, itob(amm), itob(ass), itob(ast), 0, 0);
              status = (status & ~0x80) | 0x60;
              setIrq(1);
            } break;

            case 10:
            case 30:
            case 50:
            case 70: {
              let loc = (currLoc - 150 - currTrack.begin);
              let amm = (loc / (60 * 75)) >> 0;
              let ass = ((loc / (75)) >> 0) % 60;
              let ast = loc % 75;
              results.length = 0;
              pushResults(0x82, itob(currTrack.id), 1, itob(amm), 0x80 | itob(ass), itob(ast), 0, 0);
              status = (status & ~0x80) | 0x60;
              setIrq(1);
            } break;
          }
        }
        psx.updateEvent(self, readCycles);
        currLoc++;
      } break;
      case 0x06:
      case 0x1b: {
        const result = readSector(currLoc);
        if (handleReadFailure(self, result)) return;
        // XA audio still counts as reading, even when no data IRQ reaches the CPU.
        statusCode = (statusCode & ~0xc0) | 0x22;
        if (result === READ_DATA) {
          results.length = 0;
          pushResults(0x22);
          status = (status & ~0x80) | 0x60;
          setIrq(1);
        }
        psx.updateEvent(self, readCycles);
        currLoc++;
      } break;

      default:
        abort(hex(ncmdread, 2));
    }
  };

  const eventCmd = addEvent(0, completeCmd);

  const eventRead = addEvent(0, completeRead);
  const setReadEvent = e => setEvent(eventRead, e);

  const command = (data) => {
    let nevtctrl = 0x0200;

    results.length = 0;
    status |= 0x80;
    ncmdctrl = data;
    cdLog('command', `0x${data.toString(16).padStart(2, '0')}`, {
      params: [...params],
      status,
      statusCode,
      currLoc,
      seekLoc,
      hasDisc: sectorData8.length > 0,
      tracks: tracks.length
    });
    if (data === 0x19) testSubcommand = params[0] || 0;
    switch (data) {
      case 0x01:  //- CdlNop
        nevtctrl = 0xc4e1;
        break;
      case 0x02:  //- CdlSetloc
      case 0x03:  //- CdlPlay
      case 0x0b:  //- CdlMute
      case 0x0c:  //- CdlDemute
      case 0x0d:  //- CdlSetFilter
      case 0x0e:  //- CdlSetmode
      case 0x0f:  //- CdlGetparam
      case 0x10:  //- CdlGetLocL
      case 0x11:  //- CdlGetLocP
      case 0x12:  //- CdlSetSession
      case 0x13:  //- CdlGetTN
      case 0x14:  //- CdlGetTD
      case 0x19:  //- CdlTest
      case 0x1a:  //- CdlID
      case 0x1e:  //- CdlReadTOC
        break;
      case 0x0a:  //- CdlInit
        nevtctrl = 0x13cce;
      case 0x06:  //- CdlReadN
      case 0x07:  //- CdlStandby
      case 0x08:  //- CdlStop
      case 0x15:  //- CdlSeekL
      case 0x16:  //- CdlSeekP
      case 0x1B:  //- CdlReadS
      case 0x09:  //- CdlPause
        stopReading();
        asyncCode = 0;
        break;

      default:
        ncmdctrl = INVALID_COMMAND;
        break;
    }

    cmdClock = psx.clock + (nevtctrl >>> 0);
    rearmCmdEvent();
  };

  const selectTrack = (readLoc) => {
    const lba = readLoc - 150;
    currTrack = tracks[tracks.length - 1] || {};
    for (let i = 1; i < tracks.length; ++i) {
      if (lba < tracks[i].end) {
        currTrack = tracks[i];
        break;
      }
    }
  };

  const readSector = (readLoc) => {
    const lba = readLoc - 150;
    selectTrack(readLoc);
    if (remoteImage) {
      const location = locateSector(remoteImage.fileSectors, lba);
      if (!location) return READ_MISSING;
      const [fileIndex, fileSector] = location;
      const file = remoteImage.files[fileIndex];
      const byteOffset = fileSector * remoteSectorSize;
      const chunkIndex = Math.floor(byteOffset / remoteChunkSize);
      const chunkOffset = byteOffset - chunkIndex * remoteChunkSize;
      const chunk = file.chunks.get(chunkIndex);

      if (!chunk || chunkOffset + remoteSectorSize > chunk.length) {
        // A settled request whose chunk is gone was evicted; fetch it again.
        if (!remoteRead || remoteRead.file !== file || remoteRead.chunkIndex !== chunkIndex || remoteRead.done) {
          cdLog('sector cache miss; requesting range', { readLoc, file: fileIndex, chunk: chunkIndex });
          const read = { file, chunkIndex, done: false };
          fetchRemoteChunk(file, fileIndex, chunkIndex).then(() => {
            read.done = true;
            if (remoteRead === read && ncmdread) setEvent(eventRead, 0);
          }, error => abort(error.message));
          remoteRead = read;
        }
        return READ_PENDING;
      }
      touchRemoteChunk(file, chunkIndex);

      // Read ahead while the current range is still being consumed. This is
      // especially important for CDDA tracks, where a cache miss is audible.
      if (chunkOffset + (remoteSectorSize * 32) >= chunk.length &&
        (chunkIndex + 1) * remoteChunkSize < file.size) {
        fetchRemoteChunk(file, fileIndex, chunkIndex + 1).catch(error => {
          console.warn('CD read-ahead failed:', error.message);
        });
      }

      remoteSector.set(chunk.subarray(chunkOffset, chunkOffset + remoteSectorSize));
      sectorData8 = new Int8Array(remoteSector.buffer);
      sectorData16 = new Int16Array(remoteSector.buffer);
      sectorOffset = 0;
    } else if (localImage) {
      const location = locateSector(localImage.fileSectors, lba);
      if (!location) return READ_MISSING;
      const [fileIndex, fileSector] = location;
      const file = localImage.files[fileIndex];
      const byteOffset = fileSector * remoteSectorSize;
      remoteSector.set(file.subarray(byteOffset, byteOffset + remoteSectorSize));
      sectorData8 = new Int8Array(remoteSector.buffer);
      sectorData16 = new Int16Array(remoteSector.buffer);
      sectorOffset = 0;
    } else {
      const byteOffset = lba * 2352;
      if (byteOffset < 0 || byteOffset + 2352 > sectorData8.length) return READ_MISSING;
      sectorOffset = byteOffset;
    }

    if (cdDebug && (readLoc < 20 || readLoc % 75 === 0)) {
      cdLog('sector ready', { readLoc, track: currTrack.id, data: !!currTrack.data, audio: !!currTrack.audio });
    }

    if (cdDebug && debugSectorLogCount < 64) {
      const header = Array.from(sectorData8.slice(sectorOffset + 0x0f, sectorOffset + 0x15), byte =>
        String.fromCharCode(byte & 0xff)).join('');
      cdLog('sector ready', {
        lba: readLoc - 150,
        readLoc,
        track: currTrack.id,
        mode: mode & 0x30,
        header,
        bytes: Array.from(sectorData8.slice(sectorOffset, sectorOffset + 16), byte =>
          (byte & 0xff).toString(16).padStart(2, '0')).join(' ')
      });
      debugSectorLogCount++;

      if (lba === 22 && (mode & 0x30) === 0) {
        const entries = [];
        for (let offset = 24; offset < 24 + 2048;) {
          const length = sectorData8[sectorOffset + offset] & 0xff;
          if (!length) break;
          const nameLength = sectorData8[sectorOffset + offset + 32] & 0xff;
          const name = Array.from(sectorData8.slice(
            sectorOffset + offset + 33,
            sectorOffset + offset + 33 + nameLength
          ), byte => String.fromCharCode(byte & 0xff)).join('');
          entries.push(name);
          offset += length;
        }
        cdLog('root directory entries', entries);
      }
    }

    let sectorSize = 0;
    switch (mode & 0x30) {
      case 0x00: sectorIndex = 24;
        sectorSize = 2048;
        break;
      case 0x10: sectorIndex = 24;
        sectorSize = 2328;
        break;
      case 0x20:
      case 0x30: sectorIndex = 12;
        sectorSize = 2340;
        break;
    }
    sectorEnd = sectorIndex + sectorSize;

    // Real-time audio sectors go to the ADPCM decoder and are never delivered to the CPU.
    if (mode & 0x40) {
      let sectorMode = sectorData8[sectorOffset + 0x0f];
      if (sectorMode !== 2) return READ_DATA;

      let sub = sectorData8[sectorOffset + 0x12];
      if ((sub & 0x44) !== 0x44) return READ_DATA;

      if (mode & 0x08) {
        let file = sectorData8[sectorOffset + 0x10];
        if (file !== filterFile) return READ_AUDIO;

        let chan = sectorData8[sectorOffset + 0x11];
        if (chan !== filterChan) return READ_AUDIO;
      }

      let nfo = sectorData8[sectorOffset + 0x13];

      let ms, sr;
      switch ((nfo >>> 0) & 3) {
        case 0: ms = decodeMono; break;
        case 1: ms = decodeStereo; break;
      }
      switch ((nfo >>> 2) & 1) {
        case 0: sr = 37800; break;
        case 1: sr = 18900; break;
      }
      // todo: implement next two
      // switch ((nfo >>> 4) & 3) {
      //   case 0: bs = '4bit'; break;
      //   case 1: bs = '8bit'; break;
      // }
      // switch ((nfo >>> 6) & 1) {
      //   case 0: em = 'normal'; break;
      //   case 1: em = 'emphasis'; break;
      // }
      pcmidx = 0;
      xa.fill(0);
      pcm.fill(0);

      let ix = ms?.call() || 0;

      let samples = (44100 * ix) / sr;
      let i = 0;
      let upscaleFreq = 0;
      ix = -1;

      for (let s = 0; s < samples; s += 2) {
        pcm[++ix] = xa[i + 0];
        pcm[++ix] = xa[i + 1];
        upscaleFreq += sr;
        if (upscaleFreq >= 44100) {
          upscaleFreq -= 44100;
          i += 2;
        }
      }
      pcmmax = ix;
      return READ_AUDIO;
    }
    return READ_DATA;
  };

  const decodeMono = () => {
    let ix = 0;
    for (let sg = 0; sg < 18; ++sg) {
      const decodeOffset = sectorOffset + 24 + (sg * 128);

      for (let su = 0; su < 8; ++su) {
        const shiftFilter = sectorData8[decodeOffset + 4 + su];
        const shift = (shiftFilter & 0x0f) >>> 0;
        const filter = (shiftFilter & 0xf0) >>> 3;
        const k0 = xa2flt[filter + 0];
        const k1 = xa2flt[filter + 1];

        for (let sd = 0; sd < 28; ++sd) {
          const offset = (decodeOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
          const data = sectorData8[offset] & 0xff;
          const index = (shift * 256 + data) * 2;

          let s = (sl[1] * k0) + (sl[0] * k1) + xa2pcm[index + (su & 1)];
          sl[0] = sl[1];
          sl[1] = s;

          xa[ix + sd * 2 + 0] = s;
          xa[ix + sd * 2 + 1] = s;
        }
        ix += 2 * 28;
      }
    }
    return ix;
  }

  const decodeStereo = () => {
    let ix = 0;

    for (let sg = 0; sg < 18; ++sg) {
      const decodeOffset = sectorOffset + 24 + (sg * 128);

      for (let su = 0; su < 8; su += 2) {
        {
          const shiftFilter = sectorData8[decodeOffset + 4 + su];
          const shift = (shiftFilter & 0x0f) >>> 0;
          const filter = (shiftFilter & 0xf0) >>> 3;
          const k0 = xa2flt[filter + 0];
          const k1 = xa2flt[filter + 1];

          for (let sd = 0; sd < 28; ++sd) {
            const offset = (decodeOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
            const data = sectorData8[offset] & 0xff;
            const index = (shift * 256 + data) * 2;

            let s = (sl[1] * k0) + (sl[0] * k1) + xa2pcm[index + 0];
            sl[0] = sl[1];
            sl[1] = s;

            xa[ix + sd * 2 + 0] = s;
          }
        }
        {
          const shiftFilter = sectorData8[decodeOffset + 5 + su];
          const shift = (shiftFilter & 0x0f) >>> 0;
          const filter = (shiftFilter & 0xf0) >>> 3;
          const k0 = xa2flt[filter + 0];
          const k1 = xa2flt[filter + 1];

          for (let sd = 0; sd < 28; ++sd) {
            const offset = (decodeOffset + 16 + (sd * 4) + (su / 2)) >>> 0;
            const data = sectorData8[offset] & 0xff;
            const index = (shift * 256 + data) * 2;

            let s = (sr[1] * k0) + (sr[0] * k1) + xa2pcm[index + 1];
            sr[0] = sr[1];
            sr[1] = s;

            xa[ix + sd * 2 + 1] = s;
          }
        }
        ix += 2 * 28;
      }
    }
    return ix;
  };

  const stopReading = () => {
    unsetEvent(eventRead);
    statusCode &= ~0x80;
    statusCode &= ~0x20;
    ncmdread = 0;
  };

  const resetForNewImage = () => {
    stopReading();
    status = 0x18;
    statusCode = 0x00;
    ncmdread = 0;
    ncmdctrl = 0;
    asyncCode = 0;
    unsetEvent(eventCmd);
    remoteRead = undefined;
    sectorOffset = 0;
    sectorIndex = 0;
    sectorEnd = 0;
    playIndex = 0;
    currLoc = 0;
    seekLoc = 0;
    setlocPending = false;
    irq = 0;
    results.length = 0;
    params.length = 0;
    currTrack = {};
    cpu.istat &= ~0x0004;
  };

  return {
    cdr: {
      rd08r1800: () => {
        if (cdDebug && debugResponseLogCount < 128) {
          cdLog('status register read', { status, irq, results: results.length });
          debugResponseLogCount++;
        }
        return status;
      },

      rd08r1801: () => {
        if (status & 0x20) {
          if (results.length === 1) {
            status &= ~(0x20); // clear
          }
          const result = results.shift();
          if (cdDebug && debugResponseLogCount < 128) {
            cdLog('result register read', {
              result,
              status,
              irq,
              remaining: results.length
            });
            debugResponseLogCount++;
          }
          return result;
        }
        if (cdDebug && debugResponseLogCount < 128) {
          cdLog('result register read while not ready', { status, irq, remaining: results.length });
          debugResponseLogCount++;
        }
        return 0;
      },

      rd08r1802: () => {
        if (status & 0x40) {
          const index = sectorIndex < sectorEnd ? sectorIndex++ :
            sectorEnd - ((sectorEnd === 2072) ? 8 : 4);
          return sectorData8[sectorOffset + index];
        }
        return 0x00;
      },

      rd08r1803: () => {
        switch (status & 3) {
          case 0: return 0xE0 | irqEnable;
          case 1:
            if (cdDebug && (irq & 0x1f || debugResponseLogCount < 128)) {
              cdLog('interrupt register read', { irq, status, results: results.length });
              if (!irq) debugResponseLogCount++;
            }
            return irq;
        };
      },

      wr08r1800: (data) => {
        status = (status & ~3) | (data & 3);
      },

      wr08r1801: (data) => {
        switch (status & 3) {
          case 0: command(data);
            break;
          case 3: volConfigCdRight2SpuRight = getCdVolume(data);
            break;
        };
      },

      wr08r1802: (data) => {
        switch (status & 3) {
          case 0:
            params.push(data);
            if (params.length === 16) status &= ~0x10;
            break;
          case 1:
            irqEnable = data;
            if (cdDebug) cdLog('interrupt register select/write', { irqEnable, irq });
            break;
          case 2:
            volConfigCdLeft2SpuLeft = getCdVolume(data);
            break;
          case 3:
            volConfigCdRight2SpuLeft = getCdVolume(data);
            break;
        };
      },

      wr08r1803: (data) => {
        switch (status & 3) {
          case 0:
            if (data === 0x80) {
              status |= 0x40;
            }
            break;
          case 1:
            if (cdDebug && (data & 0x1f)) {
              cdLog('interrupt register acknowledge write', { data, irq, irqEnable });
            }
            if (data & 0x1F) {
              acknowledgeInterrupt(data);
            }
            if (data & 0x40) {
              resetparams();
            }
            break;
          case 2:
            volConfigCdLeft2SpuRight = getCdVolume(data);
            break;
          case 3:
            if (data & 0x20) {
              volCdLeft2SpuLeft = volConfigCdLeft2SpuLeft;
              volCdLeft2SpuRight = volConfigCdLeft2SpuRight;
              volCdRight2SpuLeft = volConfigCdRight2SpuLeft;
              volCdRight2SpuRight = volConfigCdRight2SpuRight;
            }
            break;
        };
      },

      nextpcm: (buf) => {
        if (ncmdread === 0x03) {
          if (currTrack.audio) {
            // The next sector is late; hold the last frame instead of reading past the buffer.
            if (playIndex > remoteSectorSize - 4) playIndex = remoteSectorSize - 4;
            let offset = (sectorOffset + playIndex) >> 1;
            let sampleL = sectorData16[offset + 0] / 32768.0;
            let sampleR = sectorData16[offset + 1] / 32768.0;
            let sL = sampleL * volCdLeft2SpuLeft + sampleR * volCdRight2SpuLeft;
            let sR = sampleR * volCdRight2SpuRight + sampleL * volCdLeft2SpuRight;
            buf[0] = sL;
            buf[1] = sR;
          }
          if (currTrack.data) {
            buf[0] = 0.0;
            buf[1] = 0.0;
          }
          playIndex += 4;
          return;
        }
        if ((mode & 0x40) && pcmmax >= 1) {
          // if due to timing issues we read beyond the buffer, repeat last samples to reduce clicks.
          if (pcmidx >= (pcmmax - 1)) pcmidx = pcmmax - 1;
          let sampleL = pcm[pcmidx + 0];
          let sampleR = pcm[pcmidx + 1];
          let sL = sampleL * volCdLeft2SpuLeft + sampleR * volCdRight2SpuLeft;
          let sR = sampleR * volCdRight2SpuRight + sampleL * volCdLeft2SpuRight;
          buf[0] = sL;
          buf[1] = sR;
          pcmidx += 2;
        }
      },

      dmaTransferMode0000: (addr, blck) => {
        if (!(addr & 0x007fffff)) return 0x10;

        // DMA block counts are 32-bit words. Convert to bytes only for the
        // sector copy; return words so the DMA controller advances correctly.
        // A zero manual DMA word count encodes 65,536 words.
        const transferWords = (blck & 0xFFFF) || 0x10000;
        const transferBytes = transferWords << 2;

        if (cdDebug && debugDmaLogCount < 32) {
          cdLog('DMA sector transfer', {
            addr: `0x${(addr >>> 0).toString(16).padStart(8, '0')}`,
            bytes: transferBytes,
            sectorIndex,
            sectorEnd
          });
          debugDmaLogCount++;
        }

        clearCodeCache(addr, transferBytes);
        const ramStart = addr & 0x001fffff;
        if (ramStart + transferBytes > 0x200000) {
          clearCodeCache(0, ramStart + transferBytes - 0x200000);
        }

        for (let i = 0; i < transferBytes; i += 2) {
          let word;
          if (sectorIndex < sectorEnd) {
            word = sectorData16[(sectorOffset + sectorIndex) >> 1];
            sectorIndex += 2;
          }
          else {
            // Once the FIFO is exhausted it repeats a padding byte, not ECC
            // bytes, the next sector, or undefined data from the sector buffer.
            const index = sectorEnd - ((sectorEnd === 2072) ? 8 : 4);
            const padding = sectorData8[sectorOffset + index] & 0xff;
            word = padding | (padding << 8);
          }
          map16[(addr & 0x001fffff) >> 1] = word;
          addr += 2;
        }
        if (cdDebug && debugDmaLogCount <= 32) {
          const ramStart = (addr - transferBytes) & 0x001fffff;
          cdLog('DMA payload check', {
            bytes: Array.from(map8.slice(ramStart, ramStart + 16), byte =>
              (byte & 0xff).toString(16).padStart(2, '0')).join(' '),
            text: String.fromCharCode(...Array.from(map8.slice(ramStart, ramStart + 8), byte => byte & 0xff))
          });

          // DMA starts at the sector payload (sector offset 24), so the
          // directory begins at RAM offset zero rather than RAM + 24.
          if (sectorEnd === 2072 && (map8[ramStart] & 0xff) === 0x30) {
            const entries = [];
            for (let offset = 0; offset < 2048;) {
              const length = map8[ramStart + offset] & 0xff;
              if (!length) break;
              const nameLength = map8[ramStart + offset + 32] & 0xff;
              const name = Array.from(map8.slice(
                ramStart + offset + 33,
                ramStart + offset + 33 + nameLength
              ), byte => String.fromCharCode(byte & 0xff)).join('');
              entries.push(name);
              offset += length;
            }
            cdLog('DMA RAM directory entries', entries);
          }
        }
        if (sectorIndex >= sectorEnd) {
          status &= ~0x40;
        }

        return transferWords;
      },

      setTOC: (new_tracks) => {
        tracks.splice(0, tracks.length, ...new_tracks);
      },

      getState: () => ({
        status,
        statusCode,
        ncmdread,
        ncmdctrl,
        cmdClock,
        asyncCode,
        asyncClock,
        sectorOffset,
        sectorIndex,
        sectorEnd,
        playIndex,
        irq,
        irqEnable,
        mode,
        mute,
        currLoc,
        seekLoc,
        setlocPending,
        volCdLeft2SpuLeft,
        volCdLeft2SpuRight,
        volCdRight2SpuLeft,
        volCdRight2SpuRight,
        volConfigCdLeft2SpuLeft,
        volConfigCdLeft2SpuRight,
        volConfigCdRight2SpuLeft,
        volConfigCdRight2SpuRight,
        pcmidx,
        pcmmax,
        filterFile,
        filterChan,
        currTrackIndex: tracks.indexOf(currTrack),
        results: [...results],
        params: [...params],
        sectorData: sectorData8.slice(sectorOffset, sectorOffset + remoteSectorSize),
        pcm,
        xa,
        sl: [...sl],
        sr: [...sr]
      }),

      setState: state => {
        if (!state) return;
        status = state.status;
        statusCode = state.statusCode;
        ncmdread = state.ncmdread;
        ncmdctrl = state.ncmdctrl;
        cmdClock = state.cmdClock ?? 0;
        asyncCode = state.asyncCode ?? 0;
        asyncClock = state.asyncClock ?? 0;
        sectorOffset = state.sectorOffset;
        sectorIndex = state.sectorIndex;
        sectorEnd = state.sectorEnd;
        playIndex = state.playIndex;
        irq = state.irq;
        irqEnable = state.irqEnable;
        mode = state.mode;
        mute = state.mute;
        currLoc = state.currLoc;
        seekLoc = state.seekLoc;
        setlocPending = state.setlocPending ?? false;
        volCdLeft2SpuLeft = state.volCdLeft2SpuLeft;
        volCdLeft2SpuRight = state.volCdLeft2SpuRight;
        volCdRight2SpuLeft = state.volCdRight2SpuLeft;
        volCdRight2SpuRight = state.volCdRight2SpuRight;
        volConfigCdLeft2SpuLeft = state.volConfigCdLeft2SpuLeft;
        volConfigCdLeft2SpuRight = state.volConfigCdLeft2SpuRight;
        volConfigCdRight2SpuLeft = state.volConfigCdRight2SpuLeft;
        volConfigCdRight2SpuRight = state.volConfigCdRight2SpuRight;
        pcmidx = state.pcmidx;
        pcmmax = state.pcmmax;
        filterFile = state.filterFile;
        filterChan = state.filterChan;
        currTrack = tracks[state.currTrackIndex] || {};

        results.length = 0;
        results.push(...state.results);
        params.length = 0;
        params.push(...state.params);
        // Whole-image discs live in sectorData8; only the per-sector paths use remoteSector.
        if (state.sectorData && (remoteImage || localImage)) {
          remoteSector.set(state.sectorData);
          sectorData8 = new Int8Array(remoteSector.buffer);
          sectorData16 = new Int16Array(remoteSector.buffer);
        }
        pcm.set(state.pcm);
        xa.set(state.xa);
        sl[0] = state.sl[0];
        sl[1] = state.sl[1];
        sr[0] = state.sr[0];
        sr[1] = state.sr[1];
        remoteRead = undefined;
      },

      setCdImage: (data) => {
        resetForNewImage();
        remoteImage = undefined;
        localImage = undefined;
        sectorData16 = new Int16Array(data.buffer);
        sectorData8 = new Int8Array(data.buffer);
      },

      setCdImages: (dataBuffers) => {
        resetForNewImage();
        remoteImage = undefined;
        const files = dataBuffers.map(buffer => new Uint8Array(buffer));
        if (!files.length || files.some(file => !file.byteLength || file.byteLength % remoteSectorSize !== 0)) {
          throw new Error('Local CD images must be raw 2352-byte-sector BIN files');
        }
        localImage = {
          files,
          fileSectors: files.map(file => file.byteLength / remoteSectorSize),
          sectors: files.reduce((sectors, file) => sectors + file.byteLength / remoteSectorSize, 0)
        };
        sectorData8 = new Int8Array(remoteSector.buffer);
        sectorData16 = new Int16Array(remoteSector.buffer);
        return { size: files.reduce((size, file) => size + file.byteLength, 0), sectors: localImage.sectors, files };
      },

      setCdImageURL: async (url) => {
        return cdr.setCdImageURLs([url]);
      },

      setCdImageURLs: async (urls) => {
        // Discover the size with a one-byte range request. A full download is
        // deliberately rejected because it defeats the bounded-memory path.
        const files = await Promise.all(urls.map(async url => {
          const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
          if (response.status !== 206) {
            throw new Error(`CD image server returned HTTP ${response.status}; byte ranges are required`);
          }
          const contentRange = response.headers.get('Content-Range');
          const match = contentRange?.match(/bytes\s+\d+-\d+\/(\d+)/i);
          const size = match ? Number(match[1]) : 0;
          if (!size || size % remoteSectorSize !== 0) {
            throw new Error('CD image size is unavailable or is not a raw 2352-byte-sector image');
          }
          return { url, size, chunks: new Map(), pending: new Map() };
        }));
        remoteImage = {
          files,
          fileSectors: files.map(file => file.size / remoteSectorSize),
          lru: []
        };
        resetForNewImage();
        // The BIOS checks sectorData8.length to detect whether a disc is
        // present before issuing its first read. Keep the fixed sector views
        // visible even though the first sector has not been fetched yet.
        sectorData8 = new Int8Array(remoteSector.buffer);
        sectorData16 = new Int16Array(remoteSector.buffer);
        return {
          size: files.reduce((size, file) => size + file.size, 0),
          sectors: files.reduce((sectors, file) => sectors + file.size / remoteSectorSize, 0),
          files
        };
      },

      get mode() {
        return mode;
      }
    }
  }
})
