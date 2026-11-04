# eNGE single-port Node server

The repository includes an mdlr program, run with plain Node, that combines the three services needed for network play on one port:

- the emulator as a web app on `/`, and its other pages and generated assets from `docs/`
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

The server only speaks HTTPS over HTTP/2. To use an existing certificate, pass both `--tls-key path/to/key.pem` and `--tls-cert path/to/cert.pem`.

## Features

- No CORS headers: the emulator is served from the same origin, and other websites can't read or overwrite your saves.
- Single byte-range responses (`206 Partial Content`) for large BIN/ISO files.
- CUE files can reference BIN files in the same game directory.
- Cloud endpoints for save states and 128 KiB memory cards:
  - `GET/PUT /api/state`
  - `GET/PUT /api/memorycard` for card 1
  - `GET/PUT /api/memorycard-2` for card 2
  - `GET /api/status`
- Request logging to the terminal.

The server is intended for a trusted local network. It has no authentication and should not be exposed directly to the public internet.

## Source

`server.js` in the repository root is a generated bundle. The source is in `code/server/`, one mdlr module per concern, with specs next to the modules. Start the mdlr monitor with `--root` pointing at `code`, then:

```sh
./build.sh       # regenerates server.js and the bundles in docs/
npm test         # runs the server specs on the monitor
```

The page on `/` and its Content-Security-Policy are in `code/server/server.js`. The policy has to match the exceptions the app has in the monitor's `csp.json`.
