((scope) => {

    const psx = {
        clock: 0.0,
        eventClock: 0.0,
        events: [],
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
        let ticks = clocks * (PSX_SPEED / (768 * 44100));
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

    scope.psx = psx;

})(window);