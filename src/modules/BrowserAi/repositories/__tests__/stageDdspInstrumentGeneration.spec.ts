import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { stageDdspInstrumentGeneration } from '../stageDdspInstrumentGeneration';

import { createDdspStorageTestHarness } from './ddspGenerationStorageTestSupport';

describe('stageDdspInstrumentGeneration', () => {
    it('records the candidate in .generations.json while preserving the older current version', async () => {
        const harness = createDdspStorageTestHarness();
        const current = harness.generation('v1');
        harness.files.set(
            harness.indexModelId,
            harness.bytes({ schemaVersion: 1, currentVersion: 'v1', generations: { v1: current } })
        );
        injectDependencies(stageDdspInstrumentGeneration, {
            modelStorageWorkerBridge: harness.bridge,
            sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
        });

        await stageDdspInstrumentGeneration(harness.storage);

        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: 'v1',
            generations: { v1: current, [harness.storage.version]: harness.generation(harness.storage.version) },
        });
    });
});
