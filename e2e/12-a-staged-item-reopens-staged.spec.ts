import { expect, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { audiobookFile } from './fixtures/media';
import {
    chooseDevice,
    expand,
    processAudiobook,
    processed,
    row,
    setSettings,
    staged,
    stageButton,
    syncButton,
    tick,
} from './fixtures/ui';

const CHAPTERS = [1, 2, 3].map((n) => ({ title: `Chapter ${n}`, seconds: 120 }));

// `ready` is durable and the send list is renderer memory, so every staged item is unlisted on restart —
// which is why the fallback is per item, not per session. (ADR-0053)
// The narrowing is the half that does not survive: item state never knew about the chapter.
test('a staged chapter reopens as a staged book, and is still sendable', async ({ harness }) => {
    const { userData } = harness;

    await chooseDevice(harness);
    await setSettings(harness.page, { splitEveryMin: 1 });

    const title = await processAudiobook(harness, await audiobookFile('reopen-book', CHAPTERS));

    // Two of six, so the list is genuinely narrower than the item — otherwise the reopen proves nothing.
    await expand(row(processed(harness.page), title));
    await tick(row(processed(harness.page), CHAPTERS[1].title));
    await stageButton(harness.page).click();
    await expect(syncButton(harness.page)).toHaveText('Sync (2)');

    const page = await harness.relaunch();

    // --- the item is still staged, and all six parts are what `[Sync]` now offers (ADR-0053) ---
    await expect(row(staged(page), title)).toBeVisible();
    await expect(syncButton(page)).toHaveText('Sync (6)');
    await expect(syncButton(page)).toBeEnabled();
    expect(items(userData)[0].state).toBe('ready');

    // Nothing was remade to get there: a reopen reads rows, it does not run the engine. (ADR-0007)
    expect(outputs(userData)).toHaveLength(6);
});
