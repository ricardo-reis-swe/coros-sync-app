import { DeviceState, Output } from '../../shared/data.types';
import { clearOnWatch, getAllOutputs, getItems, markOnWatch } from '../adapters/db/db.queries';
import {
    copy,
    eject,
    enumerate,
    free,
    isPartFile,
    locateMount,
    remove,
    renameOnDevice,
    selectMount,
} from '../adapters/device/device.adapter';
import { renameSetting } from '../adapters/db/settings';
import { DeviceError, PART_SUFFIX } from '../adapters/device/device.types';
import { outputSizeBytes } from '../adapters/library/LibraryStore';
import { emitChanged, emitNotify, emitProgress } from '../events/bus';
import { log } from '../utils/logger';

// Owns one column, `outputs.onWatch` — never inserts a row, never deletes one. (ADR-0021)

export type SyncMode = 'append-new' | 'reorder-all';

/** Either name may be the one on the watch, so every comparison here matches both. (ADR-0040) */
const bothNames = (output: Output): string[] =>
    output.deviceFilename === output.deviceFilenamePlain
        ? [output.deviceFilename]
        : [output.deviceFilename, output.deviceFilenamePlain];

/** Read once per session, then applied per output: one transfer, one naming scheme. (ADR-0040) */
const nameChooser = (): ((output: Output) => string) => {
    const rename = { media: renameSetting('media'), audiobook: renameSetting('audiobook') };
    const typeOf = new Map(getItems().map((item) => [item.id, item.type] as const));

    return (output) => {
        const type = typeOf.get(output.itemId);
        // A row without its item cannot survive the FK cascade; if one did, the older name is the safe one.
        return type === undefined || rename[type] ? output.deviceFilename : output.deviceFilenamePlain;
    };
};

type ScanView = Omit<DeviceState, 'syncing' | 'stopping'>;

const DISCONNECTED: ScanView = { reach: 'unreachable', freeBytes: null, files: [] };

// No `freeBytes` though `statfs` would answer: nothing here was confirmed. (ADR-0001 / ADR-0045)
const DENIED: ScanView = { reach: 'denied', freeBytes: null, files: [] };

/** All the renderer sees of a scan; the scan still becomes no rows. (ADR-0006 / ADR-0028) */
let scanned: ScanView = DISCONNECTED;

/** Both flags are read live, so neither can be left stuck by a missed reset. */
export const getDeviceState = (): DeviceState => ({
    ...scanned,
    syncing: transferring,
    stopping: stopRequested,
});

// Live feedback only, so newest goes LAST: `files` is in playback order. (ADR-0028 / ADR-0044)
const cacheAdd = (filename: string, sizeBytes: number): void => {
    scanned = {
        ...scanned,
        freeBytes: scanned.freeBytes == null ? null : scanned.freeBytes - sizeBytes,
        // Filtered too, so a re-sent name moves to the end instead of appearing twice.
        files: [
            ...scanned.files.filter((file) => file.filename !== filename),
            { filename, managed: true },
        ],
    };
};

/** Both callers pass 0 for a file whose size is unknown — an unmanaged one has no row to measure. */
const cacheRemove = (filename: string, sizeBytes: number): void => {
    scanned = {
        ...scanned,
        freeBytes: scanned.freeBytes == null ? null : scanned.freeBytes + sizeBytes,
        files: scanned.files.filter((file) => file.filename !== filename),
    };
};

/** A boolean, not a signal: `copyFile` cannot be aborted, so the stop lands between files. (ADR-0025) */
let stopRequested = false;
let transferring = false;

export const cancelSync = (): void => {
    if (!transferring) return;

    stopRequested = true;
    // Published at once: the button has to go dead before the current file lands. (ADR-0025)
    emitChanged();
};

/** A read-only peer query — the one edge from Processing to Sync. (ADR-0031) */
export const isSyncing = (): boolean => transferring;

/* ---------- scan ---------- */

export const selectDeviceFolder = async (): Promise<void> => {
    const chosen = await selectMount();
    if (chosen) await scanDevice();
};

/** Polled on demand only — no background watcher, no mount events. (ADR-0009) */
export const scanDevice = async (): Promise<void> => {
    // Silent: `reconcile` sweeps `.part` files and the running transfer is writing one. (ADR-0010)
    if (transferring) return;

    const mount = await locateMount();

    if (!mount) {
        scanned = DISCONNECTED;
        emitChanged();
        return;
    }

    try {
        await reconcile(mount);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const denied = err instanceof DeviceError && err.kind === 'Denied' ? err : null;

        // On the transition only: ADR-0038 rescans on every focus, and narrating each is noise.
        if (denied) {
            if (scanned.reach !== 'denied') {
                log.error(`[device] scan denied: ${message}`);
                if (denied.remedy) emitNotify({ level: 'error', message: denied.remedy });
            }
            scanned = DENIED;
        } else {
            scanned = DISCONNECTED;
            // A failed device op: one of the log's four sites. (ADR-0013)
            log.error(`[device] scan failed: ${message}`);
            emitNotify({ level: 'error', message: `Could not read the watch: ${message}` });
        }
    }

    emitChanged();
};

