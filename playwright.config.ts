import { env } from 'node:process';

import { defineConfig, devices } from '@playwright/test';

import { e2eOrigin, resolveE2ePort } from './scripts/e2eServerIdentity';

// One lane-scoped port feeds baseURL and webServer together, so lanes sharing
// a machine export SOURDAW_E2E_PORT with a lane-unique value instead of
// silently reusing whatever checkout owns the default port. strictPort makes
// a collision abort loudly instead of drifting to another port.
const port = resolveE2ePort(env.SOURDAW_E2E_PORT);

// MEASUREMENT PROBE for issue 5148, not for merge: heavy-gates shard runs
// (CI with E2E_SPECS, set only by its "Run shard" step) serve a prebuilt app
// through `vite preview` and run two workers, so the result can be compared
// against dev-server runs. Local runs, the offline smoke job, and nightly keep
// the dev server and one worker.
const builtShardRun = Boolean(env.CI) && env.E2E_SPECS !== undefined;

// Specs that import `/src/...` module URLs at runtime need the dev server's
// module graph; a built app does not serve them.
const devServerOnlySpecs = [
    '**/admitLoopbackProvider.ts', // helper: dynamic /src/ imports of cloud provider use cases
    '**/agentWorkspace.spec.ts', // uses admitLoopbackProvider
    '**/aiConfirmApplyUndo.spec.ts', // uses admitLoopbackProvider
    '**/browserAiWebGpuAdmission.spec.ts', // uses admitLoopbackProvider and the /src/-served ddspRenderProbe.html
    '**/audioOwnership.native.spec.ts', // dynamic /src/ imports of use cases and stores
    '**/browserDisplayScale.spec.ts', // dynamic /src/ import of recentProjects helpers
    '**/builtinDeviceAutomationOffline.spec.ts', // dynamic /src/ imports of device strategy modules
    '**/crdtPersistence.native.spec.ts', // dynamic /src/ imports of CRDT modules
    '**/monoModulationInput.spec.ts', // dynamic /src/ imports of modulation devices
    '**/pianoRollDockAcceptance.spec.ts', // dynamic /src/ import of workspaceStore
    '**/smoke.spec.ts', // navigates to and imports /src/ CRDT module documents
    '**/spatialPannerArrangementTestId.spec.ts', // dynamic /src/ import of createArrangement
];

// oxlint-disable typescript/no-unsafe-member-access -- Typed by tsconfig.e2e.json.
// oxlint-disable-next-line import/no-default-export -- Playwright requires this export shape.
export default defineConfig({
    testDir: './tests/e2e',
    testIgnore: builtShardRun ? ['**/__tests__/**', ...devServerOnlySpecs] : ['**/__tests__/**'],
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
    workers: builtShardRun ? 2 : 1,
    reporter: 'html',
    use: {
        baseURL: e2eOrigin(port),
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: devices['Desktop Chrome'],
        },
    ],
    webServer: {
        command: builtShardRun
            ? `pnpm exec vite build --mode e2e && pnpm exec vite preview --mode e2e --port ${port} --strictPort`
            : `pnpm dev --mode e2e --port ${port} --strictPort`,
        url: e2eOrigin(port),
        timeout: builtShardRun ? 600_000 : 60_000,
        reuseExistingServer: !env.CI,
    },
});
