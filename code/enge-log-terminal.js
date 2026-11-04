// A terminal window with what the emulator writes to the console. It collects from the moment
// this module loads, before the emulator does, so a window opened later still shows everything.
mdlr('[web]enge:log-terminal', ({ html, css, style }) => {

  const LINE_LIMIT = 2000;
  const LINE_LENGTH_LIMIT = 4000;
  const NO_LINES = [];

  const lines = [];
  let version = 0;

  const toText = (value) => {
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Error) {
      return value.stack?.includes(value.message) ? value.stack : `${value}\n${value.stack}`;
    }
    try {
      return (typeof value === 'object' && JSON.stringify(value)) || String(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  };

  const addLine = (level, args) => {
    const time = (performance.now() / 1000).toFixed(3).padStart(9);
    const text = args.map(toText).join(' ').slice(0, LINE_LENGTH_LIMIT);
    lines.push({ kind: `log-${level}`, text: `${time} ${level.padEnd(5)} ${text}` });
    if (lines.length > LINE_LIMIT) {
      lines.shift();
    }
    version++;
  };

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const write = console[level];
    console[level] = (...args) => {
      write.apply(console, args);
      addLine(level, args);
    };
  }
  window.addEventListener('error', (event) => addLine('error', [event.error ?? event.message]));
  window.addEventListener('unhandledrejection', (event) => addLine('error', ['Unhandled rejection:', event.reason]));

  html`
  {:self :key=version,open,following,copyLabel}
  <section class="terminal" aria-label="Log" hidden={!open}>
    <div class="terminal-heading">
      <h2>Log</h2>
      <button type="button" on{click=copy}>{copyLabel}</button>
      <button type="button" on{click=clear}>Clear</button>
      <button type="button" aria-label="Close log" on{click=close}>×</button>
    </div>
    <div{scroller} class={following ? 'terminal-scroller following' : 'terminal-scroller'} role="log" aria-label="Log output" tabindex="0" on{scroll=onScroll}>
      <div{content} class="terminal-lines">
        {#if shown.length === 0}
          <div class="terminal-empty">No log output yet</div>
        {/if}
        {#each line in shown :key=line}
          <div class={line.kind}>{line.text}</div>
        {/each}
      </div>
    </div>
  </section>
  `;

  css`
    .terminal {
      position: fixed;
      z-index: 5;
      right: 0;
      bottom: 0;
      left: var(--rail-width);
      height: var(--log-height);
      display: flex;
      flex-direction: column;
      background: #0c0c0f;
      border-top: 1px solid #2c2c34;
    }
    .terminal[hidden] { display: none; }
    .terminal-heading { display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.5rem; background: #17171c; }
    .terminal h2 { flex: 1; margin: 0; font-size: 0.8rem; font-weight: 600; color: #a8a8b4; }
    .terminal button {
      padding: 0.2rem 0.6rem;
      border: 0;
      border-radius: 0.35rem;
      background: none;
      color: #a8a8b4;
      font: 0.8rem system-ui, sans-serif;
      cursor: pointer;
    }
    .terminal button:hover { background: #26262e; color: #e6e6e6; }
    .terminal button:focus-visible, .terminal-scroller:focus-visible { outline: 2px solid #fa9a34; outline-offset: -2px; }
    .terminal-scroller { flex: 1; min-height: 0; overflow-y: auto; padding: 0.25rem 0.5rem; scrollbar-color: #3a3a44 transparent; }
    /* Once the log is full its height stays the same, so anchoring would hold on to the old lines. */
    .terminal-scroller.following { overflow-anchor: none; }
    .terminal-lines {
      color: #d4d4d8;
      font: 0.75rem/1.35 ui-monospace, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .terminal-lines, .terminal-lines * { user-select: text; }
    .terminal-empty, .log-debug { color: #8a8a96; }
    .log-warn { color: #e5c07b; }
    .log-error { color: #ff7b72; }
  `;

  style`
    display: contents;
  `;

  return class {
    // Debug logging can write thousands of lines a second: the screen catches up ten times a second.
    $refreshRate = 100;

    #open = false;
    uponClose = null;
    scroller = null;
    content = null;
    following = true;
    copyLabel = 'Copy';

    get open() {
      return this.#open;
    }

    // Opening always starts at the newest line.
    set open(value) {
      this.following ||= value;
      this.#open = value;
    }

    get version() {
      return version;
    }

    get shown() {
      return this.open ? lines : NO_LINES;
    }

    connected() {
      const observer = new ResizeObserver(this.follow);
      observer.observe(this.scroller);
      observer.observe(this.content);
    }

    close = () => {
      this.uponClose?.();
    };

    clear = () => {
      lines.length = 0;
      version++;
    };

    copy = async () => {
      try {
        await navigator.clipboard.writeText(lines.map(({ text }) => text).join('\n'));
        this.copyLabel = 'Copied';
      } catch (error) {
        console.error('Unable to copy the log:', error);
        this.copyLabel = 'Copy failed';
      }
      setTimeout(() => { this.copyLabel = 'Copy'; }, 1500);
    };

    follow = () => {
      if (this.following) {
        this.scroller.scrollTop = this.scroller.scrollHeight;
      }
    };

    // Scrolling up to read stops the log from following new lines, until scrolled back down.
    onScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = this.scroller;
      this.following = scrollHeight - scrollTop - clientHeight < 24;
    };
  };

})
