import { resolve } from 'node:path';

import { ORIGINAL_SPEC, PRIVATE_DIRECTORY, WRAPPER } from './identity.ts';
import { requiredText } from './journal.ts';

import type { PlaywrightTestConfig } from '@playwright/test';

export function configureDiagnostic(
    original: PlaywrightTestConfig,
    root: string,
    output: string,
    observing: boolean
): PlaywrightTestConfig {
    if (original.workers !== 1 || original.retries !== 0 || !original.projects || original.projects.length !== 2) {
        throw new Error('Original one-worker, retry0, two-project configuration is required');
    }
    const maintained = resolve(root, ORIGINAL_SPEC);
    const wrapper = resolve(root, WRAPPER);
    const projects = original.projects.map((project) => {
        if (project.name === 'chromium') {
            if (!Array.isArray(project.testIgnore) || !project.testIgnore.includes(maintained)) {
                throw new Error('Original built-project exclusion is missing');
            }
            return { ...project, testIgnore: [...project.testIgnore, wrapper] };
        }
        if (
            project.name !== 'chromium-dev' ||
            !Array.isArray(project.testMatch) ||
            !project.testMatch.includes(maintained)
        ) {
            throw new Error('Original dev-project route is missing');
        }
        return { ...project, testMatch: project.testMatch.map((path) => (path === maintained ? wrapper : path)) };
    });
    if (!Array.isArray(original.webServer) || original.webServer.length !== 2) {
        throw new Error('Original preview and dev companion are required');
    }
    let companions = 0;
    const webServer = original.webServer.map((server) => {
        if (server.reuseExistingServer !== false) {
            throw new Error('Diagnostic must not reuse an existing server');
        }
        if (server.command !== 'node scripts/e2eDevServer.ts 5174') {
            return { ...server, cwd: root };
        }
        companions += 1;
        return {
            ...server,
            cwd: root,
            command: observing ? `node ${PRIVATE_DIRECTORY}/serverObserver.ts` : server.command,
        };
    });
    if (companions !== 1) {
        throw new Error('Expected exactly one original dev-companion command');
    }
    return {
        ...original,
        use: observing
            ? {
                  ...original.use,
                  launchOptions: {
                      ...original.use?.launchOptions,
                      executablePath: requiredText(
                          process.env.RELOAD_DIAGNOSTIC_BROWSER_WRAPPER,
                          'qualified browser wrapper'
                      ),
                  },
              }
            : original.use,
        testDir: resolve(root, 'tests/e2e'),
        globalSetup: resolve(root, 'tests/e2e/firstPaintWarmup.ts'),
        projects,
        webServer,
        outputDir: resolve(output, 'test-output'),
        reporter: [
            ['blob', { outputDir: resolve(output, 'blob-report') }],
            [resolve(root, PRIVATE_DIRECTORY, 'listReporter.ts')],
        ],
    };
}
