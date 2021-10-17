(scope => {

	'use strict';

	const psx = {
		clock: 0.0,
		eventClock: 0.0,
		events: [],
		inactiveEvents: [],
		lastId: 0
	}

	psx.addEvent = (clocks, cb) => {
		const event = Object.seal({
			id: psx.lastId++,
			active: true,
			clock: +psx.clock + +clocks,
			start: +psx.clock,
			cb
		});

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
		if (!event.active) return;

		const index = psx.events.findIndex(a => a.id === event.id);
		if (index !== -1) {
			psx.inactiveEvents.push(event);
			psx.events.splice(index, 1);
			event.active = false;
		}

		return event;
	}

	psx.eventCycles = (event) => {
		return +psx.clock - event.start;
	}

	psx.setEvent = (event, clocks) => {
		if (!event.active) {
			const index = psx.inactiveEvents.findIndex(a => a.id === event.id);
			if (index !== -1) {
				psx.inactiveEvents.splice(index, 1);
				psx.events.push(event);
			}
		}

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

		const events = [];
		for (let i = 0, l = psx.events.length; i < l; ++i) {
			const event = psx.events[i];

			if (psx.clock >= event.clock) {
				events.push(event);
			}
		}

		for (let i = 0, l = events.length; i < l; ++i) {
			const event = events[i];

			event.cb(event, psx.clock);
		}

		for (let i = 0, l = psx.events.length; i < l; ++i) {
			const event = psx.events[i];
			if (event.clock < eventClock && event.active) {
				eventClock = event.clock;
			}
		}

		psx.eventClock = eventClock;

		return cpuInterrupt(entry);
	}

	scope.psx = Object.seal(psx);

})(window);