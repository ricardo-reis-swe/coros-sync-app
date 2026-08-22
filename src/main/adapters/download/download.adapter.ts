import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runChild } from '../engine/spawn.engine';
import { resolveFfmpeg, resolveYtdlp } from '../../utils/resolvers';
import { ytdlpPath } from '../db/settings';
import { DownloadError, DownloadResult } from './download.types';

const SOURCE_STEM = 'source';
const TITLE_FILE = 'title.txt';

/** The user's own copy wins; read per fetch, because a rotted bundle is fixed without a release. (ADR-0055) */
const binary = (): string => ytdlpPath() ?? resolveYtdlp();

const buildArgs = (url: string, destDir: string): string[] => [
    // A config file on this machine could otherwise add `--exec` to a child we spawn. (ARCHITECTURE §8.4)
    '--ignore-config',
    // A playlist link yields its first entry; expanding one is a decision. (DECISIONS §4)
    '--no-playlist',
    '--no-progress',
    // `--print-to-file` implies simulate; without this the child exits 0 having downloaded nothing.
    '--no-simulate',
    // A source, never an output: no `--extract-audio`, no `--audio-format`. (ADR-0027)
    '-f',
    'bestaudio/best',
    // Pinned, so it can never find another ffmpeg — ours is the one built `--disable-network`.
    '--ffmpeg-location',
    path.dirname(resolveFfmpeg()),
    // Our template, so a crafted remote title cannot decide where bytes land.
    '-o',
    path.join(destDir, `${SOURCE_STEM}.%(ext)s`),
    '--print-to-file',
    '%(title)s',
    path.join(destDir, TITLE_FILE),
    '--',
    url,
];

/** One call, one child, one source file. Honouring the signal is the adapter's job. (ADR-0023) */
export const fetchAudio = async (
    url: string,
    destDir: string,
    signal: AbortSignal,
): Promise<DownloadResult> => {
    await runChild(binary(), buildArgs(url, destDir), signal);

    const produced = (await readdir(destDir)).find(
        (name) => name.startsWith(`${SOURCE_STEM}.`) && !name.endsWith('.part'),
    );

    // Exit 0 with nothing written is the extractor's way of succeeding at nothing.
    if (!produced) throw new DownloadError('the download produced no audio file');

    return {
        filePath: path.join(destDir, produced),
        title: await readTitle(destDir, produced),
    };
};

/** Read back from a file, never from stdout: the title is an item title and never a filename. */
const readTitle = async (destDir: string, produced: string): Promise<string> => {
    const raw = await readFile(path.join(destDir, TITLE_FILE), 'utf8').catch(() => '');
    const title = raw.trim().split('\n')[0]?.trim();

    return title || path.parse(produced).name;
};
