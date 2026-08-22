import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/app';

test('harness: isolated userData, and the native picker is ours', async ({ harness }) => {
    const { page, userData, device } = harness;

    await expect(page.locator('.header-title')).toHaveText('Coros Sync');
    // The db is opened at module scope off `app.getPath('userData')` — proof the switch took.
    expect(existsSync(path.join(userData, 'app.db'))).toBe(true);

    await expect(page.locator('.column-device')).toContainText('No watch folder chosen yet');

    await harness.queueDialog([device]);
    // The one picker is the header's: no empty state carries a copy of it. (ADR-0045)
    await page.locator('.app-header').getByRole('button', { name: 'Choose Music folder' }).click();

    // A stubbed picker that reached `selectMount` writes `mountPath`, and the scan follows it.
    await expect(page.locator('.column-device')).toContainText('Nothing on the watch.');
    await expect(page.locator('.cell-foot')).toContainText('GB free');
});
