# eNGE single-port Node server

The repository includes a Node server that combines the three services needed for network play on one port:

- emulator pages and generated assets from `docs/`
- BIOS, CUE, BIN, and `games.csv` files from `games/`
- save states and memory cards from `cloud-data/`

## Requirements

- Node.js 18 or newer
- a `games/` directory, or a symlink named `games` pointing to one

The server uses only Node.js built-in modules. It generates its HTTPS certificate with Node's built-in crypto library; neither npm dependencies nor a separately installed OpenSSL executable are needed.

## Setup

From the repository root:

```sh
ln -s /path/to/your/games games
node server.js
```

The default port is `8000`. HTTPS is enabled by default. The first start generates a self-signed certificate and private key under `.enge-certs/`, then prints the LAN URL it detected, for example `https://192.168.0.27:8000/`. The certificate includes the machine's current LAN IPv4 addresses. Browsers must trust the certificate for secure-context features such as AudioWorklet. If the LAN address changes, delete `.enge-certs/` to generate a certificate with the new address.

If `games/games.csv` does not exist, the server creates it from the CUE files under `games/`. If `games/bios.csv` does not exist, it creates it from `scph*`, `bios.bin`, and `openbios.bin` files. Existing catalogs are never overwritten; the server reports whether each catalog was created or reused.

## Options

```sh
node server.js --port 8000 --docs ./docs --games ./games --cloud ./cloud-data
```

Use `node server.js --http` to serve plain HTTP instead. To use an existing certificate, pass both `--tls-key path/to/key.pem` and `--tls-cert path/to/cert.pem`.

## Features

- CORS headers for browser clients.
- Single byte-range responses (`206 Partial Content`) for large BIN/ISO files.
- CUE files can reference BIN files in the same game directory.
- Cloud endpoints for save states and 128 KiB memory cards:
  - `GET/PUT /api/state`
  - `GET/PUT /api/memorycard` for card 1
  - `GET/PUT /api/memorycard-2` for card 2
  - `GET /api/status`
- Request logging to the terminal.

The server is intended for a trusted local network. It has no authentication and should not be exposed directly to the public internet.

## On the mdlr monitor

The same services also exist as an mdlr module, for the web app with the navigation rail. It is separate from `server.js`, and differs from it: it also lists raw ISO images, serves on `/enge`, and has no CORS headers.

`enge:server` is an mdlr module that serves what the emulator's Network menu needs:

- BIOS, CUE, BIN, ISO, and `games.csv` files from a games folder
- save states and memory cards from a cloud folder
- the emulator's other pages and generated assets from `docs/`

It has no process of its own. The mdlr monitor runs it as a configured endpoint, on the monitor's port and under its HTTPS and same-machine rules. It uses only Node.js built-in modules.

### Setup

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

### Other devices

By default the monitor only accepts connections from its own machine. For a device that won't accept a self-signed certificate, such as an Xbox, add `--http` to the monitor's flags and open `http://<your-ip>/psx`. Plain HTTP only reaches the app and `/enge`, as listed under `"http"` in `endpoints.json`.

There is no login or encryption: anyone on the network can load the emulator, download your game and BIOS files, and overwrite your saves. Use it on a network you trust. Browsers don't offer AudioWorklet on plain HTTP, so audio uses the ScriptProcessorNode fallback.

### Game lists

If the games folder has no `games.csv`, the server creates it from the CUE and ISO files in the folder when the endpoint starts. Delete the file and save `endpoints.json` to pick up games you added later. An ISO is only listed if it holds raw 2352-byte sectors, and the monitor log shows the ones left out. `bios.csv` is created the same way from `scph*`, `bios.bin`, and `openbios.bin` files, and `/enge/bios.csv` is always built fresh. Existing lists are never overwritten; the log says whether each was created or reused.

### Features

- No CORS headers: other websites can't read or overwrite your saves.
- Single byte-range responses (`206 Partial Content`) for large BIN/ISO files.
- CUE files can reference BIN files in the same game directory.
- Cloud endpoints for save states and 128 KiB memory cards:
  - `GET/PUT /enge/api/state`
  - `GET/PUT /enge/api/memorycard` for card 1
  - `GET/PUT /enge/api/memorycard-2` for card 2
  - `GET /enge/api/status`

### Source

The source is in `code/server/`, one mdlr module per concern, with specs next to the modules:

```sh
npm test         # runs the server specs on the monitor
```
