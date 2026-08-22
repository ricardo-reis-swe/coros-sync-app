import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, logText, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { audiobookFile } from './fixtures/media';
import {
    chooseDevice,
    device,
    importAudiobook,
    library,
    onWatch,
    processButton,
    row,
    setSettings,
    tick,
} from './fixtures/ui';

const CHAPTERS = [1, 2, 3, 4, 5, 6].map((n) => ({ title: `Chapter ${n}`, seconds: 120 }));
const ORPHAN = 'interrupted-track.mp3.part';

/**
 * Two of the log's four sites, and both are about the same thing: what an interruption leaves behind
 * (ADR-0013). Every device write is `<deviceFilename>.part` → atomic rename, so a `.part` is a file
 * whose transfer died mid-copy — it matches no `deviceFilename`, which is exactly why the model
 * needs no repair and the debris needs sweeping (ADR-0010). An item still `processing` at boot was
 * stranded the same way, and gets a failure's cleanup without a failure's notify.
 *
 * The log is the only durable trace of either, because both are the model *deliberately forgetting*:
 * after the sweep and the revert, nothing in the schema records that they happened. Asserting the
 * state without the log line would pass against a version that healed silently.
 */
test('a stray .part is swept and a stranded item is reverted, and both say so in the log', async ({
    harness,
}) => {
    const { userData } = harness;

    await chooseDevice(harness);

    // --- the sweep: debris no row can claim, removed on the next scan (ADR-0010) ---
    await writeFile(path.join(harness.device, ORPHAN), 'half a file', 'utf8');
    await device(harness.page).getByRole('button', { name: 'Rescan' }).click();

    // Never rendered either: a `.part` is filtered out of the published listing, swept or not.
    await expect(row(onWatch(harness.page), ORPHAN)).toBeHidden();
    expect(existsSync(path.join(harness.device, ORPHAN))).toBe(false);

    // --- the strand: quit mid-fan-out, which is the only way to leave `processing` behind ---
    await setSettings(harness.page, { concurrency: 1, splitEveryMin: 1 });

    const source = await audiobookFile('stranded-book', CHAPTERS);
    const title = path.parse(source).name;

    await importAudiobook(harness, [source]);
    await tick(row(library(harness.page), title));
    await processButton(harness.page).click();

    // Work banked and still running: rows written, mp3s on disk, and the row left mid-count.
    await expect(row(library(harness.page), title).locator('.row-counter')).toHaveText(
        /^([1-9]|1[01])\/12$/,
        { timeout: 90_000 },
    );
    expect(outputs(userData).length).toBeGreaterThan(0);
    expect(items(userData)[0].state).toBe('processing');

    const page = await harness.relaunch();

    // --- same cleanup as a failure, and the item is back where it started (ADR-0003) ---
    await expect(row(library(page), title)).toBeVisible();
    await expect(row(library(page), title).locator('.row-counter')).toBeHidden();
    expect(items(userData)[0].state).toBe('imported');
    expect(outputs(userData)).toHaveLength(0);
    // By directory, so the part that was being written when the app died goes too. (ADR-0003)
    expect(await readdir(path.join(userData, 'library'))).toEqual([]);

    // --- and both forgettings are on the record (ADR-0013) ---
    const log = await logText(userData);
    expect(log).toContain(`[device] swept ${ORPHAN}`);
    expect(log).toContain(`[processing] reverting stranded item ${title}`);
});
