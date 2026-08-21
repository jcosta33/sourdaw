import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { removeDdspInstrumentGenerations } from '../removeDdspInstrumentGenerations';

import { createDdspStorageTestHarness } from './ddspGenerationStorageTestSupport';

describe('removeDdspInstrumentGenerations', () => {
    it('should invalidate current readiness before deletes and remove every tracked generation on success', async () => {
        const seed = createDdspStorageTestHarness();
        const current = seed.generation('v1');
        const staged = seed.generation(seed.storage.version);
        const harness = createDdspStorageTestHarness({
            files: new Map([
                [
                    seed.indexModelId,
                    seed.bytes({
                        schemaVersion: 1,
                        currentVersion: 'v1',
                        generations: { v1: current, [seed.storage.version]: staged },
                    }),
                ],
            ]),
        });
        injectDependencies(removeDdspInstrumentGenerations, {
            modelStorageWorkerBridge: harness.bridge,
            sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
        });

        await removeDdspInstrumentGenerations({ id: harness.instrument.id });

        expect(harness.events[0]).toBe(`commit:${harness.indexModelId}`);
        expect(harness.events.slice(1, -1)).toEqual([
            `delete:${current.readyMarkerId}`,
            ...current.artifactIds.map((artifactId) => `delete:${artifactId}`),
            `delete:${staged.readyMarkerId}`,
            ...staged.artifactIds.map((artifactId) => `delete:${artifactId}`),
        ]);
        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: null,
            generations: {},
        });
    });

    it('should retain failed metadata for retry then remove it after the delete succeeds', async () => {
        const initial = createDdspStorageTestHarness();
        const current = initial.generation(initial.storage.version);
        const failedDeletes = new Set([current.artifactIds[1]!]);
        const harness = createDdspStorageTestHarness({
            failDeletes: failedDeletes,
            files: new Map([
                [
                    initial.indexModelId,
                    initial.bytes({
                        schemaVersion: 1,
                        currentVersion: initial.storage.version,
                        generations: { [initial.storage.version]: current },
                    }),
                ],
            ]),
        });
        injectDependencies(removeDdspInstrumentGenerations, {
            modelStorageWorkerBridge: harness.bridge,
            sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
        });

        await expect(removeDdspInstrumentGenerations({ id: harness.instrument.id })).rejects.toThrow('OPFS denied');

        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: null,
            generations: { [harness.storage.version]: current },
        });

        const failedArtifactDeletes = harness.bridge.deleteModel.mock.calls
            .map(([input]) => input.modelId)
            .filter((modelId) => modelId === current.artifactIds[1]);
        expect(failedArtifactDeletes).toHaveLength(1);

        failedDeletes.clear();
        await removeDdspInstrumentGenerations({ id: harness.instrument.id });

        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: null,
            generations: {},
        });
    });

    it.each(['forged ready marker', 'unsafe version', 'duplicate artifact ids'] as const)(
        'should reject without deleting metadata from an index with %s',
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
            injectDependencies(removeDdspInstrumentGenerations, {
                modelStorageWorkerBridge: harness.bridge,
                sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
            });

            await expect(removeDdspInstrumentGenerations({ id: harness.instrument.id })).rejects.toThrow(
                'Invalid DDSP generation index'
            );

            expect(harness.bridge.deleteModel).not.toHaveBeenCalled();
        }
    );
});
