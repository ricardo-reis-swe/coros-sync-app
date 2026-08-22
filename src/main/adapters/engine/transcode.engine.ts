import { rm } from 'node:fs/promises';
import { resolveFfmpeg } from '../../utils/resolvers';
import { TranscodeTask } from './engine.types';
import { runChild } from './spawn.engine';

/** One invocation, one file; main is never in the byte path. Partials die on the way out. (ADR-0003) */
export const transcode = async (task: TranscodeTask, signal: AbortSignal): Promise<void> => {
    try {
        await runChild(resolveFfmpeg(), buildArgs(task), signal);
    } catch (err) {
        await rm(task.outPath, { force: true });
        throw err;
    }
};

const buildArgs = (task: TranscodeTask): string[] => {
    const args = ['-hide_banner', '-nostdin', '-y'];

    // -ss before -i is the fast seek; -t (a duration) because -to's meaning moves with -i.
    if (task.startSec !== undefined) {
        args.push('-ss', String(task.startSec));
    }
    if (task.startSec !== undefined && task.endSec !== undefined) {
        args.push('-t', String(task.endSec - task.startSec));
    }

    args.push('-i', task.sourcePath);

    // -vn drops cover art; -map_metadata -1 drops source tags so only the per-file ones land.
    args.push('-vn', '-map_metadata', '-1');
    // Already mp3 at or under target, and no cut to make: remux, sparing a generation. (ADR-0043)
    if (task.bitrate === 'source') {
        args.push('-c:a', 'copy');
    } else {
        args.push('-c:a', 'libmp3lame', '-b:a', `${task.bitrate}k`);
    }

    if (task.title) args.push('-metadata', `title=${task.title}`);
    if (task.author) args.push('-metadata', `artist=${task.author}`);

    args.push('-id3v2_version', '3', task.outPath);

    return args;
};
