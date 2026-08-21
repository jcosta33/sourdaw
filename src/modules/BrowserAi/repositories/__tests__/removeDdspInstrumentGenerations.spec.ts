import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { removeDdspInstrumentGenerations } from '../removeDdspInstrumentGenerations';

import { createDdspStorageTestHarness } from './ddspGenerationStorageTestSupport';

describe('removeDdspInstrumentGenerations', () => {
    it('clears current readiness before removal, but retains metadata when an artifact delete fails', async () => {
        const initial = createDdspStorageTestHarness();
        const current = initial.generation(initial.storage.version);
        const harness = createDdspStorageTestHarness({
            failDeletes: new Set([current.artifactIds[1]!]),
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
    });
});
