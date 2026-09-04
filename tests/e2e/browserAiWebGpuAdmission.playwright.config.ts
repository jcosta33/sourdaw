import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const WEBGPU_ADMISSION_PORT = 5188;
const WEBGPU_ADMISSION_ORIGIN = `http://localhost:${WEBGPU_ADMISSION_PORT}`;

// This proof must exercise this checkout. Reusing the shared default Vite port
// can silently attach it to another worktree's server and report stale code as
// current evidence.
// oxlint-disable-next-line import/no-default-export -- Playwright requires this export shape.
export default defineConfig({
    testDir: '.',
    // Every spec whose subject is what Sourdaw presents once a WebGPU device is
    // admitted. The general Chromium matrix has no adapter and can only prove
    // the refused side, so a spec left out of this list has no runner that
    // executes its admitted assertions.
    testMatch: ['browserAiWebGpuAdmission.spec.ts', 'browserAiAdmittedPresentation.spec.ts'],
    // Warm this config's own isolated server before the admission specs start
    // observing their first-paint bounds. See ./firstPaintWarmup.ts.
    globalSetup: './firstPaintWarmup.ts',
    timeout: 60_000,
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: 'line',
    use: {
        baseURL: WEBGPU_ADMISSION_ORIGIN,
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            metadata: {
                browserAiWebGpuHardware: 'required',
            },
            use: {
                ...devices['Desktop Chrome'],
                headless: false,
            },
        },
    ],
    webServer: {
        command: `pnpm dev --host 127.0.0.1 --port ${WEBGPU_ADMISSION_PORT} --strictPort`,
        cwd: resolve(import.meta.dirname, '../..'),
        url: WEBGPU_ADMISSION_ORIGIN,
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
});
