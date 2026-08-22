import { chmod, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, logText, test } from './fixtures/app';
import { outputs } from './fixtures/db';
import { musicFile } from './fixtures/media';
import {
    chooseDevice,
    device,
    importMedia,
    library,
    processed,
    row,
    staged,
    tick,
    toasts,
} from './fixtures/ui';

// Only absence may empty the device view; anything else infers a device state from a failure. (ADR-0001)
// The other direction too: `copy` raising `Denied` while the scan lists fine is not `reach: 'denied'`. (ADR-0045)
test('a watch that refuses a write is not reported as unplugged', async ({ harness }) => {
    const { page, userData } = harness;
    const source = await musicFile('locked', 3, 440);
    const title = path.parse(source).name;

    await chooseDevice(harness);
    await importMedia(harness, [source]);
    await tick(row(library(page), title));
    await library(page).getByRole('button', { name: /^Process/ }).click();

    await row(processed(page), title).waitFor({ timeout: 60_000 });
    await tick(row(processed(page), title));
    await processed(page).getByRole('button', { name: /^Stage/ }).click();
    await row(staged(page), title).locator('.row-number').waitFor();

    // Readable, listable, not writable — a real watch that is present and unhappy. Not ENOENT: that IS absence.
    await chmod(harness.device, 0o500);
    await device(page).getByRole('button', { name: /^Sync/ }).click();

    await expect(toasts(page)).toContainText('Transfer interrupted — 0 of 1 copied.');

    // --- the view survives the failure: still connected, still showing its free space (ADR-0001) ---
    // Tight timeouts on purpose: the focus-rescan (ADR-0038) would repair a regression into a pass.
    await expect(device(page)).toContainText('Nothing on the watch.', { timeout: 5_000 });
    await expect(device(page)).not.toContainText('is the watch plugged in?', { timeout: 1_000 });
    await expect(device(page).locator('.cell-foot')).toContainText('GB free');
    // `reach` drives it, so an enabled Eject is the state itself, not a rendering of it. (ADR-0034)
    await expect(device(page).getByRole('button', { name: 'Eject' })).toBeEnabled();

    // --- nothing was confirmed, so nothing moved: the rename never happened (ADR-0001 / ADR-0010) ---
    expect(outputs(userData)[0].onWatch).toBe(false);
    // Still below the line and still grey: the row only crosses it on a confirmed rename. (ADR-0047)
    await expect(row(staged(page), title)).toHaveClass(/row-grey/);
    await expect(row(staged(page), title).locator('.row-tick')).toBeHidden();
    // A copy that never opened its file leaves no debris to sweep.
    expect(await readdir(harness.device)).toEqual([]);

    // --- a failed device op is one of ADR-0013's four sites ---
    expect(await logText(userData)).toMatch(/ERROR.*\[device] transfer aborted after 0\/1/);

    // Restored, or the harness cannot remove the directory it made.
    await chmod(harness.device, 0o700);
});
