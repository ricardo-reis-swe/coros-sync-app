# resources/bin — building ffmpeg and ffprobe

`bin/` is gitignored and starts empty. A fresh clone **cannot transcode** until two static
binaries are dropped in by hand, one pair per platform *and* architecture:

```
resources/bin/ffmpeg      (ffmpeg.exe on Windows)
resources/bin/ffprobe
```

Run `npm run verify:bin` after building. It checks the four things that have actually gone
wrong here, all of which are silent until runtime.

**The version is pinned in `ffmpeg-version.txt`** — one line, read by all three build scripts
and used as the release tag CI publishes under. Bumping it is what "new binaries" means.

**CI does this per OS**, hand-run from the Actions tab: `.github/workflows/ffmpeg-{macos,linux,windows}.yml`
run `scripts/build-ffmpeg{,-linux,-windows}.sh` and attach the pair to a prerelease tagged
`ffmpeg-<version>`. The app builds download that tag rather than compiling anything. The recipe
below is the same one, by hand, and the sections after it are why each flag is there — the
scripts are the executable form, this is the argument.

---

## Why build from source

The obvious shortcut — a prebuilt static build — ships a GPLv3 binary carrying x264, x265,
AV1, subtitle and font rendering, video stabilisation and teletext decoding, at ~80 MB each,
to encode mp3. Building it yourself gets three things:

- **LGPL instead of GPLv3.** Nothing this app needs is GPL. Every GPL component in a stock
  build is video; `--enable-version3` comes only from the AMR codecs. Omit both and the
  result is LGPL 2.1+, which reduces the distribution obligation to shipping a licence and a
  source pointer.
- **Roughly a quarter of the size**, on a pair of binaries shipped with every release.
- **`--disable-network` makes ADR-0014 structural.** "Zero network requests in any code
  path" currently relies on the app never handing ffmpeg a URL. A binary built without
  protocol support cannot make one whatever it is passed.

The app spawns these as **separate processes** and never links them (ADR-0003), so neither
licence propagates to the app's own code. What is owed on distribution is for the binaries:
their licence text, the version, and the corresponding source or an offer of it.

---

## LAME first, static

ffmpeg has no native mp3 *encoder*; `libmp3lame` is the whole point of this build.

```sh
curl -LO https://downloads.sourceforge.net/lame/lame-3.100.tar.gz
tar xf lame-3.100.tar.gz && cd lame-3.100
./configure --prefix="$HOME/ffbuild" --enable-static --disable-shared --disable-frontend
make -j"$(nproc)" && make install
```

## ffmpeg

```sh
curl -LO https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz
tar xf ffmpeg-7.1.tar.xz && cd ffmpeg-7.1

PKG_CONFIG_PATH="$HOME/ffbuild/lib/pkgconfig" ./configure \
  --prefix="$HOME/ffbuild" \
  --pkg-config-flags="--static" \
  --extra-cflags="-I$HOME/ffbuild/include" \
  --extra-ldflags="-L$HOME/ffbuild/lib -static" \
  --enable-static --disable-shared \
  --enable-libmp3lame \
  --disable-network \
  --disable-doc --disable-ffplay --disable-autodetect \
  --disable-encoders --enable-encoder=libmp3lame \
  --disable-muxers  --enable-muxer=mp3 \
  --disable-devices --enable-indev=lavfi

make -j"$(nproc)"
cp ffmpeg ffprobe /path/to/coros-sync-app/resources/bin/
```

**Do not add `--enable-gpl` or `--enable-version3`.** They are what makes a build GPL, and
nothing here needs either.

### Why each unobvious flag is there

| Flag | Reason |
|---|---|
| `--disable-autodetect` | Without it, configure silently links whatever it finds on the build host — the exact way a "static" build acquires a dylib dependency it only reveals on someone else's machine. |
| `--disable-encoders --enable-encoder=libmp3lame` | One encoder is all the app invokes. **Decoders and demuxers are left fully enabled on purpose** — the import filter accepts mp3, m4a, m4b, aac, flac, wav, ogg and wma, and a user's file is whatever it is. Trimming decoders is where a minimal build starts failing on real libraries. |
| `--enable-indev=lavfi` | `verify:bin` synthesises a sine wave to prove the round trip. Drop it and the check cannot run. |
| `--disable-network` | ADR-0014, enforced by the binary rather than trusted. |
| `-static` in `--extra-ldflags` | `--enable-static` alone only makes ffmpeg's *own* libs static — the binary still dynamically links `libc`/`libm`/`ld-linux` and fails `verify:bin`'s "not a dynamic executable" check. Needs `libc6-dev`'s `libc.a`/`libm.a` on the build host. |

## macOS

`--enable-static` cannot produce a fully static Mach-O — libSystem is always dynamic, and
`verify:bin` accepts exactly that and nothing else. Build on the oldest macOS you intend to
support, and set `--extra-cflags="-mmacosx-version-min=11.0"` to match.

Universal binaries are not needed: ship an arm64 build and an x86_64 build, and let the
per-arch packaging pick. **Packaged macOS spawn is still untested** (DECISIONS §4) — Spike B
covered Linux x64 only, and Gatekeeper, quarantine and notarisation are unproven here.

---

## yt-dlp — the third binary, and the odd one out

`resources/bin/yt-dlp` (`yt-dlp.exe` on Windows) is fetched, not built. It ships prebuilt and
standalone — no Python on the user's machine — so there is no recipe here, only a pin:

```
resources/ytdlp-version.txt      one line, e.g. 2026.07.04
```

The three `build-*` workflows curl the matching asset from yt-dlp's own releases:
`yt-dlp_linux`, `yt-dlp_macos` (universal2 — one file covers both mac arches), `yt-dlp.exe`.
`verify:bin` only asks whether it runs and whether it matches the pin.

**It gets no network check, and that is the point.** For ffmpeg, a binary that cannot dial out
is the stronger guarantee; for this one, dialling out is the job (ADR-0027, ARCHITECTURE §8.4).

**The licence constrains nothing** — yt-dlp is Unlicense, and the app spawns it as a separate
process exactly as it spawns ffmpeg (ADR-0003), so nothing propagates either way.

**It rots, and the pin is not the fix.** Extractors break on the sites' schedule and this app
ships no updater (ADR-0014), so a bundled copy goes stale between releases. The answer is the
`ytdlpPath` setting (ADR-0055): the user points Settings at their own current yt-dlp and the
bundled one is ignored. Bumping the pin is what "new yt-dlp" means for a *fresh install*; how
often a release is cut to do it is an open question (`DECISIONS.md §4`).

---

## Shipping

`scripts/notices.mjs` does this, and every ffmpeg workflow runs it before packing. It reads
the configure line out of `config.h` — what the build actually did, not what a script claims —
copies both `COPYING` files next to the binaries, writes `THIRD-PARTY.txt`, and stages the two
source tarballs, which the workflow then attaches to the `ffmpeg-<version>` release.

The zips carry all three files, so app builds inherit them by unpacking, and `extraResource`
puts them inside the shipped app. Nothing here is owed by hand — but a build published without
that step is a build distributed in breach, so do not pack one by hand either.
