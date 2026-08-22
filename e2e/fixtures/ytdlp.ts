import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A stand-in yt-dlp. `ytdlpPath` (ADR-0055) is the seam, so nothing in `src/` learns a test exists
 * and the suite never touches the network — the one thing an import-from-URL test must not do.
 *
 * It honours the adapter's real argv: `-o <dir>/source.%(ext)s` decides where bytes land, and
 * `--print-to-file %(title)s <file>` is where the title comes from. A fake that ignored either
 * would pass while the real flags were wrong, which is the failure this fixture exists to catch.
 */
export const fakeYtdlp = async (options: {
    /** Copied to `source.mp3` on success. */
    source?: string;
    /** Non-zero exit, the way a dead extractor fails. */
    fail?: boolean;
    /** Writes the fragment yt-dlp leaves behind, then fails — the debris cleanup must catch it. */
    leaveFragment?: boolean;
    /** Exits 0 having written nothing, which the adapter must refuse to call a success. */
    empty?: boolean;
}): Promise<string> => {
    const dir = await mkdtemp(path.join(tmpdir(), 'coros-ytdlp-'));
    const bin = path.join(dir, 'yt-dlp');

    const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);

const after = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };

const template = after('-o');
const destDir = path.dirname(template);
const printIndex = argv.indexOf('--print-to-file');
const titleFile = printIndex === -1 ? null : argv[printIndex + 2];
const url = argv[argv.length - 1];
// The title yt-dlp would have extracted: the last path segment, so a test can assert it.
const title = decodeURIComponent(url.split('/').filter(Boolean).pop() || 'untitled');

if (titleFile) fs.writeFileSync(titleFile, title + '\\n');

if (${Boolean(options.leaveFragment)}) {
    fs.writeFileSync(path.join(destDir, 'source.mp3.part'), 'half a download');
}
if (${Boolean(options.fail)} || ${Boolean(options.leaveFragment)}) {
    process.stderr.write('ERROR: unable to extract player response\\n');
    process.exit(1);
}
if (!${Boolean(options.empty)}) {
    fs.copyFileSync(${JSON.stringify(options.source ?? '')}, path.join(destDir, 'source.mp3'));
}
process.exit(0);
`;

    await writeFile(bin, script);
    await chmod(bin, 0o755);

    return bin;
};
