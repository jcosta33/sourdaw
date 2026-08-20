import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const PORT = 5192;
const ORIGIN = `http://127.0.0.1:${String(PORT)}`;

// oxlint-disable-next-line import/no-default-export -- Playwright requires this export shape.
export default defineConfig({
    testDir: '.',
    testMatch: 'ddspRenderElectron.spec.ts',
    timeout: 180_000,
    fullyParallel: false,
    workers: 1,
    reporter: 'line',
    use: { baseURL: ORIGIN, trace: 'retain-on-failure' },
    webServer: {
        command: `pnpm dev --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        url: ORIGIN,
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
});
