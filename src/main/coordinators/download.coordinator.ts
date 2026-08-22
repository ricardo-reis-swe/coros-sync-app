import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fetchAudio } from '../adapters/download/download.adapter';
import {
    allocateSourceDir,
    deleteSourceDir,
    isManagedSource,
    sourcesRoot,
} from '../adapters/download/SourceStore';
import { getItems, insertItem, nextOrderIndex } from '../adapters/db/db.queries';
import { emitChanged, emitNotify, emitProgress } from '../events/bus';
import { CancelledError } from '../queue/queue';
import { log } from '../utils/logger';

/** The transient DownloadSession — never a table, never a row. (ADR-0027) */
type Queued = { url: string; groupId: string };

let pending: Queued[] = [];
let running: AbortController | null = null;
let done = 0;
let total = 0;

export const isDownloading = (): boolean => running !== null || pending.length > 0;

/** Serial, and outside the Job Queue: `N` counts ffmpeg children, and this is not one. (ADR-0004) */
export const importUrls = async (urls: string[]): Promise<void> => {
    // One import is one group, exactly as a multi-file pick is. (ADR-0030)
    const groupId = randomUUID();
    const busy = isDownloading();

    pending.push(...urls.map((url) => ({ url, groupId })));
    total += urls.length;
    publish();

    // A batch arriving mid-drain joins the running one rather than starting a second.
    if (busy) return;

    try {
        while (pending.length > 0) {
            const next = pending.shift() as Queued;
            await downloadOne(next.url, next.groupId);

            done++;
            publish();
        }
    } finally {
        pending = [];
        running = null;
        done = 0;
        total = 0;
        emitProgress({ download: null });
    }
};

/** Kills the running child and drops the rest; the cleanup is the download's own. (ADR-0023) */
export const cancelDownloads = (): void => {
    pending = [];
    running?.abort();
};

const publish = (): void => emitProgress({ download: { done, total } });

const downloadOne = async (url: string, groupId: string): Promise<void> => {
    const controller = new AbortController();
    running = controller;

    const dir = await allocateSourceDir(randomUUID());

    try {
        const { filePath, title } = await fetchAudio(url, dir, controller.signal);

        // The row follows the bytes: after the child exits 0, never in anticipation. (ADR-0007)
        insertItem({
            state: 'imported',
            groupId,
            groupName: 'Downloads',
            sourcePath: filePath,
            type: 'media',
            title,
            // No bitrate and no split length: they land on the row at Process. (ADR-0036)
            orderIndex: nextOrderIndex('media'),
        });

        emitChanged();
    } catch (err) {
        await failDownload(url, dir, controller.signal, err);
    } finally {
        running = null;
    }
};

/** No row to revert, so ADR-0003 reduces to: delete the directory, then say so — or not. */
const failDownload = async (
    url: string,
    dir: string,
    signal: AbortSignal,
    err: unknown,
): Promise<void> => {
    await deleteSourceDir(dir);

    // `runChild` cannot know a kill was asked for, so the tier that asked names it. (ADR-0023)
    if (signal.aborted || err instanceof CancelledError) return;

    const reason = err instanceof Error ? err.message : String(err);
    log.error(`[download] ${url} failed: ${reason}`);
    emitNotify({ level: 'error', message: `Download failed: ${reason}` });
};

/** A crash leaves a whole directory behind. Startup reconciliation, widened — not a fifth log site. (ADR-0013) */
export const sweepSourcesOnStartup = async (): Promise<void> => {
    const claimed = new Set(
        getItems()
            .filter((item) => isManagedSource(item.sourcePath))
            .map((item) => path.dirname(item.sourcePath)),
    );

    const entries = await readdir(sourcesRoot(), { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
        const dir = path.join(sourcesRoot(), entry.name);
        if (claimed.has(dir)) continue;

        log.warn(`[download] sweeping orphaned source ${entry.name}`);
        await deleteSourceDir(dir);
    }
};