/** The diff, by exact string. `onWatch` moves both ways here — that is the self-healing. (ADR-0006) */
const reconcile = async (mount: string): Promise<void> => {
    const scan = await enumerate(mount);

    // Debris from an interrupted transfer: swept, and logged. (ADR-0010 / ADR-0013)
    for (const file of scan.filter((f) => isPartFile(f.filename))) {
        await remove(mount, file.filename);
        log.warn(`[device] swept ${file.filename}`);
    }

    // The watch's own order, which `readdir` does not carry: mtime, ino only breaks ties. (ADR-0049)
    const present = scan
        .filter((f) => !isPartFile(f.filename))
        .sort((a, b) => a.mtimeMs - b.mtimeMs || a.ino - b.ino)
        .map((f) => f.filename);
    const onDevice = new Set(present);

    const outputs = getAllOutputs();
    const known = new Set(outputs.flatMap(bothNames));

    for (const output of outputs) {
        // Either name counts as present: a flipped toggle must not orphan what is already there. (ADR-0040)
        const found = bothNames(output).some((name) => onDevice.has(name));
        if (found === output.onWatch) continue;
        if (found) markOnWatch(output.id);
        else clearOnWatch(output.id);
    }

    scanned = {
        reach: 'ok',
        freeBytes: await free(mount),
        files: present.map((filename) => ({ filename, managed: known.has(filename) })),
    };
};

/** Asked for, never assumed: the OS owns the unmount, and refuses it if anything is busy. (ADR-0034) */
export const ejectDevice = async (): Promise<void> => {
    if (transferring) {
        emitNotify({ level: 'error', message: 'A sync is running — stop it first.' });
        return;
    }

    const mount = await locateMount();
    if (!mount) {
        emitNotify({ level: 'error', message: 'The watch folder is not available.' });
        return;
    }

    try {
        await eject(mount);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A failed device op: one of the log's four sites. (ADR-0013)
        log.error(`[device] eject failed: ${message}`);
        emitNotify({ level: 'error', message: `Could not eject the watch: ${message}` });
        return;
    }

    // The volume is gone, so the scan view is too. `onWatch` is untouched — the files are still there.
    scanned = DISCONNECTED;
    emitNotify({ level: 'info', message: 'Ejected — safe to unplug the watch.' });
    emitChanged();
};

/* ---------- transfer ---------- */

/** Strictly serial, and written in the order given — write order decides playback. (ADR-0004 / ADR-0044) */
export const sync = async (mode: SyncMode, ordered: string[]): Promise<void> => {
    // Two sessions would interleave two upload orders into one playback order. (ADR-0025)
    if (transferring) {
        emitNotify({ level: 'error', message: 'A sync is already running.' });
        return;
    }

    // Claimed before the first await, or the guard above is a check-then-act. (ADR-0025)
    transferring = true;
    stopRequested = false;
    // Both edges of the flag are published, or `[Stop]` sticks with no session. (ADR-0028)
    emitChanged();

    let done = 0;
    let total = 0;

    try {
        const mount = await locateMount();
        if (!mount) {
            emitNotify({ level: 'error', message: 'The watch folder is not available.' });
            return;
        }

        // A fresh scan every time: a remembered plan is a stale plan. (ADR-0001)
        await reconcile(mount);

        const session = buildSession(mode, ordered);
        if (session instanceof Error) {
            emitNotify({ level: 'error', message: session.message });
            return;
        }

        total = session.length;
        const chosenName = nameChooser();

        if (mode === 'reorder-all') await wipeManaged(mount);

        // Skipped after a stopped wipe: a cancelled session must not report a space error.
        if (!stopRequested && !(await hasRoomFor(session, mount))) return;

        // Forward: the player follows write order; the listing is inverted in `reconcile`. (ADR-0044)
        for (const output of session) {
            // Between files, never mid-file — stopping there would leave a `.part`. (ADR-0025)
            if (stopRequested) break;

            // Selected, never composed — both names were fixed when the row was born. (ADR-0040)
            const deviceName = chosenName(output);
            const tempName = `${deviceName}${PART_SUFFIX}`;

            await copy(output.filePath, mount, tempName);
            await renameOnDevice(mount, tempName, deviceName);

            // Only now: the rename, not the last byte, is the confirmation. (ADR-0001 / ADR-0010)
            markOnWatch(output.id);
            cacheAdd(deviceName, await outputSizeBytes(output.filePath));

            done++;
            emitProgress({ transfer: { done, total } });
            emitChanged();
        }

        // The device decides where new entries land, not us: re-read rather than trust the appends.
        if (done > 0) await reconcile(mount).catch(() => undefined);

        // A stop is quiet: the user asked for it, and nothing was forgotten. (ADR-0025)
        if (!stopRequested) {
            emitNotify({ level: 'info', message: `Synced ${done} of ${total} files.` });
        }
    } catch (err) {
        abort(err, done, total);
    } finally {
        // One place releases both, or a stop leaks into the next session.
        transferring = false;
        stopRequested = false;
        emitChanged();
    }
};

