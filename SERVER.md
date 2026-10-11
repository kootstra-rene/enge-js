# eNGE single-port Node server

The repository includes a dependency-free Node server that combines the three services needed for network play on one port:

- emulator pages and generated assets from `docs/`
- BIOS, CUE, BIN, and `games.csv` files from `games/`
- save states and memory cards from `cloud-data/`

## Requirements

- Node.js 18 or newer
- a `games/` directory, or a symlink named `games` pointing to one

No npm install is required; the server uses only Node's built-in modules.

## Setup

From the repository root:

```sh
ln -s /path/to/your/games games
node server.js
```

The default port is `8000`. The server prints the LAN URL it detected, for example `http://192.168.0.27:8000/`.

If `games/games.csv` does not exist, the server creates it from the CUE files under `games/`. If `games/bios.csv` does not exist, it creates it from `scph*`, `bios.bin`, and `openbios.bin` files. Existing catalogs are never overwritten; the server reports whether each catalog was created or reused.

## Options

```sh
node server.js --port 8000 --docs ./docs --games ./games --cloud ./cloud-data
```

## Features

- CORS headers for browser clients.
- Single byte-range responses (`206 Partial Content`) for large BIN/ISO files.
- CUE files can reference BIN files in the same game directory.
- Cloud endpoints for save states and 128 KiB memory cards:
  - `GET/PUT /api/state`
  - `GET/PUT /api/memorycard`
  - `GET /api/status`
- Request logging to the terminal.

The server is intended for a trusted local network. It has no authentication and should not be exposed directly to the public internet.
