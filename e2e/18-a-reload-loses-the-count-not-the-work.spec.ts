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

// One long chapter split in two, so the second part is a wide enough window to reload inside.
const ONE_LONG_CHAPTER = [{ title: 'Chapter 1', seconds: 1200 }];

/**
 * `progress:delta` is not durable — it is the one channel that carries no state, by design (ADR-0011),
 * because a count of confirmed files is cheap to re-derive and expensive to keep true. So a renderer
 * that reloads mid-run gets the snapshot and nothing else: the row is still `processing`, still
 * spinning, and has no number until the next file lands. ARCHITECTURE §10 calls that the channel working, and it
 * reads exactly like a hung transcode, which is why it is written down.
 *
 * The other half is what a reload must NOT do: main owns the run, so the pool, the children and the
 * Job outlive the window. A reload that restarted or stranded the fan-out would show up here as an
 * item that never reaches column 2.
 */
test('a reload leaves the count blank and the transcode running', async ({ harness }) => {
    const { page, userData } = harness;

    // One child at a time and ten-minute parts: two tasks, each long enough to act inside.
    await setSettings(page, { concurrency: 1, splitEveryMin: 10 });

    const source = await audiobookFile('reload-book', ONE_LONG_CHAPTER);
    const title = path.parse(source).name;

    await importAudiobook(harness, [source]);
    await tick(row(library(page), title));
    await processButton(page).click();

    // The first part is confirmed, so a delta HAS been rendered — otherwise a blank count proves nothing.
    await expect(row(library(page), title).locator('.row-counter')).toHaveText('1/2', {
        timeout: 120_000,
    });

    await page.reload();
    await page.waitForSelector('.app-header');

    // --- the run is main's, and it is still going ---
    expect(items(userData)[0].state).toBe('processing');
    await expect(row(library(page), title).locator('.row-spinner')).toBeVisible();

    // --- and the count is gone, because nothing durable ever held it (ARCHITECTURE §10 / ADR-0011) ---
    await expect(row(library(page), title).locator('.row-counter')).toBeHidden();

    // --- the fan-out finishes anyway: a reload cost the number, not the work ---
    await expect(row(processed(page), title)).toBeVisible({ timeout: 120_000 });
    expect(items(userData)[0].state).toBe('processed');
});
