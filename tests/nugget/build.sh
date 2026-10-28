#!/bin/sh
# Fetch nugget and build its test executables and OpenBIOS into
# tests/nugget/.nugget, where tests/nugget/run.js looks by default.
#
#   tests/nugget/build.sh [nugget commit or branch]
#
# Needs git, make and a MIPS cross compiler: mipsel-none-elf-gcc (nugget's
# own toolchain), or mipsel-linux-gnu-gcc (Debian/Ubuntu:
# apt install gcc-mipsel-linux-gnu g++-mipsel-linux-gnu). Without either,
# it builds inside nugget's Docker image when Docker is running.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
DEST="$HERE/.nugget"
# The nugget revision this suite list (suites.js) was written against.
REF=${1:-41c48051eee9c477e774efd84d5b3566adcaf08a}
JOBS=${JOBS:-$(nproc 2>/dev/null || echo 4)}

if [ ! -d "$DEST/.git" ]; then
  git clone https://github.com/pcsx-redux/nugget "$DEST"
fi
git -C "$DEST" fetch --depth 1 origin "$REF" 2>/dev/null || git -C "$DEST" fetch origin
git -C "$DEST" checkout --quiet FETCH_HEAD 2>/dev/null || git -C "$DEST" checkout --quiet "$REF"
git -C "$DEST" submodule update --init --depth 1 third_party/libcester third_party/psxlua

if command -v mipsel-none-elf-gcc >/dev/null 2>&1; then
  set -- PREFIX=mipsel-none-elf
  MAKE="make"
elif command -v mipsel-linux-gnu-gcc >/dev/null 2>&1; then
  # Linux binutils name the little-endian MIPS ELF target differently.
  set -- PREFIX=mipsel-linux-gnu FORMAT=elf32-tradlittlemips
  MAKE="make"
elif docker info >/dev/null 2>&1; then
  set --
  MAKE="$DEST/dockermake.sh"
else
  echo "no MIPS cross compiler (mipsel-none-elf-gcc or mipsel-linux-gnu-gcc) and no Docker" >&2
  exit 1
fi

(cd "$DEST/openbios" && $MAKE "$@" -j"$JOBS")
(cd "$DEST/tests" && $MAKE "$@" PCSX_TESTS=true -j"$JOBS" all)

echo
echo "built $(find "$DEST/tests" -name '*.ps-exe' | wc -l) test executables and $DEST/openbios/openbios.bin"
echo "run them with: node tests/nugget/run.js"
