import path from 'node:path';
import { expect, must, test } from './fixtures/app';
import { items } from './fixtures/db';
import { audiobookFile } from './fixtures/media';
import { importAudiobook, library, processButton, processed, row, setSettings, tick } from './fixtures/ui';

const ONE_CHAPTER = [{ title: 'Chapter 1', seconds: 60 }];

/**
 * A seed setting is read at **Process**, not at import, and then belongs to the row — so a library
 * processed across a settings change holds two different bitrates, and the badge is the only thing
 * that can say which is which. That is the whole reason the badge exists (ADR-0036), and the reason
 * it shows what the file was *made with* rather than what Settings says now.
 *
 * Nothing else catches a regression here. A re-read at sync would produce mp3s that are correct,
 * playable and quietly not what the row claims; both directions look plausible on screen.
 *
 * Asserted on an audiobook, deliberately: an already-mp3 `media` source is COPIED and records the
 * bitrate its file actually has, so the setting is not what decides it there (ADR-0043).
 */
test('a bitrate is read when Process is pressed, and then belongs to the row', async ({
    harness,
}) => {
    const { page, userData } = harness;

    const quiet = await audiobookFile('bitrate-quiet', ONE_CHAPTER);
    const loud = await audiobookFile('bitrate-loud', ONE_CHAPTER);
    const [first, second] = [quiet, loud].map((source) => path.basename(source, '.m4b'));

    // Both imported BEFORE either setting is chosen: if the value were taken at import, both rows
    // would carry whatever was in effect right here, and the two assertions below could not differ.
    await importAudiobook(harness, [quiet]);
    await importAudiobook(harness, [loud]);

    await setSettings(page, { bitrateAudiobook: 48 });
    await tick(row(library(page), first));
    await processButton(page).click();
    await expect(row(processed(page), first).locator('.row-badge')).toHaveText('48k');

    // --- the second item is processed under a different setting, and takes that one ---
    await setSettings(page, { bitrateAudiobook: 96 });
    await tick(row(library(page), second));
    await processButton(page).click();
    await expect(row(processed(page), second).locator('.row-badge')).toHaveText('96k');

    // --- and the first row did not follow the setting it was not made with (ADR-0036) ---
    await expect(row(processed(page), first).locator('.row-badge')).toHaveText('48k');

    const byTitle = new Map(items(userData).map((item) => [item.title, item]));
    expect(must(byTitle.get(first), `a row for ${first}`).bitrate).toBe(48);
    expect(must(byTitle.get(second), `a row for ${second}`).bitrate).toBe(96);
});
