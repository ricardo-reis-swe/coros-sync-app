import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, must, test } from './fixtures/app';
import { outputs } from './fixtures/db';
import { musicFile } from './fixtures/media';
import {
    acceptNextDialog,
    chooseDevice,
    chooseMode,
    device,
    discard,
    onWatch,
    putOnWatch,
    row,
    staged,
    syncButton,
    toasts,
} from './fixtures/ui';

const SIDELOADED = 'not-ours.mp3';

/**
 * The one gesture that can empty a watch: `wipeManaged` deletes **every** managed file, then the
 * rebuild copies back only the session — so a narrowed list is a statement that the watch should be
 * exactly this, and everything managed outside it is gone for good (ADR-0050). The confirm is the
 * only guard on that, and its count is the only place the loss is stated, so both are asserted here.
 *
 * A sideloaded file survives, and cannot be placed: `wipeManaged` walks rows, and a file with no row
 * is untouched by the delete and unmoved by the rebuild — which is DECISIONS §4's standing question, not
 * a defect, and is pinned here so it cannot change without someone noticing.
 *
 * Order is asserted on write TIME for ADR-0044's reason: a rebuild exists to impose playback order,
 * so the direction has to hold through a wipe as well as through an append.
 */
test('reorder-all wipes everything managed and rebuilds exactly the list it was given', async ({
    harness,
}) => {
    const { page, userData } = harness;

    await chooseDevice(harness);
    const titles = await putOnWatch(harness, [
        await musicFile('rebuild-a', 4, 330),
        await musicFile('rebuild-b', 4, 440),
        await musicFile('rebuild-c', 4, 550),
    ]);

    await writeFile(path.join(harness.device, SIDELOADED), 'not really audio', 'utf8');
    await device(page).getByRole('button', { name: 'Rescan' }).click();
    await expect(row(onWatch(page), SIDELOADED)).toBeVisible();

    // An append had nothing left to send — everything staged is already there. A rebuild rewrites it,
    // so the same three rows are a session again, which is the only difference between the modes.
    await expect(syncButton(page)).toHaveText('Sync');
    await chooseMode(page, 'Reorder all');
    await expect(syncButton(page)).toHaveText('Sync (3)');

    // --- narrowed to two: the third leaves the list, and a rebuild will not put it back (ADR-0050) ---
    await discard(row(staged(page), titles[2]));
    await expect(syncButton(page)).toHaveText('Sync (2)');

    // --- the confirm counts what it will not put back, and is the only warning there is ---
    const asked = acceptNextDialog(page);
    await syncButton(page).click();

    const message = await asked;
    expect(message).toContain('copies back the 2 in the list');
    expect(message).toContain('1 file on the watch is not in it and will not come back');

    await toasts(page).filter({ hasText: 'Synced 2 of 2' }).waitFor();

    // --- the watch holds exactly the list, plus the one file the wipe could not touch ---
    const rows = outputs(userData);
    const named = (title: string) =>
        must(rows.find((output) => output.deviceFilename.startsWith(title)), `an output for ${title}`);

    const [kept, alsoKept, dropped] = titles.map(named);
    expect(existsSync(path.join(harness.device, kept.deviceFilename))).toBe(true);
    expect(existsSync(path.join(harness.device, alsoKept.deviceFilename))).toBe(true);
    expect(existsSync(path.join(harness.device, dropped.deviceFilename))).toBe(false);
    expect(existsSync(path.join(harness.device, SIDELOADED))).toBe(true);

    // Sync moved `onWatch` in both directions and deleted no rows: the wipe cleared the third. (ADR-0021)
    expect(rows).toHaveLength(3);
    expect(named(titles[0]).onWatch).toBe(true);
    expect(named(titles[1]).onWatch).toBe(true);
    expect(named(titles[2]).onWatch).toBe(false);

    // --- and the rebuild wrote them forward, which is what the mode exists to do (ADR-0044) ---
    const writtenAt = await Promise.all(
        [kept, alsoKept].map(async (output) => {
            const info = await stat(path.join(harness.device, output.deviceFilename), { bigint: true });
            return info.mtimeNs;
        }),
    );
    expect(
        writtenAt[0] < writtenAt[1],
        `${kept.deviceFilename} should be rewritten before ${alsoKept.deviceFilename}`,
    ).toBe(true);
});
