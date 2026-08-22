import { defineConfig } from '@playwright/test';

// Serial: the app is a singleton per userData dir, and ffmpeg's N is a machine-wide resource.
export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    // Transcoding a real file is the slow part; the default 30s trips on the audiobook fan-out.
    timeout: 120_000,
    expect: { timeout: 30_000 },
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
});
