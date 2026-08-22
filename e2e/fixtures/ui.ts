import { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { Harness } from './app';

// Scoped by heading, never by index: a `processed` item is on screen TWICE on purpose (derive.ts).
const column = (page: Page, title: string): Locator =>
    page.locator(`.column:has(> .column-head > .column-title:text-is("${title}"))`);

export const library = (page: Page) => column(page, 'Library');
export const processed = (page: Page) => column(page, 'Processed');
export const device = (page: Page) => page.locator('.column-device');

// Two regions, so a bare `.row` would match either; `staged` spans both type cells on purpose. (ADR-0047)
export const onWatch = (page: Page) => device(page).locator('.cell-on-watch');
export const staged = (page: Page) => device(page).locator('.cell:not(.cell-on-watch)');

/** Exact, via the title attribute Row already puts on every label — `hasText` would match prefixes. */
export const row = (within: Locator, label: string): Locator =>
    within.locator(`.row:has(.row-label[title="${label}"])`);

export const rowLabels = (within: Locator): Promise<string[]> =>
    within.locator('.row .row-label').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('title') ?? ''),
    );

export const tick = (target: Locator) => target.locator('input[type="checkbox"]').check();

export const untick = (target: Locator) => target.locator('input[type="checkbox"]').uncheck();

/** A row's own arrow, never a child's: `.row` is flat, so one row holds exactly one. */
export const expand = (target: Locator) => target.locator('.row-arrow').click();

/** `⇤`, by the title `Row` gives it — the only accessible name a bare icon button has. */
export const discard = (target: Locator) =>
    target.getByRole('button', { name: /^Take off the send list/ }).click();

/** The three counts, each read from the column that owns it — they are allowed to disagree. (ADR-0051) */
export const processButton = (page: Page) => library(page).getByRole('button', { name: /^Process/ });
export const stageButton = (page: Page) => processed(page).getByRole('button', { name: /^Stage/ });
export const syncButton = (page: Page) => device(page).getByRole('button', { name: /^Sync/ });

export const toasts = (page: Page) => page.locator('.toast');

export const footer = (page: Page) => device(page).locator('.cell-foot');

/** Column 1's trash is titled `Delete`; column 3's is a different intent with a different title. */
export const trash = (target: Locator) =>
    target.getByRole('button', { name: 'Delete', exact: true }).click();

export const trashFromWatch = (target: Locator) =>
    target.getByRole('button', { name: 'Delete from the watch' }).click();

/** The radio's name comes from its wrapping label — the `ⓘ` beside it carries no text. */
export const chooseMode = (page: Page, label: string) =>
    device(page).getByRole('radio', { name: label }).check();

/**
 * Playwright DISMISSES a dialog when nothing is listening, so a `confirm`-guarded gesture needs this
 * armed before the click. Resolves with the message, which for a rebuild is the only place the cost
 * of the wipe is stated. (ADR-0050)
 */
export const acceptNextDialog = (page: Page): Promise<string> =>
    new Promise((resolve) => {
        page.once('dialog', async (dialog) => {
            const message = dialog.message();
            await dialog.accept();
            resolve(message);
        });
    });

export const importMedia = async (harness: Harness, sourcePaths: string[]): Promise<void> => {
    await harness.queueDialog(sourcePaths);
    // Exact: the split button's dropdown trigger is titled "Import Media — folder".
    await harness.page.getByRole('button', { name: 'Import Media', exact: true }).click();
};

export const importAudiobook = async (harness: Harness, sourcePaths: string[]): Promise<void> => {
    await harness.queueDialog(sourcePaths);
    await harness.page.getByRole('button', { name: 'Import Audiobook', exact: true }).click();
};

/** One picker, in the header: no empty state carries a copy of it. (ADR-0045) */
export const chooseDevice = async (harness: Harness): Promise<void> => {
    await harness.queueDialog([harness.device]);
    await harness.page
        .locator('.app-header')
        .getByRole('button', { name: 'Choose Music folder' })
        .click();
};

// One import each: files picked together share a `groupId` and render as ONE collapsed folder row.
export const importEach = async (harness: Harness, sourcePaths: string[]): Promise<string[]> => {
    const titles: string[] = [];

    for (const sourcePath of sourcePaths) {
        // The same title `processImport` derives, so the row is addressable by the name on screen.
        const title = path.basename(sourcePath, path.extname(sourcePath));
        await importMedia(harness, [sourcePath]);
        await row(library(harness.page), title).waitFor();
        titles.push(title);
    }

    return titles;
};

// Import → Process → Stage: stops while the order is still a claim, the only moment it is on screen. (ADR-0047)
export const stageAll = async (harness: Harness, sourcePaths: string[]): Promise<string[]> => {
    const { page } = harness;
    const titles = await importEach(harness, sourcePaths);

    for (const title of titles) await tick(row(library(page), title));
    await library(page).getByRole('button', { name: /^Process/ }).click();

    for (const title of titles) {
        await row(processed(page), title).waitFor({ timeout: 60_000 });
        await tick(row(processed(page), title));
    }
    await processed(page).getByRole('button', { name: /^Stage/ }).click();

    // Staged is a place: the row leaves column 2 for column 3, carrying a playback number.
    await row(staged(page), titles[0]).locator('.row-number').waitFor();

    return titles;
};

// Import → Process one audiobook: the row appearing in column 2 IS the end of processing (`isTranscoded`).
export const processAudiobook = async (harness: Harness, source: string): Promise<string> => {
    const { page } = harness;
    const title = path.basename(source, path.extname(source));

    await importAudiobook(harness, [source]);
    await tick(row(library(page), title));
    await processButton(page).click();
    await row(processed(page), title).waitFor({ timeout: 90_000 });

    return title;
};

export const syncAll = async (page: Page, count: number): Promise<void> => {
    await device(page).getByRole('button', { name: /^Sync/ }).click();
    await toasts(page).filter({ hasText: `Synced ${count} of ${count}` }).waitFor();
};

/** Import → Process → Stage → Sync. The arrange step for anything about the watch. */
export const putOnWatch = async (harness: Harness, sourcePaths: string[]): Promise<string[]> => {
    const titles = await stageAll(harness, sourcePaths);
    await syncAll(harness.page, titles.length);

    return titles;
};

// Through the preload surface, not a back door: driving the modal would be testing the modal.
export const setSettings = (page: Page, patch: Record<string, unknown>): Promise<unknown> =>
    page.evaluate(
        (values) =>
            (window as unknown as { api: { invoke(c: string, p: unknown): Promise<unknown> } }).api.invoke(
                'updateSettings',
                values,
            ),
        patch,
    );
