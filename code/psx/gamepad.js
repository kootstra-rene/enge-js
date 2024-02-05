mdlr('enge:psx:gamepad', m => {

  let controller = null;
  let joypad = null;
  const keyboard = new Map();

  const setController = (type) => {
    if (controller === type) return;
    controller = type;

    const elem = document.getElementById('gamepad');
    if (elem) {
      elem.classList.remove(...elem.classList);
      elem.classList.add('connected');
      elem.classList.add(type);
    }
  }

  const buttonPressed = (b) => b.pressed;

  const enge_gamepad_update = () => {
    if (!joypad) return;

    const pad = navigator.getGamepads()[joypad.index];
    if (pad) {
      const device = joy.devices[0];
      const {axes, buttons} = pad;
      setController('gamepad');

      let lo = 0xff;
      if (axes[0] <= -0.4) { lo &= ~0x80 } // left
      if (axes[0] >= 0.4) { lo &= ~0x20 } // right
      if (axes[1] <= -0.4) { lo &= ~0x10 } // up
      if (axes[1] >= 0.4) { lo &= ~0x40 } // down

      if (buttonPressed(buttons[14])) { lo &= ~0x80 } // left
      if (buttonPressed(buttons[15])) { lo &= ~0x20 } // right
      if (buttonPressed(buttons[12])) { lo &= ~0x10 } // up
      if (buttonPressed(buttons[13])) { lo &= ~0x40 } // down

      if (buttonPressed(buttons[8])) { lo &= ~0x01 } // select
      if (buttonPressed(buttons[9])) { lo &= ~0x08 } // start
      device.lo = lo;

      let hi = 0xff;
      if (buttonPressed(buttons[3])) { hi &= ~0x10 } // triangle
      if (buttonPressed(buttons[1])) { hi &= ~0x20 } // circle
      if (buttonPressed(buttons[0])) { hi &= ~0x40 } // cross
      if (buttonPressed(buttons[2])) { hi &= ~0x80 } // square

      if (buttonPressed(buttons[4])) { hi &= ~0x04 } // l1
      if (buttonPressed(buttons[6])) { hi &= ~0x01 } // l2
      if (buttonPressed(buttons[5])) { hi &= ~0x08 } // r1
      if (buttonPressed(buttons[7])) { hi &= ~0x02 } // r2
      device.hi = hi;
    }
  }

  // Thanks zaykho(https://github.com/zaykho) for helping to add this feature. 
  // refactored the code to be slightly simpler and more inline with the rest


  // default keyboard mapping
  keyboard.set(69, { bits: 0x10, property: 'hi' }); /*  [^]  */
  keyboard.set(68, { bits: 0x20, property: 'hi' }); /*  [O]  */
  keyboard.set(88, { bits: 0x40, property: 'hi' }); /*  [X]  */
  keyboard.set(83, { bits: 0x80, property: 'hi' }); /*  [#]  */

  keyboard.set(81, { bits: 0x01, property: 'hi' }); /*  [L2]  */
  keyboard.set(84, { bits: 0x02, property: 'hi' }); /*  [R2]  */
  keyboard.set(87, { bits: 0x04, property: 'hi' }); /*  [L1]  */
  keyboard.set(82, { bits: 0x08, property: 'hi' }); /*  [R1]  */

  keyboard.set(38, { bits: 0x10, property: 'lo' }); /*  [u]  */
  keyboard.set(39, { bits: 0x20, property: 'lo' }); /*  [r]  */
  keyboard.set(40, { bits: 0x40, property: 'lo' }); /*  [d]  */
  keyboard.set(37, { bits: 0x80, property: 'lo' }); /*  [l]  */

  keyboard.set(32, { bits: 0x01, property: 'lo' }); /* [sel] */
  keyboard.set(13, { bits: 0x08, property: 'lo' }); /*[start]*/

  window.addEventListener("keydown", (e) => {
    const mapping = keyboard.get(e.keyCode);
    const device = joy.devices[0];

    if (mapping !== undefined) {
      device[mapping.property] &= ~mapping.bits;
      setController('keyboard');
    }
  }, false);

  window.addEventListener("keyup", (e) => {
    const mapping = keyboard.get(e.keyCode);
    const device = joy.devices[0];

    if (mapping !== undefined) {
      device[mapping.property] |= mapping.bits;
    }
  }, false);

  window.addEventListener("gamepadconnected", (e) => {
    joypad = e.gamepad;
    document.getElementById('gamepad').classList.add('connected')
  });

  window.addEventListener("gamepaddisconnected", (e) => {
    document.getElementById('gamepad').classList.remove('connected')
    joypad = null;
  });

  return {
    handleGamePads: enge_gamepad_update
  }
})