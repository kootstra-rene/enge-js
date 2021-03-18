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

let frameEvent = psx.addEvent(0, endMainLoop);
let endAnimationFrame = false;
function endMainLoop(self, clock) {
  endAnimationFrame = true;
  self.active = false;
}

let switches = 0;
function mainLoop(stamp) {
  window.requestAnimationFrame(mainLoop);
  const delta = stamp - context.timeStamp;
  context.timeStamp = stamp;
  if (!running || !hasFocus || delta > 200) return;

  context.realtime += delta;

  let diffTime = context.realtime - context.emutime;
  const timeToEmulate = diffTime;

  const totalCycles = timeToEmulate * (768*44.100);

  let entry = getCacheEntry(cpu.pc);
  if (!entry) return abort('invalid pc')

  endAnimationFrame = false;
  psx.setEvent(frameEvent, +totalCycles);
  handleGamePads();
  while (!endAnimationFrame) {
    if (!entry.code) {
      entry.code = compileBlock(entry);
    }
    entry = entry.code(psx);
    ++switches;
    // let next = entry.code(psx);
    // if (!next) debugger;
    // entry = next;
  }
  cpu.pc = entry.pc;

  // correct the emulation time accourding to the psx.clock
  context.emutime =  psx.clock / (768*44.100);
}

function bios() {
  running = false;

  let entry = getCacheEntry(0xbfc00000);
  const $ = psx;
  while (entry.pc !== 0x00030000) {
    if (!entry.code) {
      entry.code = compileBlock(entry);
    }
    entry = entry.code(psx);
    ++switches;
    // let next = entry.code(psx);
    // if (!next) debugger;
    // entry = next;
  }
  context.realtime = context.emutime =  psx.clock / (768*44.100);
  vector = getCacheEntry(0x80);
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
    cpu.gpr[29] = data.getInt32(0x30) ? data.getInt32(0x30) : 0x001ffff0;
    cpu.gpr[30] = data.getInt32(0x30) ? data.getInt32(0x30) : 0x001ffff0;
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

    var textSegmentOffset = data.getInt32(0x18);
    var fileContentLength = view8.length;
    for (var i = 0; i < fileContentLength; ++i) {
      map8[(textSegmentOffset & 0x001fffff) >>> 0] = view8[(0x800 + i) >>> 0];
      textSegmentOffset++;
    }

    clearCodeCache(data.getInt32(0x18), view8.length);
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
    cdr.setCdImage(data);
    cdr.setTOC(tracks);

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
    writeStorageStream('bios', arrayBuffer);
    for (var i = 0; i < 0x00080000; i += 4) {
      map[(0x01c00000 + i) >>> 2] = data[i >>> 2];
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

// default keyboard mapping
const keyboard = new Map();
keyboard.set(69, {bits: 0x10, property: 'hi'}); /*  [^]  */
keyboard.set(68, {bits: 0x20, property: 'hi'}); /*  [O]  */
keyboard.set(88, {bits: 0x40, property: 'hi'}); /*  [X]  */
keyboard.set(83, {bits: 0x80, property: 'hi'}); /*  [#]  */

keyboard.set(81, {bits: 0x01, property: 'hi'}); /*  [L2]  */
keyboard.set(84, {bits: 0x02, property: 'hi'}); /*  [R2]  */
keyboard.set(87, {bits: 0x04, property: 'hi'}); /*  [L1]  */
keyboard.set(82, {bits: 0x08, property: 'hi'}); /*  [R1]  */

keyboard.set(38, {bits: 0x10, property: 'lo'}); /*  [u]  */
keyboard.set(39, {bits: 0x20, property: 'lo'}); /*  [r]  */
keyboard.set(40, {bits: 0x40, property: 'lo'}); /*  [d]  */
keyboard.set(37, {bits: 0x80, property: 'lo'}); /*  [l]  */

keyboard.set(32, {bits: 0x01, property: 'lo'}); /* [sel] */
keyboard.set(13, {bits: 0x08, property: 'lo'}); /*[start]*/

function init() {

  canvas = document.getElementById('display');

  document.addEventListener('dragover', handleDragOver, false);
  document.addEventListener('drop', handleFileSelect, false);
  document.getElementById('file').addEventListener('change', handleFileSelect, false);

  settings.updateQuality();

  document.getElementById('quality').addEventListener('click', evt => {
    settings.updateQuality(true);

    evt.stopPropagation();
    evt.preventDefault();
    return false;
  });


  mainLoop(performance.now());

  renderer = new WebGLRenderer(canvas);

  canvas.addEventListener("dblclick", function(e) {
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

  window.addEventListener("keyup", function(e) {
    if (e.key === '1' && e.ctrlKey) renderer.setMode('disp');
    if (e.key === '2' && e.ctrlKey) renderer.setMode('draw');
    if (e.key === '3' && e.ctrlKey) renderer.setMode('clut8');
    if (e.key === '4' && e.ctrlKey) renderer.setMode('clut4');

    if (e.key === 'F12') return; // allow developer tools
    if (e.key === 'F11') return; // allow full screen
    if (e.key === 'F5') return; // allow page refresh
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
  readStorageStream('card1', data => {
    if (data) {
      let data8 = new Uint8Array(data);
      console.log('loading card1', data8.length);
      for (let i = 0; i < 128*1024; ++i) {
        joy.devices[0].data[i] = data8[i];
      }
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