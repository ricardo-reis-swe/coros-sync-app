import { app, BrowserWindow, clipboard, dialog, FileFilter, ipcMain, shell } from 'electron';
import { Ack, EventChannel, Intent, StateSnapshot } from '../../shared/ipc.types';
import { ItemType } from '../../shared/data.types';
import { mkdir, readdir, stat } from 'fs/promises';
import path from 'path';
import {
    cancelProcessing,
    deleteItems,
    processImport,
    processItems,
    reorderItemsInType,
    revertItems,
    stageItems,
    unstageItems,
    updateItemDetails,
} from '../coordinators/processing.coordinator';
import {
    cancelSync,
    deleteFromDevice,
    ejectDevice,
    getDeviceState,
    scanDevice,
    selectDeviceFolder,
    sync,
} from '../coordinators/sync.coordinator';
import { cancelDownloads, importUrls } from '../coordinators/download.coordinator';
import { getAllOutputs, getItems, lastImportedSource } from '../adapters/db/db.queries';
import { applySettings, effectiveSettings } from '../adapters/db/settings';
import { randomUUID } from 'crypto';
import { onChanged, onNotify, onProgress } from '../events/bus';
import { logsDir, readLogTail } from '../utils/logger';
import {
    validateFilenames,
    validateImport,
    validateImportUrls,
    validateItemIds,
    validateReorder,
    validateSync,
    validateUpdateItem,
    validateUpdateSettings,
} from './validate.ipc';

const buildSnapshot = (): StateSnapshot => ({
    device: getDeviceState(),
    items: getItems(),
    outputs: getAllOutputs(),
    // Effective values: the renderer never learns a code default. (ADR-0024)
    settings: effectiveSettings(),
    requestId: randomUUID(),
});

const ok = (): Ack => ({ ok: true, requestId: randomUUID() });

// invoke() returns Promise<Ack>, never a result; a throw becomes `ok: false`. (ADR-0011)
const handle = (channel: Intent, handler: (payload: unknown) => Promise<void> | void) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, payload: unknown) => {
        try {
            await handler(payload);
            return ok();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: { code: channel, message } } as Ack;
        }
    });
};

