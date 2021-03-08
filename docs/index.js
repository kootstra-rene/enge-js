'use strict';

var running = false;
var originalSpeed = true;
var realtimeStart = 0;
var samplesStart = 0;
var loading = 0;
var renderer = undefined;
var canvas = undefined;
var emulationTime = 0.0;
var context = undefined;

function readStorageStream(item, cb) {
  const base64text = localStorage.getItem(item);
  if (base64text) {
    const arrayBuffer = Base64.decode(base64text);
    cb(arrayBuffer);
  }
  else {
    cb(null);
  }
}

var abort = function() {
  console.error(Array.prototype.slice.call(arguments).join(' '));
  canvas.style.borderColor = 'red';
  running = false;
  spu.silence();
  throw 'abort';
}

let hasFocus = true;
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === 'visible') {
    document.title = 'active';
    hasFocus = true;
  } else {
    document.title = 'paused';
    hasFocus = false;
    spu.silence();
  }
});

var context = window.context= {
  timeStamp: 0,
  realtime: 0,
  emutime: 0,
  jstime: 0
};

const psx = {
  clock: 0.0,
  eventClock: 0.0,
  events:[],
}

psx.addEvent = (clocks, cb) => {
  const event = {
    active: true, 
    clock: +psx.clock + +clocks,
    start: +psx.clock,
    cb
  };
  Object.seal(event);

  if (psx.eventClock > event.clock) {
    psx.eventClock = event.clock;
  }
  psx.events.push(event);
  return event;
}

psx.updateEvent = (event, clocks) => {
  event.start = event.clock;
  event.clock += +clocks;
  event.active = true;

  if (psx.eventClock > event.clock) {
    psx.eventClock = event.clock;
  }
  return event;
}

psx.unsetEvent = (event) => {
  event.active = false;
  return event;
}

psx.eventCycles = (event) => {
  return +psx.clock - event.start;
}

psx.setEvent = (event, clocks) => {
  event.clock = +psx.clock + +clocks;
  event.start = +psx.clock;
  event.active = true;

  if (psx.eventClock > event.clock) {
    psx.eventClock = event.clock;
  }
  return event;
}

psx.handleEvents = (entry) => {
  let eventClock = Number.MAX_SAFE_INTEGER;

  for (let i = 0, l = psx.events.length; i < l; ++i) {
    const event = psx.events[i];
    if (!event.active) continue;

    if (psx.clock >= event.clock) {
      event.cb(event, psx.clock);
    }
    if (event.clock < eventClock && event.active) {
      eventClock = event.clock;
    }
  }

  psx.eventClock = eventClock;

  return cpuInterrupt(entry);
}

Object.seal(psx);

psx.addEvent(0, spu.event.bind(spu));
dma.eventDMA0 = psx.addEvent(0, dma.completeDMA0.bind(dma));
dma.eventDMA1 = psx.addEvent(0, dma.completeDMA1.bind(dma));
dma.eventDMA2 = psx.addEvent(0, dma.completeDMA2.bind(dma));
dma.eventDMA3 = psx.addEvent(0, dma.completeDMA3.bind(dma));
dma.eventDMA4 = psx.addEvent(0, dma.completeDMA4.bind(dma));
dma.eventDMA6 = psx.addEvent(0, dma.completeDMA6.bind(dma));
cdr.eventRead = psx.addEvent(0, cdr.completeRead.bind(cdr));
cdr.eventCmd = psx.addEvent(0, cdr.completeCmd.bind(cdr));
joy.eventIRQ = psx.addEvent(0, joy.completeIRQ.bind(joy));
mdc.event = psx.addEvent(0, mdc.complete.bind(mdc));

dot.event = psx.addEvent(0, dot.complete.bind(dot));
// rc0.event = psx.addEvent(0, rc0.complete.bind(rc0));
// rc1.event = psx.addEvent(0, rc1.complete.bind(rc1));
// rc2.event = psx.addEvent(0, rc2.complete.bind(rc2));

let frameEvent = psx.addEvent(0, endMainLoop);
let endAnimationFrame = false;
function endMainLoop(self, clock) {
  endAnimationFrame = true;
  self.active = false;
}

