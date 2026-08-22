#!/usr/bin/env bash
# Builds a minimal ffmpeg.exe/ffprobe.exe into resources/bin. LGPL, no network, lame the only external lib.
# Usage: run under the MSYS2 MINGW64 shell — bash scripts/build-ffmpeg-windows.sh. Then: npm run verify:bin
# Needs: base-devel make diffutils nasm, and the mingw-w64-x86_64 gcc/pkgconf toolchain.

set -euo pipefail

LAME_VERSION=3.100

[ "${MSYSTEM:-}" = "MINGW64" ] || { echo "run this from the MSYS2 MINGW64 shell (MSYSTEM=$MSYSTEM)" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# One pin, shared with the sibling scripts and with the release tag CI publishes under.
FFMPEG_VERSION="$(tr -d '[:space:]' < "$ROOT/resources/ffmpeg-version.txt")"
WORK="$ROOT/out/ffmpeg-build/win-x86_64"
PREFIX="$WORK/deps"
JOBS="$(nproc)"

export CFLAGS="-O2"

echo "==> building win-x64 ffmpeg $FFMPEG_VERSION + lame $LAME_VERSION into $WORK"
mkdir -p "$WORK" "$PREFIX"
cd "$WORK"

# ---------- lame ----------

if [ ! -f "$PREFIX/lib/libmp3lame.a" ]; then
    [ -f "lame-$LAME_VERSION.tar.gz" ] || curl -fLo "lame-$LAME_VERSION.tar.gz" \
        "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz"
    rm -rf "lame-$LAME_VERSION" && tar xf "lame-$LAME_VERSION.tar.gz"
    cd "lame-$LAME_VERSION"

    # 3.100 predates clang/gcc treating this as an error rather than a warning.
    export CFLAGS="$CFLAGS -Wno-implicit-function-declaration"

    ./configure --prefix="$PREFIX" --host=x86_64-w64-mingw32 \
        --disable-shared --enable-static --disable-frontend --disable-dependency-tracking
    make -j"$JOBS" && make install
    cd "$WORK"

    export CFLAGS="-O2"
fi

# ---------- ffmpeg ----------

[ -f "ffmpeg-$FFMPEG_VERSION.tar.xz" ] || curl -fLo "ffmpeg-$FFMPEG_VERSION.tar.xz" \
    "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
rm -rf "ffmpeg-$FFMPEG_VERSION" && tar xf "ffmpeg-$FFMPEG_VERSION.tar.xz"
cd "ffmpeg-$FFMPEG_VERSION"

configure_flags=(
    --prefix="$WORK/out"
    --disable-shared --enable-static
    --pkg-config-flags=--static
    # Never link anything outside the toolchain — autodetect would silently absorb the MSYS2 package set.
    --disable-autodetect
    # ADR-0014, structurally: it cannot dial out because it cannot speak a network protocol.
    --disable-network
    # No --enable-gpl: x264/x265 are what make a stock build GPLv3, and nothing here uses them.
    --enable-libmp3lame
    # The whole point of the custom build — one encoder, one muxer. Decoders and demuxers stay
    # wide, because narrowing them is a file the user cannot import.
    --disable-encoders --enable-encoder=libmp3lame
    --disable-muxers --enable-muxer=mp3
    --disable-ffplay
    --disable-doc --disable-htmlpages --disable-manpages --disable-podpages --disable-txtpages
    --disable-debug
    --extra-cflags="-I$PREFIX/include"
    # Without -static the exe needs libwinpthread/libgcc dlls that only exist inside MSYS2.
    --extra-ldflags="-L$PREFIX/lib -static"
)

./configure "${configure_flags[@]}"
make -j"$JOBS"

# ---------- install ----------

mkdir -p "$ROOT/resources/bin"
for bin in ffmpeg ffprobe; do
    cp "$WORK/ffmpeg-$FFMPEG_VERSION/$bin.exe" "$ROOT/resources/bin/$bin.exe"
    strip "$ROOT/resources/bin/$bin.exe"
done

echo
ls -lh "$ROOT/resources/bin"
echo
echo "==> now run: npm run verify:bin"
