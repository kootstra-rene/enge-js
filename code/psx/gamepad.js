mdlr('enge:psx:gamepad', m => {

  let controller = null;
  const joypads = [null, null];
  const keyboard = new Map();
  const virtual = { lo: 0xff, hi: 0xff };
  const keyboardState = { lo: 0xff, hi: 0xff };
  const debugPad = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug-pad') === '1';
  const debugInput = (...args) => {
    if (debugPad) console.log('[PAD]', ...args);
  };

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

  const buttonPressed = (b) => !!b?.pressed;

  const updateDevice = (pad, device) => {
    if (!device) return;

    const {axes = [], buttons = []} = pad || {};
    const axis = (index) => axes[index] || 0;

    let lo = virtual.lo & keyboardState.lo;
    if (axis(0) <= -0.4) { lo &= ~0x80 } // left
    if (axis(0) >= 0.4) { lo &= ~0x20 } // right
    if (axis(1) <= -0.4) { lo &= ~0x10 } // up
    if (axis(1) >= 0.4) { lo &= ~0x40 } // down

    if (buttonPressed(buttons[14])) { lo &= ~0x80 } // left
    if (buttonPressed(buttons[15])) { lo &= ~0x20 } // right
    if (buttonPressed(buttons[12])) { lo &= ~0x10 } // up
    if (buttonPressed(buttons[13])) { lo &= ~0x40 } // down

    if (buttonPressed(buttons[8])) { lo &= ~0x01 } // select
    if (buttonPressed(buttons[9])) { lo &= ~0x08 } // start
    device.lo = lo;

    let hi = virtual.hi & keyboardState.hi;
    if (buttonPressed(buttons[3])) { hi &= ~0x10 } // triangle
    if (buttonPressed(buttons[1])) { hi &= ~0x20 } // circle
    if (buttonPressed(buttons[0])) { hi &= ~0x40 } // cross
    if (buttonPressed(buttons[2])) { hi &= ~0x80 } // square

    if (buttonPressed(buttons[4])) { hi &= ~0x04 } // l1
    if (buttonPressed(buttons[6])) { hi &= ~0x01 } // l2
    if (buttonPressed(buttons[5])) { hi &= ~0x08 } // r1
    if (buttonPressed(buttons[7])) { hi &= ~0x02 } // r2
    device.hi = hi;
  };

  const releaseDevice = (device) => {
    if (device) {
      device.lo = 0xff;
      device.hi = 0xff;
    }
  };

  const setVirtualButton = (property, bit, pressed) => {
    if (pressed) virtual[property] &= ~bit;
    else virtual[property] |= bit;
  };

  window.engeSetVirtualButton = setVirtualButton;

  const virtualPointers = new Map();
  const virtualButtons = new Map();
  const releaseVirtualPointer = event => {
    const pointerId = event.pointerId;
    if (pointerId == null) return;
    const key = virtualPointers.get(pointerId);
    if (!key) return;
    virtualPointers.delete(pointerId);
    const stillPressed = [...virtualPointers.values()].includes(key);
    if (!stillPressed) {
      const [property, bit] = key.split(':');
      setVirtualButton(property, Number(bit), false);
      virtualButtons.get(key)?.classList.remove('is-pressed');
    }
  };

  document.querySelectorAll('[data-virtual-property]').forEach(button => {
    const property = button.dataset.virtualProperty;
    const bit = Number(button.dataset.virtualBit);
    const key = `${property}:${bit}`;
    virtualButtons.set(key, button);
    const release = event => {
      event.preventDefault();
      event.stopPropagation();
      releaseVirtualPointer(event);
    };
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      releaseVirtualPointer(event);
      virtualPointers.set(event.pointerId, key);
      setVirtualButton(property, bit, true);
      button.classList.add('is-pressed');
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', event => {
      if (event.pointerType === 'mouse') release(event);
    });
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
    });
  });
  window.addEventListener('pointerup', releaseVirtualPointer);
  window.addEventListener('pointercancel', releaseVirtualPointer);
  window.addEventListener('blur', () => {
    virtualPointers.clear();
    for (const button of document.querySelectorAll('[data-virtual-property]')) {
      setVirtualButton(button.dataset.virtualProperty, Number(button.dataset.virtualBit), false);
      button.classList.remove('is-pressed');
    }
  });

  const stick = document.querySelector('[data-virtual-stick]');
  const stickKnob = stick?.querySelector('.touch-stick-knob');
  let stickPointerId = null;
  const stickBits = { up: 16, down: 64, left: 128, right: 32 };

  const clearVirtualStick = () => {
    if (stickKnob) stickKnob.style.transform = 'translate(0, 0)';
    for (const bit of Object.values(stickBits)) setVirtualButton('lo', bit, false);
  };

  const updateVirtualStick = event => {
    if (!stick || !stickKnob) return;
    const bounds = stick.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const radius = Math.min(bounds.width, bounds.height) * 0.36;
    let x = event.clientX - centerX;
    let y = event.clientY - centerY;
    const distance = Math.hypot(x, y);
    if (distance > radius) {
      x = x / distance * radius;
      y = y / distance * radius;
    }
    stickKnob.style.transform = `translate(${x}px, ${y}px)`;

    for (const bit of Object.values(stickBits)) setVirtualButton('lo', bit, false);
    if (distance < radius * 0.25) return;
    if (Math.abs(x) >= Math.abs(y)) {
      setVirtualButton('lo', x < 0 ? stickBits.left : stickBits.right, true);
    }
    else {
      setVirtualButton('lo', y < 0 ? stickBits.up : stickBits.down, true);
    }
  };

  const releaseVirtualStick = event => {
    if (stickPointerId !== null && event.pointerId != null && event.pointerId !== stickPointerId) return;
    stickPointerId = null;
    clearVirtualStick();
  };

  stick?.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    stickPointerId = event.pointerId;
    stick.setPointerCapture?.(event.pointerId);
    updateVirtualStick(event);
  });
  stick?.addEventListener('pointermove', event => {
    if (event.pointerId === stickPointerId) updateVirtualStick(event);
  });
  stick?.addEventListener('pointerup', releaseVirtualStick);
  stick?.addEventListener('pointercancel', releaseVirtualStick);
  stick?.addEventListener('lostpointercapture', releaseVirtualStick);
  window.addEventListener('pointerup', releaseVirtualStick);
  window.addEventListener('pointercancel', releaseVirtualStick);
  window.addEventListener('touchend', releaseVirtualStick, {passive: false});
  window.addEventListener('touchcancel', releaseVirtualStick, {passive: false});
  window.addEventListener('blur', releaseVirtualStick);

  const enge_gamepad_update = () => {
    if (!navigator.getGamepads) return;

    const pads = navigator.getGamepads();
    for (let index = 0; index < joypads.length; ++index) {
      if (!joypads[index] && pads[index]) joypads[index] = pads[index];
    }
    const usedPadIndices = new Set();
    for (let index = 0; index < joypads.length; ++index) {
      const pad = joypads[index] && pads[joypads[index].index];
      if (pad && usedPadIndices.has(pad.index)) {
        joypads[index] = null;
        releaseDevice(joy.devices[index]);
        continue;
      }
      if (pad) {
        usedPadIndices.add(pad.index);
        updateDevice(pad, joy.devices[index]);
        setController('gamepad');
      }
      else if (index === 0) {
        // Keep virtual and keyboard releases flowing to controller 1.
        updateDevice(null, joy.devices[index]);
      }
      else if (index === 1) {
        releaseDevice(joy.devices[index]);
      }
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

  const keyboardCodes = new Map([
    ['KeyE', 69], ['KeyD', 68], ['KeyX', 88], ['KeyS', 83],
    ['KeyQ', 81], ['KeyT', 84], ['KeyW', 87], ['KeyR', 82],
    ['ArrowUp', 38], ['ArrowRight', 39], ['ArrowDown', 40], ['ArrowLeft', 37],
    ['Space', 32], ['Enter', 13]
  ]);

  const getKeyboardMapping = event =>
    keyboard.get(event.keyCode) || keyboard.get(keyboardCodes.get(event.code));

  window.addEventListener("keydown", (e) => {
    const mapping = getKeyboardMapping(e);
    const device = joy.devices[0];

    if (mapping !== undefined) {
      e.preventDefault();
      keyboardState[mapping.property] &= ~mapping.bits;
      device[mapping.property] &= ~mapping.bits;
      debugInput('keydown', { key: e.key, code: e.code, property: mapping.property, bits: `0x${mapping.bits.toString(16)}`, lo: device.lo, hi: device.hi });
      setController('keyboard');
    }
  }, false);

  window.addEventListener("keyup", (e) => {
    const mapping = getKeyboardMapping(e);
    const device = joy.devices[0];

    if (mapping !== undefined) {
      e.preventDefault();
      keyboardState[mapping.property] |= mapping.bits;
      device[mapping.property] |= mapping.bits;
      debugInput('keyup', { key: e.key, code: e.code, property: mapping.property, bits: `0x${mapping.bits.toString(16)}`, lo: device.lo, hi: device.hi });
    }
  }, false);

  window.addEventListener("gamepadconnected", (e) => {
    const index = e.gamepad.index < joypads.length
      ? e.gamepad.index
      : joypads.findIndex(pad => !pad);
    if (index >= 0) joypads[index] = e.gamepad;
    document.getElementById('gamepad')?.classList.add('connected')
  });

  window.addEventListener("gamepaddisconnected", (e) => {
    const index = joypads.findIndex(pad => pad?.index === e.gamepad.index);
    if (index >= 0) {
      joypads[index] = null;
      releaseDevice(joy.devices[index]);
    }
    if (!joypads.some(Boolean)) {
      document.getElementById('gamepad')?.classList.remove('connected');
    }
  });

  return {
    handleGamePads: enge_gamepad_update
  }
})