function mainLoop(stamp) {
  window.requestAnimationFrame(mainLoop);
  const delta = stamp - context.timeStamp;
  context.timeStamp = stamp;
  if (!running || !hasFocus || delta > 200) return;

  context.realtime += delta;

  let diffTime = context.emutime - context.realtime;
  const timeToEmulate = 10.0 - diffTime;

  const totalCycles = timeToEmulate * (768*44.100);
  let jstime = performance.now();

  let entry = getCacheEntry(cpu.pc);

  endAnimationFrame = false;
  psx.setEvent(frameEvent, +totalCycles);
  handleGamePads();
  while (!endAnimationFrame) {
    if (!entry.code) {
      entry.code = compileBlock(entry);//.bind(null);
    }
    entry = entry.code(psx);
  }
  cpu.pc = entry.pc;

  jstime = performance.now() - jstime;
  context.jstime += jstime;
  // correct the emulation time accourding to the psx.clock
  context.emutime =  psx.clock / (768*44.100);
  // console.log(context.jstime/context.emutime);
}

function bios() {
  running = false;

  let entry = getCacheEntry(0xbfc00000);
  const $ = psx;
  while (entry.pc !== 0x00030000) {
    if (!entry.code) {
      entry.code = compileBlock(entry);//.bind(null);
    }
    entry = entry.code(psx);
  }
  context.realtime = context.emutime =  psx.clock / (768*44.100);

  cpu.pc = entry.pc;
}

var openFile = function(file) {
  var reader = new FileReader();

  reader.onload = function(event) {
    console.log(escape(file.name), file.size);

    loadFileData(event.target.result)
  };

  loading++;
  reader.readAsArrayBuffer(file);
}

