import path from 'node:path';
import { expect, test } from './fixtures/app';
import { items } from './fixtures/db';
import { audiobookFile } from './fixtures/media';
import {
    importAudiobook,
    library,
    processButton,
    processed,
    row,
    setSettings,
    tick,
} from './fixtures/ui';

const CHAPTERS = [1, 2, 3, 4, 5, 6].map((n) => ({ title: `Chapter ${n}`, seconds: 120 }));
const N = 2;

/**
 * `N` is the number of ffmpeg children that may exist at once — **one** limiter over one resource
 * (ADR-0012). Two items fanning out to twelve parts each is twenty-four tasks through one flat pool,
 * and the only observable proof the pool is flat is that the machine never holds more than `N`.
 *
 * The cancel is the sharp half. A slot frees when the task *unwinds*, not when `abort()` is called —
 * freeing it at the call admits `N + K` live children, because the aborted child is still running
 * while its replacement starts (ADR-0023). That surplus is invisible in every other way: the queue
 * looks right, the rows look right, and the only symptom is a machine doing more work than it was
 * told to. So the ceiling is sampled ACROSS the cancel, not checked after it.
 */
test('never more than N ffmpeg children, including across a cancel', async ({ harness }) => {
    const { page, userData } = harness;

    await setSettings(page, { concurrency: N, splitEveryMin: 1 });

    const sources = [
        await audiobookFile('pool-book-a', CHAPTERS),
        await audiobookFile('pool-book-b', CHAPTERS),
    ];
    const titles = sources.map((source) => path.parse(source).name);

    for (const source of sources) {
        await importAudiobook(harness, [source]);
        await tick(row(library(page), path.parse(source).name));
    }
    await processButton(page).click();

    // Sampled continuously rather than at chosen moments: a surplus is transient by nature, and a
    // check after the fact is exactly the shape of test that let `N + K` through.
    let sampling = true;
    let peak = 0;
    const sampler = (async () => {
        while (sampling) peak = Math.max(peak, await harness.liveChildren());
    })();

    // Both running, and deep enough in that the pool is saturated rather than filling.
    await expect(row(library(page), titles[0]).locator('.row-counter')).toHaveText(/^[1-9]/, {
        timeout: 90_000,
    });

    // --- the cancel, sampled through: one item unwinds while the other keeps the pool full ---
    await row(library(page), titles[0]).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row(library(page), titles[0]).locator('.row-counter')).toBeHidden({
        timeout: 60_000,
    });

    // The survivor runs to completion on the same pool the cancel just churned.
    await expect(row(processed(page), titles[1])).toBeVisible({ timeout: 120_000 });

    sampling = false;
    await sampler;

    // --- the ceiling held, and it was actually reached — otherwise the sampling proves nothing ---
    expect(peak).toBeLessThanOrEqual(N);
    expect(peak).toBe(N);

    // --- and nothing outlived the item it was making (ADR-0023 / ADR-0032) ---
    await expect.poll(() => harness.liveChildren(), { timeout: 30_000 }).toBe(0);

    const byTitle = new Map(items(userData).map((item) => [item.title, item.state]));
    expect(byTitle.get(titles[0])).toBe('imported');
    expect(byTitle.get(titles[1])).toBe('processed');
});
