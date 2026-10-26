import { resolve } from 'node:path';
import { env } from 'node:process';

import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

import { e2eOrigin, resolveE2ePort, SOURDAW_E2E_PORT_ENV } from './scripts/e2eServerIdentity';
import { devServerOnlySpecs } from './tests/e2e/devServerOnlySpecs';

// One lane-scoped port feeds baseURL and webServer together, so lanes sharing
// a machine export SOURDAW_E2E_PORT with a lane-unique value instead of
// silently reusing whatever checkout owns the default port. strictPort makes
// a collision abort loudly instead of drifting to another port.
const port = resolveE2ePort(env.SOURDAW_E2E_PORT);

// Serving the dev server costs about half of all CI browser runner time, so a
// CI shard (the only caller that sets E2E_SPECS, via scripts/prValidationScope.ts
// `run`) serves a production-mode build instead. Local runs, the offline smoke
// job and nightly keep the dev server.
const builtShardRun = Boolean(env.CI) && env.E2E_SPECS !== undefined;

function selectedShardSpecs(): readonly string[] {
    const parsed: unknown = JSON.parse(env.E2E_SPECS ?? '[]');
    if (!Array.isArray(parsed)) {
        throw new TypeError('E2E_SPECS must be a JSON list of spec paths');
    }
    return parsed.filter((path): path is string => typeof path === 'string');
}

// A build serves no `/src/` module URLs, so these files keep a dev server.
const devServerOnlyPaths = devServerOnlySpecs.map((path) => resolve(import.meta.dirname, path));
const shardNeedsDevServer = builtShardRun && selectedShardSpecs().some((path) => devServerOnlySpecs.includes(path));

function devServerPort(): number {
    if (port === 65535) {
        throw new RangeError(`${SOURDAW_E2E_PORT_ENV}=65535 leaves no valid port for this CI shard's dev companion`);
    }
    return port + 1;
}

const defaultIgnore = ['**/__tests__/**'];

// Today's shape: one dev server, one project.
type Project = NonNullable<PlaywrightTestConfig['projects']>[number];
type WebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>;

const devServerProjects: Project[] = [
    {
        name: 'chromium',
        use: devices['Desktop Chrome'],
    },
];
const devServerWebServer: WebServer = {
    command: `pnpm dev --mode e2e --port ${port} --strictPort`,
    url: e2eOrigin(port),
    reuseExistingServer: !env.CI,
};

function builtShardProjects(): Project[] {
    const projects: Project[] = [
        {
            name: 'chromium',
            // A project-level ignore replaces the top-level one, so it repeats it.
            testIgnore: [...defaultIgnore, ...devServerOnlyPaths],
            use: devices['Desktop Chrome'],
        },
    ];
    if (shardNeedsDevServer) {
        projects.push({
            name: 'chromium-dev',
            testMatch: devServerOnlyPaths,
            use: { ...devices['Desktop Chrome'], baseURL: e2eOrigin(devServerPort()) },
        });
    }
    return projects;
}

function builtShardWebServers(): WebServer[] {
    const servers: WebServer[] = [
        {
            // The build is part of server startup, so the wait covers it.
            command: `pnpm exec vite build --mode e2e && pnpm exec vite preview --mode e2e --port ${port} --strictPort`,
            url: e2eOrigin(port),
            timeout: 600_000,
            reuseExistingServer: false,
        },
    ];
    if (shardNeedsDevServer) {
        const companionPort = devServerPort();
        servers.push({
            command: `pnpm dev --mode e2e --port ${companionPort} --strictPort`,
            url: e2eOrigin(companionPort),
            reuseExistingServer: false,
        });
    }
    return servers;
}

// oxlint-disable typescript/no-unsafe-member-access -- Typed by tsconfig.e2e.json.
// oxlint-disable-next-line import/no-default-export -- Playwright requires this export shape.
export default defineConfig({
    testDir: './tests/e2e',
    testIgnore: defaultIgnore,
    // Warm each server's cold start once, before any test's first-paint bound
    // starts observing: the dev server's module transform, or the built
    // app's first load. See tests/e2e/firstPaintWarmup.ts.
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
        baseURL: e2eOrigin(port),
        trace: 'retain-on-failure',
    },
    projects: builtShardRun ? builtShardProjects() : devServerProjects,
    webServer: builtShardRun ? builtShardWebServers() : devServerWebServer,
});
