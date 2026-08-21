import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { cleanupUnpublishedDdspGeneration } from '../cleanupUnpublishedDdspGeneration';

import { createDdspStorageTestHarness } from './ddspGenerationStorageTestSupport';

describe('cleanupUnpublishedDdspGeneration', () => {
    it('should track and delete every candidate artifact before preserving the current generation', async () => {
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

        const candidate = harness.generation(harness.storage.version);
        expect(harness.events).toEqual([
            `commit:${harness.indexModelId}`,
            `delete:${candidate.readyMarkerId}`,
            ...candidate.artifactIds.map((artifactId) => `delete:${artifactId}`),
            `commit:${harness.indexModelId}`,
        ]);
        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: 'v1',
            generations: { v1: current },
        });
    });

    it('should retain a failed candidate for retry and remove it after a later successful cleanup', async () => {
        const seed = createDdspStorageTestHarness();
        const current = seed.generation('v1');
        const failedDeletes = new Set([`${seed.instrument.id}/${seed.storage.version}/group1-shard1of1.bin`]);
        const harness = createDdspStorageTestHarness({
            failDeletes: failedDeletes,
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
            generations: { v1: current, [harness.storage.version]: harness.generation(harness.storage.version) },
        });

        failedDeletes.clear();
        await cleanupUnpublishedDdspGeneration(harness.storage);

        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: 'v1',
            generations: { v1: current },
        });
    });

    it.each(['forged ready marker', 'unsafe version', 'duplicate artifact ids'] as const)(
        'should suppress cleanup without deleting metadata from an index with %s',
        async (kind) => {
            const harness = createDdspStorageTestHarness();
            const generation = harness.generation(harness.storage.version);
            const generations =
                kind === 'unsafe version'
                    ? { '../unsafe': generation }
                    : {
                          [harness.storage.version]: {
                              ...generation,
                              ...(kind === 'forged ready marker'
                                  ? { readyMarkerId: `${harness.instrument.id}/${harness.storage.version}/forged.json` }
                                  : { artifactIds: [generation.artifactIds[0], generation.artifactIds[0]] }),
                          },
                      };
            harness.files.set(
                harness.indexModelId,
                harness.bytes({
                    schemaVersion: 1,
                    currentVersion: kind === 'unsafe version' ? '../unsafe' : harness.storage.version,
                    generations,
                })
            );
            injectDependencies(cleanupUnpublishedDdspGeneration, {
                logger: { warn: vi.fn() },
                modelStorageWorkerBridge: harness.bridge,
                sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
            });

            await cleanupUnpublishedDdspGeneration(harness.storage);

            expect(harness.bridge.deleteModel).not.toHaveBeenCalled();
        }
    );
});
