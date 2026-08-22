import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { REPO } from './app';

const exec = promisify(execFile);

// The same static build the app ships, so a fixture cannot be decodable by a codec the app lacks.
const ffmpeg = path.join(REPO, 'resources', 'bin', 'ffmpeg');

// Cached across runs: a sine is cheap, an hour of encoded sine is not. Keyed by name, never by mtime.
const CACHE = path.join(tmpdir(), 'coros-e2e-media');

const cached = async (name: string, make: (out: string) => Promise<void>): Promise<string> => {
    await mkdir(CACHE, { recursive: true });
    const out = path.join(CACHE, name);
    if (!existsSync(out)) await make(out);

    return out;
};

/** One track. Distinct frequencies so a mixed-up file is audible as well as assertable. */
export const musicFile = (name: string, seconds = 4, hz = 440): Promise<string> =>
    cached(`${name}.mp3`, async (out) => {
        await exec(ffmpeg, [
            '-y',
            '-f', 'lavfi',
            '-i', `sine=frequency=${hz}:duration=${seconds}`,
            '-c:a', 'libmp3lame',
            '-b:a', '128k',
            out,
        ]);
    });

export type ChapterSpec = { title: string; seconds: number };

/** A real chaptered m4b — the import filter accepts nothing else, and the probe must find the marks. */
export const audiobookFile = (name: string, chapters: ChapterSpec[]): Promise<string> =>
    cached(`${name}.m4b`, async (out) => {
        const total = chapters.reduce((sum, chapter) => sum + chapter.seconds, 0);

        let at = 0;
        const meta = [';FFMETADATA1', `title=${name}`, 'artist=E2E'];
        for (const chapter of chapters) {
            meta.push(
                '',
                '[CHAPTER]',
                'TIMEBASE=1/1000',
                `START=${at * 1000}`,
                `END=${(at + chapter.seconds) * 1000}`,
                `title=${chapter.title}`,
            );
            at += chapter.seconds;
        }

        const metaPath = `${out}.meta.txt`;
        await writeFile(metaPath, meta.join('\n'), 'utf8');

        await exec(ffmpeg, [
            '-y',
            '-f', 'lavfi',
            '-i', `sine=frequency=220:duration=${total}`,
            '-i', metaPath,
            '-map', '0:a',
            '-map_metadata', '1',
            '-c:a', 'aac',
            '-b:a', '32k',
            out,
        ], { maxBuffer: 1024 * 1024 * 16 });
    });

/** An .mp3 that is not one. The extension gets it past the picker; the child then exits non-zero. */
export const undecodableFile = (name: string): Promise<string> =>
    cached(`${name}.mp3`, (out) => writeFile(out, 'this is not an audio file', 'utf8'));
