import { chmod } from 'node:fs/promises';
import { expect, logText, test } from './fixtures/app';
import { outputs } from './fixtures/db';
import { musicFile } from './fixtures/media';
import { chooseDevice, device, putOnWatch, row, staged, toasts } from './fixtures/ui';

// The state macOS produces: `stat` passes, `readdir` is refused. `Denied` is its own reach because a
// forbidden device is not an absent one — it shipped as "is the watch plugged in?". (ADR-0045)
test('a watch the OS forbids is reported as blocked, not as unplugged', async ({ harness }) => {
    const { page, userData } = harness;

    await chooseDevice(harness);
    const titles = await putOnWatch(harness, [await musicFile('forbidden', 3, 440)]);

    // Present, listed by the picker a moment ago, and now unreadable. Not ENOENT — that IS absence.
    await chmod(harness.device, 0o000);
    await device(page).getByRole('button', { name: 'Rescan' }).click();

    // --- the blocked state, naming the path and the remedy's control (ADR-0045) ---
    await expect(device(page)).toContainText('The system is blocking access to');
    await expect(device(page)).toContainText(harness.device);
    await expect(device(page)).not.toContainText('is the watch plugged in?');
    // Named, not duplicated: the one picker is the header's and is never hidden. (ADR-0045)
    await expect(device(page)).toContainText('Use Choose Music folder in the header');
    await expect(
        page.locator('.app-header').getByRole('button', { name: 'Choose Music folder' }),
    ).toBeVisible();

    // --- both controls stay live: Rescan is what you press after granting, and `diskutil` never read ---
    await expect(device(page).getByRole('button', { name: 'Rescan' })).toBeEnabled();
    await expect(device(page).getByRole('button', { name: 'Eject' })).toBeEnabled();

    // --- a denied scan confirms nothing, so `onWatch` moves neither way (ADR-0001) ---
    expect(outputs(userData)[0].onWatch).toBe(true);
    // Nothing falls back into the staged region: a refused read is not a confirmed absence. (ADR-0001)
    await expect(row(staged(page), titles[0])).toBeHidden();

    // --- the remedy is a sentence, not an errno: the toast is the only place the OS is named ---
    const blocked = toasts(page).filter({ hasText: 'Music folder' });
    await expect(blocked).toHaveCount(1);
    await expect(blocked).not.toContainText('EACCES');

    // --- once per transition, not per scan: ADR-0038 rescans on every focus (ADR-0013 / ADR-0045) ---
    await device(page).getByRole('button', { name: 'Rescan' }).click();
    await device(page).getByRole('button', { name: 'Rescan' }).click();
    // Retries, so a second toast appearing at any point during the two scans fails this.
    await expect(blocked).toHaveCount(1);

    // Restored — and the barrier: the file back on screen means the scans above have all settled.
    await chmod(harness.device, 0o700);
    await device(page).getByRole('button', { name: 'Rescan' }).click();
    await expect(device(page)).toContainText(titles[0]);
    await expect(device(page).locator('.cell-foot')).toContainText('GB free');

    expect(await logText(userData)).toMatch(/ERROR \[device] scan denied:/);
    expect((await logText(userData)).match(/\[device] scan denied:/g)).toHaveLength(1);
});
