import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures/app';
import { outputs } from './fixtures/db';
import { musicFile } from './fixtures/media';
import {
    chooseDevice,
    device,
    importMedia,
    library,
    onWatch,
    processed,
    row,
    staged,
    tick,
    toasts,
} from './fixtures/ui';

// Import → probe → transcode → one Output row → scan → transfer → onWatch: the walking skeleton.
test('one file walks the whole path and lands on the watch', async ({ harness }) => {
    const { page, userData } = harness;
    const source = await musicFile('skeleton', 4);
    const title = path.parse(source).name;

    await chooseDevice(harness);
    await importMedia(harness, [source]);

    // Column 1 mirrors the source library, so the row is there the moment the rows are inserted.
    await expect(row(library(page), title)).toBeVisible();

    await tick(row(library(page), title));
    await library(page).getByRole('button', { name: /^Process/ }).click();

    // Column 2 holds exactly one state, so no grey, no number, no tick: all four said "staged". (ADR-0047)
    await expect(row(processed(page), title)).toBeVisible({ timeout: 60_000 });
    await expect(row(processed(page), title)).not.toHaveClass(/row-grey/);
    await expect(row(processed(page), title).locator('.row-number')).toBeHidden();

    await tick(row(processed(page), title));
    await processed(page).getByRole('button', { name: /^Stage/ }).click();

    // Staging ADDS a place rather than moving the row; column 3 gives it a playback position. (ADR-0047)
    await expect(row(processed(page), title)).toBeVisible();
    await expect(row(staged(page), title).locator('.row-number')).toHaveText('1');
    // Grey below the line is `!onWatch`, and carries the hedge: not there yet, not promised.
    await expect(row(staged(page), title)).toHaveClass(/row-grey/);

    await device(page).getByRole('button', { name: /^Sync/ }).click();
    await expect(toasts(page)).toContainText('Synced 1 of 1 files.');

    // --- rows follow reality (ADR-0007) ---
    const rows = outputs(userData);
    expect(rows).toHaveLength(1);
    const [output] = rows;

    // --- the mp3 the row describes actually exists, in the item's own directory (ADR-0020) ---
    const produced = await readFile(output.filePath);
    expect(produced.byteLength).toBeGreaterThan(0);
    expect(output.filePath.startsWith(path.join(userData, 'library'))).toBe(true);

    // --- the device holds exactly that name, and nothing else (ADR-0006 / ADR-0015) ---
    const onDevice = await readdir(harness.device);
    expect(onDevice).toEqual([output.deviceFilename]);

    // --- the rename happened: no `.part` survives a completed transfer (ADR-0010) ---
    expect(onDevice.some((name) => name.endsWith('.part'))).toBe(false);
    expect(await readFile(path.join(harness.device, output.deviceFilename))).toEqual(produced);

    // --- onWatch follows the CONFIRMED rename, and "synced" is derived from it (ADR-0001 / ADR-0007) ---
    expect(output.onWatch).toBe(true);

    // The staged region IS the session, so a file that landed leaves it for above the line. (ADR-0047)
    await expect(row(staged(page), title)).toBeHidden();
    await expect(row(onWatch(page), output.deviceFilename)).toBeVisible();
});
