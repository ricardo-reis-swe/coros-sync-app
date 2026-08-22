import path from 'path';
import { Item, ItemType } from '../../shared/data.types';
import {
    deleteItem,
    deleteOutputsByItemId,
    getAllOutputs,
    getItem,
    getItems,
    getOutputsByItemId,
    insertItem,
    nextOrderIndex,
    reorderItems,
    updateItem,
    insertOutput,
} from '../adapters/db/db.queries';
import { bitrateSetting, splitEveryMinSetting } from '../adapters/db/settings';
import { generateDeviceFilenames, OutputSpec, sanitise } from '../adapters/device/filename.device';
import { ProbeResult, TranscodeTask } from '../adapters/engine/engine.types';
import { probe } from '../adapters/engine/probe.engine';
import { transcode } from '../adapters/engine/transcode.engine';
import { allocateOutputPath, deleteItemOutputs } from '../adapters/library/LibraryStore';
import { deleteSourceDir, isManagedSource } from '../adapters/download/SourceStore';
import { isSyncing } from './sync.coordinator';
import { emitChanged, emitNotify, emitProgress } from '../events/bus';
import { pool } from '../queue/pool';
import { CancelledError } from '../queue/queue';
import { log } from '../utils/logger';

/** An item whose bitrate is settled — which only happens once processing starts. (ADR-0036) */
type Decided = Item & { bitrate: number };

/** The transient Job — `M` lives here, never in SQLite. (ADR-0007) */
type Job = {
    itemId: string;
    expectedOutputs: number;
    completed: number;
};

const jobs = new Map<string, Job>();

/** Tier two: covers the gaps *between* an item's tasks. Not chained to the pool's. (ADR-0023) */
const cancellations = new Map<string, AbortController>();

// The names an in-flight item has been promised: rows cannot hold them until the child exits. (ADR-0007)
const reservedNames = new Map<string, string[]>();

/* ---------- import ---------- */

export const processImport = async (type: ItemType, sourcePaths: string[], groupName: string) => {
    // No bitrate and no split length: they land on the row when processing starts. (ADR-0036)
    const groupId = crypto.randomUUID();
    sourcePaths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    // Appended, not started at 0: the index space is the whole type now. (ADR-0030)
    let i = nextOrderIndex(type);
    for (const sourcePath of sourcePaths) {
        insertItem({
            state: 'imported',
            groupId,
            groupName,
            sourcePath: sourcePath,
            type,
            title: path.parse(sourcePath).name,
            orderIndex: i,
        });

        i++;
    }

    // The coordinator that wrote the rows announces them, never the Gateway. (ADR-0004 / ADR-0039)
    if (sourcePaths.length > 0) emitChanged();
};

/** Order is a user decision, so it is stored where every other item fact is. (ADR-0030) */
export const reorderItemsInType = (itemIds: string[]): void => {
    reorderItems(itemIds);
    emitChanged();
};

/* ---------- processing ---------- */

/** Not awaited per item: the pool is flat and FIFO, and awaiting would serialise it. (ADR-0008) */
export const processItems = (itemIds: string[]): void => {
    itemIds.forEach((itemId) => void runItem(itemId));
};

/** Both tiers, every time — the caller cannot know which one holds the item. */
export const cancelProcessing = (itemIds: string[]): void => {
    itemIds.forEach((itemId) => {
        cancellations.get(itemId)?.abort();
        pool.cancelGroup(itemId);
    });
};

/** Library only, no device call; refused while `processing` — cancel first. (ADR-0022) */
export const deleteItems = async (itemIds: string[]): Promise<void> => {
    // Blanket, not per item: `reorder-all`'s wipe walks every output live. (ADR-0031)
    if (isSyncing()) {
        emitNotify({ level: 'error', message: 'A sync is running — stop it first.' });
        return;
    }

    for (const itemId of itemIds) {
        const item = getItem(itemId);
        if (!item) continue;

        if (item.state === 'processing') {
            emitNotify({
                level: 'error',
                message: `${item.title ?? 'That item'} is still processing — cancel it first.`,
            });
            continue;
        }

        await deleteItemOutputs(item.id);
        deleteOutputsByItemId(item.id);
        // A fetched source is ours, so it goes with the row. `revertItems` must not — it still needs it.
        if (isManagedSource(item.sourcePath)) await deleteSourceDir(path.dirname(item.sourcePath));
        deleteItem(item.id);
    }

    emitChanged();
};

