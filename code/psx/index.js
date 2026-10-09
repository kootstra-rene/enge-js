mdlr('enge:psx:index', m => {

  let running = false;
  let canvas = undefined;
  const cpuDebug = new URLSearchParams(window.location.search).has('debug-cd') ||
    new URLSearchParams(window.location.search).has('debug-game');
  let lastCpuDebugTime = 0;

  const PSX_SPEED = 44100 * 768; // 33868800 cyles

  const abort = (...args) => {
    const message = [...args].join(' ');
    canvas.style.borderColor = 'red';
    running = false;
    spu.silence();
    console.error(message);
    alert(`eNGE stopped: ${message}`);
    throw new Error(message);
  }

  let endAnimationFrame = false;
  let hasFocus = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
      hasFocus = true;
    } else {
      hasFocus = false;
      spu.silence();
    }
  });

  const context = {
    timeStamp: 0,
    realtime: 0,
    emutime: 0,
    counter: 0
  };

  // function isTouchEnabled() {
  //   return ('ontouchstart' in window) ||
  //     (navigator.maxTouchPoints > 0) ||
  //     (navigator.msMaxTouchPoints > 0);
  // }

  const frameEvent = psx.addEvent(0, (self) => {
    endAnimationFrame = true;
    psx.unsetEvent(self);
  });

  const mainLoop = (stamp) => {
    const delta = stamp - context.timeStamp;
    context.timeStamp = stamp;
    if (!running || !hasFocus || delta > 250) return;

    context.realtime += delta;

    const diffTime = context.realtime - context.emutime;
    const totalCycles = diffTime * (PSX_SPEED / 1000);

    endAnimationFrame = false;
    psx.setEvent(frameEvent, +totalCycles);

    let entry = getCacheEntry(cpu.pc);
    if (!entry) return abort();

    handleGamePads();

    const $ = psx;
    while (!endAnimationFrame) {
      entry = entry.code($);

      if ($.clock >= $.eventClock) {
        entry = $.handleEvents(entry);
      }
    }
    cpu.pc = entry.pc;

    if (cpuDebug && stamp - lastCpuDebugTime >= 1000) {
      lastCpuDebugTime = stamp;
      console.debug('[CPU]', JSON.stringify({
        pc: `0x${(cpu.pc >>> 0).toString(16).padStart(8, '0')}`,
        ra: `0x${(cpu.gpr[31] >>> 0).toString(16).padStart(8, '0')}`,
        a0: `0x${(cpu.gpr[4] >>> 0).toString(16).padStart(8, '0')}`,
        v0: `0x${(cpu.gpr[2] >>> 0).toString(16).padStart(8, '0')}`,
        sr: `0x${(cpu.sr >>> 0).toString(16)}`,
        cause: `0x${(cpu.cause >>> 0).toString(16).padStart(8, '0')}`,
        epc: `0x${(cpu.epc >>> 0).toString(16).padStart(8, '0')}`,
        istat: `0x${(cpu.istat >>> 0).toString(16)}`,
        imask: `0x${(cpu.imask >>> 0).toString(16)}`
      }));
    }

    context.emutime = psx.clock / (PSX_SPEED / 1000);
    ++context.counter;
  }

  const emulate = (stamp) => {
    mainLoop(stamp);
    requestAnimationFrame(emulate);
  }

  const bios = () => {
    running = false;

    let entry = getCacheEntry(0xbfc00000);
    const $ = psx;
    while (entry.pc !== 0x00030000) {
      entry = entry.code($);

      if ($.clock >= $.eventClock) {
        entry = $.handleEvents(entry);
      }
    }
    context.realtime = context.emutime = psx.clock / (PSX_SPEED / 1000);
    vector = getCacheEntry(0x80);
    cpu.pc = entry.pc;
  }

  const openFile = (file) => {
    var reader = new FileReader();

    reader.onload = (event) => {
      loadFileData(event.target.result, file.name)
    };

    reader.readAsArrayBuffer(file);
  }

  const cueTimeToSector = value => {
    const parts = value.split(':').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      throw new Error(`Invalid CUE index time: ${value}`);
    }
    return parts[0] * 60 * 75 + parts[1] * 75 + parts[2];
  };

  const parseCue = (text, cueURL) => {
    const files = [];
    let currentFile;
    let currentTrack;
    const parsedTracks = [];

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      let match = line.match(/^FILE\s+"([^"]+)"\s+(?:BINARY|MOTOROLA)$/i);
      if (match) {
        currentFile = { name: match[1], url: new URL(match[1], cueURL).href, index: files.length };
        files.push(currentFile);
        continue;
      }

      match = line.match(/^TRACK\s+(\d+)\s+(\S+)/i);
      if (match) {
        currentTrack = {
          id: Number(match[1]),
          begin: 0,
          type: match[2].toUpperCase(),
          fileIndex: currentFile?.index ?? 0,
          fileBegin: 0
        };
        parsedTracks.push(currentTrack);
        continue;
      }

      match = line.match(/^INDEX\s+01\s+(\d+:\d+:\d+)/i);
      if (match && currentTrack) {
        currentTrack.fileBegin = cueTimeToSector(match[1]);
      }
    }

    if (!files.length || !parsedTracks.length) {
      throw new Error('CUE sheet has no supported FILE/TRACK/INDEX entries');
    }

    return { files, tracks: parsedTracks };
  };

  const loadCueFromURL = async cueURL => {
    const response = await fetch(cueURL);
    if (!response.ok) throw new Error(`CUE request returned HTTP ${response.status}`);
    const cue = parseCue(await response.text(), cueURL);
    const image = await cdr.setCdImageURLs(cue.files.map(file => file.url));
    const fileBases = [];
    let base = 0;
    for (const file of image.files) {
      fileBases.push(base);
      base += file.size / 2352;
    }
    const tracks = cue.tracks.map((track, index) => {
      const begin = fileBases[track.fileIndex] + track.fileBegin;
      const next = cue.tracks[index + 1];
      const sameFile = next && next.fileIndex === track.fileIndex;
      const end = sameFile
        ? fileBases[next.fileIndex] + next.fileBegin
        : fileBases[track.fileIndex] + image.files[track.fileIndex].size / 2352;
      return {
      id: track.id,
      begin,
      end,
      fileIndex: track.fileIndex,
      fileBegin: track.fileBegin,
      ...(track.type === 'AUDIO' ? { audio: true } : { data: true })
      };
    });
    cdr.setTOC([
      { id: 0, begin: 0, end: image.sectors },
      ...tracks
    ]);
  };

  const loadCueFromFiles = async (cueFile, selectedFiles) => {
    const cue = parseCue(await cueFile.text(), 'http://local-disc.invalid/');
    const filesByName = new Map(selectedFiles.map(file => [file.name.toLowerCase(), file]));
    const dataBuffers = [];
    for (const cueFileEntry of cue.files) {
      const name = cueFileEntry.name.replace(/\\/g, '/').split('/').pop().toLowerCase();
      const selectedFile = filesByName.get(name);
      if (!selectedFile) throw new Error(`CUE references missing BIN file: ${cueFileEntry.name}`);
      dataBuffers.push(await selectedFile.arrayBuffer());
    }
    const image = cdr.setCdImages(dataBuffers);
    const fileBases = [];
    let base = 0;
    for (const file of image.files) {
      fileBases.push(base);
      base += file.byteLength / 2352;
    }
    const tracks = cue.tracks.map((track, index) => {
      const begin = fileBases[track.fileIndex] + track.fileBegin;
      const next = cue.tracks[index + 1];
      const sameFile = next && next.fileIndex === track.fileIndex;
      const end = sameFile
        ? fileBases[next.fileIndex] + next.fileBegin
        : fileBases[track.fileIndex] + image.files[track.fileIndex].byteLength / 2352;
      return {
        id: track.id,
        begin,
        end,
        fileIndex: track.fileIndex,
        fileBegin: track.fileBegin,
        ...(track.type === 'AUDIO' ? { audio: true } : { data: true })
      };
    });
    cdr.setTOC([
      { id: 0, begin: 0, end: image.sectors },
      ...tracks
    ]);
    loadedGameId = `local:${cueFile.name}:${selectedFiles.length}`;
    bootBiosIfReady();
    running = true;
    scheduleStateReady();
  };

  const loadFileFromURL = async (url) => {
    running = false;
    try {
      if (/\.cue(?:$|[?#])/i.test(url)) {
        await loadCueFromURL(url);
      }
      else {
        const image = await cdr.setCdImageURL(url);
        cdr.setTOC([
          { id: 0, begin: 0, end: image.sectors },
          { id: 1, begin: 0, end: image.sectors, data: true }
        ]);
      }
      loadedGameId = new URL(url, document.baseURI).href;
      bootBiosIfReady();
      running = true;
      scheduleStateReady();
    }
    catch (error) {
      abort('Unable to load CD image:', error.message);
    }
  }

  const loadBiosFromURL = async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`BIOS request returned HTTP ${response.status}`);
    loadFileData(await response.arrayBuffer(), new URL(url, document.baseURI).href);
  };

  const stateStorageKey = 'enge-psx-save-state-v1';
  const stateBuild = 'enge-save-state-v3-renderer-v1';
  const stateStartupDelay = 15000;
  const emulatorVariant = [...document.scripts].some(script => script.src.includes('index-webgl2'))
    ? 'webgl2'
    : 'webgl';
  let loadedBiosId = 'unloaded';
  let loadedGameId = 'unloaded';
  let biosBooted = false;

  const bootBiosIfReady = () => {
    if (biosBooted || loadedBiosId === 'unloaded' || loadedGameId === 'unloaded') return;
    bios();
    biosBooted = true;
    running = true;
  };
  let stateReady = false;
  let stateReadyTimer;
  let stateCountdownTimer;
  let stateReadyAt = 0;

  const updateStateStatus = text => {
    const status = document.getElementById('state-status');
    if (status) status.textContent = text;
  };

  const updateStateControls = () => {
    for (const id of ['save-state', 'load-state', 'download-state', 'upload-state', 'cloud-save-state', 'cloud-load-state']) {
      const button = document.getElementById(id);
      if (button) button.disabled = !stateReady;
    }
  };

  const scheduleStateReady = () => {
    stateReady = false;
    clearTimeout(stateReadyTimer);
    clearInterval(stateCountdownTimer);
    stateReadyAt = Date.now() + stateStartupDelay;
    const updateCountdown = () => {
      const seconds = Math.max(1, Math.ceil((stateReadyAt - Date.now()) / 1000));
      updateStateStatus(`State controls unlock in ${seconds} second${seconds === 1 ? '' : 's'}`);
    };
    updateCountdown();
    stateCountdownTimer = setInterval(updateCountdown, 250);
    updateStateControls();
    stateReadyTimer = setTimeout(() => {
      stateReady = true;
      clearInterval(stateCountdownTimer);
      updateStateStatus('State controls ready');
      updateStateControls();
    }, stateStartupDelay);
  };

  const bufferIdentity = arrayBuffer => {
    const bytes = new Uint8Array(arrayBuffer);
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return `${bytes.byteLength}:${hash >>> 0}`;
  };

  const currentStateCompatibility = () => ({
    build: stateBuild,
    variant: emulatorVariant,
    bios: loadedBiosId,
    game: loadedGameId
  });

  const bytesToBase64 = bytes => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  };

  const base64ToBytes = value => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const snapshotValue = (value, seen = new WeakSet()) => {
    if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'function' || value === undefined) return undefined;
    if (ArrayBuffer.isView(value)) {
      return {
        type: value.constructor.name,
        data: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      };
    }
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => snapshotValue(item, seen));

    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const snapshot = snapshotValue(item, seen);
      if (snapshot !== undefined) result[key] = snapshot;
    }
    return result;
  };

  const restoreValue = (target, snapshot) => {
    if (!target || !snapshot) return;
    if (ArrayBuffer.isView(target) && snapshot.type) {
      const bytes = base64ToBytes(snapshot.data);
      new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(bytes.subarray(0, target.byteLength));
      return;
    }
    if (Array.isArray(target) && Array.isArray(snapshot)) {
      snapshot.forEach((value, index) => restoreValue(target[index], value));
      return;
    }
    for (const [key, value] of Object.entries(snapshot)) {
      if (!(key in target) || typeof target[key] === 'function') continue;
      if (value && value.type && ArrayBuffer.isView(target[key])) {
        restoreValue(target[key], value);
      }
      else if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') {
        restoreValue(target[key], value);
      }
      else if (typeof value !== 'object') {
        target[key] = value;
      }
    }
  };

  const restoreSnapshot = snapshot => {
    if (snapshot === null || typeof snapshot !== 'object') return snapshot;
    if (snapshot.type && snapshot.data) {
      const bytes = base64ToBytes(snapshot.data);
      const Type = globalThis[snapshot.type];
      return Type ? new Type(bytes.buffer) : bytes;
    }
    if (Array.isArray(snapshot)) return snapshot.map(restoreSnapshot);
    return Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, restoreSnapshot(value)]));
  };

  const saveState = () => {
    const wasRunning = running;
    running = false;
    spu.silence();
    try {
      const gpuState = snapshotValue(gpu);
      delete gpuState.img?.buffer;
      const state = {
        version: 3,
        compatibility: currentStateCompatibility(),
        ram: bytesToBase64(new Uint8Array(map.buffer, 0, 2 * 1024 * 1024)),
        cpu: snapshotValue(cpu),
        gpu: gpuState,
        rendererVram: renderer.getVramState ? snapshotValue(renderer.getVramState()) : undefined,
        psx: snapshotValue(psx),
        scheduler: psx.getState(),
        cdr: snapshotValue(cdr.getState()),
        context: snapshotValue(context)
      };
      localStorage.setItem(stateStorageKey, JSON.stringify(state));
      return true;
    }
    finally {
      running = wasRunning;
    }
  };

  const loadState = (encoded = localStorage.getItem(stateStorageKey)) => {
    if (!stateReady) {
      throw new Error('The game is still booting; wait for the Sony and PlayStation screens to finish before loading a state');
    }
    if (loadedBiosId === 'unloaded' || loadedGameId === 'unloaded') {
      throw new Error('PlayStation is not ready yet; wait for the BIOS and game to finish loading before loading a state');
    }
    if (!encoded) return false;

    const state = JSON.parse(encoded);
    if (state.version !== 3) throw new Error('Save state was created by an incompatible emulator build');
    const expected = currentStateCompatibility();
    const actual = state.compatibility || {};
    for (const key of Object.keys(expected)) {
      if (actual[key] !== expected[key]) {
        throw new Error(`Save state mismatch: ${key} does not match the currently loaded emulator`);
      }
    }

    const wasRunning = running;
    running = false;
    spu.silence();
    try {
      new Uint8Array(map.buffer, 0, 2 * 1024 * 1024).set(base64ToBytes(state.ram));
      restoreValue(cpu, state.cpu);
      restoreValue(gpu, state.gpu);
      if (state.rendererVram && renderer.setVramState) {
        renderer.setVramState(restoreSnapshot(state.rendererVram));
      }
      restoreValue(psx, state.psx);
      cdr.setState(state.cdr && restoreSnapshot(state.cdr));
      psx.setState(state.scheduler);
      restoreValue(context, state.context);
      clearCodeCache(0, 2 * 1024 * 1024);
      context.timeStamp = performance.now();
      return true;
    }
    finally {
      running = wasRunning;
    }
  };

  const updateStateButton = (button, text) => {
    if (!button) return;
    const original = button.textContent;
    button.textContent = text;
    setTimeout(() => { button.textContent = original; }, 1200);
  };

  const downloadFile = (data, filename, type) => {
    const blob = new Blob([data], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const loadFileData = (arrayBuffer, sourceId = '') => {
    const view = new DataView(arrayBuffer);

    if (view.getUint16(0, true) === 0x5350) { // PS
      cpu.pc = view.getInt32(0x10, true);
      cpu.gpr[28] = view.getInt32(0x14, true);
      cpu.gpr[29] = view.getInt32(0x30, true) || 0x801ffff0;
      cpu.gpr[30] = view.getInt32(0x30, true) || 0x801ffff0;
      cpu.gpr[31] = cpu.pc;

      var textSegmentOffset = view.getInt32(0x18, true);
      var fileContentLength = view.getInt32(0x1C, true);
      for (var i = 0; i < fileContentLength; ++i) {
        if (0x800 + i >= arrayBuffer.byteLength) continue;
        ram.setInt8(textSegmentOffset++ & 0x001fffff, view.getInt8(0x800 + i, true), true);
      }

      clearCodeCache(view.getInt32(0x18, true), arrayBuffer.byteLength);
      running = true;
    }
    else if (view.getUint32(0, true) === 0x0000434d) { // MEMCARD
      var copy = new Uint8Array(arrayBuffer);
      let card = joy.devices ? joy.devices[0].data : joy.cardOneMemory;
      for (var i = 0; i < copy.length; ++i) {
        card[i] = copy[i];
      }
    }
    else if (arrayBuffer.byteLength === 524288) {
      biosBooted = false;
      loadedBiosId = bufferIdentity(arrayBuffer);
      writeStorageStream('bios', arrayBuffer);
      clearCodeCache(0x01c00000, 0x00080000);
      for (var i = 0; i < 0x00080000; i += 4) {
        const data = view.getInt32(i, true);
        rom.setInt32(i, data, true);
      }
      // Sony BIOS traditionally starts as soon as it is loaded. OpenBIOS
      // needs the disc present before starting, so defer only that BIOS.
      const biosText = new TextDecoder().decode(new Uint8Array(arrayBuffer));
      const isOpenBios = /openbios|pcsx-redux/i.test(biosText);
      if (isOpenBios) {
        bootBiosIfReady();
      }
      else {
        bios();
        biosBooted = true;
        running = true;
      }
      let header = document.querySelector('span.nobios');
      if (header) {
        header.classList.remove('nobios');
      }
    }
    else if (true || view.getUint32(0, true) === (0xffffff00 >>> 0)) { // ISO
      // auto build TOC (attempt to not need .cue files)
      let lastLoc = (arrayBuffer.byteLength / 4) / (2352 / 4);
      let tracks = [];

      tracks.push({ id: 0, begin: 0, end: lastLoc });
      const sectorLength = 2352;
      const isDataSector = (startLoc) => {
        let mask1 = view.getInt32(startLoc * sectorLength + 0, true) >>> 0;
        let mask2 = view.getInt32(startLoc * sectorLength + 4, true) >>> 0;
        let mask3 = view.getInt32(startLoc * sectorLength + 8, true) >>> 0;
        return (mask1 === 0xffffff00 && mask2 === 0xffffffff && mask3 === 0x00ffffff) || (!mask1 && !mask2 && !mask3);
      }

      const isEmptySector = (startLoc) => {
        let mask = 0;
        for (let i = 0; i < sectorLength; i += 4) {
          mask |= view.getInt32(startLoc * sectorLength + i, true);
        }
        return (mask >>> 0) === (0x00000000 >>> 0);
      }

      let begin, end, lead;

      let i = 0;
      begin = i;
      while ((i < lastLoc) && isDataSector(i)) ++i;
      end = i;
      while ((i < lastLoc) && isEmptySector(i)) ++i;
      tracks.push({ id: 1, begin, end, data: true });

      let id = 2;
      if (i < lastLoc) {
        begin = i;
        while (i < lastLoc) {
          while ((i < lastLoc) && !isEmptySector(i)) ++i;
          end = i;
          while ((i < lastLoc) && isEmptySector(i)) ++i;
          lead = i;
          if ((lead - end) < 75) continue;
          tracks.push({ id, begin, end, audio: true });
          begin = i;
          id++;
        }
        if (begin < lastLoc) {
          end = lead = lastLoc
          tracks.push({ id, begin, end, audio: true });
        }
      }
      cdr.setCdImage(view);
      cdr.setTOC(tracks);
      loadedGameId = sourceId ? `local:${sourceId}:${arrayBuffer.byteLength}` : `local-image:${arrayBuffer.byteLength}`;

      bootBiosIfReady();
      running = true;
      scheduleStateReady();
    }
    else {
      abort();
    }
  }

  const handleFileSelect = async (evt) => {
    evt.stopPropagation();
    evt.preventDefault();

    const fileList = evt.dataTransfer ? evt.dataTransfer.files : evt.target.files;

    const selectedFiles = [...fileList];
    const biosFile = selectedFiles.find(file => file.size === 0x80000);
    if (biosFile) {
      loadFileData(await biosFile.arrayBuffer(), biosFile.name);
    }
    const cueFile = selectedFiles.find(file => /\.cue$/i.test(file.name));
    if (cueFile) {
      try {
        await loadCueFromFiles(cueFile, selectedFiles);
      } catch (error) {
        abort('Unable to load local CUE:', error.message);
      }
      return;
    }
    for (const file of selectedFiles) {
      openFile(file);
    }
  }

  const handleDragOver = (evt) => {
    evt.stopPropagation();
    evt.preventDefault();
  }

  const init = () => {
    canvas = document.getElementById('display');

    document.addEventListener('dragover', handleDragOver, false);
    document.addEventListener('drop', handleFileSelect, false);

    const fileElem = document.getElementById('file');
    fileElem?.addEventListener('change', handleFileSelect, false);

    const loadBiosButton = document.getElementById('load-bios');
    loadBiosButton?.addEventListener('click', async () => {
      loadBiosButton.disabled = true;
      loadBiosButton.textContent = 'Loading...';
      try {
        await loadBiosFromURL(loadBiosButton.dataset.url);
        loadBiosButton.textContent = 'BIOS Loaded';
      }
      catch (error) {
        const message = `Unable to load BIOS: ${error.message}`;
        console.error(message, error);
        alert(message);
        loadBiosButton.disabled = false;
        loadBiosButton.textContent = 'Load BIOS';
      }
    });

    const loadOpenBiosButton = document.getElementById('load-openbios');
    loadOpenBiosButton?.addEventListener('click', async () => {
      loadOpenBiosButton.disabled = true;
      loadOpenBiosButton.textContent = 'Loading...';
      try {
        await loadBiosFromURL(loadOpenBiosButton.dataset.url);
        loadOpenBiosButton.textContent = 'OpenBIOS Loaded';
      }
      catch (error) {
        const message = `Unable to load OpenBIOS: ${error.message}`;
        console.error(message, error);
        alert(message);
        loadOpenBiosButton.disabled = false;
        loadOpenBiosButton.textContent = 'Load OpenBIOS';
      }
    });

    const loadGameButton = document.getElementById('load-game');
    const loadGameFromButton = async (button, url, loadedText = 'Game Loaded') => {
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Loading...';
      try {
        await loadFileFromURL(url);
        button.textContent = loadedText;
      }
      catch (error) {
        const message = `Unable to load game: ${error.message}`;
        console.error(message, error);
        alert(message);
        button.disabled = false;
        button.textContent = originalText;
      }
    };
    loadGameButton?.addEventListener('click', () => loadGameFromButton(loadGameButton, loadGameButton.dataset.url));

    const cloudBase = window.location.origin;
    const gameListBase = window.location.origin;
    const gamesCsvUrl = `${gameListBase}/games.csv`;
    const biosCsvUrl = `${window.location.origin}/bios.csv`;
    const parseCsv = text => {
      const rows = [];
      let row = [];
      let field = '';
      let quoted = false;
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '"') {
          if (quoted && text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = !quoted;
          }
        } else if (character === ',' && !quoted) {
          row.push(field);
          field = '';
        } else if ((character === '\n' || character === '\r') && !quoted) {
          if (character === '\r' && text[index + 1] === '\n') index += 1;
          row.push(field);
          if (row.some(value => value.trim())) rows.push(row);
          row = [];
          field = '';
        } else {
          field += character;
        }
      }
      if (field || row.length) {
        row.push(field);
        if (row.some(value => value.trim())) rows.push(row);
      }
      if (!rows.length) return [];
      const headers = rows.shift().map(value => value.trim().toLowerCase());
      const nameIndex = headers.indexOf('name');
      const urlIndex = headers.indexOf('url');
      if (nameIndex < 0 || urlIndex < 0) throw new Error('games.csv must have name and url columns');
      return rows.map(values => ({
        name: (values[nameIndex] || '').trim(),
        url: (values[urlIndex] || '').trim(),
      })).filter(game => game.name && game.url);
    };
    const loadBiosCatalog = async () => {
      const biosList = document.getElementById('bios-list');
      const biosListStatus = document.getElementById('bios-list-status');
      if (!biosList || biosList.dataset.loaded === 'true') return;
      biosListStatus && (biosListStatus.textContent = 'Loading BIOS files...');
      try {
        const response = await fetch(biosCsvUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const bios = parseCsv(await response.text());
        biosList.replaceChildren();
        for (const biosFile of bios) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = `Load ${biosFile.name}`;
          button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'Loading...';
            try {
              await loadBiosFromURL(new URL(biosFile.url, `${window.location.origin}/`).href);
              button.textContent = `${biosFile.name} Loaded`;
            } catch (error) {
              console.error(`Unable to load ${biosFile.name}:`, error);
              alert(`Unable to load ${biosFile.name}: ${error.message}`);
              button.disabled = false;
              button.textContent = `Load ${biosFile.name}`;
            }
          });
          const item = document.createElement('div');
          item.append(button);
          biosList.append(item);
        }
        biosList.dataset.loaded = 'true';
        if (biosListStatus) {
          biosListStatus.textContent = '';
          biosListStatus.hidden = true;
        }
      } catch (error) {
        console.error('Unable to load bios.csv:', error);
        if (biosListStatus) {
          biosListStatus.hidden = false;
          biosListStatus.textContent = `Unable to load BIOS list: ${error.message}`;
        }
      }
    };
    const loadGameCatalog = async () => {
      const gameList = document.getElementById('game-list');
      const gameListStatus = document.getElementById('game-list-status');
      if (!gameList || gameList.dataset.loaded === 'true') return;
      gameListStatus && (gameListStatus.textContent = 'Loading games...');
      try {
        const response = await fetch(gamesCsvUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const games = parseCsv(await response.text());
        gameList.replaceChildren();
        for (const game of games) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = game.name;
          button.addEventListener('click', () => loadGameFromButton(button, new URL(game.url, `${gameListBase}/`).href, 'Game Loaded'));
          const item = document.createElement('div');
          item.append(button);
          gameList.append(item);
        }
        gameList.dataset.loaded = 'true';
        if (gameListStatus) {
          gameListStatus.textContent = '';
          gameListStatus.hidden = true;
        }
      } catch (error) {
        console.error('Unable to load games.csv:', error);
        if (gameListStatus) {
          gameListStatus.hidden = false;
          gameListStatus.textContent = `Unable to load games: ${error.message}`;
        }
      }
    };
    const cloudRequest = (path, options = {}) => fetch(`${cloudBase}${path}`, {
      cache: 'no-store',
      ...options,
    }).then(async response => {
      if (!response.ok) {
        let message = response.statusText;
        try { message = (await response.text()) || message; } catch (_) { }
        throw new Error(`${response.status} ${message}`);
      }
      return response;
    });

    const cloudSaveStateButton = document.getElementById('cloud-save-state');
    cloudSaveStateButton?.addEventListener('click', async () => {
      try {
        if (!saveState()) throw new Error('Save state is unavailable');
        await cloudRequest('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: localStorage.getItem(stateStorageKey),
        });
        updateStateButton(cloudSaveStateButton, 'Cloud Saved');
      }
      catch (error) {
        console.error('Unable to save state to cloud:', error);
        updateStateButton(cloudSaveStateButton, 'Cloud Save Failed');
        alert(`Unable to save state to cloud: ${error.message}`);
      }
    });

    const cloudLoadStateButton = document.getElementById('cloud-load-state');
    cloudLoadStateButton?.addEventListener('click', async () => {
      try {
        const encoded = await (await cloudRequest('/api/state')).text();
        loadState(encoded);
        localStorage.setItem(stateStorageKey, encoded);
        updateStateButton(cloudLoadStateButton, 'Cloud State Loaded');
      }
      catch (error) {
        console.error('Unable to load state from cloud:', error);
        updateStateButton(cloudLoadStateButton, 'Cloud Load Failed');
        alert(`Unable to load state from cloud: ${error.message}`);
      }
    });

    const cloudSaveMemoryCardButton = document.getElementById('cloud-save-memorycard');
    cloudSaveMemoryCardButton?.addEventListener('click', async () => {
      try {
        const card = joy.devices[0].getMemoryCard?.();
        if (!card) throw new Error('Memory card is unavailable');
        await cloudRequest('/api/memorycard', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: card,
        });
        updateStateButton(cloudSaveMemoryCardButton, 'Cloud Saved');
      }
      catch (error) {
        console.error('Unable to save memory card to cloud:', error);
        updateStateButton(cloudSaveMemoryCardButton, 'Cloud Save Failed');
        alert(`Unable to save memory card to cloud: ${error.message}`);
      }
    });

    const cloudLoadMemoryCardButton = document.getElementById('cloud-load-memorycard');
    cloudLoadMemoryCardButton?.addEventListener('click', async () => {
      try {
        const buffer = await (await cloudRequest('/api/memorycard')).arrayBuffer();
        if (buffer.byteLength !== 128 * 1024) throw new Error('Cloud memory card must be exactly 128 KB');
        joy.devices[0].setMemoryCard(new Uint8Array(buffer));
        writeStorageStream('card1', buffer);
        updateStateButton(cloudLoadMemoryCardButton, 'Cloud Card Loaded');
      }
      catch (error) {
        console.error('Unable to load memory card from cloud:', error);
        updateStateButton(cloudLoadMemoryCardButton, 'Cloud Load Failed');
        alert(`Unable to load memory card from cloud: ${error.message}`);
      }
    });

    const saveStateButton = document.getElementById('save-state');
    saveStateButton?.addEventListener('click', () => {
      try {
        updateStateButton(saveStateButton, saveState() ? 'State Saved' : 'Save Failed');
      }
      catch (error) {
        console.error('Unable to save state:', error);
        updateStateButton(saveStateButton, 'Save Failed');
      }
    });

    const loadStateButton = document.getElementById('load-state');
    loadStateButton?.addEventListener('click', () => {
      try {
        updateStateButton(loadStateButton, loadState() ? 'State Loaded' : 'No State');
      }
      catch (error) {
        console.error('Unable to load state:', error);
        const reason = error.message || 'Unknown error';
        const shortReason = reason.startsWith('Save state mismatch:')
          ? 'State Mismatch'
          : reason.includes('incompatible emulator build')
            ? 'Incompatible Build'
            : 'Load Failed';
        updateStateButton(loadStateButton, shortReason);
        alert(`Unable to load save state: ${reason}`);
      }
    });

    const downloadStateButton = document.getElementById('download-state');
    downloadStateButton?.addEventListener('click', () => {
      try {
        if (!saveState()) {
          updateStateButton(downloadStateButton, 'Save Failed');
          return;
        }
        downloadFile(localStorage.getItem(stateStorageKey), 'enge-save-state.json', 'application/json');
        updateStateButton(downloadStateButton, 'Downloaded');
      }
      catch (error) {
        console.error('Unable to download state:', error);
        updateStateButton(downloadStateButton, 'Download Failed');
      }
    });

    const downloadMemoryCardButton = document.getElementById('download-memorycard');
    downloadMemoryCardButton?.addEventListener('click', () => {
      try {
        const card = joy.devices[0].getMemoryCard?.();
        if (!card) throw new Error('Memory card is unavailable');
        downloadFile(card, 'enge-memory-card-1.mcr', 'application/octet-stream');
        updateStateButton(downloadMemoryCardButton, 'Downloaded');
      }
      catch (error) {
        console.error('Unable to download memory card:', error);
        updateStateButton(downloadMemoryCardButton, 'Download Failed');
      }
    });

    const uploadStateButton = document.getElementById('upload-state');
    const uploadStateInput = document.getElementById('upload-state-file');
    uploadStateButton?.addEventListener('click', () => uploadStateInput?.click());
    uploadStateInput?.addEventListener('change', () => {
      const file = uploadStateInput.files?.[0];
      if (!file) return;
      file.text().then(encoded => {
        loadState(encoded);
        localStorage.setItem(stateStorageKey, encoded);
        updateStateButton(uploadStateButton, 'State Loaded');
      }).catch(error => {
        console.error('Unable to upload state:', error);
        updateStateButton(uploadStateButton, error.message.includes('mismatch') ? 'State Mismatch' : 'Load Failed');
        alert(`Unable to upload save state: ${error.message}`);
      }).finally(() => { uploadStateInput.value = ''; });
    });

    const uploadMemoryCardButton = document.getElementById('upload-memorycard');
    const uploadMemoryCardInput = document.getElementById('upload-memorycard-file');
    uploadMemoryCardButton?.addEventListener('click', () => uploadMemoryCardInput?.click());
    uploadMemoryCardInput?.addEventListener('change', () => {
      const file = uploadMemoryCardInput.files?.[0];
      if (!file) return;
      file.arrayBuffer().then(buffer => {
        if (buffer.byteLength !== 128 * 1024) throw new Error('Memory card must be exactly 128 KB');
        joy.devices[0].setMemoryCard(new Uint8Array(buffer));
        writeStorageStream('card1', buffer);
        updateStateButton(uploadMemoryCardButton, 'Card Loaded');
      }).catch(error => {
        console.error('Unable to upload memory card:', error);
        updateStateButton(uploadMemoryCardButton, 'Load Failed');
        alert(`Unable to upload memory card: ${error.message}`);
      }).finally(() => { uploadMemoryCardInput.value = ''; });
    });

    const menuButton = document.getElementById('menu-button');
    const controlMenu = document.getElementById('control-menu');
    const closeMenuButton = document.getElementById('close-menu');
    const closeMenu = () => {
      if (!controlMenu) return;
      controlMenu.classList.remove('open');
      controlMenu.hidden = true;
      menuButton?.setAttribute('aria-expanded', 'false');
    };
    menuButton?.addEventListener('click', () => {
      if (!controlMenu) return;
      controlMenu.hidden = false;
      controlMenu.classList.add('open');
      menuButton.setAttribute('aria-expanded', 'true');
    });
    document.getElementById('reload-window')?.addEventListener('click', () => window.location.reload());
    const cloudButton = document.getElementById('cloud-button');
    const networkMenu = document.getElementById('network-menu');
    const closeNetworkMenuButton = document.getElementById('close-network-menu');
    const closeNetworkMenu = () => {
      if (!networkMenu) return;
      networkMenu.classList.remove('open');
      networkMenu.hidden = true;
      cloudButton?.setAttribute('aria-expanded', 'false');
    };
    cloudButton?.addEventListener('click', () => {
      if (!networkMenu) return;
      networkMenu.hidden = false;
      networkMenu.classList.add('open');
      cloudButton.setAttribute('aria-expanded', 'true');
      void loadBiosCatalog();
      void loadGameCatalog();
    });
    const overlayToggle = document.getElementById('overlay-toggle');
    overlayToggle?.addEventListener('click', () => {
      const hidden = document.body.classList.toggle('touch-overlay-hidden');
      overlayToggle.setAttribute('aria-pressed', String(hidden));
      overlayToggle.setAttribute('aria-label', hidden ? 'Show touch controls' : 'Hide touch controls');
      overlayToggle.title = hidden ? 'Show touch controls' : 'Hide touch controls';
    });
    closeMenuButton?.addEventListener('click', closeMenu);
    controlMenu?.addEventListener('click', event => {
      if (event.target === controlMenu) closeMenu();
    });
    closeNetworkMenuButton?.addEventListener('click', closeNetworkMenu);
    networkMenu?.addEventListener('click', event => {
      if (event.target === networkMenu) closeNetworkMenu();
    });

    const fullscreenButton = document.getElementById('fullscreen');
    const updateFullscreenLabel = () => {
      const nativeFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      const pseudoFullscreen = document.documentElement.classList.contains('enge-pseudo-fullscreen');
      const fullscreenActive = nativeFullscreen || pseudoFullscreen;
      fullscreenButton.textContent = fullscreenActive
        ? 'Exit Fullscreen'
        : 'Fullscreen';
      fullscreenButton.setAttribute('aria-label', fullscreenActive ? 'Exit fullscreen' : 'Fullscreen');
      fullscreenButton.title = fullscreenActive ? 'Exit fullscreen' : 'Fullscreen';
    };
    fullscreenButton?.addEventListener('click', async () => {
      try {
        const nativeFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
        const pseudoFullscreen = document.documentElement.classList.contains('enge-pseudo-fullscreen');
        if (nativeFullscreen) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) await exit.call(document);
        }
        else if (pseudoFullscreen) {
          document.documentElement.classList.remove('enge-pseudo-fullscreen');
        }
        else {
          const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
          if (request) {
            try {
              await request.call(document.documentElement);
            }
            catch (error) {
              document.documentElement.classList.add('enge-pseudo-fullscreen');
            }
          }
          else {
            document.documentElement.classList.add('enge-pseudo-fullscreen');
          }
        }
        updateFullscreenLabel();
      }
      catch (error) {
        console.error('Fullscreen request failed:', error);
        document.documentElement.classList.add('enge-pseudo-fullscreen');
        updateFullscreenLabel();
      }
    });
    document.addEventListener('fullscreenchange', updateFullscreenLabel);
    document.addEventListener('webkitfullscreenchange', updateFullscreenLabel);

    settings.updateQuality();

    const qualityElem = document.getElementById('quality');
    qualityElem?.addEventListener('click', event => {
      settings.updateQuality(true);
      event.preventDefault();
    });

    emulate(performance.now());

    canvas.addEventListener("dblclick", () => {
      running = !running;
      if (!running) {
        spu.silence();
      }
    });

    canvas.addEventListener("touchstart", () => {
      running = !running;
      if (!running) {
        spu.silence();
      }
    });


    window.addEventListener("keydown", e => {
      if (e.key === 'F12') return; // allow developer tools
      if (e.key === 'F11') return; // allow full screen
      if (e.key === 'F5') return; // allow page refresh
    }, false);

    window.addEventListener("keyup", e => {
      if (e.key === '1' && e.ctrlKey) renderer.setMode('disp');
      if (e.key === '2' && e.ctrlKey) renderer.setMode('draw');
      if (e.key === '3' && e.ctrlKey) renderer.setMode('clut8');
      if (e.key === '4' && e.ctrlKey) renderer.setMode('clut4');
      if (e.key === '0' && e.ctrlKey) renderer.setMode('page2');

      if (e.key === 'F12') return; // allow developer tools
      if (e.key === 'F11') return; // allow full screen
      if (e.key === 'F5') return; // allow page refresh
    }, false);

    readStorageStream('bios', data => {
      if (data) {
        loadedBiosId = bufferIdentity(data.buffer);
        let data32 = new Uint32Array(data.buffer);
        for (var i = 0; i < 0x80000; i += 4) {
          map[(0x01c00000 + i) >>> 2] = data32[i >>> 2];
        }
        let header = document.querySelector('span.nobios');
        if (header) {
          header.classList.remove('nobios');
        }
        bootBiosIfReady();
      }
    });
    readStorageStream('card1', data => {
      if (data) {
        joy.devices[0].setMemoryCard(data);
      }
    });
    readStorageStream('card2', data => {
      if (data) {
        joy.devices[1].setMemoryCard(data);
      }
    });

    // BIOS loading is explicit now. This avoids silently replacing a BIOS
    // selected by the user with the bundled OpenBIOS file.
    // loadBiosFromURL('openbios.bin').catch(error => {
    //   console.error('Unable to auto-load local OpenBIOS:', error);
    // });

  }

  return { init, PSX_SPEED, abort, context, loadFileFromURL, loadCueFromURL, loadBiosFromURL };
})
