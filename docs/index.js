'use strict';

var running = false;
var originalSpeed = true;
var realtimeStart = 0;
var samplesStart = 0;
var loading = 0;
var renderer = undefined;
var canvas = undefined;
var emulationTime = 0.0;
var pads = undefined;
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

window.addEventListener("gamepadconnected", function(e) {
  var gp = e.gamepad;
  console.log(e);
  console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.",
  gp.index, gp.id,
  gp.buttons.length, gp.axes.length);
});

window.addEventListener("gamepaddisconnected", function(e) {
  pads = undefined;
  console.log("Gamepad disconnected");
});

var gamepad = function() {return;
  pads = navigator.getGamepads()[0];
  if (pads !== undefined) {
    var pad = pads;
    // if (pad === undefined) return;

    joy.pad0lo = 0xff;
    if (pad.axes[0] <= -0.5) { joy.pad0lo &= ~0x80 } // left
    if (pad.axes[0] >= +0.5) { joy.pad0lo &= ~0x20 } // right
    if (pad.axes[1] <= -0.5) { joy.pad0lo &= ~0x10 } // up
    if (pad.axes[1] >= +0.5) { joy.pad0lo &= ~0x40 } // down

    if (pad.buttons[8].pressed) { joy.pad0lo &= ~0x01 } // select
    if (pad.buttons[9].pressed) { joy.pad0lo &= ~0x08 } // start
    if (joy.pad0lo !== 255) console.log(joy.pad0lo)

    joy.pad0hi = 0xff;
    if (pad.buttons[0].pressed) { joy.pad0hi  &= ~0x10 } // triangle
    if (pad.buttons[1].pressed) { joy.pad0hi &= ~0x20 } // circle
    if (pad.buttons[2].pressed) { joy.pad0hi &= ~0x40 } // cross
    if (pad.buttons[3].pressed) { joy.pad0hi &= ~0x80 } // square

    if (pad.buttons[4].pressed) { joy.pad0hi &= ~0x04 } // l1
    if (pad.buttons[6].pressed) { joy.pad0hi &= ~0x01 } // l2
    if (pad.buttons[5].pressed) { joy.pad0hi &= ~0x08 } // r1
    if (pad.buttons[7].pressed) { joy.pad0hi &= ~0x02 } // r2
    if (joy.pad0hi !== 255) console.log(joy.pad0hi)

  }
}

var abort = function() {
  console.error(Array.prototype.slice.call(arguments).join(' '));
  canvas.style.borderColor = 'red';
  running = false;
  spu.silence();
  throw 'abort';
}

document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === 'visible') {
    document.title = 'active';
  } else {
    document.title = 'paused';
    running = false;
    spu.silence();
  }
});

var context = window.context= {
  timeStamp: 0,
  realtime: 0,
  emutime: 0
};

function mainLoop(stamp) {
  window.requestAnimationFrame(mainLoop);
  const delta = stamp - context.timeStamp;
  context.timeStamp = stamp;
  if (!running || delta > 50) return;

  context.realtime += delta;

  let diffTime = context.emutime - context.realtime;
  let timeToEmulate = 10.0 - diffTime;

  if (timeToEmulate > 50.0) {
   console.debug(timeToEmulate);
   timeToEmulate = 50.0;
  }
  
  let totalCycles = timeToEmulate * (768*44.100);
  let block = 0;
  const mmu = map;
  while (totalCycles > 0) {
    let pc = cpu.pc & 0x01ffffff;
    let lutIndex = (pc < 0x800000) ?  (pc & 0x1fffff) >>> 2 : pc >>> 2;

    let dynamic = cache[lutIndex];
    if (null === dynamic) {
      dynamic = compileBlock(cpu.pc);
      cache[lutIndex] = dynamic;
    }

    let cycles = dynamic(mmu, cpu, gte);
    totalCycles -= cycles;
    block += cycles;

    while (block >= CYCLES_PER_BLOCK) {
      // statsCycles -= CYCLES_PER_BLOCK;
      // if (statsCycles <= 0) {
      //   statsCycles += 33868800;
      //   console.debug('stats');
      //   console.debug(`- #fps: ${(gpu.frame / (cpu.totalCycles / 33868800)).toFixed(2)}`);
      //   console.debug(`- #ints: ${statInts}`);
      //   statInts = 0;
      // }
      cpu.totalCycles += CYCLES_PER_BLOCK;
      block -= CYCLES_PER_BLOCK;
      update(CYCLES_PER_BLOCK);
    }

    //- do interrupts here incase after an rfe interrupts are still inpending
    statInts += cpuInterrupt() ? 1 : 0;
  }

  context.emutime += timeToEmulate;
}

