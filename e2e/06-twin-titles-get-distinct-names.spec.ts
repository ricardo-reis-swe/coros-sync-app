import { existsSync } from 'node:fs';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, logText, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { musicFile } from './fixtures/media';
import { importMedia, library, row, setSettings, tick, toasts } from './fixtures/ui';

// "In use" cannot mean "has a row": a row follows the child (ADR-0007), so two items planned in one
// tick see a table mentioning neither. Nothing else catches it — one of the two still works. (ADR-0019)
test('two items with the same title get distinct device filenames', async ({ harness }) => {
    const { page, userData } = harness;

    // Above 1, or the fan-out serialises and each item plans against the other's committed rows.
    await setSettings(page, { concurrency: 4 });

    // The same audio under the same filename in two folders — where a duplicate title comes from.
    const source = await musicFile('twin', 3, 440);
    const twins = await Promise.all(
        ['a', 'b'].map(async (which) => {
            const dir = await mkdtemp(path.join(tmpdir(), `coros-twin-${which}-`));
            const at = path.join(dir, 'Identical Track.mp3');
            await copyFile(source, at);
            return at;
        }),
    );

    // One pick, so one group: two rows sharing a title cannot be addressed apart on screen anyway.
    await importMedia(harness, twins);
    const folder = `${path.basename(path.dirname(twins[0]))}/`;
    await tick(row(library(page), folder));
    await library(page).getByRole('button', { name: /^Process/ }).click();

    // --- BOTH items produce a file: neither is lost to the other's name (ADR-0019) ---
    await expect.poll(() => outputs(userData).length, { timeout: 60_000 }).toBe(2);
    expect(items(userData).map((item) => item.state).sort()).toEqual(['processed', 'processed']);

    // --- one disambiguator apiece, and the pair is distinct (ADR-0019) ---
    const names = outputs(userData)
        .map((output) => output.deviceFilename)
        .sort();
    expect(names).toEqual(['Identical Track (2).mp3', 'Identical Track.mp3']);

    // --- the mp3s exist, one per item directory, named as the row says (ADR-0007 / ADR-0020) ---
    for (const output of outputs(userData)) {
        expect(existsSync(output.filePath)).toBe(true);
        expect(path.basename(output.filePath)).toBe(output.deviceFilename);
    }

    // --- and nothing failed on the way: a collision reverts an item loudly (ADR-0003) ---
    await expect(toasts(page)).toHaveCount(0);
    expect(await logText(userData)).not.toContain('[processing]');
});
