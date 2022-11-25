(scope => {

  'use strict';

  let running = false;
  let canvas = undefined;

  const PSX_SPEED = 44100 * 768; // 33868800 cyles

  function abort() {
    console.error(Array.prototype.slice.call(arguments).join(' '));
    canvas.style.borderColor = 'red';
    running = false;
    spu.silence();
    throw 'abort';
  }

  let hasFocus = true;
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === 'visible') {
      document.title = `eNGE - [${gameCode}]`;
      hasFocus = true;
    } else {
      document.title = 'paused';
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

  function isTouchEnabled() {
    return ('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0) ||
      (navigator.msMaxTouchPoints > 0);
  }

  psx.addEvent(0, spu.event.bind(spu));
  dma.eventDMA0 = psx.addEvent(0, dma.completeDMA0.bind(dma));
  // dma.eventDMA1 = psx.addEvent(0, dma.completeDMA1.bind(dma));
  dma.eventDMA2 = psx.addEvent(0, dma.completeDMA2.bind(dma));
  dma.eventDMA3 = psx.addEvent(0, dma.completeDMA3.bind(dma));
  dma.eventDMA4 = psx.addEvent(0, dma.completeDMA4.bind(dma));
  dma.eventDMA6 = psx.addEvent(0, dma.completeDMA6.bind(dma));
  cdr.eventRead = psx.addEvent(0, cdr.completeRead.bind(cdr));
  cdr.eventCmd = psx.addEvent(0, cdr.completeCmd.bind(cdr));
  joy.eventIRQ = psx.addEvent(0, joy.completeIRQ.bind(joy));
  mdc.event = psx.addEvent(0, mdc.complete.bind(mdc));

  dot.event = psx.addEvent(0, dot.complete.bind(dot));

  let frameEvent = psx.addEvent(0, endMainLoop);
  let endAnimationFrame = false;
  function endMainLoop(self, clock) {
    endAnimationFrame = true;
    psx.unsetEvent(self);
  }

  function runFrame() {
    let entry = getCacheEntry(cpu.pc);
    if (!entry) return abort('invalid pc')

    handleGamePads();

    const $ = psx;
    while (!endAnimationFrame) {
      CodeTrace.add(entry);
      entry = entry.code($);

      if ($.clock >= $.eventClock) {
        entry = $.handleEvents(entry);
      }
    }
    cpu.pc = entry.pc;
  }

  function mainLoop(stamp) {
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

  function emulate(stamp) {
    window.requestAnimationFrame(emulate);
    mainLoop(stamp);
  }

  function bios() {
    running = false;

    let entry = getCacheEntry(0xbfc00000);
    const $ = psx;
    while (entry.pc !== 0x00030000) {
      CodeTrace.add(entry);
      entry = entry.code($);

      if ($.clock >= $.eventClock) {
        entry = $.handleEvents(entry);
      }
    }
    context.realtime = context.emutime = psx.clock / (PSX_SPEED / 1000);
    vector = getCacheEntry(0x80);
    cpu.pc = entry.pc;
  }

  function openFile(file) {
    var reader = new FileReader();

    reader.onload = function (event) {
      console.log(escape(file.name), file.size);

      loadFileData(event.target.result)
    };

    reader.readAsArrayBuffer(file);
  }

  function loadFileData(arrayBuffer) {
    const view = new DataView(arrayBuffer);

    if (view.getUint16(0, true) === 0x5350) { // PS
      for (let i = 0; i <0x40; i+=4) {
        console.log(hex(i,2), hex(view.getInt32(i,8)));
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
      let loc = 0;
      let lastLoc = (arrayBuffer.byteLength / 4) / (2352 / 4);
      let type = 0; // data
      let tracks = [];

      tracks.push({ id: 0, begin: 0, end: lastLoc });
      const sectorLength = 2352;
      function isDataSector(startLoc) {
        let mask1 = view.getInt32(startLoc * sectorLength + 0, true) >>> 0;
        let mask2 = view.getInt32(startLoc * sectorLength + 4, true) >>> 0;
        let mask3 = view.getInt32(startLoc * sectorLength + 8, true) >>> 0;
        return (mask1 === 0xffffff00 && mask2 === 0xffffffff && mask3 === 0x00ffffff);
      }

      function isEmptySector(startLoc) {
        let mask = 0;
        for (let i = 0; i < sectorLength; i += 4) {
          mask |= view.getInt32(startLoc * sectorLength + i, true);
        }
        return (mask >>> 0) === (0x00000000 >>> 0);
      }

      let begin, end, lead, track = 0;

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

  function handleFileSelect(evt) {
    evt.stopPropagation();
    evt.preventDefault();

    const fileList = evt.dataTransfer ? evt.dataTransfer.files : evt.target.files;

    var output = [];
    for (var i = 0, f; f = fileList[i]; i++) {
      openFile(f);
    }
  }

  function handleDragOver(evt) {
    evt.stopPropagation();
    evt.preventDefault();
  }

  function init() {

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

    renderer = new WebGLRenderer(canvas);

    canvas.addEventListener("dblclick", function (e) {
      running = !running;
      if (!running) {
        spu.silence();
      }
    });

    canvas.addEventListener("touchstart", function (e) {
      running = !running;
      if (!running) {
        spu.silence();
      }
    });


    window.addEventListener("keydown", function (e) {
      if (e.key === 'F12') return; // allow developer tools
      if (e.key === 'F11') return; // allow full screen
      if (e.key === 'F5') return; // allow page refresh
      e.preventDefault();
    }, false);

    window.addEventListener("keyup", function (e) {
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
        let data32 = new Uint32Array(data);
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
        let data8 = new Uint8Array(data);
        console.log('loading card1', data8.length);
        for (let i = 0; i < 128 * 1024; ++i) {
          joy.devices[0].data[i] = data8[i];
        }
      }
    });
    readStorageStream('card2', data => {
      if (data) {
        let data8 = new Uint8Array(data);
        console.log('loading card2', data8.length);
        for (let i = 0; i < 128 * 1024; ++i) {
          joy.devices[1].data[i] = data8[i];
        }
      }
    });
  }

  scope.init = init;
  scope.PSX_SPEED = PSX_SPEED;
  scope.renderer = undefined;
  scope.abort = abort;
  scope.context = context;

})(window);