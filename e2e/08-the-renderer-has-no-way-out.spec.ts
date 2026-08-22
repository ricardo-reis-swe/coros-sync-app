import { expect, test } from './fixtures/app';

// ADR-0014's zero-network and ADR-0011's two-verb sandbox, upheld by discipline alone until here.
// Against the PACKAGED app: the dev server needs its own socket, so the CSP lands on `isPackaged`.
test('the renderer has no way out: no network, no navigation, no Node', async ({ harness }) => {
    const { page } = harness;

    // --- connect-src 'none': a refused connection looks identical to a rejected promise, so the CSP
    // has to be caught reporting itself — the violation, not the failure. (ADR-0014) ---
    const violated = await page.evaluate(async () => {
        const reported = new Promise<string>((resolve) => {
            document.addEventListener(
                'securitypolicyviolation',
                (event) => resolve(event.effectiveDirective || event.violatedDirective),
                { once: true },
            );
        });

        // Port 9 (discard): nothing to reach even if the CSP were missing, so this cannot hang.
        void fetch('http://127.0.0.1:9/').catch(() => undefined);

        return Promise.race([
            reported,
            new Promise<string>((resolve) => setTimeout(() => resolve('no violation'), 5_000)),
        ]);
    });
    expect(violated).toBe('connect-src');

    // --- setWindowOpenHandler denies: a second window is the other route to a request ---
    expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true);

    // --- the sandbox, declared rather than inherited: no Node reaches the renderer (ADR-0011) ---
    expect(
        await page.evaluate(() => {
            const global = window as unknown as Record<string, unknown>;
            return {
                require: typeof global.require,
                process: typeof global.process,
                ipcRenderer: typeof global.ipcRenderer,
                // Two verbs, and only two.
                api: Object.keys((global.api ?? {}) as object).sort(),
            };
        }),
    ).toEqual({
        require: 'undefined',
        process: 'undefined',
        ipcRenderer: 'undefined',
        api: ['invoke', 'subscribe'],
    });
});
