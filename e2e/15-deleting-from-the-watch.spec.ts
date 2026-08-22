import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, must, test } from './fixtures/app';
import { outputs } from './fixtures/db';
import { musicFile } from './fixtures/media';
import {
    acceptNextDialog,
    chooseDevice,
    device,
    onWatch,
    putOnWatch,
    row,
    trashFromWatch,
} from './fixtures/ui';

const SIDELOADED = 'sideloaded-by-hand.mp3';

/**
 * `deleteFromDevice` is keyed by **filename**, because that is the device's own key and the only one
 * an unmanaged file has (ADR-0029). The two cases differ in one thing: anything the app put there it
 * can put back, and a file it never wrote it cannot — so only the second is confirmed.
 *
 * The confirms are asserted by *not* handling them: Playwright dismisses a dialog nothing is
 * listening for, so a gesture that completes with no listener proves no confirm was shown, and one
 * that leaves the file in place proves there was.
 *
 * And it deletes no rows. Sync owns `onWatch` and only `onWatch` (ADR-0021) — a delete that took the
 * Output row with it would look identical on screen and lose the mp3's identity for good.
 */
test('a managed file goes without asking, a sideloaded one only after confirming', async ({
    harness,
}) => {
    const { page, userData } = harness;

    await chooseDevice(harness);
    const titles = await putOnWatch(harness, [
        await musicFile('watch-delete-a', 4, 330),
        await musicFile('watch-delete-b', 4, 440),
    ]);

    await writeFile(path.join(harness.device, SIDELOADED), 'not really audio', 'utf8');
    await device(page).getByRole('button', { name: 'Rescan' }).click();

    const byItem = outputs(userData);
    const first = must(
        byItem.find((output) => output.deviceFilename.startsWith(titles[0])),
        `an output for ${titles[0]}`,
    );

    // The scan calls it unmanaged because no row claims either of its names. (ADR-0040)
    await expect(row(onWatch(page), SIDELOADED)).toContainText('unmanaged');
    await expect(row(onWatch(page), first.deviceFilename)).not.toContainText('unmanaged');

    // --- managed: no confirm, so it completes with nothing listening for a dialog (ADR-0029) ---
    await trashFromWatch(row(onWatch(page), first.deviceFilename));

    await expect(row(onWatch(page), first.deviceFilename)).toBeHidden();
    expect(existsSync(path.join(harness.device, first.deviceFilename))).toBe(false);

    // --- and it moved `onWatch` and nothing else: both rows survive (ADR-0021) ---
    const after = outputs(userData);
    expect(after).toHaveLength(2);
    expect(must(after.find((output) => output.id === first.id), 'the deleted row').onWatch).toBe(false);

    // --- sideloaded: dismissed by default, so the file is still there (ADR-0029) ---
    await trashFromWatch(row(onWatch(page), SIDELOADED));
    await expect(row(onWatch(page), SIDELOADED)).toBeVisible();
    expect(existsSync(path.join(harness.device, SIDELOADED))).toBe(true);

    // --- and gone once confirmed, by a question that says why it is being asked ---
    const asked = acceptNextDialog(page);
    await trashFromWatch(row(onWatch(page), SIDELOADED));

    expect(await asked).toContain('This app did not put them there');
    await expect(row(onWatch(page), SIDELOADED)).toBeHidden();
    expect(existsSync(path.join(harness.device, SIDELOADED))).toBe(false);

    // The scan is discarded either way: an unmanaged file never had a row to lose. (ADR-0006)
    expect(outputs(userData)).toHaveLength(2);
});
