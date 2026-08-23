#!/usr/bin/env node
/** `npm run verify:bin` — checks resources/bin is static and can actually encode mp3. Downloads nothing. */
/** `--ffmpeg-only` drops the yt-dlp checks, for the ffmpeg workflows: they build ffmpeg, and nothing else is there yet. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BIN_DIR = path.join(process.cwd(), 'resources', 'bin');
const EXE = process.platform === 'win32' ? '.exe' : '';
const ffmpeg = path.join(BIN_DIR, `ffmpeg${EXE}`);
const ffprobe = path.join(BIN_DIR, `ffprobe${EXE}`);
const ytdlp = path.join(BIN_DIR, `yt-dlp${EXE}`);

const ffmpegOnly = process.argv.includes('--ffmpeg-only');

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });
// Shippable, but worth knowing — never counted as a failure.
const warn = (name, detail) => results.push({ name, ok: true, warn: true, detail });

const run = (bin, args) =>
    execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/* ---------- (0) present and executable ---------- */

for (const bin of ffmpegOnly ? [ffmpeg, ffprobe] : [ffmpeg, ffprobe, ytdlp]) {
    const name = `${path.basename(bin)} present`;

    if (!existsSync(bin)) {
        record(name, false, `missing — drop a static build at ${bin}`);
        continue;
    }

    // Any execute bit — a binary copied off a FAT stick arrives without them. Windows has none to report.
    const executable = process.platform === 'win32' || (statSync(bin).mode & 0o111) !== 0;
    record(name, executable, executable ? path.basename(bin) : 'not executable (chmod +x)');
}

if (results.some((result) => !result.ok)) report();

/* ---------- (a) static ---------- */

const linkage = () => {
    if (process.platform === 'darwin') {
        // "Static" on macOS means nothing outside the dyld shared cache — a framework-free ffmpeg cannot exist.
        const out = run('otool', ['-L', ffmpeg]);
        const external = out
            .split('\n')
            .slice(1)
            .map((line) => line.trim().split(' ')[0])
            .filter((lib) => lib && !/^(\/System\/Library\/Frameworks\/|\/usr\/lib\/)/.test(lib));

        return external.length === 0
            ? { ok: true, detail: 'system frameworks only' }
            : { ok: false, detail: `links ${external.length} non-system dylib(s): ${external[0]}` };
    }

    if (process.platform === 'linux') {
        try {
            const out = run('ldd', [ffmpeg]);
            return { ok: false, detail: out.split('\n')[0].trim() };
        } catch (err) {
            // `ldd` exits non-zero with exactly this on a static binary.
            const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
            return /not a dynamic executable/.test(out)
                ? { ok: true, detail: 'not a dynamic executable' }
                : { ok: false, detail: out.trim().split('\n')[0] || 'ldd failed' };
        }
    }

    return { ok: true, detail: 'skipped on this platform' };
};

const link = linkage();
record('ffmpeg is static', link.ok, link.detail);

/* ---------- (a2) the right arch — a thin binary is an Exec format error on the other Mac ---------- */

if (process.platform === 'darwin') {
    try {
        const archs = run('lipo', ['-archs', ffmpeg]).trim().split(/\s+/);

        if (!archs.includes(process.arch)) record('ffmpeg arch', false, `${archs.join('+')} — this Mac is ${process.arch}`);
        else if (archs.length === 1) warn('ffmpeg arch', `${archs[0]} only — not universal, will not run on the other Mac`);
        else record('ffmpeg arch', true, `universal (${archs.join('+')})`);
    } catch (err) {
        record('ffmpeg arch', false, err.message);
    }
}

/* ---------- (b) carries libmp3lame — `-encoders`, never `-muxers` ---------- */

try {
    const encoders = run(ffmpeg, ['-hide_banner', '-encoders']);
    const has = /\blibmp3lame\b/.test(encoders);
    record('libmp3lame encoder', has, has ? 'present' : 'MISSING — a stock build will not transcode');
} catch (err) {
    record('libmp3lame encoder', false, err.message);
}

