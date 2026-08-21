import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { publishDdspInstrumentGeneration } from '../publishDdspInstrumentGeneration';

import { createDdspStorageTestHarness } from './ddspGenerationStorageTestSupport';

describe('publishDdspInstrumentGeneration', () => {
    it('publishes only after every pinned artifact verifies, then cleans exactly indexed stale artifacts', async () => {
        const harness = createDdspStorageTestHarness();
        const stale = harness.generation('v1');
        const untracked = `${harness.instrument.id}/untracked.bin`;
        harness.files.set(
            harness.indexModelId,
            harness.bytes({ schemaVersion: 1, currentVersion: 'v1', generations: { v1: stale } })
        );
        harness.files.set(untracked, harness.bytes('keep'));
        injectDependencies(publishDdspInstrumentGeneration, {
            modelStorageWorkerBridge: harness.bridge,
            sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
        });

        await publishDdspInstrumentGeneration(harness.storage);

        expect(harness.events).toEqual([
            `commit:${harness.instrument.id}/${harness.storage.version}/.ready.json`,
            `commit:${harness.indexModelId}`,
            `delete:${stale.readyMarkerId}`,
            ...stale.artifactIds.map((artifactId) => `delete:${artifactId}`),
            `commit:${harness.indexModelId}`,
        ]);
        expect(harness.files.has(untracked)).toBe(true);
    });
});
