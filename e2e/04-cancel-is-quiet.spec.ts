import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, logText, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { audiobookFile } from './fixtures/media';
import { importAudiobook, library, row, setSettings, tick, toasts } from './fixtures/ui';

const CHAPTERS = [600, 600, 600, 600].map((seconds, i) => ({
    title: `Chapter ${i + 1}`,
    seconds,
}));

// Cancel is a failure's transition with the opposite handling: same cleanup, no notify, no log. (ADR-0023)
test('a cancelled item is reverted silently, and leaves no children behind', async ({ harness }) => {
    const { page, userData } = harness;

    // One child at a time so the fan-out is long enough to interrupt, and 1-minute parts so it fans out.
    await setSettings(page, { concurrency: 1, splitEveryMin: 1 });

    const source = await audiobookFile('cancel-book', CHAPTERS);
    const title = path.parse(source).name;

    await importAudiobook(harness, [source]);
    await tick(row(library(page), title));
    await library(page).getByRole('button', { name: /^Process/ }).click();

    // Wait until real work is BANKED: rows written, mp3s on disk. Cancelling before that proves nothing.
    const counter = row(library(page), title).locator('.row-counter');
    await expect(counter).toHaveText(/^[1-9]\d*\/40$/, { timeout: 90_000 });
    expect(outputs(userData).length).toBeGreaterThan(0);

    // By role: `getByTitle` matches substrings, and the label's own title contains "cancel".
    await row(library(page), title).getByRole('button', { name: 'Cancel', exact: true }).click();

    // --- same cleanup as a failure: reverted, row-less, directory gone (ADR-0023 / ADR-0003) ---
    await expect(counter).toBeHidden({ timeout: 60_000 });
    expect(items(userData)[0].state).toBe('imported');
    expect(outputs(userData)).toHaveLength(0);
    // The ones already produced are gone too — that is what "by directory" is for.
    expect(await readdir(path.join(userData, 'library'))).toEqual([]);

    // --- and QUIETLY: the whole difference from ADR-0003's path (ADR-0023) ---
    await expect(toasts(page)).toHaveCount(0);
    expect(await logText(userData)).not.toContain('[processing]');

    // --- the slot frees on unwind, so no child outlives the item it was making (ADR-0023 / ADR-0032) ---
    await expect.poll(() => harness.liveChildren(), { timeout: 30_000 }).toBe(0);
});
