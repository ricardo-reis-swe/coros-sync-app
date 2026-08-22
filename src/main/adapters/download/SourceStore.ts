import { app } from 'electron';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

/** The app's second owned blob: a fetched source has no path to be read in place. (ADR-0027) */
export const sourcesRoot = (): string => path.join(app.getPath('userData'), 'sources');

export const allocateSourceDir = async (downloadId: string): Promise<string> => {
    const dir = path.join(sourcesRoot(), downloadId);
    await mkdir(dir, { recursive: true });

    return dir;
};

/** By directory, not by file — that is what catches yt-dlp's `.part` fragment. (ADR-0003) */
export const deleteSourceDir = async (dir: string): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
};

/** Provenance is derived, never stored: the prefix is the whole answer. (ADR-0027) */
export const isManagedSource = (sourcePath: string): boolean => {
    const relative = path.relative(sourcesRoot(), sourcePath);

    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
