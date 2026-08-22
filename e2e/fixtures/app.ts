import { _electron as electron, ElectronApplication, Page, test as base } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const REPO = path.resolve(__dirname, '..', '..');

// The PACKAGED app, never `.webpack/main`: only packaging exercises `app.isPackaged`'s binary paths.
const executablePath = (): string => {
    const dir = path.join(REPO, 'out', `coros-sync-app-${process.platform}-${process.arch}`);
    const macOS = path.join(dir, 'coros-sync-app.app', 'Contents', 'MacOS', 'coros-sync-app');
    const elsewhere = path.join(dir, 'coros-sync-app');
    const binary = process.platform === 'darwin' ? macOS : elsewhere;

    if (!existsSync(binary)) {
        throw new Error(`No packaged app at ${binary} — run \`npm run package\` first.`);
    }

    return binary;
};

export type Harness = {
    app: ElectronApplication;
    page: Page;
    /** A private `--user-data-dir`: its own app.db, its own library, its own logs. */
    userData: string;
    /** The stand-in for the watch's Music folder. The Device Adapter is pure `fs`, so a dir IS the watch. */
    device: string;
    /** The next native picker returns these paths. Queued, not matched on options: the tests drive the order. */
    queueDialog(filePaths: string[]): Promise<void>;
    /** How many ffmpeg children main currently has. The pool's `N` made observable. */
    liveChildren(): Promise<number>;
    /** Quit and reopen on the same `userData`. Returns the NEW page — a destructured one is stale. */
    relaunch(): Promise<Page>;
};

// `evaluate` runs INSIDE main, patching the same `electron` object the Gateway holds — nothing in `src/` knows.
const stubDialogs = async (app: ElectronApplication): Promise<void> => {
    await app.evaluate(({ dialog }) => {
        const queue: string[][] = [];
        (globalThis as unknown as { __e2eDialogQueue: string[][] }).__e2eDialogQueue = queue;

        // A cancelled picker is the honest default: a test that forgot to queue gets a no-op, not a hang.
        dialog.showOpenDialog = (async () => {
            const filePaths = queue.shift();
            return filePaths ? { canceled: false, filePaths } : { canceled: true, filePaths: [] };
        }) as typeof dialog.showOpenDialog;
    });
};

/** Narrows and explains in one step, so a missing row fails as a sentence instead of `undefined`. */
export const must = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`expected to find ${what}`);
    return value;
};

/** The log is absent until something is written to it, which is itself an assertable fact. */
export const logText = async (userData: string): Promise<string> =>
    readFile(path.join(userData, 'logs', 'app.log'), 'utf8').catch(() => '');

export const test = base.extend<{ harness: Harness }>({
    // Playwright reads the destructuring pattern to work out which fixtures to build; `_` breaks discovery.
    // eslint-disable-next-line no-empty-pattern
    harness: async ({}, use, testInfo) => {
        // Realpathed: macOS hands back `/var/...` while Electron reports `/private/var/...`.
        const userData = await realpath(await mkdtemp(path.join(tmpdir(), 'coros-user-')));
        const device = await realpath(await mkdtemp(path.join(tmpdir(), 'coros-watch-')));

        const open = async (): Promise<[ElectronApplication, Page]> => {
            const started = await electron.launch({
                executablePath: executablePath(),
                args: [`--user-data-dir=${userData}`],
            });
            await stubDialogs(started);

            const window = await started.firstWindow();
            // The mirror's first write. Nothing is assertable until the snapshot has landed.
            await window.waitForSelector('.app-header');

            return [started, window];
        };

        let [app, page] = await open();

        const harness: Harness = {
            // Getters, not fields: `relaunch` replaces both, and teardown must close the live one.
            get app() {
                return app;
            },
            get page() {
                return page;
            },
            userData,
            device,
            queueDialog: (filePaths) =>
                app.evaluate((_electron, paths) => {
                    (
                        globalThis as unknown as { __e2eDialogQueue: string[][] }
                    ).__e2eDialogQueue.push(paths);
                }, filePaths),
            liveChildren: async () => {
                const pid = app.process().pid;
                if (!pid) return 0;
                // Children of main, matched on the binary: precise enough that a dev's own app cannot count.
                const { stdout } = await exec('pgrep', ['-P', String(pid), '-f', 'ffmpeg']).catch(
                    () => ({ stdout: '' }),
                );
                return stdout.split('\n').filter(Boolean).length;
            },
            relaunch: async () => {
                await app.close().catch(() => undefined);
                [app, page] = await open();

                return page;
            },
        };

        await use(harness);

        // The log and the db are the evidence for a failed run, so they outlive it.
        if (testInfo.status !== testInfo.expectedStatus) {
            testInfo.attach('userData', { body: userData, contentType: 'text/plain' });
        }

        await app.close().catch(() => undefined);

        if (testInfo.status === testInfo.expectedStatus) {
            await rm(userData, { recursive: true, force: true }).catch(() => undefined);
            await rm(device, { recursive: true, force: true }).catch(() => undefined);
        }
    },
});

export { expect } from '@playwright/test';