/** A courtesy, not a guarantee: the copy still answers `Full` if the device fills mid-session. */
const hasRoomFor = async (session: Output[], mount: string): Promise<boolean> => {
    const sizes = await Promise.all(session.map((output) => outputSizeBytes(output.filePath)));
    const needed = sizes.reduce((total, size) => total + size, 0);
    const available = await free(mount);

    if (needed <= available) return true;

    // Not logged: nothing was attempted and the notify carries the whole reason. (ADR-0013)
    const shortfall = Math.ceil((needed - available) / (1024 * 1024));
    emitNotify({
        level: 'error',
        message: `Not enough room on the watch — ${shortfall} MB short. Delete something first.`,
    });

    return false;
};

/** Wipes first so playback order is rebuilt from scratch; an interruption half-wipes the device. */
const wipeManaged = async (mount: string): Promise<void> => {
    for (const output of getAllOutputs()) {
        if (stopRequested) return;
        if (!output.onWatch) continue;

        // Both names issued, because the row does not record which one it was uploaded under. (ADR-0040)
        for (const name of bothNames(output)) await remove(mount, name);

        clearOnWatch(output.id); // confirmed, then cached

        // One credit for one file: only ever one of the two names was on the device.
        cacheRemove(output.deviceFilename, await outputSizeBytes(output.filePath));
        cacheRemove(output.deviceFilenamePlain, 0);

        // Per file, like the transfer loop: a 300-file wipe is not one silent pause.
        emitChanged();
    }
};

/** No resume, no retry: a `.part` matches no `deviceFilename`, so the model is already true. */
const abort = (err: unknown, done: number, total: number): void => {
    const message = err instanceof Error ? err.message : String(err);
    // The session is discarded, so how far it got is recorded here or nowhere. (ADR-0013)
    log.error(`[device] transfer aborted after ${done}/${total}: ${message}`);

    const kind = err instanceof DeviceError ? err.kind : undefined;

    // Only absence empties the view: a full or unreadable watch is still plugged in. (ADR-0001)
    // `Denied` included: a refused write is not a refused scan, and only the scan sets it. (ADR-0045)
    if (kind === undefined || kind === 'DeviceGone') scanned = DISCONNECTED;

    emitNotify({
        level: 'error',
        message:
            kind === 'Full'
                ? `The watch is full — ${done} of ${total} copied. Delete something and sync again.`
                : `Transfer interrupted — ${done} of ${total} copied.`,
    });
    emitChanged();
};

/** Main validates the renderer's list: all ids exist, all belong to `ready` items. */
const buildSession = (mode: SyncMode, ordered: string[]): Output[] | Error => {
    const outputs = new Map(getAllOutputs().map((output) => [output.id, output]));
    const ready = new Set(
        getItems()
            .filter((item) => item.state === 'ready')
            .map((item) => item.id),
    );

    const session: Output[] = [];
    for (const id of ordered) {
        const output = outputs.get(id);
        if (!output) return new Error(`Unknown output in sync request: ${id}`);
        if (!ready.has(output.itemId)) {
            return new Error('Every item in a sync must be staged as ready first.');
        }
        session.push(output);
    }

    return mode === 'append-new' ? session.filter((output) => !output.onWatch) : session;
};

/* ---------- delete ---------- */

/** Filenames, not rows: the device's own key, and the only one an unmanaged file has. (ADR-0029) */
export const deleteFromDevice = async (filenames: string[]): Promise<void> => {
    // The session is writing the same column; nothing is removed under it. (ADR-0031)
    if (transferring) {
        emitNotify({ level: 'error', message: 'A sync is running — stop it first.' });
        return;
    }

    const mount = await locateMount();
    if (!mount) {
        emitNotify({ level: 'error', message: 'The watch folder is not available.' });
        return;
    }

    // Keyed by both names: the user clicked a file, and either name could be the one it is under. (ADR-0040)
    const byFilename = new Map(
        getAllOutputs().flatMap((output) =>
            bothNames(output).map((name) => [name, output] as const),
        ),
    );

    for (const filename of filenames) {
        try {
            await remove(mount, filename);
            // An unmanaged file has no row — the whole difference between the two.
            const output = byFilename.get(filename);
            if (output) clearOnWatch(output.id); // confirmed, then cached
            cacheRemove(filename, output ? await outputSizeBytes(output.filePath) : 0);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`[device] delete failed for ${filename}: ${message}`);
            // The remedy when the OS is the cause: a filename alone leaves nothing to act on. (ADR-0045)
            const remedy = err instanceof DeviceError ? err.remedy : undefined;
            emitNotify({
                level: 'error',
                message: `Could not delete ${filename}.${remedy ? ` ${remedy}` : ''}`,
            });
            break;
        }
    }

    emitChanged();
};
