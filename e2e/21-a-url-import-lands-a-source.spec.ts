import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, logText, must, test } from './fixtures/app';
import { items } from './fixtures/db';
import { musicFile } from './fixtures/media';
import { fakeYtdlp } from './fixtures/ytdlp';
import {
    expand,
    importUrls,
    library,
    processButton,
    processed,
    row,
    setSettings,
    tick,
    toasts,
    trash,
} from './fixtures/ui';

const sourceDirs = (userData: string): Promise<string[]> =>
    readdir(path.join(userData, 'sources')).catch(() => []);

/**
 * The whole point of ADR-0027, in one assertion: a URL import produces a **source**, not an output.
 * The row lands `imported` in column 1 with no bitrate, and the mp3 is `[Process]`'s to make under
 * today's settings — which is what option B (yt-dlp emits the mp3, item lands `processed`) would
 * have destroyed, silently and while looking correct on screen.
 */
test('a URL lands a source in column 1, and Process makes the mp3', async ({ harness }) => {
    const { page, userData } = harness;
    const source = await musicFile('url-import', 4);

    await setSettings(page, { ytdlpPath: await fakeYtdlp({ source }), bitrateAudiobook: 64 });
    await importUrls(page, ['https://example.test/watch/Nocturne']);

    // The title is yt-dlp's, read back from `--print-to-file` — never used as a filename.
    await expect(row(library(page), 'Nocturne')).toBeVisible();

    const item = must(items(userData).find((row) => row.title === 'Nocturne'), 'the imported row');
    expect(item.state).toBe('imported');
    expect(item.type).toBe('media');
    // Null until Process decides it: the settings are read there, not at import. (ADR-0036)
    expect(item.bitrate ?? null).toBeNull();
    // The app's second owned blob, and the reason `sourcePath` is not the user's own file. (ADR-0027)
    expect(item.sourcePath.startsWith(path.join(userData, 'sources'))).toBe(true);

    await tick(row(library(page), 'Nocturne'));
    await processButton(page).click();

    await expect(row(processed(page), 'Nocturne')).toBeVisible({ timeout: 60_000 });
    // It went through the ordinary pipeline, so it has a badge and an Output row like anything else.
    await expect(row(processed(page), 'Nocturne').locator('.row-badge')).toBeVisible();
});

/** A dead extractor is an ordinary failure (ADR-0003): no row, no debris, one toast, one log line. */
test('a failed download leaves no row and no orphan directory', async ({ harness }) => {
    const { page, userData } = harness;

    // It writes the `.part` fragment first: cleanup by row would miss it, cleanup by directory cannot.
    await setSettings(page, { ytdlpPath: await fakeYtdlp({ leaveFragment: true }) });
    await importUrls(page, ['https://example.test/watch/Broken']);

    await expect(toasts(page)).toContainText('Download failed');

    expect(items(userData)).toHaveLength(0);
    expect(await sourceDirs(userData)).toHaveLength(0);
    expect(await logText(userData)).toContain('[download]');
});

/** Exit 0 having written nothing is the extractor succeeding at nothing; a row would follow no bytes. */
test('a download that writes nothing is not a success', async ({ harness }) => {
    const { page, userData } = harness;

    await setSettings(page, { ytdlpPath: await fakeYtdlp({ empty: true }) });
    await importUrls(page, ['https://example.test/watch/Empty']);

    await expect(toasts(page)).toContainText('Download failed');
    expect(items(userData)).toHaveLength(0);
    expect(await sourceDirs(userData)).toHaveLength(0);
});

/** The renderer's own guard, and main's: neither may let a non-http scheme reach a spawned child. */
test('only http and https are accepted', async ({ harness }) => {
    const { page, userData } = harness;

    await setSettings(page, { ytdlpPath: await fakeYtdlp({ source: await musicFile('url-import', 4) }) });
    await page.getByRole('button', { name: 'Import URL', exact: true }).click();
    await page.locator('.url-input').fill('file:///etc/passwd');

    // Dead, and it says why: a disabled button with no reason is the worse failure.
    await expect(page.locator('.modal').getByRole('button', { name: /^Import/ })).toBeDisabled();
    await expect(page.locator('.url-bad')).toContainText('Not an http or https link');

    // The renderer is a convenience; main is the one that decides. (ARCHITECTURE §8.4)
    const ack = await page.evaluate(() =>
        (window as unknown as { api: { invoke(c: string, p: unknown): Promise<{ ok: boolean }> } }).api.invoke(
            'importUrls',
            { urls: ['file:///etc/passwd'] },
        ),
    );
    expect(ack.ok).toBe(false);
    expect(items(userData)).toHaveLength(0);
});

/** One paste is one group, and the source goes with the row — `deleteItems` owns the second blob. */
test('a list imports as one group, and deleting takes the source with it', async ({ harness }) => {
    const { page, userData } = harness;
    const source = await musicFile('url-import', 4);

    await setSettings(page, { ytdlpPath: await fakeYtdlp({ source }) });
    await importUrls(page, [
        'https://example.test/watch/One',
        'https://example.test/watch/Two',
        'https://example.test/watch/Three',
    ]);

    // One paste is one group, so it renders as one collapsed folder row — like any multi-file import.
    await expect(row(library(page), 'Downloads/')).toBeVisible({ timeout: 30_000 });
    await expand(row(library(page), 'Downloads/'));
    await expect(row(library(page), 'Three')).toBeVisible();

    const rows = items(userData);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((item) => item.groupId)).size).toBe(1);
    // Appended, never restarted at 0 — the index space is the whole type. (ADR-0030)
    expect(new Set(rows.map((item) => item.orderIndex)).size).toBe(3);
    expect(await sourceDirs(userData)).toHaveLength(3);

    await trash(row(library(page), 'Two'));

    await expect(row(library(page), 'Two')).toBeHidden();
    expect(await sourceDirs(userData)).toHaveLength(2);
});

/**
 * The updater's network path cannot be tested here — the suite must not reach the network, which
 * is the property `ytdlpPath` exists to preserve. What IS testable offline is the guard, and it is
 * the one that matters: replacing the binary under a running child is how you get a half-swapped
 * yt-dlp mid-download. (ADR-0056)
 */
test('yt-dlp cannot be replaced while a download is running', async ({ harness }) => {
    const { page, userData } = harness;
    const source = await musicFile('url-import', 4);

    await setSettings(page, { ytdlpPath: await fakeYtdlp({ source, holdMs: 5000 }) });
    await importUrls(page, ['https://example.test/watch/Held']);

    // While the child is still alive, the updater must refuse rather than swap the binary.
    await page.evaluate(() =>
        (window as unknown as { api: { invoke(c: string, p: unknown): Promise<unknown> } }).api.invoke(
            'updateYtdlp',
            {},
        ),
    );

    await expect(toasts(page)).toContainText('A download is running');
    // Refused, not merely deferred: nothing was fetched and no bin/ directory exists.
    expect(await readdir(path.join(userData, 'bin')).catch(() => [])).toHaveLength(0);

    // And the held download still lands, so the refusal cost the user nothing.
    await expect(row(library(page), 'Held')).toBeVisible({ timeout: 30_000 });
});
