import { env } from 'node:process';
import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { e2eOrigin, resolveE2ePort } from '../../scripts/e2eServerIdentity';

const port = resolveE2ePort(env.SOURDAW_E2E_PORT ?? '15215');
const repositoryRoot = resolve(import.meta.dirname, '../..');

// oxlint-disable-next-line import/no-default-export -- Playwright requires this export shape.
export default defineConfig({
    testDir: '.',
    testMatch: 'productionFaustExport.e2e.spec.ts',
    timeout: 600_000,
    fullyParallel: false,
    forbidOnly: !!env.CI,
    retries: 0,
    workers: 1,
    outputDir: resolve(repositoryRoot, 'test-results/production-faust'),
    reporter: [
        ['list'],
        ['json', { outputFile: resolve(repositoryRoot, 'test-results/production-faust-results.json') }],
    ],
    use: {
        baseURL: e2eOrigin(port),
        viewport: { width: 1440, height: 900 },
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
    webServer: {
        command: `pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: repositoryRoot,
        url: e2eOrigin(port),
        reuseExistingServer: false,
    },
});
