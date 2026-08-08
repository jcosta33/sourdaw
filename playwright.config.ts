import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    testIgnore: ['**/__tests__/**'],
    // Default per-test timeout. Template launches boot the WASM DSP + audio
    // graph before wait_for_workspace_ready observes the launch overlay exit;
    // under fullyParallel worker contention that cold boot + template creation
    // can exceed Playwright's 30s default. 25 tests across 11 spec files already
    // raise this to 60s per-test as a workaround — promoting it to the suite
    // default removes that duplication and adds no runtime to tests that finish
    // early (the timeout only bounds the slow ones).
    timeout: 60_000,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
    },
});
