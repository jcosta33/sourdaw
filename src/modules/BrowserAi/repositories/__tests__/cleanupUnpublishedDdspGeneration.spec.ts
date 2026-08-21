import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { cleanupUnpublishedDdspGeneration } from '../cleanupUnpublishedDdspGeneration';

import { createDdspStorageTestHarness } from './ddspGenerationStorageTestSupport';

describe('cleanupUnpublishedDdspGeneration', () => {
    it('removes a staged failed generation without disturbing the already-current one', async () => {
        const seed = createDdspStorageTestHarness();
        const current = seed.generation('v1');
        const harness = createDdspStorageTestHarness({
            files: new Map([
                [
                    seed.indexModelId,
                    seed.bytes({ schemaVersion: 1, currentVersion: 'v1', generations: { v1: current } }),
                ],
            ]),
        });
        injectDependencies(cleanupUnpublishedDdspGeneration, {
            logger: { warn: vi.fn() },
            modelStorageWorkerBridge: harness.bridge,
            sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
        });

        await cleanupUnpublishedDdspGeneration(harness.storage);

        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: 'v1',
            generations: { v1: current },
        });
    });
});
