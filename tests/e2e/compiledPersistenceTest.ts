import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { test as base } from '@playwright/test';

import { startCompiledPersistenceServer } from '../../scripts/compiledPersistenceServer';
import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import warmFirstPaint from './firstPaintWarmup';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));

// Worker initialization is outside the unchanged acceptance-case deadline.
// Other selected specs never request this fixture and never pay for a build.
export const test = base.extend<object, { compiledPersistenceOrigin: string }>({
    compiledPersistenceOrigin: [
        async ({}, use, workerInfo) => {
            if (isBuiltE2eShardRun(process.env)) {
                const origin = workerInfo.project.use.baseURL;
                if (typeof origin !== 'string') {
                    throw new Error('Built persistence shard requires its configured preview origin');
                }
                await use(origin);
                return;
            }
            const server = await startCompiledPersistenceServer(root);
            try {
                await warmFirstPaint({
                    ...workerInfo.config,
                    projects: [{ ...workerInfo.project, use: { ...workerInfo.project.use, baseURL: server.origin } }],
                });
                await use(server.origin);
            } finally {
                await server.close();
            }
        },
        { scope: 'worker', timeout: 600_000 },
    ],
    baseURL: async ({ compiledPersistenceOrigin }, use) => {
        await use(compiledPersistenceOrigin);
    },
});
