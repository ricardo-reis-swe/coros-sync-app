#!/usr/bin/env bash
# Builds a minimal ffmpeg/ffprobe into resources/bin on Linux. LGPL, no network, lame the only external lib.
# Usage: bash scripts/build-ffmpeg-linux.sh   — x86_64 only. Then: npm run verify:bin
# Needs: build-essential nasm pkg-config (libc6-dev's libc.a is what makes -static possible)

set -euo pipefail

LAME_VERSION=3.100

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# One pin, shared with the sibling scripts and with the release tag CI publishes under.
FFMPEG_VERSION="$(tr -d '[:space:]' < "$ROOT/resources/ffmpeg-version.txt")"
WORK="$ROOT/out/ffmpeg-build/linux-$(uname -m)"
PREFIX="$WORK/deps"
JOBS="$(nproc)"

export CFLAGS="-O2"

echo "==> building linux ffmpeg $FFMPEG_VERSION + lame $LAME_VERSION into $WORK"
mkdir -p "$WORK" "$PREFIX"
cd "$WORK"

# ---------- lame ----------

if [ ! -f "$PREFIX/lib/libmp3lame.a" ]; then
    [ -f "lame-$LAME_VERSION.tar.gz" ] || curl -fLo "lame-$LAME_VERSION.tar.gz" \
        "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz"
    rm -rf "lame-$LAME_VERSION" && tar xf "lame-$LAME_VERSION.tar.gz"
    cd "lame-$LAME_VERSION"

    ./configure --prefix="$PREFIX" \
        --disable-shared --enable-static --disable-frontend --disable-dependency-tracking
    make -j"$JOBS" && make install
    cd "$WORK"
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
    # Never link anything outside the OS — autodetect would silently absorb whatever apt left on the runner.
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
    # --enable-static alone leaves libc dynamic, which fails verify:bin's "not a dynamic executable" check.
    --extra-ldflags="-L$PREFIX/lib -static"
)

./configure "${configure_flags[@]}"
make -j"$JOBS"

# ---------- install ----------

mkdir -p "$ROOT/resources/bin"
for bin in ffmpeg ffprobe; do
    cp "$WORK/ffmpeg-$FFMPEG_VERSION/$bin" "$ROOT/resources/bin/$bin"
    strip "$ROOT/resources/bin/$bin"
done

echo
ls -lh "$ROOT/resources/bin"
echo
echo "==> now run: npm run verify:bin"