function bios() {
  running = false;
  cpu.pc = 0xbfc00000;

  while ((cpu.pc|0) !== (0x80030000|0)) {
    var block = recompile(cpu.pc);
    block(map, cpu, gte);
    if (cpu.cycles >= 33868800) {
      abort('takes too long');
    }
  }
  setTimeout(() => {audioCtx.resume()}, 500);
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

var loadFileData = function(arrayBuffer) {

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

  if ((data[0] & 0xffff) === 0x5350) { // PS
    cpu.pc = data.getInt32(0x10);
    cpu.gpr[28] = data.getInt32(0x14);
    cpu.gpr[29] = data.getInt32(0x30);
    cpu.gpr[30] = data.getInt32(0x30);
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
    var fileContentLength = data.getInt32(0x1C);
    for (var i = 0; i < fileContentLength; ++i) {
      map.setInt8(textSegmentOffset & 0x1FFFFF, data.getInt8(0x800 + i));
      textSegmentOffset++;
    }
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
      map.setInt32(0x01c00000 + i, data.getInt32(i));
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

  var fileList = evt.dataTransfer.files;

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

  mainLoop(performance.now());

  renderer = new WebGLRenderer(canvas);

  window.addEventListener("dblclick", function(e) {
    running = !running;
    if (!running) {
      spu.silence();
    }
  });

  if (!joy.devices) {
    window.addEventListener("keydown", function(e) {
      if (e.keyCode === 69) { /*  [^]  */ joy.pad0hi &= ~0x10; return; }
      if (e.keyCode === 68) { /*  [O]  */ joy.pad0hi &= ~0x20; return; }
      if (e.keyCode === 88) { /*  [X]  */ joy.pad0hi &= ~0x40; return; }
      if (e.keyCode === 83) { /*  [#]  */ joy.pad0hi &= ~0x80; return; }

      if (e.keyCode === 81) { /*  [L2] */ joy.pad0hi &= ~0x01; return; }
      if (e.keyCode === 84) { /*  [R2] */ joy.pad0hi &= ~0x02; return; }
      if (e.keyCode === 87) { /*  [L1] */ joy.pad0hi &= ~0x04; return; }
      if (e.keyCode === 82) { /*  [R1] */ joy.pad0hi &= ~0x08; return; }

      if (e.keyCode === 38) { /*  [u]  */ joy.pad0lo &= ~0x10; return; }
      if (e.keyCode === 39) { /*  [r]  */ joy.pad0lo &= ~0x20; return; }
      if (e.keyCode === 40) { /*  [d]  */ joy.pad0lo &= ~0x40; return; }
      if (e.keyCode === 37) { /*  [l]  */ joy.pad0lo &= ~0x80; return; }

      if (e.keyCode === 32) { /*  sel  */ joy.pad0lo &= ~0x01; return; }
      if (e.keyCode === 13) { /* start */ joy.pad0lo &= ~0x08; return; }
      if (e.keyCode === 122) return; //f11
      if (e.keyCode === 123) return; //f12
      if (e.keyCode === 116) return; //f5

      e.preventDefault();
    }, false);

    window.addEventListener("keyup", function(e) {
      if (e.keyCode === 69) { /*  [^]  */ joy.pad0hi |= 0x10; return; }
      if (e.keyCode === 68) { /*  [O]  */ joy.pad0hi |= 0x20; return; }
      if (e.keyCode === 88) { /*  [X]  */ joy.pad0hi |= 0x40; return; }
      if (e.keyCode === 83) { /*  [#]  */ joy.pad0hi |= 0x80; return; }

      if (e.keyCode === 81) { /*  [L2] */ joy.pad0hi |= 0x01; return; }
      if (e.keyCode === 84) { /*  [R2] */ joy.pad0hi |= 0x02; return; }
      if (e.keyCode === 87) { /*  [L1] */ joy.pad0hi |= 0x04; return; }
      if (e.keyCode === 82) { /*  [R1] */ joy.pad0hi |= 0x08; return; }

      if (e.keyCode === 38) { /*  [u]  */ joy.pad0lo |= 0x10; return; }
      if (e.keyCode === 39) { /*  [r]  */ joy.pad0lo |= 0x20; return; }
      if (e.keyCode === 40) { /*  [d]  */ joy.pad0lo |= 0x40; return; }
      if (e.keyCode === 37) { /*  [l]  */ joy.pad0lo |= 0x80; return; }

      if (e.keyCode === 32) { /*  sel  */ joy.pad0lo |= 0x01; return; }
      if (e.keyCode === 13) { /* start */ joy.pad0lo |= 0x08; return; }

      if (e.keyCode === 122) return;
      if (e.keyCode === 123) return; //f12
      if (e.keyCode === 116) return; //f5
      e.preventDefault();
    }, false);
  }
  else {
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

      console.log(e)
      e.preventDefault();
    }, false);
  }

  readStorageStream('bios', data => {
    if (data) {
      let data32 = new Uint32Array(data);
      for (var i = 0; i < 0x80000; i+=4) {
        map.setInt32(0x01c00000 + i, data32[i>>2]);
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
                        console.warn(line);
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
