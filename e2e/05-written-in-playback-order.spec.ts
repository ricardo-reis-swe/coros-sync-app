import { stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, must, test } from './fixtures/app';
import { items, outputs } from './fixtures/db';
import { musicFile } from './fixtures/media';
import { chooseDevice, row, staged, stageAll, syncAll } from './fixtures/ui';

// The player follows write order, so the session is written FORWARD, and nothing else can catch a
// regression: no row records the direction, and it has been wrong once. (ADR-0044, superseding ADR-0035)
test('the session is written in playback order, which is the order on screen', async ({
    harness,
}) => {
    const { page, userData } = harness;

    await chooseDevice(harness);
    const titles = await stageAll(harness, [
        await musicFile('order-a', 4, 330),
        await musicFile('order-b', 4, 440),
        await musicFile('order-c', 4, 550),
    ]);

    // --- the renderer's view is plain playback order: 1, 2, 3, in the order they were imported ---
    // Before the sync, the only time it is on screen; never above the line, which is the device's order.
    for (const [at, title] of titles.entries()) {
        await expect(row(staged(page), title).locator('.row-number')).toHaveText(String(at + 1));
    }

    await syncAll(page, titles.length);

    // Playback order as main was given it: `orderIndex` ascending, one output per media item.
    const byItem = new Map(outputs(userData).map((output) => [output.itemId, output]));
    const playback = items(userData)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((item) => must(byItem.get(item.id), `an output for ${String(item.title)}`));

    expect(playback.map((output) => output.deviceFilename.replace(/\.mp3$/, ''))).toEqual(titles);

    // Nanoseconds: three small copies land inside the same millisecond, so `mtimeMs` cannot tell them apart.
    const writtenAt = await Promise.all(
        playback.map(async (output) => {
            const info = await stat(path.join(harness.device, output.deviceFilename), {
                bigint: true,
            });
            return info.mtimeNs;
        }),
    );

    // --- the one that plays FIRST was written FIRST (ADR-0044) ---
    for (let at = 1; at < writtenAt.length; at++) {
        expect(
            writtenAt[at - 1] < writtenAt[at],
            `${playback[at - 1].deviceFilename} should be written before ${playback[at].deviceFilename}`,
        ).toBe(true);
    }
});
