mdlr('enge:psx:test-window', () => {

  // The window the modules read (location.search, localStorage, ...) for the
  // specs, in Node and in the browser alike. A browser's window and location
  // cannot be replaced or deleted (strict mode throws), so only what is
  // missing is added, and the query string is changed through history, which
  // does not navigate.
  //
  //   const restoreWindow = stubWindow({ location: { href: '', search: '' } });
  //   setSearch('?pgxp');   // before the module that reads it is included
  //   ...
  //   restoreWindow();      // removes what was added, puts the query string back

  const isBrowser = () => typeof history !== 'undefined' && typeof history.replaceState === 'function';

  const setSearch = (search) => {
    if (isBrowser()) history.replaceState(history.state, '', location.pathname + search + location.hash);
    else window.location.search = search;
  };

  const stubWindow = (stubs) => {
    const created = typeof window === 'undefined';
    if (created) globalThis.window = {};
    const added = Object.keys(stubs).filter(name => !window[name]);
    for (const name of added) window[name] = stubs[name];
    const search = window.location?.search;

    return () => {
      if (window.location && window.location.search !== search) setSearch(search);
      for (const name of added) delete window[name];
      if (created) delete globalThis.window;
    };
  };

  return { stubWindow, setSearch };
});
