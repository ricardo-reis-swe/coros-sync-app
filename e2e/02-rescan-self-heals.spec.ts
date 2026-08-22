import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, must, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { musicFile } from './fixtures/media';
import { chooseDevice, device, onWatch, putOnWatch, row, staged } from './fixtures/ui';

// The scan moves `onWatch` both ways and leaves nothing else; the row counts catch a Sync that inserts. (ADR-0021)
test('a rescan corrects onWatch both ways and creates no rows', async ({ harness }) => {
    const { page, userData } = harness;

    await chooseDevice(harness);
    const titles = await putOnWatch(harness, [
        await musicFile('heal-a', 3, 330),
        await musicFile('heal-b', 3, 440),
        await musicFile('heal-c', 3, 550),
    ]);

    const before = outputs(userData);
    expect(before).toHaveLength(3);
    expect(before.every((output) => output.onWatch)).toBe(true);
    const rowCounts = { items: items(userData).length, outputs: before.length };

    // Reach behind the app: one file taken off the watch, and debris from an interrupted transfer.
    const vanished = must(
        before.find((output) => output.deviceFilename.startsWith(titles[1])),
        `an output for ${titles[1]}`,
    );
    await rm(path.join(harness.device, vanished.deviceFilename));
    await writeFile(path.join(harness.device, 'Interrupted.mp3.part'), 'half a file');

    await device(page).getByRole('button', { name: 'Rescan' }).click();

    // --- true → false for the one that went, and only that one (ADR-0006) ---
    // Below the line is what `onWatch: false` looks like: owed again, so it rejoins the session. (ADR-0047)
    await expect(row(onWatch(page), vanished.deviceFilename)).toBeHidden();
    await expect(row(staged(page), titles[1])).toBeVisible();
    await expect(row(staged(page), titles[0])).toBeHidden();
    await expect(row(staged(page), titles[2])).toBeHidden();

    const after = outputs(userData);
    expect(must(after.find((output) => output.id === vanished.id), 'the row still').onWatch).toBe(
        false,
    );
    expect(after.filter((output) => output.onWatch)).toHaveLength(2);

    // --- the `.part` is swept, and never reaches the renderer (ADR-0010 / ADR-0028) ---
    await expect(device(page)).not.toContainText('Interrupted');
    expect(await readdir(harness.device)).not.toContain('Interrupted.mp3.part');

    // --- the sweep is logged: one of ADR-0013's four sites ---
    const logged = await readFile(path.join(userData, 'logs', 'app.log'), 'utf8');
    expect(logged).toContain('[device] swept Interrupted.mp3.part');

    // --- the scan is DISCARDED: the corrected boolean is its only durable trace (ADR-0006) ---
    expect({ items: items(userData).length, outputs: after.length }).toEqual(rowCounts);
    // Sync never inserts and never deletes — not even for the file it just found missing. (ADR-0021)
    expect(after.map((output) => output.id).sort()).toEqual(
        before.map((output) => output.id).sort(),
    );
});
