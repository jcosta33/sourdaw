import { env } from 'node:process';

import { defineConfig, devices } from '@playwright/test';

import { e2eOrigin, resolveE2ePort } from './scripts/e2eServerIdentity';

const port = resolveE2ePort(env.SOURDAW_E2E_PORT ?? '15215');

// oxlint-disable-next-line import/no-default-export -- Playwright requires this export shape.
export default defineConfig({
    testDir: './tests/production-e2e',
    testMatch: 'productionFaustExport.e2e.spec.ts',
    timeout: 600_000,
    fullyParallel: false,
    forbidOnly: !!env.CI,
    retries: 0,
    workers: 1,
    outputDir: 'test-results/production-faust',
    reporter: [['list'], ['json', { outputFile: 'test-results/production-faust-results.json' }]],
    use: {
        baseURL: e2eOrigin(port),
        viewport: { width: 1440, height: 900 },
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
    webServer: {
        command: `pnpm preview --host localhost --port ${port} --strictPort`,
        url: e2eOrigin(port),
        reuseExistingServer: false,
    },
});