function loadFileData(arrayBuffer) {
  if ((arrayBuffer.byteLength & 3) !== 0) {
    var copy = new Uint8Array(arrayBuffer);
    var data = new Uint32Array(((copy.length + 3) & ~3) >> 2);
    for (var i = 0; i < copy.length; ++i) {
      data.setInt8(i, copy[i]);
    }
  }
  else {
    var data = new Uint32Array(arrayBuffer);
  }

  const view8 = new Int8Array(data.buffer);

  if ((data[0] & 0xffff) === 0x5350) { // PS
    cpu.pc = data.getInt32(0x10);
    cpu.gpr[28] = data.getInt32(0x14);
    if (data.getInt32(0x30)) cpu.gpr[29] = data.getInt32(0x30);
    if (data.getInt32(0x30)) cpu.gpr[30] = data.getInt32(0x30);
    cpu.gpr[31] = cpu.pc;
    console.log('init-pc  : $', hex(cpu.pc >>> 0));
    console.log('init-gp  : $', hex(cpu.gpr[28] >>> 0));
    console.log('init-sp  : $', hex(cpu.gpr[29] >>> 0));
    console.log('init-fp  : $', hex(cpu.gpr[30] >>> 0));
    console.log('init-of  : $', hex(data.getInt32(0x34) >>> 0));
    console.log('text-addr: $', hex(data.getInt32(0x18) >>> 0));
    console.log('text-size: $', hex(data.getInt32(0x1C) >>> 0));
    console.log('data-addr: $', hex(data.getInt32(0x20) >>> 0));
    console.log('data-size: $', hex(data.getInt32(0x24) >>> 0));

    // for (let i = 0; i < 0x40;i+=4) {
    //   console.log(hex(data.getInt32(i) >>> 0))
    // }

    var textSegmentOffset = data.getInt32(0x18);
    var fileContentLength = data.getInt32(0x1C);
    for (var i = 0; i < fileContentLength; ++i) {
      map8[(textSegmentOffset & 0x001fffff) >>> 0] = view8[(0x800 + i) >>> 0];
      // map.setInt8(textSegmentOffset & 0x1FFFFF, data.getInt8(0x800 + i));
      textSegmentOffset++;
    }
    // psx.addEvent(44100*768*60, (self, clock) => {
    //   running = false;
    //   spu.silence();
    //   throw 'stoped';
    // });
    running = true;
  }
  else if (data[0] === 0xffffff00) { // ISO
    // audo build TOC (sad attempt to not need .cue files)
    let loc = 0;
    let lastLoc = data.length / (2352 / 4);
    let type = 0; // data
    let tracks = [];

    // console.log(`TRACK #0: 0 - ${lastLoc}`);
    tracks.push({id: 0, begin:0, end:lastLoc});
    const sectorLength = 2352;
    function isDataSector(startLoc) {
      let mask1 = data.getInt32(startLoc * sectorLength + 0) >>> 0;
      let mask2 = data.getInt32(startLoc * sectorLength + 4) >>> 0;
      let mask3 = data.getInt32(startLoc * sectorLength + 8) >>> 0;
      return (mask1 === 0xffffff00 && mask2 === 0xffffffff&& mask3 === 0x00ffffff);
    }

    function isEmptySector(startLoc) {
      let mask = 0;
      for (let i = 0; i < sectorLength; i += 4) {
        mask |= data.getInt32(startLoc * sectorLength + i);
      }
      return (mask >>> 0) === (0x00000000 >>> 0);
    }

    let begin, end, lead, track = 0;

    let i = 0;
    begin = i;
    while ((i < lastLoc) && isDataSector(i)) ++i;
    end = i;
    while ((i < lastLoc) && isEmptySector(i)) ++i;
    // console.log(`TRACK #${++track}: ${begin} - ${end}`);
    tracks.push({id: 1, begin, end,data:true});
 
    let id = 2;
    if (i < lastLoc) {
      begin = i;
      while (i < lastLoc) {
        while ((i < lastLoc) && !isEmptySector(i)) ++i;
        end = i;
        while ((i < lastLoc) && isEmptySector(i)) ++i;
        lead = i;
        if ((lead-end) < 75) continue;
        // console.log(`TRACK #${++track}: ${begin} - ${end}: ${end-begin}: ${lead-end}`);
        tracks.push({id, begin, end, audio:true});
        begin = i;
        id++;
      }
      if (begin < lastLoc) {
        end = lead = lastLoc
        // console.log(`TRACK #${++track}: ${begin} - ${end}: ${end-begin}: ${lead-end}`);
        tracks.push({id, begin, end, audio:true});
      }
    }
    cdr.setTOC(tracks);

    cdr.hasCdFile = true;
    cdr.cdImage = data;
    running = true;
  }
  else if (data[0] === 0x0000434d) { // MEMCARD
    console.log('loaded MEMCARD');
    var copy = new Uint8Array(arrayBuffer);
    let card = joy.devices ? joy.devices[0].data : joy.cardOneMemory;
    for (var i = 0; i < copy.length; ++i) {
      card[i] = copy[i];
    }
  }
  else if (arrayBuffer.byteLength === 524288) {
    const base64text = Base64.encode(arrayBuffer);
    localStorage.setItem('bios', base64text);
    for (var i = 0; i < 0x00080000; i += 4) {
      map[(0x01c00000 + i) >>> 2] = data[i >>> 2];
      // map[(0x01c00000 + i) >>> 2] = data.getInt32(i);
      // map.setInt32(0x01c00000 + i, data.getInt32(i));
    }
    bios();
    let header = document.querySelector('span.nobios');
    if (header) {
      header.classList.remove('nobios');
    }
  }
  else {
    abort('Unsupported fileformat');
  }
  loading --;
}

