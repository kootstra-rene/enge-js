(scope => {

	'use strict';

	let controller = null;
	let joypad = null;
	const keyboard = new Map();

	function setController(type) {
		if (controller === type) return;
		controller = type;

		const elem = document.getElementById('gamepad');

		elem.classList.remove(...elem.classList);
		elem.classList.add('connected');
		elem.classList.add(type);
	}

	function enge_gamepad_update() {
		if (!joypad) return;

		const pad = navigator.getGamepads()[joypad.index];
		if (pad) {
			const device = joy.devices[0];
			setController('gamepad');

			device.lo = 0xff;
			if (pad.axes[0] <= -0.4) { device.lo &= ~0x80 } // left
			if (pad.axes[0] >= 0.4) { device.lo &= ~0x20 } // right
			if (pad.axes[1] <= -0.4) { device.lo &= ~0x10 } // up
			if (pad.axes[1] >= 0.4) { device.lo &= ~0x40 } // down

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

			if (pad.buttons[4].pressed) { device.hi &= ~0x04 } // l1
			if (pad.buttons[6].pressed) { device.hi &= ~0x01 } // l2
			if (pad.buttons[5].pressed) { device.hi &= ~0x08 } // r1
			if (pad.buttons[7].pressed) { device.hi &= ~0x02 } // r2
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

	window.addEventListener("keydown", function (e) {
		const mapping = keyboard.get(e.keyCode);
		const device = joy.devices[0];

		if (mapping !== undefined) {
			device[mapping.property] &= ~mapping.bits;
			setController('keyboard');
		}
	}, false);

	window.addEventListener("keyup", function (e) {
		const mapping = keyboard.get(e.keyCode);
		const device = joy.devices[0];

		if (mapping !== undefined) {
			device[mapping.property] |= mapping.bits;
		}
	}, false);

	window.addEventListener("gamepadconnected", function (e) {
		joypad = e.gamepad;
		console.log(`~~ Gamepad '${joypad.id}' connected  ~~`);
		document.getElementById('gamepad').classList.add('connected')
	});

	window.addEventListener("gamepaddisconnected", function (e) {
		console.log(`~~ Gamepad '${joypad.id}' disconnected  ~~`);
		document.getElementById('gamepad').classList.remove('connected')
		joypad = null;
	});

	scope.handleGamePads = enge_gamepad_update;

})(window);