/** The way back: the cancel path's cleanup, asked for on purpose. Quiet, like a cancel. (ADR-0033) */
export const revertItems = async (itemIds: string[]): Promise<void> => {
    // Blanket, not per item, for ADR-0031's reason.
    if (isSyncing()) {
        emitNotify({ level: 'error', message: 'A sync is running — stop it first.' });
        return;
    }

    for (const itemId of itemIds) {
        const item = getItem(itemId);
        // Already there: nothing to undo, and nothing to say about it.
        if (!item || item.state === 'imported') continue;

        if (item.state === 'processing') {
            emitNotify({
                level: 'error',
                message: `${item.title ?? 'That item'} is still processing — cancel it first.`,
            });
            continue;
        }

        await deleteItemOutputs(item.id); // by directory — catches the half-written file
        deleteOutputsByItemId(item.id);
        // The device keeps its copies; the next scan calls them `unmanaged`. (ADR-0022)
        updateItem(item.id, { state: 'imported' });
    }

    emitChanged();
};

/** Editable at any time; existing `deviceFilename`s never move with it. (ADR-0006) */
export const updateItemDetails = (
    itemId: string,
    // Keys present here are written — including as NULL. Keys absent are left alone.
    fields: Partial<Pick<Item, 'title' | 'author'>>,
): void => {
    const item = getItem(itemId);
    if (!item) return;

    const next = { ...item, ...fields };
    const clash = getItems().find(
        (other) => other.id !== itemId && composedName(other) === composedName(next),
    );

    if (clash) {
        emitNotify({
            level: 'error',
            message: `"${composedName(next)}" is already used by another item in the library.`,
        });
        return;
    }

    updateItem(itemId, fields);

    if (getOutputsByItemId(itemId).length > 0) {
        emitNotify({
            level: 'info',
            message: `Renamed in the library. Files already produced keep the names they were made with.`,
        });
    }

    emitChanged();
};

/** What the name generator will see — sanitised, so device-forbidden chars cannot hide a clash. */
const composedName = (item: Pick<Item, 'title' | 'author' | 'sourcePath'>): string => {
    const title = sanitise(item.title ?? path.parse(item.sourcePath).name);
    const author = item.author ? sanitise(item.author) : '';

    return author ? `${author} - ${title}` : title;
};

/** processed → ready. The user's decision that an item may be sent to the watch. */
export const stageItems = (itemIds: string[]): void => {
    itemIds.forEach((itemId) => {
        const item = getItem(itemId);
        if (item?.state === 'processed') updateItem(itemId, { state: 'ready' });
    });

    emitChanged();
};

/** ready → processed. `stage` backwards: no cleanup, no device call, `orderIndex` kept. (ADR-0047) */
export const unstageItems = (itemIds: string[]): void => {
    // Blanket, like every other write during a session: the running order must not move under it.
    if (isSyncing()) {
        emitNotify({ level: 'error', message: 'A sync is running — stop it first.' });
        return;
    }

    itemIds.forEach((itemId) => {
        const item = getItem(itemId);
        if (item?.state === 'ready') updateItem(itemId, { state: 'processed' });
    });

    emitChanged();
};

/** Anything still `processing` on boot was stranded by a crash: same cleanup as a failure. */
export const reconcileOnStartup = async (): Promise<void> => {
    const stranded = getItems().filter((item) => item.state === 'processing');

    for (const item of stranded) {
        // Startup reconciliation is one of ADR-0013's four log sites.
        log.warn(`[processing] reverting stranded item ${item.title ?? item.id}`);
        await deleteItemOutputs(item.id);
        deleteOutputsByItemId(item.id);
        updateItem(item.id, { state: 'imported' });
    }

    if (stranded.length > 0) emitChanged();
};

