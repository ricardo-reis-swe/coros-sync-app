import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { undecodableFile } from './fixtures/media';
import { importMedia, library, processed, row, tick, toasts } from './fixtures/ui';

// No `failed` state: clean up BY DIRECTORY, revert, notify, log — the item ends where it started. (ADR-0003)
test('a failed child reverts the item and leaves nothing behind', async ({ harness }) => {
    const { page, userData } = harness;
    const source = await undecodableFile('not-really-audio');
    const title = path.parse(source).name;

    await importMedia(harness, [source]);
    await tick(row(library(page), title));
    await library(page).getByRole('button', { name: /^Process/ }).click();

    // --- the failure is LOUD: one notify, carrying the reason the row no longer holds (ADR-0003) ---
    await expect(toasts(page)).toHaveCount(1, { timeout: 60_000 });
    await expect(toasts(page)).toHaveClass(/toast-error/);
    await expect(toasts(page)).toContainText(title);

    // --- reverted, not failed: back at `imported`, which is where it started (ADR-0003) ---
    const [item] = items(userData);
    expect(item.state).toBe('imported');
    // `processed` is all column 2 shows, so a reverted item is absent from it. (ADR-0047)
    await expect(row(processed(page), title)).toBeHidden();
    await expect(row(library(page), title)).toBeVisible();

    // --- no row was written in anticipation, and none survived the cleanup (ADR-0007) ---
    expect(outputs(userData)).toHaveLength(0);

    // --- cleanup is by DIRECTORY, so the item's directory is gone, not merely row-less (ADR-0003) ---
    expect(await readdir(path.join(userData, 'library'))).toEqual([]);

    // --- what the model deliberately forgot is in the log: one of ADR-0013's four sites ---
    const logged = await readFile(path.join(userData, 'logs', 'app.log'), 'utf8');
    expect(logged).toMatch(new RegExp(`ERROR.*\\[processing\\] ${title} failed:`));

    // The row is workable again — a revert that leaves the item unusable is not a revert.
    await expect(row(library(page), title).locator('input[type="checkbox"]')).toBeEnabled();
});
