import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { publishDdspInstrumentGeneration } from '../publishDdspInstrumentGeneration';

import { createDdspStorageTestHarness } from './ddspGenerationStorageTestSupport';

describe('publishDdspInstrumentGeneration', () => {
    it('should reject before marker or index publication when an artifact cannot verify', async () => {
        const harness = createDdspStorageTestHarness();
        const artifactId = harness.generation(harness.storage.version).artifactIds[0]!;
        harness.metadata.set(artifactId, { sizeBytes: 1, sha256: '0'.repeat(64) });
        injectDependencies(publishDdspInstrumentGeneration, {
            modelStorageWorkerBridge: harness.bridge,
            sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
        });

        await expect(publishDdspInstrumentGeneration(harness.storage)).rejects.toThrow(
            'DDSP generation verification failed'
        );

        expect(harness.bridge.beginModelWrite).not.toHaveBeenCalled();
        expect(harness.bridge.deleteModel).not.toHaveBeenCalled();
    });

    it('should retain stale generation metadata for recovery when an indexed stale artifact cannot be removed', async () => {
        const seed = createDdspStorageTestHarness();
        const stale = seed.generation('v1');
        const harness = createDdspStorageTestHarness({
            failDeletes: new Set([stale.artifactIds[1]!]),
            files: new Map([
                [seed.indexModelId, seed.bytes({ schemaVersion: 1, currentVersion: 'v1', generations: { v1: stale } })],
            ]),
        });
        injectDependencies(publishDdspInstrumentGeneration, {
            modelStorageWorkerBridge: harness.bridge,
            sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
        });

        await publishDdspInstrumentGeneration(harness.storage);

        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: harness.storage.version,
            generations: { v1: stale, [harness.storage.version]: harness.generation(harness.storage.version) },
        });
        expect(harness.events.filter((event) => event === `commit:${harness.indexModelId}`)).toHaveLength(1);
    });

    it('should recover a retained stale generation on a later successful publication', async () => {
        const seed = createDdspStorageTestHarness();
        const stale = seed.generation('v1');
        const failedDeletes = new Set([stale.artifactIds[1]!]);
        const harness = createDdspStorageTestHarness({
            failDeletes: failedDeletes,
            files: new Map([
                [seed.indexModelId, seed.bytes({ schemaVersion: 1, currentVersion: 'v1', generations: { v1: stale } })],
            ]),
        });
        injectDependencies(publishDdspInstrumentGeneration, {
            modelStorageWorkerBridge: harness.bridge,
            sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) => harness.digest(value)),
        });

        await publishDdspInstrumentGeneration(harness.storage);
        failedDeletes.clear();
        await publishDdspInstrumentGeneration(harness.storage);

        expect(harness.events.filter((event) => event === `delete:${stale.artifactIds[1]}`)).toHaveLength(2);
        expect(JSON.parse(new TextDecoder().decode(harness.files.get(harness.indexModelId)))).toEqual({
            schemaVersion: 1,
            currentVersion: harness.storage.version,
            generations: { [harness.storage.version]: harness.generation(harness.storage.version) },
        });
    });

    it('should publish only after every pinned artifact verifies, then clean exactly indexed stale artifacts', async () => {
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