function handleFileSelect(evt) {
  evt.stopPropagation();
  evt.preventDefault();

  const fileList = evt.dataTransfer?.files || evt.target.files;

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
  document.getElementById('file').addEventListener('change', handleFileSelect, false);

  mainLoop(performance.now());

  renderer = new WebGLRenderer(canvas);

  window.addEventListener("dblclick", function(e) {
    running = !running;
    if (!running) {
      spu.silence();
    }
  });

  window.addEventListener("keydown", function(e) {
    if (e.keyCode === 69) { /*  [^]  */ joy.devices[0].hi &= ~0x10; return; }
    if (e.keyCode === 68) { /*  [O]  */ joy.devices[0].hi &= ~0x20; return; }
    if (e.keyCode === 88) { /*  [X]  */ joy.devices[0].hi &= ~0x40; return; }
    if (e.keyCode === 83) { /*  [#]  */ joy.devices[0].hi &= ~0x80; return; }

    if (e.keyCode === 81) { /*  [L2] */ joy.devices[0].hi &= ~0x01; return; }
    if (e.keyCode === 84) { /*  [R2] */ joy.devices[0].hi &= ~0x02; return; }
    if (e.keyCode === 87) { /*  [L1] */ joy.devices[0].hi &= ~0x04; return; }
    if (e.keyCode === 82) { /*  [R1] */ joy.devices[0].hi &= ~0x08; return; }

    if (e.keyCode === 38) { /*  [u]  */ joy.devices[0].lo &= ~0x10; return; }
    if (e.keyCode === 39) { /*  [r]  */ joy.devices[0].lo &= ~0x20; return; }
    if (e.keyCode === 40) { /*  [d]  */ joy.devices[0].lo &= ~0x40; return; }
    if (e.keyCode === 37) { /*  [l]  */ joy.devices[0].lo &= ~0x80; return; }

    if (e.keyCode === 32) { /*  sel  */ joy.devices[0].lo &= ~0x01; return; }
    if (e.keyCode === 13) { /* start */ joy.devices[0].lo &= ~0x08; return; }
    if (e.keyCode === 122) return; //f11
    if (e.keyCode === 123) return; //f12
    if (e.keyCode === 116) return; //f5
    e.preventDefault();
  }, false);

  window.addEventListener("keyup", function(e) {
    if (e.keyCode === 69) { /*  [^]  */ joy.devices[0].hi |= 0x10; }
    if (e.keyCode === 68) { /*  [O]  */ joy.devices[0].hi |= 0x20; }
    if (e.keyCode === 88) { /*  [X]  */ joy.devices[0].hi |= 0x40; }
    if (e.keyCode === 83) { /*  [#]  */ joy.devices[0].hi |= 0x80; }

    if (e.keyCode === 81) { /*  [L2] */ joy.devices[0].hi |= 0x01; }
    if (e.keyCode === 84) { /*  [R2] */ joy.devices[0].hi |= 0x02; }
    if (e.keyCode === 87) { /*  [L1] */ joy.devices[0].hi |= 0x04; }
    if (e.keyCode === 82) { /*  [R1] */ joy.devices[0].hi |= 0x08; }

    if (e.keyCode === 38) { /*  [u]  */ joy.devices[0].lo |= 0x10; }
    if (e.keyCode === 39) { /*  [r]  */ joy.devices[0].lo |= 0x20; }
    if (e.keyCode === 40) { /*  [d]  */ joy.devices[0].lo |= 0x40; }
    if (e.keyCode === 37) { /*  [l]  */ joy.devices[0].lo |= 0x80; }

    if (e.keyCode === 32) { /*  sel  */ joy.devices[0].lo |= 0x01; }
    if (e.keyCode === 13) { /* start */ joy.devices[0].lo |= 0x08; }

    if (e.keyCode === 122) return;
    if (e.keyCode === 123) return; //f12
    if (e.keyCode === 116) return; //f5

    if (e.key === 'F1' && e.ctrlKey) renderer.setMode('disp');
    if (e.key === 'F2' && e.ctrlKey) renderer.setMode('vram');

    e.preventDefault();
  }, false);

  readStorageStream('bios', data => {
    if (data) {
      let data32 = new Uint32Array(data);
      for (var i = 0; i < 0x80000; i+=4) {
        map[(0x01c00000 + i) >>> 2] = data32[i >>> 2];
        // map.setInt32(0x01c00000 + i, data32[i>>2]);
      }
      let header = document.querySelector('span.nobios');
      if (header) {
        header.classList.remove('nobios');
      }
      bios();
    }
  });
}

var line = ''
var lastLine = null;

function trace(pc, val) {
  const gpr = cpu.gpr;

  switch (pc) {
    case 0xa0:
      switch (val) {
        default:    //log(`$${hex(pc, 2)}: $${hex(val, 3)}`);
                    break;
      }
      break;
    case 0xb0:
      switch (val) {
        case 0x16:  break; // OutdatedPadGetButtons()
        case 0x17:  break; // ReturnFromException()
        case 0x3d:  line += String.fromCharCode(gpr[4])
                    if (gpr[4] === 10 || gpr[4] === 13) {
                      if (line !== lastLine) {
                        console.debug(line);
                        lastLine = line;
                      }
                      line = '';
                    }
                    break;
        case 0x4f:  log(`read_card_sector($${hex(gpr[4])}, $${hex(gpr[5])}, $${hex(gpr[6])})`);
                    break;
        default:    //log(`$${hex(pc, 2)}: $${hex(val, 3)}`);
                    break;
      }
      break;
    case 0xc0:
      switch (val) {
        default:    //log(`$${hex(pc, 2)}: $${hex(val, 3)}`);
                    break;
      }
      break;
  }
}