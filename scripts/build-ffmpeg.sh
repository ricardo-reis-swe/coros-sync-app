#!/usr/bin/env bash
# Builds a minimal ffmpeg/ffprobe into resources/bin. LGPL, no network, lame the only external lib.
# Usage: bash scripts/build-ffmpeg.sh [arm64|x86_64]   — defaults to this Mac. Then: npm run verify:bin

set -euo pipefail

LAME_VERSION=3.100
DEPLOYMENT_TARGET=12.0

ARCH="${1:-$(uname -m)}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# One pin, shared with the sibling scripts and with the release tag CI publishes under.
FFMPEG_VERSION="$(tr -d '[:space:]' < "$ROOT/resources/ffmpeg-version.txt")"
WORK="$ROOT/out/ffmpeg-build/$ARCH"
PREFIX="$WORK/deps"

case "$ARCH" in
    arm64|aarch64) ARCH=arm64; FF_ARCH=aarch64; HOST=aarch64-apple-darwin ;;
    x86_64)        FF_ARCH=x86_64; HOST=x86_64-apple-darwin ;;
    *) echo "unknown arch: $ARCH (want arm64 or x86_64)" >&2; exit 1 ;;
esac

export MACOSX_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET"
export CC="clang -arch $ARCH"
# -Wno-implicit-function-declaration: lame 3.100 predates clang 15 making that an error, not a warning.
export CFLAGS="-arch $ARCH -mmacosx-version-min=$DEPLOYMENT_TARGET -O2 -Wno-implicit-function-declaration"
export LDFLAGS="-arch $ARCH -mmacosx-version-min=$DEPLOYMENT_TARGET"

echo "==> building $ARCH ffmpeg $FFMPEG_VERSION + lame $LAME_VERSION into $WORK"
mkdir -p "$WORK" "$PREFIX"
cd "$WORK"

# ---------- lame ----------

if [ ! -f "$PREFIX/lib/libmp3lame.a" ]; then
    [ -f "lame-$LAME_VERSION.tar.gz" ] || curl -fLo "lame-$LAME_VERSION.tar.gz" \
        "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz"
    rm -rf "lame-$LAME_VERSION" && tar xf "lame-$LAME_VERSION.tar.gz"
    cd "lame-$LAME_VERSION"

    # 3.100 exports a symbol it no longer defines; the link fails on macOS without this.
    sed -i '' '/lame_init_old/d' include/libmp3lame.sym

    # --host also sidesteps 3.100's config.guess, which predates arm64 and aborts.
    ./configure --prefix="$PREFIX" --host="$HOST" \
        --disable-shared --enable-static --disable-frontend --disable-dependency-tracking
    make -j"$(sysctl -n hw.ncpu)" && make install
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
    # Never link anything outside the OS — autodetect would silently absorb Homebrew.
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
    --extra-ldflags="-L$PREFIX/lib"
)

[ "$ARCH" = "$(uname -m)" ] || configure_flags+=(--enable-cross-compile --arch="$FF_ARCH" --target-os=darwin --cc="$CC")

./configure "${configure_flags[@]}"
make -j"$(sysctl -n hw.ncpu)"

# ---------- install ----------

mkdir -p "$ROOT/resources/bin"
for bin in ffmpeg ffprobe; do
    cp "$WORK/ffmpeg-$FFMPEG_VERSION/$bin" "$ROOT/resources/bin/$bin"
    strip -x "$ROOT/resources/bin/$bin"
    # strip breaks the ad-hoc signature clang applied, and an unsigned arm64 binary is SIGKILLed on exec.
    codesign --force --sign - "$ROOT/resources/bin/$bin"
done

echo
ls -lh "$ROOT/resources/bin"
echo
echo "==> now run: npm run verify:bin"
