#!/usr/bin/env node
// Regenerates the committed raster icons from assets/icon.svg; the outputs are committed because no CI runner has this toolchain.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ASSETS = new URL('../assets/', import.meta.url).pathname;
const SVG = join(ASSETS, 'icon.svg');
const MASTER = 1024;

// .icns needs iconutil, which is macOS-only, so a non-darwin run leaves the committed one alone.
const ICNS_SIZES = [16, 32, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const need = (bin, hint) => {
    try {
        execFileSync('/bin/sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    } catch {
        console.error(`missing ${bin} — ${hint}`);
        process.exit(1);
    }
};
need('rsvg-convert', 'brew install librsvg');
need('magick', 'brew install imagemagick');

const work = mkdtempSync(join(tmpdir(), 'coros-icons-'));
const master = join(work, 'master.png');
// One 1024 render downsampled with Lanczos beats re-rendering the SVG small, where hairlines drop out.
execFileSync('rsvg-convert', ['-w', String(MASTER), '-h', String(MASTER), SVG, '-o', master]);

const scale = (size, out) =>
    execFileSync('magick', [master, '-filter', 'Lanczos', '-resize', `${size}x${size}`, out]);

scale(512, join(ASSETS, 'icon.png'));

execFileSync('magick', [master, '-filter', 'Lanczos', '-define', 'icon:auto-resize=' + ICO_SIZES.join(','), join(ASSETS, 'icon.ico')]);

if (process.platform === 'darwin') {
    const iconset = join(work, 'icon.iconset');
    mkdirSync(iconset);
    for (const size of ICNS_SIZES) {
        scale(size, join(iconset, `icon_${size}x${size}.png`));
        scale(size * 2, join(iconset, `icon_${size}x${size}@2x.png`));
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ASSETS, 'icon.icns')]);
} else {
    console.warn('not darwin — icon.icns left as committed');
}

rmSync(work, { recursive: true, force: true });
console.log('wrote assets/icon.png, assets/icon.ico' + (process.platform === 'darwin' ? ', assets/icon.icns' : ''));
