# eNGE server

`enge:server` is an mdlr module that serves what the emulator's Network menu needs:

- BIOS, CUE, BIN, ISO, and `games.csv` files from a games folder
- save states and memory cards from a cloud folder
- the emulator's other pages and generated assets from `docs/`

It has no process of its own. The mdlr monitor runs it as a configured endpoint, on the monitor's port and under its HTTPS and same-machine rules. It uses only Node.js built-in modules.

## Setup

Start the monitor from a checkout of mdlr-dev next to this repository, with this repository's source as a root:

```sh
./mdlr/tools/scripts/dev-restart.sh --root ../enge-js/code
```

The monitor's `endpoints.json` holds the folders:

```json
{
  "/enge": {
    "module": "enge:server",
    "options": { "docs": "../enge-js/docs", "games": "../enge-js/collection", "cloud": "../enge-js/cloud-data" },
    "http": ["/app/web/enge:webgl2-app", "/bundle/web/enge:webgl2-app"]
  }
}
```

Relative paths are from the folder the monitor runs in. The endpoint restarts when you save the file. `collection/` and `cloud-data/` are ignored by git.

Then open https://localhost/app/web/enge:webgl2-app. The page and its Content-Security-Policy come from the monitor, with the exceptions in its `csp.json`.

The emulator looks for the server on `/enge`, set by `serverBase` in `code/psx/index.js`, so keep that prefix in `endpoints.json`.

## Other devices

By default the monitor only accepts connections from its own machine. For a device that won't accept a self-signed certificate, such as an Xbox, add `--http` to the monitor's flags and open `http://<your-ip>/psx`. Plain HTTP only reaches the app and `/enge`, as listed under `"http"` in `endpoints.json`.

There is no login or encryption: anyone on the network can load the emulator, download your game and BIOS files, and overwrite your saves. Use it on a network you trust. Browsers don't offer AudioWorklet on plain HTTP, so audio uses the ScriptProcessorNode fallback.

## Game lists

If the games folder has no `games.csv`, the server creates it from the CUE and ISO files in the folder when the endpoint starts. Delete the file and save `endpoints.json` to pick up games you added later. An ISO is only listed if it holds raw 2352-byte sectors, and the monitor log shows the ones left out. `bios.csv` is created the same way from `scph*`, `bios.bin`, and `openbios.bin` files, and `/enge/bios.csv` is always built fresh. Existing lists are never overwritten; the log says whether each was created or reused.

## Features

- No CORS headers: other websites can't read or overwrite your saves.
- Single byte-range responses (`206 Partial Content`) for large BIN/ISO files.
- CUE files can reference BIN files in the same game directory.
- Cloud endpoints for save states and 128 KiB memory cards:
  - `GET/PUT /enge/api/state`
  - `GET/PUT /enge/api/memorycard` for card 1
  - `GET/PUT /enge/api/memorycard-2` for card 2
  - `GET /enge/api/status`

## Source

The source is in `code/server/`, one mdlr module per concern, with specs next to the modules:

```sh
npm test         # runs the server specs on the monitor
```
