// The eNGE emulator with the WebGL2 renderer, as a web app. Served at /app/web/enge:webgl2-app
// by an mdlr monitor started with `--root <this folder>`, which also needs the CSP exceptions
// below in its csp.json, for the recompiler's new Function and the audio worklet's data: URL:
//   "[web]enge:webgl2-app": { "script-src": ["'unsafe-eval'"], "script-src-elem": ["data:"] }
mdlr('[web]enge:webgl2-app', ({ html, style, css, include }) => {

  include('[web]enge:log-terminal');

  // enge:psx:index wires up the panel's elements by id and adds the rows of the lists marked
  // data-settings. A click on cloud-button also makes it load the BIOS and game lists.
  const SECTIONS = [
    { key: 'game', id: 'game-tab', label: 'Game', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6z' },
    { key: 'saves', id: 'saves-tab', label: 'Saves', icon: 'M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 2v5h9V5H7zm5 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
    { key: 'video', id: 'video-tab', label: 'Video', icon: 'M3 4h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v10h16V6H4z' },
    { key: 'controls', id: 'controls-tab', label: 'Controls', icon: 'M7 7h10a5 5 0 0 1 4.9 6l-.6 3a3 3 0 0 1-5.4 1.2L14.5 16h-5l-1.4 1.2A3 3 0 0 1 2.7 16l-.6-3A5 5 0 0 1 7 7zm1 3v2H6v2h2v2h2v-2h2v-2h-2v-2H8zm8 1a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z' },
    { key: 'network', id: 'cloud-button', label: 'Network', icon: 'M6.5 19a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.2 9 5 5 0 0 1 17 19H6.5z' },
  ];

  html`
  <canvas id="ambilight"></canvas>
  <div id="background"></div>
  <canvas id="display" on{click=close}></canvas>
  <div id="touch-controls" aria-label="Virtual controller">
    <div class="touch-stick" data-virtual-stick>
      <div class="touch-stick-knob"></div>
    </div>
    <div class="touch-face">
      <button aria-label="Triangle" data-virtual-property="hi" data-virtual-bit="16" class="touch-button triangle">TRI</button>
      <button aria-label="Circle" data-virtual-property="hi" data-virtual-bit="32" class="touch-button circle">CIR</button>
      <button aria-label="Cross" data-virtual-property="hi" data-virtual-bit="64" class="touch-button cross">X</button>
      <button aria-label="Square" data-virtual-property="hi" data-virtual-bit="128" class="touch-button square">SQR</button>
    </div>
    <div class="touch-menu">
      <button aria-label="Select" data-virtual-property="lo" data-virtual-bit="1" class="touch-button select">Select</button>
      <button aria-label="Start" data-virtual-property="lo" data-virtual-bit="8" class="touch-button start">Start</button>
    </div>
    <div class="touch-shoulders">
      <div class="touch-shoulder-pair">
        <button data-virtual-property="hi" data-virtual-bit="4" class="touch-button">L1</button>
        <button data-virtual-property="hi" data-virtual-bit="1" class="touch-button">L2</button>
      </div>
      <div class="touch-shoulder-pair">
        <button data-virtual-property="hi" data-virtual-bit="8" class="touch-button">R1</button>
        <button data-virtual-property="hi" data-virtual-bit="2" class="touch-button">R2</button>
      </div>
    </div>
  </div>

  <div class="menu" data-menu on{click=onMenuClick} on{keydown=onMenuKeydown}>
    <nav class="rail" aria-label="Emulator menu">
      {#each item in sections}
        <button id={item.id} class="rail-item" type="button" aria-expanded={section === item.key ? 'true' : 'false'} on{click=()=>toggle(item.key)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d={item.icon} /></svg>
          <span>{item.label}</span>
        </button>
      {/each}
      <button id="log-tab" class="rail-item" type="button" aria-expanded={logOpen ? 'true' : 'false'} on{click=toggleLog}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v12h16V6H4zm2.4 2.6L9.8 12l-3.4 3.4L5 14l2-2-2-2zM11 14h6v2h-6z" /></svg>
        <span>Log</span>
      </button>
      <div class="rail-end">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z" /></svg>
        <button id="fullscreen" class="rail-item" type="button">Fullscreen</button>
      </div>
    </nav>

    <aside class="panel" aria-label={title} hidden={!section}>
      <div class="panel-heading">
        <h2>{title}</h2>
        <button class="panel-close" type="button" aria-label="Close menu" on{click=close}>×</button>
      </div>

      <section hidden={section !== 'game'}>
        <ul>
          <li><button id="local-files-button" type="button">Open BIOS or Game Files</button></li>
          <li><button id="change-disc" type="button">Change Disc</button></li>
          <li><button id="reload-window" type="button">Reload Window</button></li>
        </ul>
      </section>

      <section hidden={section !== 'saves'}>
        <ul>
          <li class="group">Save States</li>
          <li id="state-status" role="status">State controls waiting for game startup</li>
          <li><button id="save-state" type="button" disabled>Save State</button></li>
          <li><button id="load-state" type="button" disabled>Load State</button></li>
          <li><button id="download-state" type="button" disabled>Download Save State</button></li>
          <li><button id="upload-state" type="button" disabled>Upload Save State</button></li>
          <li class="group">Memory Card 1</li>
          <li><button id="download-memorycard" type="button">Download Memory Card 1</button></li>
          <li><button id="upload-memorycard" type="button">Upload Memory Card 1</button></li>
          <li class="group">Memory Card 2</li>
          <li><button id="download-memorycard-2" type="button">Download Memory Card 2</button></li>
          <li><button id="upload-memorycard-2" type="button">Upload Memory Card 2</button></li>
        </ul>
      </section>

      <section hidden={section !== 'video'}>
        <ul data-settings="video">
          <li><button id="quality" type="button" aria-label="Render quality">Q1</button></li>
        </ul>
      </section>

      <section hidden={section !== 'controls'}>
        <ul data-settings="controls">
          <li class="touch-only"><button id="overlay-toggle" type="button" aria-pressed="false">Touch controls:</button></li>
        </ul>
        <ul>
          <li class="group">Keyboard</li>
          <li>Cross X, Circle D, Square S, Triangle E</li>
          <li>L1 W, L2 Q, R1 R, R2 T</li>
          <li>Start Enter, Select Space, D-pad arrow keys</li>
          <li class="group">Screen</li>
          <li>Double-click the picture to pause or resume.</li>
        </ul>
      </section>

      <section id="network-menu" hidden={section !== 'network'}>
        <ul>
          <li class="group">BIOS</li>
          <li id="bios-list-status" role="status">Loading BIOS list...</li>
          <li id="bios-list"></li>
          <li class="group">Games</li>
          <li id="game-list-status" role="status">Loading game list...</li>
          <li id="game-list"></li>
          <li class="group">Cloud Saves</li>
          <li><button id="cloud-save-state" type="button" disabled>Save State to Cloud</button></li>
          <li><button id="cloud-load-state" type="button" disabled>Load State from Cloud</button></li>
          <li><button id="cloud-save-memorycard" type="button">Save Memory Card 1 to Cloud</button></li>
          <li><button id="cloud-load-memorycard" type="button">Load Memory Card 1 from Cloud</button></li>
          <li><button id="cloud-save-memorycard-2" type="button">Save Memory Card 2 to Cloud</button></li>
          <li><button id="cloud-load-memorycard-2" type="button">Load Memory Card 2 from Cloud</button></li>
        </ul>
      </section>
    </aside>

    <log-terminal .open={logOpen} .uponClose={closeLog}/>
  </div>

  <input id="file" type="file" accept=".cue,.bin,.iso,.img,.bios,application/octet-stream" multiple hidden />
  <input id="upload-state-file" type="file" accept=".json,application/json" hidden />
  <input id="upload-memorycard-file" type="file" accept=".mcr,.mc,.bin,application/octet-stream" hidden />
  <input id="change-disc-file" type="file" multiple hidden />
  `;

  css`
    html {
      box-sizing: border-box;
      --rail-width: 5rem;
      --rail-height: 0px;
      --screen-fill: 0.94;
      --free-width: calc(100vw - var(--rail-width));
      --panel-width: min(22rem, calc(100vw - var(--rail-width)));
      --log-height: 0px;
      --free-height: calc(100vh - var(--rail-height) - var(--log-height));
      --screen-width: min(calc(var(--free-height) * var(--screen-fill) * 4 / 3), calc(var(--free-width) * var(--screen-fill)));
      --screen-height: calc(var(--screen-width) * 3 / 4);
    }
    html:has(.terminal:not([hidden])) { --log-height: min(40vh, 24rem); }
    *, *::before, *::after { box-sizing: inherit; user-select: none; }
    [hidden] { display: none; }
    html.enge-pseudo-fullscreen, html.enge-pseudo-fullscreen body { position: fixed; inset: 0; width: 100%; height: 100%; }

    body {
      all: unset;
      box-sizing: inherit;
      position: absolute;
      inset: 0;
      overflow: hidden;
      background-color: #222;
      background-size: cover;
      font-family: system-ui, sans-serif;
      color: #e6e6e6;
    }

    #background {
      position: absolute;
      inset: 0;
      background-image: linear-gradient(-35deg, #18182060, #202028e0, #18182080, #181820e0);
    }

    #ambilight {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      filter: blur(100px);
    }

    #display {
      position: absolute;
      top: calc(var(--rail-height) + (var(--free-height) - var(--screen-height)) / 2);
      left: calc(var(--rail-width) + (var(--free-width) - var(--screen-width)) / 2);
      width: var(--screen-width);
      height: var(--screen-height);
      background-color: black;
      border: solid 1px #202028;
      padding: 0.75vh;
      border-radius: 0.75vh;
    }

    .menu { display: contents; }

    .rail {
      position: fixed;
      z-index: 7;
      inset: 0 auto 0 0;
      width: var(--rail-width);
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.75rem 0.5rem;
      background: #17171c;
      border-right: 1px solid #2c2c34;
    }

    .rail-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      width: 100%;
      padding: 0.5rem 0;
      border: 0;
      border-radius: 0.75rem;
      background: none;
      color: #a8a8b4;
      font: 500 0.7rem/1.1 system-ui, sans-serif;
      cursor: pointer;
    }
    .rail-item:hover { background: #26262e; color: #e6e6e6; }
    .rail-item:focus-visible { outline: 2px solid #fa9a34; outline-offset: -2px; }
    .rail-item[aria-expanded="true"] { background: #33333d; color: #fa9a34; }
    .rail svg { display: block; width: 1.5rem; height: 1.5rem; fill: currentColor; }

    .rail-end { position: relative; margin-top: auto; color: #a8a8b4; }
    .rail-end:hover { color: #e6e6e6; }
    .rail-end svg { position: absolute; top: 0.5rem; left: 50%; transform: translateX(-50%); pointer-events: none; }
    .rail-end .rail-item { padding-top: 2.25rem; color: inherit; }

    .panel {
      position: fixed;
      z-index: 6;
      top: 0;
      bottom: 0;
      left: var(--rail-width);
      width: var(--panel-width);
      padding: 1rem;
      overflow-y: auto;
      background: #1e1e24f5;
      border-right: 1px solid #2c2c34;
    }
    .panel-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
    .panel h2 { margin: 0; font-size: 1.15rem; font-weight: 600; }
    .panel ul { margin: 0; padding: 0; list-style: none; }
    .panel li { margin: 0.4rem 0; color: #a8a8b4; font-size: 0.85rem; line-height: 1.35; }
    .panel .group {
      margin-top: 1.1rem;
      padding-bottom: 0.25rem;
      border-bottom: 1px solid #3a3a44;
      color: #a8a8b4;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .panel button {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1px solid #3a3a44;
      border-radius: 0.5rem;
      background: #2a2a32;
      color: #e6e6e6;
      font: 0.9rem system-ui, sans-serif;
      text-align: left;
      cursor: pointer;
    }
    .panel button:hover { background: #363640; }
    .panel button:focus-visible { outline: 2px solid #fa9a34; outline-offset: 1px; }
    .panel button:disabled { background: #202026; color: #6e6e78; cursor: not-allowed; }
    .panel .panel-close { width: 2.25rem; height: 2.25rem; padding: 0; border: 0; background: none; font-size: 1.5rem; text-align: center; }

    .panel:not([hidden]) ~ log-terminal > .terminal { left: calc(var(--rail-width) + var(--panel-width)); }

    /* margins, because the CSS compiler removes whitespace after a colon, even in a string */
    #quality::before { content: 'Render quality:'; margin-right: 0.25em; }
    #overlay-toggle::after { content: 'On'; margin-left: 0.25em; }
    #overlay-toggle[aria-pressed="true"]::after { content: 'Off'; }

    /* network-menu is closed by a click on itself, so it must not have a box of its own */
    #network-menu { display: contents; }
    #network-menu[hidden] { display: none; }

    .touch-only { display: none; }
    #touch-controls { display: none; }

    @media (pointer: coarse), (max-width: 700px) {
      html { --screen-fill: 1; }
      .touch-only { display: list-item; }
      #background, #ambilight { display: none; }
      #display { padding: 0; border: 0; border-radius: 0; }

    #touch-controls {
      position: fixed;
      inset: 0;
      display: block;
      z-index: 4;
      pointer-events: none;
      touch-action: none;
    }

    .touch-button {
      position: relative;
      width: 3.75rem;
      height: 3.75rem;
      border: 1px solid #aaa;
      border-radius: 50%;
      background: #222b;
      color: white;
      font-size: 1.25rem;
      pointer-events: auto;
      touch-action: none;
      color: #e6e6e6;
      font-size: 0;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
    }

    .touch-button:active { background: #777d; }
    .touch-button.is-pressed { background: #777d; }

    .touch-button:before {
      content: '';
      display: block;
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
    }

    .touch-button.select:before { width: 1.45rem; height: 0.85rem; border: 0.16rem solid currentColor; border-radius: 0.2rem; }
    .touch-button.start:before { width: 1.65rem; height: 1.05rem; background: currentColor; clip-path: polygon(0 0, 100% 50%, 0 100%); }
    .touch-button.circle:before { width: 1.45rem; height: 1.45rem; border: 0.16rem solid currentColor; border-radius: 50%; }
    .touch-button.square:before { width: 1.35rem; height: 1.35rem; border: 0.16rem solid currentColor; }
    .touch-button.triangle:before { width: 1.7rem; height: 1.55rem; background: currentColor; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
    .touch-button.triangle:after { content: ''; display: block; position: absolute; left: 50%; top: 50%; width: 1.05rem; height: 0.95rem; transform: translate(-50%, -42%); background: #222; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
    .touch-button.cross:before { width: 1.55rem; height: 1.55rem; background: linear-gradient(45deg, transparent 42%, currentColor 43%, currentColor 57%, transparent 58%), linear-gradient(-45deg, transparent 42%, currentColor 43%, currentColor 57%, transparent 58%); }

    .touch-stick {
      position: absolute;
      left: 1rem;
      bottom: 1.5rem;
      width: 9rem;
      height: 9rem;
      border: 2px solid #aaa8;
      border-radius: 50%;
      background: #222b;
      pointer-events: auto;
      touch-action: none;
    }

    .touch-stick-knob {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 4rem;
      height: 4rem;
      margin: -2rem;
      border: 1px solid #ddd;
      border-radius: 50%;
      background: #777d;
      pointer-events: none;
    }

    .touch-face,
    .touch-menu,
    .touch-shoulders {
      position: absolute;
      display: flex;
      gap: 0.35rem;
      align-items: center;
    }

    .touch-face { right: 1rem; bottom: 1.5rem; width: 12rem; height: 12rem; }
    .touch-face .touch-button { position: absolute; }
    .touch-face .triangle { top: 0; left: 50%; transform: translateX(-50%); }
    .touch-face .circle { top: 50%; right: 0; transform: translateY(-50%); }
    .touch-face .square { top: 50%; left: 0; transform: translateY(-50%); }
    .touch-face .cross { bottom: 0; left: 50%; transform: translateX(-50%); }
    .touch-menu { top: 5.25rem; right: 1rem; left: auto; bottom: auto; transform: none; }
    .touch-shoulders { left: 1rem; right: 1rem; top: 0.75rem; justify-content: space-between; }
    .touch-shoulder-pair { display: flex; gap: 0.45rem; }
    .touch-shoulder-pair .touch-button { font-size: 1.1rem; }
    }

    @media (pointer: coarse) and (orientation: portrait), (max-width: 700px) and (orientation: portrait) {
      html { --rail-width: 0px; --rail-height: 3.75rem; }
      .rail { inset: 0 0 auto 0; width: auto; height: var(--rail-height); flex-direction: row; padding: 0.25rem; border-right: 0; border-bottom: 1px solid #2c2c34; }
      .rail-item { padding: 0.25rem 0; }
      .rail > .rail-item { flex: 1; }
      .rail-end { margin: 0; flex: 1; }
      .rail-end svg { top: 0.25rem; }
      .rail-end .rail-item { padding-top: 1.85rem; }
      .panel { top: var(--rail-height); left: 0; width: 100%; }
      #touch-controls { top: var(--rail-height); }
      .touch-button { width: 4rem; height: 4rem; }
      .touch-stick { left: 2rem; bottom: 6rem; width: 9.5rem; height: 9.5rem; }
      .touch-stick-knob { width: 4.5rem; height: 4.5rem; margin: -2.25rem; }
      .touch-face { right: 0.5rem; bottom: 6rem; width: 12rem; height: 12rem; }
      .touch-menu { top: 6rem; }
    }

    @media (pointer: coarse) and (orientation: landscape) and (max-height: 500px), (max-width: 900px) and (orientation: landscape) and (max-height: 500px) {
      html { --rail-width: 3.25rem; }
      .rail { padding: 0.25rem; gap: 0; }
      .rail-item span { display: none; }
      .rail-end .rail-item { padding: 0.5rem 0; height: 2.5rem; font-size: 0; }
      #touch-controls { left: var(--rail-width); }
      .touch-button { width: 3.5rem; height: 3.5rem; }
      .touch-stick { left: 0.75rem; bottom: 0.75rem; width: 8.5rem; height: 8.5rem; }
      .touch-stick-knob { width: 3.5rem; height: 3.5rem; margin: -1.75rem; }
      .touch-face { right: 0.75rem; bottom: 0.75rem; width: 10.5rem; height: 10.5rem; }
      .touch-menu { top: 4.5rem; right: 0.75rem; gap: 0.2rem; }
      .touch-shoulders { top: 0.5rem; gap: 0.2rem; }
      .touch-shoulder-pair { gap: 0.2rem; }
    }
  `;

  style`
    display: contents;
  `;

  // These modules look up their elements as soon as they load, so they have to wait for the template.
  const start = () => {
    document.title = 'eNGE';
    include('enge:psx:webgl2');
    window.init();
  };

  return class {
    sections = SECTIONS;
    section = null;
    logOpen = false;

    get title() {
      return SECTIONS.find(({ key }) => key === this.section)?.label ?? '';
    }

    connected() {
      start();
    }

    toggle = (key) => {
      this.section = this.section === key ? null : key;
    };

    close = () => {
      this.section = null;
    };

    toggleLog = () => {
      this.logOpen = !this.logOpen;
    };

    closeLog = () => {
      this.logOpen = false;
    };

    onMenuClick = (event) => {
      // After a mouse or touch press the keyboard goes back to the game. A keyboard
      // press reports a detail of 0 and keeps its focus, so the menu stays usable.
      if (event.detail > 0) {
        event.target.closest('button, [tabindex]')?.blur();
      }
    };

    onMenuKeydown = (event) => {
      if (event.key === 'Escape') {
        event.target.closest('button, [tabindex]')?.blur();
        if (this.section) {
          this.close();
        }
        else {
          this.closeLog();
        }
      }
    };
  };

})
