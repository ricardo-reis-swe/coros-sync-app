#!/usr/bin/env node
/** `node scripts/notices.mjs` — writes the LGPL notices next to the binaries and stages the source for upload. */
/** Run after a build script, while out/ffmpeg-build still holds the extracted trees. Downloads nothing. */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BUILDS = path.join(ROOT, 'out', 'ffmpeg-build');
const BIN = path.join(ROOT, 'resources', 'bin');
const SOURCE = path.join(ROOT, 'out', 'source');

const die = (why) => {
    console.error(`notices: ${why}`);
    process.exit(1);
};

// Every build script lays out out/ffmpeg-build/<target>/, so one search covers all three platforms.
const find = (prefix) => {
    if (!existsSync(BUILDS)) die(`no ${path.relative(ROOT, BUILDS)} — run a build script first`);

    for (const target of readdirSync(BUILDS)) {
        const dir = path.join(BUILDS, target);
        for (const entry of readdirSync(dir)) {
            if (entry.startsWith(prefix) && !entry.endsWith('.tar.gz') && !entry.endsWith('.tar.xz')) {
                return path.join(dir, entry);
            }
        }
    }

    return undefined;
};

const tarball = (prefix) => {
    for (const target of readdirSync(BUILDS)) {
        const dir = path.join(BUILDS, target);
        const hit = readdirSync(dir).find((e) => e.startsWith(prefix) && (e.endsWith('.tar.gz') || e.endsWith('.tar.xz')));
        if (hit) return path.join(dir, hit);
    }

    return undefined;
};

const ffmpegSrc = find('ffmpeg-') ?? die('no extracted ffmpeg tree under out/ffmpeg-build');
const lameSrc = find('lame-') ?? die('no extracted lame tree under out/ffmpeg-build');

const ffmpegVersion = path.basename(ffmpegSrc).replace('ffmpeg-', '');
const lameVersion = path.basename(lameSrc).replace('lame-', '');

// The configuration as ffmpeg recorded it, not as a script claims it: a cross build cannot be asked to print it.
const configHeader = [path.join(ffmpegSrc, 'config.h'), path.join(ffmpegSrc, 'ffbuild', 'config.h')].find(existsSync);
if (!configHeader) die(`no config.h under ${path.relative(ROOT, ffmpegSrc)} — configure has not run`);

const configuration = /#define FFMPEG_CONFIGURATION "(.*)"/.exec(readFileSync(configHeader, 'utf8'))?.[1];
if (!configuration) die(`no FFMPEG_CONFIGURATION in ${path.relative(ROOT, configHeader)}`);

const lgpl = path.join(ffmpegSrc, 'COPYING.LGPLv2.1');
const lameCopying = path.join(lameSrc, 'COPYING');
for (const file of [lgpl, lameCopying]) if (!existsSync(file)) die(`missing licence text: ${file}`);

mkdirSync(BIN, { recursive: true });
copyFileSync(lgpl, path.join(BIN, 'COPYING.LGPLv2.1'));
copyFileSync(lameCopying, path.join(BIN, 'COPYING.LAME'));

// Owner-agnostic like the rest of CI: the release is named, never the account that hosts it.
const repo = process.env.GITHUB_REPOSITORY;
const hosted = repo
    ? `https://github.com/${repo}/releases/tag/ffmpeg-${ffmpegVersion}`
    : `the ffmpeg-${ffmpegVersion} release of this application's repository`;

const notice = `Third-party programs bundled with Coros Sync App
================================================

These are executed as separate processes. Nothing here is linked into the
application, and none of these licences apply to the application's own code.

ffmpeg, ffprobe ${ffmpegVersion}
--------------------------------
Copyright (c) the FFmpeg developers — https://ffmpeg.org
Licensed under the GNU Lesser General Public License, version 2.1 or later.
Full text: COPYING.LGPLv2.1, beside this file.

Built from unmodified upstream source, statically, with:

${configuration
        .split(' --')
        .map((flag, i) => (i === 0 ? `    ${flag}` : `    --${flag}`))
        .join('\n')}

LAME ${lameVersion} (libmp3lame) is statically linked into those binaries.
Copyright (c) the LAME developers — https://lame.sourceforge.io
Licensed under the GNU Lesser General Public License, version 2.1 or later.
Full text: COPYING.LAME, beside this file.

Source code
-----------
The exact sources these binaries were built from, so they can be studied,
rebuilt, modified, or relinked against a different libmp3lame:

    ${hosted}

ffmpeg-${ffmpegVersion}.tar.xz and lame-${lameVersion}.tar.gz are attached there.
The same files upstream:

    https://ffmpeg.org/releases/ffmpeg-${ffmpegVersion}.tar.xz
    https://downloads.sourceforge.net/project/lame/lame/${lameVersion}/lame-${lameVersion}.tar.gz

The scripts that drive the build are scripts/build-ffmpeg*.sh in the
application's repository, and the configure line above is what they produced.

yt-dlp
------
Released into the public domain under the Unlicense — https://github.com/yt-dlp/yt-dlp
Bundled unmodified, as published upstream. No obligation attaches; the credit is
deliberate.
`;

writeFileSync(path.join(BIN, 'THIRD-PARTY.txt'), notice, 'utf8');

// Staged rather than uploaded here: publishing is the workflow's job, and it already holds the token.
mkdirSync(SOURCE, { recursive: true });
for (const prefix of ['ffmpeg-', 'lame-']) {
    const archive = tarball(prefix);
    if (!archive) die(`no ${prefix}source tarball under out/ffmpeg-build`);
    copyFileSync(archive, path.join(SOURCE, path.basename(archive)));
}

console.log(`notices: ffmpeg ${ffmpegVersion} + lame ${lameVersion}`);
console.log(`  resources/bin/{THIRD-PARTY.txt, COPYING.LGPLv2.1, COPYING.LAME}`);
console.log(`  out/source/${readdirSync(SOURCE).join(', ')}`);