/* ---------- (c) licence posture and network ---------- */

try {
    const configuration = run(ffmpeg, ['-hide_banner', '-version']);
    const has = (flag) => configuration.includes(`--enable-${flag}`);

    // The only fatal one: a nonfree build cannot be redistributed at all, at any price.
    record('redistributable', !has('nonfree'), has('nonfree') ? '--enable-nonfree — CANNOT ship' : 'no --enable-nonfree');

    const licence = has('gpl')
        ? has('version3') ? 'GPLv3' : 'GPLv2+'
        : has('version3') ? 'LGPLv3' : 'LGPLv2.1+';

    // GPL is shippable, it just owes more — reported, never enforced. See resources/README.md.
    if (licence.startsWith('L')) record(`licence: ${licence}`, true, 'minimal obligation');
    else warn(`licence: ${licence}`, 'shippable, but owes source + licence at release');

    // ffmpeg is spawned, never handed a URL; a binary that cannot dial out is stronger. (ADR-0014)
    const online = /^\s*(https?)\b/m.test(run(ffmpeg, ['-hide_banner', '-protocols']));
    if (online) warn('network protocols', 'built with network support; --disable-network is stronger');
    else record('no network protocols', true, 'file protocols only');
} catch (err) {
    record('licence posture', false, err.message);
}

/* ---------- (d) the round trip: sine -> mp3 -> probe ---------- */

const scratch = mkdtempSync(path.join(tmpdir(), 'coros-verify-'));
const sample = path.join(scratch, 'sample.mp3');

try {
    run(ffmpeg, [
        '-hide_banner', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:a', 'libmp3lame', '-b:a', '64k',
        sample,
    ]);

    const probed = JSON.parse(
        run(ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_streams', sample]),
    );
    const audio = (probed.streams ?? []).find((stream) => stream.codec_type === 'audio');

    record(
        'sine → mp3 → probe',
        audio?.codec_name === 'mp3',
        audio ? `decoded as ${audio.codec_name}` : 'no audio stream in the output',
    );
} catch (err) {
    record('sine → mp3 → probe', false, (err.stderr || err.message).toString().trim().split('\n').pop());
} finally {
    rmSync(scratch, { recursive: true, force: true });
}

/* ---------- (e) yt-dlp runs, and matches the pin ---------- */

// No network check here: for ffmpeg a binary that cannot dial out is stronger, for this one it is the job.
if (!ffmpegOnly) {
    try {
        const version = run(ytdlp, ['--version']).trim();
        const pinned = readFileSync(path.join(process.cwd(), 'resources', 'ytdlp-version.txt'), 'utf8').trim();

        record('yt-dlp runs', /^\d{4}\.\d{2}\.\d{2}/.test(version), version || 'no version printed');

        // A drifted pin is shippable; it only means CI would fetch a different binary than this one. (DECISIONS §4)
        if (version !== pinned) warn('yt-dlp pin', `binary is ${version}, ytdlp-version.txt says ${pinned}`);
        else record('yt-dlp pin', true, pinned);
    } catch (err) {
        record('yt-dlp runs', false, (err.stderr || err.message).toString().trim().split('\n').pop());
    }
}

report();

function report() {
    for (const { name, ok, warn: isWarn, detail } of results) {
        const status = !ok ? 'FAIL' : isWarn ? 'warn' : 'ok  ';
        console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
    }

    const failed = results.filter((result) => !result.ok).length;
    const warned = results.filter((result) => result.ok && result.warn).length;
    const suffix = warned > 0 ? `, ${warned} warning${warned > 1 ? 's' : ''}` : '';

    console.log(
        failed === 0
            ? `\n${results.length} checks passed${suffix} — resources/bin can ship.`
            : `\n${failed} of ${results.length} failed${suffix} — this build breaks at runtime, not at build time.`,
    );

    process.exit(failed === 0 ? 0 : 1);
}
