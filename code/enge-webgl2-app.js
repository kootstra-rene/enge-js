// The eNGE emulator with the WebGL2 renderer, as a web app. Served at /app/web/enge:webgl2-app
// by an mdlr monitor started with `--root <this folder> --mount enge=<docs folder>`, which
// also needs the CSP exceptions below in its csp.json, for the recompiler's new Function and
// the audio worklet's data: URL:
//   "[web]enge:webgl2-app": { "script-src": ["'unsafe-eval'"], "script-src-elem": ["data:"] }
mdlr('[web]enge:webgl2-app', ({ html, style, css, include }) => {

  html`
  <link rel="stylesheet" href="/enge/index-webgl2.css" />
  <canvas id="ambilight"></canvas>
  <div id="background"></div>
  <canvas id="display"></canvas>
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
  <div id="nav-actions">
    <button id="local-files-button" class="nav-icon-button" type="button" aria-label="Open local files" title="Open local files">Open Files</button>
    <button id="cloud-button" class="nav-icon-button" type="button" aria-label="Open network menu" aria-expanded="false" title="Network loading">Cloud</button>
    <button id="overlay-toggle" class="nav-icon-button" type="button" aria-label="Hide touch controls" aria-pressed="false" title="Hide touch controls">Overlay</button>
    <button id="quality" aria-label="Video quality" class="nav-icon-button" type="button">Q1</button>
    <button id="menu-button" class="nav-icon-button" type="button" aria-label="Open menu" aria-expanded="false">&#9776;</button>
    <button id="fullscreen" class="nav-icon-button" type="button">Fullscreen</button>
  </div>
  <input id="file" type="file" accept=".cue,.bin,.iso,.img,.bios,application/octet-stream" multiple hidden />

  <div id="network-menu" role="dialog" aria-modal="true" aria-label="Network menu" hidden>
    <div class="control-menu-panel">
      <div class="control-menu-heading">
        <h2>Network</h2>
        <button id="close-network-menu" type="button" aria-label="Close network menu">×</button>
      </div>
      <ul class="control-menu-list">
        <li class="menu-section">BIOS</li>
        <li id="bios-list-status" role="status">Loading BIOS list...</li>
        <li id="bios-list"></li>
        <li class="menu-section">Games</li>
        <li id="game-list-status" role="status">Loading game list...</li>
        <li id="game-list"></li>
        <li class="menu-section">Cloud Saves</li>
        <li><button id="cloud-save-state" type="button" disabled>Save State to Cloud</button></li>
        <li><button id="cloud-load-state" type="button" disabled>Load State from Cloud</button></li>
        <li><button id="cloud-save-memorycard" type="button">Save Memory Card to Cloud</button></li>
        <li><button id="cloud-load-memorycard" type="button">Load Memory Card from Cloud</button></li>
      </ul>
    </div>
  </div>

  <div id="control-menu" role="dialog" aria-modal="true" aria-label="Emulator menu" hidden>
    <div class="control-menu-panel">
      <div class="control-menu-heading">
        <h2>Menu</h2>
        <button id="close-menu" type="button" aria-label="Close menu">×</button>
      </div>
      <ul class="control-menu-list">
        <li class="menu-section">Save States</li>
        <li id="state-status" role="status">State controls waiting for game startup</li>
        <li><button id="save-state" type="button" disabled>Save State</button></li>
        <li><button id="load-state" type="button" disabled>Load State</button></li>
        <li><button id="download-state" type="button" disabled>Download Save State</button></li>
        <li><button id="download-memorycard" type="button">Download Memory Card 1</button></li>
        <li><button id="download-memorycard-2" type="button">Download Memory Card 2</button></li>
        <li><button id="upload-state" type="button" disabled>Upload Save State</button></li>
        <li><button id="upload-memorycard" type="button">Upload Memory Card 1</button></li>
        <li><button id="upload-memorycard-2" type="button">Upload Memory Card 2</button></li>
        <li><button id="change-disc" type="button">Change Disc</button></li>
        <li><button id="reload-window" type="button">Reload Window</button></li>
      </ul>
      <input id="upload-state-file" type="file" accept=".json,application/json" hidden />
      <input id="upload-memorycard-file" type="file" accept=".mcr,.mc,.bin,application/octet-stream" hidden />
      <input id="change-disc-file" type="file" multiple hidden />
    </div>
  </div>
  `;

  // The framework's page styles come after the stylesheet above, so what they reset is set
  // again here. The rest replaces the style attributes of docs/index-webgl2.html, which the
  // CSP blocks.
  css`
    body {
      all: unset;
      box-sizing: inherit;
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      margin: 0;
      overflow: hidden;
      background-color: #222;
      background-size: cover;
    }
    *, *::before, *::after { box-sizing: inherit; }
    [hidden] { display: none; }
    #nav-actions { position: fixed; z-index: 6; top: 5.25rem; left: 1rem; display: flex; }
    #local-files-button, #cloud-button, #quality, #menu-button, #fullscreen { position: static; margin: 0; }
    #overlay-toggle { margin: 0; }
  `;

  style`
    display: contents;
  `;

  // These modules look up their elements as soon as they load, so they have to wait for the template.
  const start = () => {
    include('enge:psx:webgl2');
    window.init();
  };

  return class {
    connected() {
      start();
    }
  };

})
