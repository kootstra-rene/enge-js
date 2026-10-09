# eNGE single-port server

The Go server combines all three services on port `8000`:

- Emulator pages and assets from `docs/`
- BIOS, CUE, BIN, and `games.csv` files from `games/`
- A generated `bios.csv` catalog for matching `scph*`, `bios.bin`, and `openbios.bin` files
- Save states and memory cards from `cloud-data/`

## Setup

Install Go, then create a `games` directory or symlink inside this repository and run:

```sh
ln -s /path/to/your/games games
```

Then start the server:

```sh
go run server.go -docs ./docs -games ./games -cloud ./cloud-data
```

Then open the displayed LAN address, for example:

```text
http://192.168.0.27:8000/
```

The server supports HTTP byte ranges for large BIN files and keeps the cloud files in `cloud-data/`.
If `games/games.csv` does not exist, it is generated automatically from the CUE files under `games/`. If `games/bios.csv` does not exist, it is generated from matching BIOS files. Existing CSV files are never overwritten; the server reports whether each catalog was created or reused.

To build a standalone executable instead:

```sh
go build -o enge-server server.go
./enge-server -docs ./docs -games ./games -cloud ./cloud-data
```

If the folders are elsewhere, pass their paths with `-docs`, `-games`, and `-cloud`.
