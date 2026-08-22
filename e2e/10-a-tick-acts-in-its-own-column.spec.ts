import { expect, test } from './fixtures/app';
import { audiobookFile } from './fixtures/media';
import {
    chooseDevice,
    expand,
    library,
    processAudiobook,
    processButton,
    processed,
    row,
    setSettings,
    staged,
    stageButton,
    syncButton,
    tick,
    untick,
} from './fixtures/ui';

// Six outputs, two per chapter: the smallest tree with a book, a chapter and an episode in it.
const CHAPTERS = [1, 2, 3].map((n) => ({ title: `Chapter ${n}`, seconds: 120 }));

// Three columns, three verbs, three tick sets. One set let a tick in column 2 silently narrow what
// column 3 would send, so this is asserted on the counts, which is what a user reads. (ADR-0051)
// `Stage (N)` counts parts for the reason `Sync (N)` does: files are what a transfer sends. (ADR-0046)
test('a tick acts only in its own column, and Stage counts the parts it will send', async ({
    harness,
}) => {
    const { page } = harness;

    await chooseDevice(harness);
    await setSettings(page, { splitEveryMin: 1 });

    const title = await processAudiobook(harness, await audiobookFile('picks-book', CHAPTERS));

    // Closed, the row states its own file count — the number every count below is checked against. (ADR-0046)
    await expect(row(processed(page), title).locator('.row-counter')).toHaveText('0/6');

    // --- column 1 still holds the tick `[Process]` was pressed with, and `[Stage]` cannot see it (ADR-0051) ---
    await expect(processButton(page)).toBeDisabled();
    await expect(stageButton(page)).toHaveText('Stage');
    await expect(stageButton(page)).toBeDisabled();

    // Re-ticked now the outputs exist: the shape of the leak that would have read `Stage (6)`.
    await untick(row(library(page), title));
    await tick(row(library(page), title));
    await expect(stageButton(page)).toHaveText('Stage');

    // --- one chapter is one row and two files, and the button counts files (ADR-0054) ---
    await expand(row(processed(page), title));
    await tick(row(processed(page), CHAPTERS[1].title));
    await expect(stageButton(page)).toHaveText('Stage (2)');

    await stageButton(page).click();

    // --- staging a chapter stages that chapter, not its book (ADR-0052) ---
    await expect(syncButton(page)).toHaveText('Sync (2)');
    await expect(row(staged(page), title).locator('.row-counter')).toHaveText('0/2');

    // --- and the next tick in column 2 moves nothing in column 3 (ADR-0051) ---
    // The two counts now disagree on purpose: four parts are ticked here, two are on the send list.
    await tick(row(processed(page), CHAPTERS[2].title));
    await expect(stageButton(page)).toHaveText('Stage (4)');
    await expect(syncButton(page)).toHaveText('Sync (2)');
    await expect(row(staged(page), title).locator('.row-counter')).toHaveText('0/2');

    // --- the press is what moves it, and it adds rather than replaces (ADR-0052) ---
    await stageButton(page).click();
    await expect(syncButton(page)).toHaveText('Sync (4)');
    await expect(row(staged(page), title).locator('.row-counter')).toHaveText('0/4');
});
