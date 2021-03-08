const handleGamePads = (() => {

  // Thanks zaykho(https://github.com/zaykho) for helping to add this feature. 
  // refactored the code to be slightly simpler and more inline with the rest

  let joypad = null;

  window.addEventListener("gamepadconnected", function(e) {
    joypad = e.gamepad;
    console.log(`~~ Gamepad '${joypad.id}' connected  ~~`);
    document.getElementById('gamepad').classList.add('connected')
  });

  window.addEventListener("gamepaddisconnected", function(e) {
    console.log(`~~ Gamepad '${joypad.id}' disconnected  ~~`);
    document.getElementById('gamepad').classList.remove('connected')
    joypad = null;
  });

  function enge_gamepad_update() {
    if (!joypad) return;

    const pad = navigator.getGamepads()[joypad.index];
    if (pad) {
      const device = joy.devices[0];

      device.lo = 0xff;
      if (pad.axes[0] === -1) { device.lo &= ~0x80 } // left
      if (pad.axes[0] ===  1) { device.lo &= ~0x20 } // right
      if (pad.axes[1] === -1) { device.lo &= ~0x10 } // up
      if (pad.axes[1] ===  1) { device.lo &= ~0x40 } // down

      if (pad.buttons[14].pressed) { device.lo &= ~0x80 } // left
      if (pad.buttons[15].pressed) { device.lo &= ~0x20 } // right
      if (pad.buttons[12].pressed) { device.lo &= ~0x10 } // up
      if (pad.buttons[13].pressed) { device.lo &= ~0x40 } // down

      if (pad.buttons[8].pressed) { device.lo &= ~0x01 } // select
      if (pad.buttons[9].pressed) { device.lo &= ~0x08 } // start

      device.hi = 0xff;
      if (pad.buttons[3].pressed) { device.hi &= ~0x10 } // triangle
      if (pad.buttons[1].pressed) { device.hi &= ~0x20 } // circle
      if (pad.buttons[0].pressed) { device.hi &= ~0x40 } // cross
      if (pad.buttons[2].pressed) { device.hi &= ~0x80 } // square

      if (pad.buttons[6].pressed) { device.hi &= ~0x04 } // l1
      if (pad.buttons[7].pressed) { device.hi &= ~0x01 } // l2
      if (pad.buttons[5].pressed) { device.hi &= ~0x08 } // r1
      if (pad.buttons[4].pressed) { device.hi &= ~0x02 } // r2
    }
  }

  return enge_gamepad_update;
})();