import { expect, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { audiobookFile } from './fixtures/media';
import {
    chooseDevice,
    device,
    discard,
    expand,
    processAudiobook,
    processed,
    row,
    rowLabels,
    setSettings,
    staged,
    stageButton,
    syncButton,
    tick,
} from './fixtures/ui';

const CHAPTERS = [1, 2, 3].map((n) => ({ title: `Chapter ${n}`, seconds: 120 }));

// The staged region *is* the session (ADR-0047), so a box inside it was wired to its own container.
// ADR-0053 deleted the boxes rather than disabling them: asserted at all three depths for that reason.
// `⇤` replaces them, and its last press must unstage the item, or the fallback puts the book back. (ADR-0054)
test('the staged region cannot be picked in, and `⇤` narrows it at every depth', async ({
    harness,
}) => {
    const { page, userData } = harness;

    await chooseDevice(harness);
    await setSettings(page, { splitEveryMin: 1 });

    const title = await processAudiobook(harness, await audiobookFile('region-book', CHAPTERS));

    await tick(row(processed(page), title));
    await expect(stageButton(page)).toHaveText('Stage (6)');
    await stageButton(page).click();
    await expect(syncButton(page)).toHaveText('Sync (6)');

    // Only chapter 1 is opened, which is also what makes `p1`/`p2` unique: `partIndex` restarts per chapter.
    await expand(row(staged(page), title));
    await expand(row(staged(page), CHAPTERS[0].title));
    await expect(row(staged(page), 'p2')).toBeVisible();

    // --- no box at any depth, and no row-as-hit-area either (ADR-0053) ---
    await expect(staged(page).locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(staged(page).locator('.row-pick')).toHaveCount(0);
    // The control: the same tree in column 2 is pickable, so absence here is the rule.
    await expect(processed(page).locator('input[type="checkbox"]').first()).toBeVisible();

    // --- and clicking a row leaves the list exactly as it was, at every depth (ADR-0053) ---
    const before = await rowLabels(staged(page));
    expect(before).toHaveLength(6);

    for (const label of [title, CHAPTERS[1].title, 'p2']) {
        await row(staged(page), label).locator('.row-label').click();
    }
    expect(await rowLabels(staged(page))).toEqual(before);
    await expect(syncButton(page)).toHaveText('Sync (6)');

    // --- `⇤` on an episode drops one file (ADR-0054) ---
    await discard(row(staged(page), 'p2'));
    await expect(syncButton(page)).toHaveText('Sync (5)');

    // --- `⇤` on a chapter drops that chapter's files, and the item stays staged ---
    await discard(row(staged(page), CHAPTERS[2].title));
    await expect(syncButton(page)).toHaveText('Sync (3)');
    expect(items(userData)[0].state).toBe('ready');

    await discard(row(staged(page), CHAPTERS[1].title));
    await expect(syncButton(page)).toHaveText('Sync (1)');

    // One part left, so the chapter level is not drawn and the part carries its chapter's name. (Cell)
    const last = `${CHAPTERS[0].title} p1`;
    await expect(row(staged(page), last)).toBeVisible();

    // --- the last part off the list is the item off the list, or the fallback puts the book back (ADR-0054) ---
    await discard(row(staged(page), last));
    await expect(device(page).locator('.staged-line')).toBeHidden();
    await expect(syncButton(page)).toHaveText('Sync');
    await expect(syncButton(page)).toBeDisabled();
    expect(items(userData)[0].state).toBe('processed');

    // --- and none of it unmade an mp3: that is the whole difference between `⇤` and `↺` (ADR-0047) ---
    expect(outputs(userData)).toHaveLength(6);
    await expect(row(processed(page), title)).toBeVisible();
});
