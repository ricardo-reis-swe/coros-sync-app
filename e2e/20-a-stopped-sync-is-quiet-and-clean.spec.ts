import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures/app';
import { outputs } from './fixtures/db';
import { audiobookFile } from './fixtures/media';
import {
    chooseDevice,
    importAudiobook,
    library,
    processButton,
    processed,
    row,
    setSettings,
    stageButton,
    syncButton,
    tick,
    toasts,
} from './fixtures/ui';

const CHAPTERS = [1, 2, 3, 4].map((n) => ({ title: `Chapter ${n}`, seconds: 600 }));
const PARTS = 40;

/**
 * A different mechanism from ADR-0023's cancel, because `copyFile` cannot be aborted: `stopRequested`
 * is a boolean read **between** files, never a signal that interrupts one. Stopping mid-file would
 * leave a `.part` on the watch — the next scan would sweep it (ADR-0010), but only after the user had
 * seen it, so the design never produces one.
 *
 * The stop is queued in the same tick as the session rather than clicked, because forty small files
 * copy in under a tenth of a second and a click cannot land inside that. Same-tick is not a
 * workaround but the sharper case: `sync` sets `transferring` before its first `await`, so the stop
 * lands while the session is claimed and is read before the loop's first file. A guard that checked
 * the flag anywhere other than the top of each iteration copies at least one file here.
 *
 * And a stop is quiet, for ADR-0023's reason at the other end of the app: the user asked for it, so
 * `Synced N of M` would be a session claiming success for a job it was told to abandon.
 */
test('a stop lands before a file, says nothing, and leaves the whole list to send', async ({
    harness,
}) => {
    const { page, userData } = harness;

    await chooseDevice(harness);
    await setSettings(page, { splitEveryMin: 1 });

    const source = await audiobookFile('cancel-book', CHAPTERS);
    const title = path.parse(source).name;

    await importAudiobook(harness, [source]);
    await tick(row(library(page), title));
    await processButton(page).click();

    await row(processed(page), title).waitFor({ timeout: 120_000 });
    await tick(row(processed(page), title));
    await stageButton(page).click();
    await expect(syncButton(page)).toHaveText(`Sync (${PARTS})`);

    // The same list `[Sync]` would send, in the same playback order, through the same two verbs the
    // preload exposes — `setSettings` uses this door too. Building it here is what makes the stop
    // deterministic: both messages are queued before main can copy anything. (ADR-0025)
    const ordered = outputs(userData)
        .sort((a, b) => (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0) || a.partIndex - b.partIndex)
        .map((output) => output.id);
    expect(ordered).toHaveLength(PARTS);

    await page.evaluate((list) => {
        const { api } = window as unknown as {
            api: { invoke(channel: string, payload: unknown): Promise<unknown> };
        };
        void api.invoke('sync', { mode: 'append-new', ordered: list });
        void api.invoke('cancelSync', {});
    }, ordered);

    // The session is over when the button `[Stop]` replaced comes back.
    await expect(syncButton(page)).toBeVisible({ timeout: 60_000 });

    // --- it stopped before a file, so there is nothing on the watch and nothing half-written ---
    expect(await readdir(harness.device)).toEqual([]);
    expect(outputs(userData).filter((output) => output.onWatch)).toHaveLength(0);

    // --- and quietly: no session reports success for a job it was told to abandon (ADR-0025) ---
    await expect(toasts(page).filter({ hasText: 'Synced' })).toHaveCount(0);

    // --- the work is left to resume, which is the difference between a stop and a failure ---
    await expect(syncButton(page)).toHaveText(`Sync (${PARTS})`);

    // --- and pressing it again sends the lot: the stop left no flag stuck behind it ---
    await syncButton(page).click();
    await toasts(page).filter({ hasText: `Synced ${PARTS} of ${PARTS}` }).waitFor({ timeout: 60_000 });

    expect(outputs(userData).filter((output) => output.onWatch)).toHaveLength(PARTS);
    const onDevice = await readdir(harness.device);
    expect(onDevice.filter((name) => name.endsWith('.part'))).toEqual([]);
    expect(onDevice).toHaveLength(PARTS);
});
