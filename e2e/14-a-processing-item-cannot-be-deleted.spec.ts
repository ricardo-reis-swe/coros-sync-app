import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { audiobookFile } from './fixtures/media';
import {
    importAudiobook,
    library,
    processButton,
    processed,
    row,
    setSettings,
    tick,
    toasts,
    trash,
} from './fixtures/ui';

const CHAPTERS = [1, 2, 3, 4, 5, 6].map((n) => ({ title: `Chapter ${n}`, seconds: 120 }));

/**
 * `deleteItems` is refused while `processing` — cancel first (ADR-0022). Two mechanisms enforce it and
 * only one of them is on screen: the row plan withholds the trash and offers `✕` instead, and the
 * coordinator refuses the intent regardless. The second exists because the renderer is not the only
 * thing that can send one, so it is asserted through the preload surface the app already exposes —
 * the same door `setSettings` uses, not a back door.
 *
 * Deleting mid-fan-out would race the children writing into the directory being removed, and the
 * rows it would take with it are the ones ADR-0007 says arrive only after a child exits 0.
 */
test('a processing item offers no trash and refuses the intent, and deletes cleanly once done', async ({
    harness,
}) => {
    const { page, userData } = harness;

    // One child at a time, so the fan-out is a window wide enough to act in rather than a flicker.
    await setSettings(page, { concurrency: 1, splitEveryMin: 1 });

    const source = await audiobookFile('delete-book', CHAPTERS);
    const title = path.parse(source).name;

    await importAudiobook(harness, [source]);
    await tick(row(library(page), title));
    await processButton(page).click();

    // Real work banked, and still running: `1/12` at the earliest, never `12/12`.
    const counter = row(library(page), title).locator('.row-counter');
    await expect(counter).toHaveText(/^([1-9]|1[01])\/12$/, { timeout: 90_000 });

    // --- the gesture is not offered: `✕` is what a running item has (ARCHITECTURE §10) ---
    await expect(row(library(page), title).getByRole('button', { name: 'Delete', exact: true })).toBeHidden();
    await expect(row(library(page), title).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();

    // --- and the intent is refused on its own, without the button that would have sent it (ADR-0022) ---
    const itemId = items(userData)[0].id;
    await page.evaluate(
        (id) =>
            (
                window as unknown as { api: { invoke(c: string, p: unknown): Promise<unknown> } }
            ).api.invoke('deleteItems', { itemIds: [id] }),
        itemId,
    );

    await expect(toasts(page)).toContainText('is still processing — cancel it first');
    expect(items(userData)).toHaveLength(1);
    await expect(row(library(page), title)).toBeVisible();

    // --- once it is done, the same gesture takes the item, its rows and its directory (ADR-0022) ---
    await expect(row(processed(page), title)).toBeVisible({ timeout: 120_000 });
    expect(outputs(userData)).toHaveLength(12);
    expect(await readdir(path.join(userData, 'library'))).toHaveLength(1);

    await trash(row(library(page), title));

    await expect(row(library(page), title)).toBeHidden();
    await expect(row(processed(page), title)).toBeHidden();
    expect(items(userData)).toHaveLength(0);
    expect(outputs(userData)).toHaveLength(0);
    // By directory, like every other cleanup path — the mp3s go with the row. (ADR-0003)
    expect(existsSync(path.join(userData, 'library'))
        ? await readdir(path.join(userData, 'library'))
        : []).toEqual([]);
});
