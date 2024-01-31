mdlr('enge:psx:index', m => {

  let running = false;
  let canvas = undefined;

  const PSX_SPEED = 44100 * 768; // 33868800 cyles

  const abort = () => {
    console.error(Array.prototype.slice.call(arguments).join(' '));
    canvas.style.borderColor = 'red';
    running = false;
    spu.silence();
    throw new Error;
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

  const frameEvent = psx.addEvent(0, (self, clock) => {
    endAnimationFrame = true;
    psx.unsetEvent(self);
  });

  const runFrame = () => {
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
  }

  const mainLoop = (stamp) => {
    const delta = stamp - context.timeStamp;
    context.timeStamp = stamp;
    if (!running || !hasFocus || delta > 250) return;

    context.realtime += delta;

    const diffTime = context.realtime - context.emutime;
    const totalCycles = diffTime * (PSX_SPEED / 1000);

    endAnimationFrame = false;
    psx.setEvent(frameEvent, +totalCycles);
    ++context.counter;
    runFrame();

    context.emutime = psx.clock / (PSX_SPEED / 1000);
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
      console.log(escape(file.name), file.size);

      loadFileData(event.target.result)
    };

    reader.readAsArrayBuffer(file);
  }

  const loadFileData = (arrayBuffer) => {
    const view = new DataView(arrayBuffer);

    if (view.getUint16(0, true) === 0x5350) { // PS
      for (let i = 0; i < 0x40; i += 4) {
        console.log(hex(i, 2), hex(view.getInt32(i, 8)));
      }
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
      console.log('loaded MEMCARD');
      var copy = new Uint8Array(arrayBuffer);
      let card = joy.devices ? joy.devices[0].data : joy.cardOneMemory;
      for (var i = 0; i < copy.length; ++i) {
        card[i] = copy[i];
      }
    }
    else if (arrayBuffer.byteLength === 524288) {
      writeStorageStream('bios', arrayBuffer);
      for (var i = 0; i < 0x00080000; i += 4) {
        const data = view.getInt32(i, true);
        rom.setInt32(i, data, true);
      }
      bios();
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

      running = true;
    }
    else {
      abort('Unsupported fileformat');
    }
  }

  const handleFileSelect = (evt) => {
    evt.stopPropagation();
    evt.preventDefault();

    const fileList = evt.dataTransfer ? evt.dataTransfer.files : evt.target.files;

    for (let i = 0, f; f = fileList[i]; ++i) {
      openFile(f);
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

    settings.updateQuality();

    const qualityElem = document.getElementById('quality');
    qualityElem?.addEventListener('click', evt => {
      settings.updateQuality(true);

      evt.stopPropagation();
      evt.preventDefault();
      return false;
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
      e.preventDefault();
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
      e.preventDefault();
    }, false);

    readStorageStream('bios', data => {
      if (data) {
        let data32 = new Uint32Array(data.buffer);
        for (var i = 0; i < 0x80000; i += 4) {
          map[(0x01c00000 + i) >>> 2] = data32[i >>> 2];
        }
        let header = document.querySelector('span.nobios');
        if (header) {
          header.classList.remove('nobios');
        }
        bios();
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
  }

  return { init, PSX_SPEED, abort, context };
})