const runItem = async (itemId: string): Promise<void> => {
    const item = getItem(itemId);
    if (!item || item.state !== 'imported') return;

    // Read now, not at import, so a revert and re-process picks up today's Settings. (ADR-0036)
    const decided = {
        ...item,
        bitrate: bitrateSetting(item.type),
        splitEveryMin: item.type === 'audiobook' ? splitEveryMinSetting() : undefined,
    };

    // No bitrate yet: the probe decides whether it is honoured or the source's is kept. (ADR-0043)
    updateItem(itemId, { state: 'processing', splitEveryMin: decided.splitEveryMin });
    emitChanged();

    // Fresh per run: one that outlived its run would cancel the next before it started.
    const controller = new AbortController();
    cancellations.set(itemId, controller);

    try {
        // First task, same pool: yields M, and is the only check the source decodes. (ADR-0008)
        const probed = await pool.submit(itemId, (signal) => probe(item.sourcePath, signal));

        // The column records what the files are, which is knowable only now. (ADR-0043 / ADR-0036)
        const encoding = chooseEncoding(decided, probed);
        updateItem(itemId, { bitrate: encoding.recorded });
        emitChanged();

        const planned = await planTasks(decided, probed, encoding.bitrate);

        // The gap the pool cannot see. After the await, so a real planTasks failure stays loud.
        if (controller.signal.aborted) throw new CancelledError(itemId);

        const job: Job = { itemId, expectedOutputs: planned.length, completed: 0 };
        jobs.set(itemId, job);

        await runTasks(item, job, planned);

        updateItem(itemId, { state: 'processed' });
        emitChanged();
    } catch (err) {
        await failItem(item, err);
    } finally {
        jobs.delete(itemId);
        cancellations.delete(itemId);
        // Released after the rows land or the cleanup removes them, so the name is never unclaimed.
        reservedNames.delete(itemId);
    }
};

/** One planned output = one task = one child = one file = one row. (ADR-0008) */
type PlannedOutput = {
    task: TranscodeTask;
    chapterIndex?: number;
    chapterTitle?: string;
    partIndex: number;
    deviceFilename: string;
    deviceFilenamePlain: string;
};

/** Copy only where the copy is exact: already mp3, no better than target, and no cut. (ADR-0043) */
const chooseEncoding = (
    item: Decided,
    probed: ProbeResult,
): { bitrate: number | 'source'; recorded: number } => {
    const source = probed.bitrateKbps;

    // `<=`, never `==`: VBR reports an average, and re-encoding upward invents nothing.
    if (item.type === 'media' && probed.codec === 'mp3' && source !== undefined && source <= item.bitrate) {
        return { bitrate: 'source', recorded: source };
    }

    return { bitrate: item.bitrate, recorded: item.bitrate };
};

/** Media is the M = 1 case of the same shape; an audiobook fans out over chapters then parts. */
const planTasks = async (
    item: Decided,
    probed: ProbeResult,
    bitrate: number | 'source',
): Promise<PlannedOutput[]> => {
    const title = item.title ?? path.parse(item.sourcePath).name;
    const specs = item.type === 'media' ? planMedia() : planAudiobook(item, probed);

    // Both spaces, since either name may be the one that reaches the device. (ADR-0040)
    const taken = new Set([
        ...getAllOutputs().flatMap((output) => [output.deviceFilename, output.deviceFilenamePlain]),
        ...[...reservedNames.values()].flat(),
    ]);
    const names = generateDeviceFilenames({ type: item.type, title, author: item.author }, specs, taken);

    // Claimed before the first await, or two items reading the same `taken` both pick the same name.
    reservedNames.set(item.id, [...names.composed, ...names.plain]);

    return Promise.all(
        specs.map(async (spec, i) => ({
            task: {
                // The library path follows the composed name whatever sync later writes. (ADR-0040)
                sourcePath: item.sourcePath,
                outPath: await allocateOutputPath(item.id, names.composed[i]),
                startSec: spec.startSec,
                endSec: spec.endSec,
                bitrate,
                // Per-file tags: the reason one task is one child. (ADR-0008)
                ...composeTags(item, title, specs[i], names.composed[i]),
            },
            chapterIndex: spec.chapterIndex,
            chapterTitle: spec.chapterTitle,
            partIndex: spec.partIndex,
            deviceFilename: names.composed[i],
            deviceFilenamePlain: names.plain[i],
        })),
    );
};