export const registerGateway = (window: BrowserWindow) => {
    const send = (channel: EventChannel, payload: unknown) => {
        if (!window.isDestroyed()) window.webContents.send(channel, payload);
    };

    // Long-running work never holds the invoke open; a rejection becomes a notify.
    const detach = (what: string, work: Promise<void>) => {
        void work.catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            send('notify', { level: 'error', message: `${what} failed: ${message}` });
        });
    };

    // The mirror has one writer, the renderer's event handler: reality, never intent. (ADR-0011)
    const unsubscribe = [
        onChanged(() => send('state:snapshot', buildSnapshot())),
        onNotify((notification) => send('notify', notification)),
        onProgress((delta) => send('progress:delta', delta)),
    ];

    window.on('closed', () => unsubscribe.forEach((off) => off()));

    /* ---------- library ---------- */

    // Detached: the picker stays open as long as the user browses. Paths never cross IPC. (ADR-0017)
    handle('import', (payload) => {
        const { type, isFolder } = validateImport(payload);
        detach('Import', runImport(type, isFolder));
    });

    /** Reopens where the last import came from. A folder picker gets the PARENT, so a sibling album is one click. */
    const lastImportFolder = async (isFolder: boolean): Promise<string | null> => {
        const source = lastImportedSource();
        if (!source) return null;

        const folder = isFolder ? path.dirname(path.dirname(source)) : path.dirname(source);

        // The source may have moved or been unplugged since; a dead defaultPath is worse than none.
        return await stat(folder).then(
            (info) => (info.isDirectory() ? folder : null),
            () => null,
        );
    };

    const runImport = async (type: ItemType, isFolder: boolean) => {
        const mediaFilter: FileFilter = {
            name: 'media',
            extensions: ['mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'ogg', 'wma'],
        };
        const audiobookFilter: FileFilter = { name: 'audiobook', extensions: ['m4b'] };
        const filter = type === 'audiobook' ? audiobookFilter : mediaFilter;
        const defaultPath = await lastImportFolder(isFolder);

        if (isFolder) {
            const { filePaths } = await dialog.showOpenDialog({
                properties: ['openDirectory'],
                ...(defaultPath && { defaultPath }),
            });
            const folderPath = filePaths[0];
            if (!folderPath) return;

            const dirents = await readdir(folderPath, { withFileTypes: true });
            const chosen = dirents
                .filter(
                    (dirent) =>
                        dirent.isFile() &&
                        filter.extensions.includes(
                            path.extname(dirent.name).slice(1).toLowerCase(),
                        ),
                )
                .map((dirent) => path.join(folderPath, dirent.name));

            if (chosen.length > 0) await processImport(type, chosen, path.basename(folderPath));
        } else {
            const { filePaths } = await dialog.showOpenDialog({
                properties: ['openFile', 'multiSelections'],
                filters: [filter],
                ...(defaultPath && { defaultPath }),
            });
            if (filePaths.length === 0) return;

            // One import is one group: per-file calls gave every item `orderIndex: 0`.
            await processImport(type, filePaths, path.basename(path.dirname(filePaths[0])));
        }

        // No snapshot here: `processImport` emits, like every other lifecycle change. (ADR-0039)
    };

    // Detached: a download is as long-running as a transfer, and the Ack is not its outcome. (ADR-0027)
    handle('importUrls', (payload) => {
        detach('Import', importUrls(validateImportUrls(payload)));
    });

    // Kills the child and drops the rest; the cleanup is the download's own. (ADR-0023)
    handle('cancelDownloads', () => cancelDownloads());

    handle('updateItem', (payload) => {
        const { itemId, ...fields } = validateUpdateItem(payload);
        updateItemDetails(itemId, fields);
    });

    handle('process', (payload) => {
        processItems(validateItemIds('process', payload));
    });

    handle('cancelProcessing', (payload) => {
        cancelProcessing(validateItemIds('cancelProcessing', payload));
    });

    handle('stage', (payload) => {
        stageItems(validateItemIds('stage', payload));
    });

    handle('unstage', (payload) => {
        unstageItems(validateItemIds('unstage', payload));
    });

    // Detached: it deletes files, so it is as long-running as a delete. (ADR-0033)
    handle('revertItems', (payload) => {
        detach('Revert', revertItems(validateItemIds('revertItems', payload)));
    });

    handle('reorder', (payload) => {
        reorderItemsInType(validateReorder(payload).ordered);
    });

    // Library only — no device call, so no failure path. (ADR-0022)
    handle('deleteItems', (payload) => {
        detach('Delete', deleteItems(validateItemIds('deleteItems', payload)));
    });

    /* ---------- device ---------- */

    // Detached: the Ack acknowledges the intent, never the outcome. (ADR-0011)
    handle('scanDevice', () => detach('Scan', scanDevice()));

    handle('selectDeviceFolder', () => detach('Choosing the watch folder', selectDeviceFolder()));

    handle('ejectDevice', () => detach('Eject', ejectDevice()));

    handle('sync', (payload) => {
        const { mode, ordered } = validateSync(payload);
        detach('Sync', sync(mode, ordered));
    });

    // Sets a flag; the transfer runs on until the current file lands. (ADR-0025)
    handle('cancelSync', () => cancelSync());

    handle('deleteFromDevice', (payload) => {
        detach('Delete', deleteFromDevice(validateFilenames('deleteFromDevice', payload)));
    });

    /* ---------- settings, logs, shell ---------- */

    // `getSettings` returns nothing; the snapshot carries the values, like `scanDevice`. (ADR-0024)
    handle('getSettings', () => {
        send('state:snapshot', buildSnapshot());
    });

    handle('updateSettings', (payload) => {
        applySettings(validateUpdateSettings(payload));
        send('state:snapshot', buildSnapshot());
    });

    // Both act entirely in main: the log never crosses IPC. (ADR-0013)
    handle('openLogFolder', () => {
        detach(
            'Opening the log folder',
            (async () => {
                // It does not exist until something is logged, which is the first-run case.
                await mkdir(logsDir(), { recursive: true });
                const error = await shell.openPath(logsDir());
                if (error) send('notify', { level: 'error', message: `Could not open the log folder: ${error}` });
            })(),
        );
    });

    handle('copyLogs', () => {
        const tail = readLogTail();

        if (!tail) {
            send('notify', { level: 'info', message: 'The log is empty — nothing has failed yet.' });
            return;
        }

        clipboard.writeText(tail);
        // Nothing is shown on screen, so the confirmation is the whole affordance. (ADR-0013)
        send('notify', { level: 'info', message: 'The recent log is on your clipboard.' });
    });

    handle('hydrate', () => {
        send('state:snapshot', buildSnapshot());
    });

    handle('openAppData', () => {
        // Detached: openPath can block forever on a broken file-manager handler. (ADR-0011)
        void shell.openPath(app.getPath('userData')).then(
            (error) => {
                if (error) send('notify', { level: 'error', message: `Could not open the app data folder: ${error}` });
            },
            (err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                send('notify', { level: 'error', message: `Could not open the app data folder: ${message}` });
            },
        );
    });
};
