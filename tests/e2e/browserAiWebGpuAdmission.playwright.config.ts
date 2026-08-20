import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const WEBGPU_ADMISSION_PORT = 5188;
const WEBGPU_ADMISSION_ORIGIN = `http://localhost:${WEBGPU_ADMISSION_PORT}`;

// This proof must exercise this checkout. Reusing the shared default Vite port
// can silently attach it to another worktree's server and report stale code as
// current evidence.
export default defineConfig({
    testDir: '.',
    testMatch: 'browserAiWebGpuAdmission.spec.ts',
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
            use: {
                ...devices['Desktop Chrome'],
                headless: false,
            },
        },
    ],
    webServer: {
        command: `pnpm dev --host 127.0.0.1 --port ${WEBGPU_ADMISSION_PORT} --strictPort`,
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        url: WEBGPU_ADMISSION_ORIGIN,
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
});
