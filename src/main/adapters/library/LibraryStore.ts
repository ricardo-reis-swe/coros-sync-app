import { app } from 'electron';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Produced mp3s and nothing else, one directory per item — no source is ever copied in. (ADR-0020) */
export const libraryRoot = (): string => path.join(app.getPath('userData'), 'library');

export const itemOutputDir = (itemId: string): string => path.join(libraryRoot(), itemId);

export const allocateOutputPath = async (itemId: string, deviceFilename: string) => {
    const dir = itemOutputDir(itemId);
    await mkdir(dir, { recursive: true });

    return path.join(dir, deviceFilename);
};

/** By directory, not by row — that is what catches the half-written file. (ADR-0003) */
export const deleteItemOutputs = async (itemId: string): Promise<void> => {
    await rm(itemOutputDir(itemId), { recursive: true, force: true });
};

/** Metadata only; a missing file counts as 0 and fails later at the copy, where it reads true. */
export const outputSizeBytes = async (filePath: string): Promise<number> => {
    try {
        return (await stat(filePath)).size;
    } catch {
        return 0;
    }
};