/** Audiobooks: the book on the title line, `CC PPP` on the artist line — one shape for every output. (DECISIONS §4) */
const composeTags = (
    item: Item,
    title: string,
    spec: PlannedSpec,
    deviceFilename: string,
): Pick<TranscodeTask, 'title' | 'author'> =>
    item.type === 'audiobook'
        ? { title, author: `${pad(spec.chapterIndex ?? 1)} ${pad(spec.partIndex)}` }
        : { title: deviceFilename.replace(/\.mp3$/, ''), author: item.author };

/** Two digits, widening only for a number that needs it — a floor, not a fixed width. */
const pad = (n: number): string => String(n).padStart(2, '0');

type PlannedSpec = OutputSpec & { startSec?: number; endSec?: number };

const planMedia = (): PlannedSpec[] => [{ partIndex: 1, split: false }];

const planAudiobook = (item: Decided, probed: ProbeResult): PlannedSpec[] => {
    const chapters =
        probed.chapters.length > 0
            ? probed.chapters
            : [{ index: 1, title: undefined, startSec: 0, endSec: probed.durationSec }];

    const maxPartSec = Math.max(1, (item.splitEveryMin ?? 5) * 60);
    const specs: PlannedSpec[] = [];

    for (const chapter of chapters) {
        const length = Math.max(0, chapter.endSec - chapter.startSec);
        const partCount = Math.max(1, Math.ceil(length / maxPartSec));

        for (let partIndex = 1; partIndex <= partCount; partIndex++) {
            const startSec = chapter.startSec + (partIndex - 1) * maxPartSec;

            specs.push({
                chapterIndex: chapter.index,
                chapterTitle: chapter.title,
                partIndex,
                split: partCount > 1,
                startSec,
                endSec: partIndex === partCount ? chapter.endSec : startSec + maxPartSec,
            });
        }
    }

    return specs;
};

/** The first failure cancels the group and is the one that surfaces: one item, one notify. */
const runTasks = async (item: Item, job: Job, planned: PlannedOutput[]): Promise<void> => {
    let firstError: unknown;

    await Promise.all(
        planned.map((output) =>
            pool
                .submit(item.id, (signal) => transcode(output.task, signal))
                .then(() => {
                    // Rows follow reality: the child exited 0, so the file provably exists.
                    insertOutput({
                        itemId: item.id,
                        filePath: output.task.outPath,
                        chapterIndex: output.chapterIndex,
                        chapterTitle: output.chapterTitle,
                        partIndex: output.partIndex,
                        deviceFilename: output.deviceFilename,
                        deviceFilenamePlain: output.deviceFilenamePlain,
                        onWatch: false,
                    });

                    job.completed++;
                    // A count of confirmed files, never a parsed percentage. (ADR-0008)
                    emitProgress({
                        itemId: item.id,
                        completed: job.completed,
                        expected: job.expectedOutputs,
                    });
                    emitChanged();
                })
                .catch((err) => {
                    if (firstError === undefined) {
                        firstError = err;
                        pool.cancelGroup(item.id);
                    }
                }),
        ),
    );

    if (firstError !== undefined) throw firstError;
};

/** No `failed` state: cleanup + revert + notify. A cancel takes the same path, quietly. (ADR-0003) */
const failItem = async (item: Item, err: unknown): Promise<void> => {
    await deleteItemOutputs(item.id); // by directory — catches the half-written file
    deleteOutputsByItemId(item.id); // then the rows that did get written
    updateItem(item.id, { state: 'imported' });
    emitChanged();

    if (err instanceof CancelledError) return;

    const reason = err instanceof Error ? err.message : String(err);
    // The DB will only show the item back at `imported`, so the reason lives here. (ADR-0013)
    log.error(`[processing] ${item.title ?? item.id} failed: ${reason}`);
    emitNotify({ level: 'error', message: `${item.title ?? 'Item'} failed: ${reason}` });
};
