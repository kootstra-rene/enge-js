mdlr('enge:psx:core', m => {

  let lastId = 0;

  const events = [];
  const inactiveEvents = [];

  const psx = {
    clock: 0.0,
    eventClock: 0.0,
  }

  psx.addEvent = (clocks, cb) => {
    const event = {
      id: ++lastId,
      active: true,
      clock: +psx.clock + +clocks,
      start: +psx.clock,
      cb
    };

    if (psx.eventClock > event.clock) {
      psx.eventClock = event.clock;
    }
    events.push(event);
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

    const index = events.findIndex(a => a.id === event.id);
    if (index !== -1) {
      inactiveEvents.push(event);
      events.splice(index, 1);
      event.active = false;
    }

    return event;
  }

  psx.eventCycles = (event) => {
    return +psx.clock - event.start;
  }

  psx.setEvent = (event, clocks) => {
    if (!event.active) {
      const index = inactiveEvents.findIndex(a => a.id === event.id);
      if (index !== -1) {
        inactiveEvents.splice(index, 1);
        events.push(event);
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

    for (let event of events) {
      if (!event.active) continue;

      if (psx.clock >= event.clock) {
        event.cb(event, psx.clock);
      }
      if (event.clock < eventClock) {
        eventClock = event.clock;
      }
    };

    psx.eventClock = eventClock;

    return cpuInterrupt(entry);
  }

  return { psx };
})