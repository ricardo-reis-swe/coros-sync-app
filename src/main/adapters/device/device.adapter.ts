import { dialog } from 'electron';
import { execFile as execFileCb } from 'node:child_process';
import { copyFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { setSetting } from '../db/db.queries';
import { mountPath } from '../db/settings';
import { DeviceError, DeviceErrorKind, DeviceFile, PART_SUFFIX } from './device.types';

/* All device ugliness stops here. Nothing above this module knows it is a filesystem. */

const classify = (err: unknown): DeviceErrorKind => {
    const code = (err as NodeJS.ErrnoException)?.code;

    if (code === 'ENOSPC') return 'Full';
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENXIO' || code === 'EIO') {
        return 'DeviceGone';
    }
    // Present but forbidden — macOS gates removable volumes per call, so `stat` passes. (ADR-0045)
    if (code === 'EPERM' || code === 'EACCES') return 'Denied';
    return 'IoError';
};

/** Composed here, beside `EJECT`: the last place that may know which OS this is. (ADR-0045) */
const REMEDY: Partial<Record<NodeJS.Platform, string>> = {
    darwin:
        'macOS is blocking access to the watch. Choose the Music folder again to allow it for now, ' +
        'or add this app under System Settings → Privacy & Security → Files and Folders to keep it.',
    linux:
        'The volume is mounted with permissions this user cannot read. Remount it, ' +
        'or choose the Music folder again.',
    win32: 'Windows is blocking access to that folder. Choose the Music folder again, or check its permissions.',
};

const DENIED_FALLBACK = 'The operating system is blocking access to the watch. Choose the Music folder again.';

const fail = (err: unknown, what: string): never => {
    const kind = classify(err);
    const detail = err instanceof Error ? err.message : String(err);
    const remedy = kind === 'Denied' ? (REMEDY[process.platform] ?? DENIED_FALLBACK) : undefined;
    throw new DeviceError(kind, `${what}: ${detail}`, remedy);
};

/** Native folder picker. The chosen path is written to settings. (ADR-0016) */
export const selectMount = async (): Promise<string | null> => {
    // macOS hides an open panel's title bar, so the same instruction goes in `message` to stay visible.
    const { filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Choose the watch’s Music folder',
        message: 'Pick the Music folder inside the watch’s USB volume — not the volume itself.',
        buttonLabel: 'Use this folder',
    });
    const chosen = filePaths[0];
    if (!chosen) return null;

    setSetting('mountPath', chosen);
    return chosen;
};

/** Reads the remembered path and validates it — it does not detect. (ADR-0016) */
export const locateMount = async (): Promise<string | null> => {
    const picked = mountPath();
    if (!picked) return null;

    try {
        const info = await stat(picked);
        return info.isDirectory() ? picked : null;
    } catch {
        return null;
    }
};

export const enumerate = async (mount: string): Promise<DeviceFile[]> => {
    try {
        const dirents = await readdir(mount, { withFileTypes: true });
        const files = dirents.filter((dirent) => dirent.isFile());

        return await Promise.all(
            files.map(async (dirent) => {
                const info = await stat(path.join(mount, dirent.name));
                // The returned order means nothing — macOS sorts `readdir` by name. (ADR-0049)
                return {
                    filename: dirent.name,
                    sizeBytes: info.size,
                    mtimeMs: info.mtimeMs,
                    ino: info.ino,
                };
            }),
        );
    } catch (err) {
        return fail(err, `enumerate ${mount}`);
    }
};

/** Writes "<deviceFilename>.part". Never the final name — that is the rename's job. */
export const copy = async (src: string, mount: string, tempName: string): Promise<void> => {
    try {
        await copyFile(src, path.join(mount, tempName));
    } catch (err) {
        return fail(err, `copy to ${tempName}`);
    }
};

/** THE CONFIRMATION POINT — atomic, and what `onWatch` follows. (ADR-0010 / ADR-0001) */
export const renameOnDevice = async (
    mount: string,
    tempName: string,
    finalName: string,
): Promise<void> => {
    try {
        await rename(path.join(mount, tempName), path.join(mount, finalName));
    } catch (err) {
        return fail(err, `rename ${tempName} -> ${finalName}`);
    }
};

export const remove = async (mount: string, filename: string): Promise<void> => {
    try {
        await rm(path.join(mount, filename), { force: true });
    } catch (err) {
        return fail(err, `delete ${filename}`);
    }
};

export const free = async (mount: string): Promise<number> => {
    try {
        const info = await statfs(mount);
        return info.bsize * info.bavail;
    } catch (err) {
        return fail(err, `free space on ${mount}`);
    }
};

export const isPartFile = (filename: string): boolean => filename.endsWith(PART_SUFFIX);

const execFile = promisify(execFileCb);

/** The volume, not the folder the user picked — `mountPath` may be a subfolder of it. (ADR-0034) */
const volumeRoot = async (start: string): Promise<string> => {
    let current = path.resolve(start);
    const { dev } = await stat(current);

    for (;;) {
        const parent = path.dirname(current);
        if (parent === current) return current;

        try {
            // A different device number means the parent is on another filesystem: we were at the root.
            if ((await stat(parent)).dev !== dev) return current;
        } catch {
            return current;
        }

        current = parent;
    }
};

/** The one call that spawns: unmounting belongs to the OS, and every OS spells it differently. */
const EJECT: Partial<Record<NodeJS.Platform, (root: string) => [string, string[]]>> = {
    darwin: (root) => ['diskutil', ['eject', root]],
    linux: (root) => ['gio', ['mount', '-e', root]],
};

export const eject = async (mount: string): Promise<void> => {
    const command = EJECT[process.platform];
    if (!command) {
        throw new DeviceError('IoError', `eject is not supported on ${process.platform}`);
    }

    const [bin, args] = command(await volumeRoot(mount));

    try {
        await execFile(bin, args);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // Not `fail`: an ENOENT here is the missing tool, and `classify` would call that DeviceGone.
        throw new DeviceError('IoError', `eject ${mount}: ${detail}`);
    }
};
