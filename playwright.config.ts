import { env } from 'node:process';

import { defineConfig, devices } from '@playwright/test';

// oxlint-disable typescript/no-unsafe-member-access -- Typed by tsconfig.e2e.json.
// oxlint-disable-next-line import/no-default-export -- Playwright requires this export shape.
export default defineConfig({
    testDir: './tests/e2e',
    testIgnore: ['**/__tests__/**'],
    // Warm the dev server's cold module transform once, before any test's
    // first-paint bound starts observing. See tests/e2e/firstPaintWarmup.ts.
    globalSetup: './tests/e2e/firstPaintWarmup.ts',
    // Default per-test timeout. The ceiling accommodates independently bounded
    // cold first-paint and workspace-ready phases without outer preemption.
    // Template launches boot the WASM DSP + audio graph before the launch
    // overlay exits; early-completing tests add no runtime because this only
    // bounds the slow ones.
    timeout: 90_000,
    fullyParallel: true,
    forbidOnly: !!env.CI,
    // A result that needed a retry is a flaky result and creates the same duty as a failure.
    retries: 0,
    workers: 1,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'pnpm dev --mode e2e',
        url: 'http://localhost:5173',
        reuseExistingServer: !env.CI,
    },
});
