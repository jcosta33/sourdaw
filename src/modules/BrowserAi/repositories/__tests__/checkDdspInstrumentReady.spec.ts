import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { checkDdspInstrumentReady } from '../checkDdspInstrumentReady';

import { createDdspStorageTestHarness } from './ddspGenerationStorageTestSupport';

function injectStorage(bridge: ReturnType<typeof createDdspStorageTestHarness>['bridge']): void {
    injectDependencies(checkDdspInstrumentReady, {
        logger: { warn: vi.fn() },
        modelStorageWorkerBridge: bridge,
        sha256ArrayBuffer: vi.fn(async (value: ArrayBuffer) =>
            Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
        ),
    });
}

describe('checkDdspInstrumentReady', () => {
    it('should return true only for a current index with an exact ready marker and verified artifacts', async () => {
        const harness = createDdspStorageTestHarness();
        const current = harness.generation(harness.storage.version);
        const marker = harness.readyMarkerBytes();
        harness.files.set(
            harness.indexModelId,
            harness.bytes({
                schemaVersion: 1,
                currentVersion: harness.storage.version,
                generations: { [harness.storage.version]: current },
            })
        );
        harness.files.set(current.readyMarkerId, marker);
        harness.metadata.set(current.readyMarkerId, { sizeBytes: marker.byteLength, sha256: harness.digest(marker) });
        injectStorage(harness.bridge);

        await expect(checkDdspInstrumentReady(harness.storage)).resolves.toBe(true);

        expect(harness.bridge.verifyModel).toHaveBeenCalledTimes(harness.storage.artifacts.length);
    });

    it('should return false when one artifact metadata record is corrupt after an exact ready marker', async () => {
        const harness = createDdspStorageTestHarness();
        const current = harness.generation(harness.storage.version);
        const marker = harness.readyMarkerBytes();
        const corruptArtifactId = current.artifactIds[0]!;
        harness.files.set(
            harness.indexModelId,
            harness.bytes({
                schemaVersion: 1,
                currentVersion: harness.storage.version,
                generations: { [harness.storage.version]: current },
            })
        );
        harness.files.set(current.readyMarkerId, marker);
        harness.metadata.set(current.readyMarkerId, { sizeBytes: marker.byteLength, sha256: harness.digest(marker) });
        harness.metadata.set(corruptArtifactId, { sizeBytes: 1, sha256: '0'.repeat(64) });
        injectStorage(harness.bridge);

        await expect(checkDdspInstrumentReady(harness.storage)).resolves.toBe(false);

        expect(harness.bridge.verifyModel).toHaveBeenCalledTimes(harness.storage.artifacts.length);
    });

    it.each([
        [
            'invalid JSON',
            (_harness: ReturnType<typeof createDdspStorageTestHarness>) => new TextEncoder().encode('{').buffer,
        ],
        [
            'a current version absent from generations',
            (harness: ReturnType<typeof createDdspStorageTestHarness>) =>
                harness.bytes({ schemaVersion: 1, currentVersion: harness.storage.version, generations: {} }),
        ],
        [
            'an unsafe indexed artifact id',
            (harness: ReturnType<typeof createDdspStorageTestHarness>) =>
                harness.bytes({
                    schemaVersion: 1,
                    currentVersion: harness.storage.version,
                    generations: {
                        [harness.storage.version]: {
                            artifactIds: [`${harness.instrument.id}/${harness.storage.version}/../outside.bin`],
                            readyMarkerId: `${harness.instrument.id}/${harness.storage.version}/.ready.json`,
                        },
                    },
                }),
        ],
        [
            'a forged ready marker id',
            (harness: ReturnType<typeof createDdspStorageTestHarness>) =>
                harness.bytes({
                    schemaVersion: 1,
                    currentVersion: harness.storage.version,
                    generations: {
                        [harness.storage.version]: {
                            ...harness.generation(harness.storage.version),
                            readyMarkerId: `${harness.instrument.id}/${harness.storage.version}/forged.json`,
                        },
                    },
                }),
        ],
        [
            'an unsafe version key',
            (harness: ReturnType<typeof createDdspStorageTestHarness>) =>
                harness.bytes({
                    schemaVersion: 1,
                    currentVersion: '../unsafe',
                    generations: { '../unsafe': harness.generation(harness.storage.version) },
                }),
        ],
        [
            'duplicate artifact ids',
            (harness: ReturnType<typeof createDdspStorageTestHarness>) => {
                const generation = harness.generation(harness.storage.version);
                return harness.bytes({
                    schemaVersion: 1,
                    currentVersion: harness.storage.version,
                    generations: {
                        [harness.storage.version]: {
                            ...generation,
                            artifactIds: [generation.artifactIds[0], generation.artifactIds[0]],
                        },
                    },
                });
            },
        ],
    ])('should fail closed before artifact verification for %s', async (_case, indexBytes) => {
        const harness = createDdspStorageTestHarness();
        harness.files.set(harness.indexModelId, indexBytes(harness));
        injectStorage(harness.bridge);

        await expect(checkDdspInstrumentReady(harness.storage)).resolves.toBe(false);

        expect(harness.bridge.verifyModel).not.toHaveBeenCalled();
    });

    it.each(['missing', 'wrong'] as const)(
        'should fail closed with a current index and valid artifacts but a %s ready marker',
        async (kind) => {
            const harness = createDdspStorageTestHarness();
            const current = harness.generation(harness.storage.version);
            harness.files.set(
                harness.indexModelId,
                harness.bytes({
                    schemaVersion: 1,
                    currentVersion: harness.storage.version,
                    generations: { [harness.storage.version]: current },
                })
            );
            if (kind === 'wrong') {
                const wrong = harness.bytes({ version: 'wrong', artifacts: [] });
                harness.files.set(current.readyMarkerId, wrong);
                harness.metadata.set(current.readyMarkerId, {
                    sizeBytes: wrong.byteLength,
                    sha256: harness.digest(wrong),
                });
            }
            injectStorage(harness.bridge);

            await expect(checkDdspInstrumentReady(harness.storage)).resolves.toBe(false);
            expect(harness.bridge.verifyModel).not.toHaveBeenCalled();
        }
    );

    it('should fail closed and close a corrupt metadata-transfer port exactly once', async () => {
        let failedHandler: ((event: MessageEvent) => void) | null = null;
        let messageHandler: ((event: MessageEvent) => void) | null = null;
        const port = {
            close: vi.fn(),
            onmessage: null as ((event: MessageEvent) => void) | null,
            onmessageerror: null as ((event: MessageEvent) => void) | null,
            start: vi.fn(() => {
                failedHandler = port.onmessageerror;
                messageHandler = port.onmessage;
                failedHandler?.(new MessageEvent('messageerror'));
                messageHandler?.(
                    new MessageEvent('message', { data: { modelData: new ArrayBuffer(1), type: 'model-data' } })
                );
            }),
        } as unknown as MessagePort;
        const harness = createDdspStorageTestHarness({ readPort: port });
        const current = harness.generation(harness.storage.version);
        harness.files.set(
            harness.indexModelId,
            harness.bytes({
                schemaVersion: 1,
                currentVersion: harness.storage.version,
                generations: { [harness.storage.version]: current },
            })
        );
        injectStorage(harness.bridge);

        await expect(checkDdspInstrumentReady(harness.storage)).resolves.toBe(false);

        expect(port.close).toHaveBeenCalledOnce();
        expect(port.onmessage).toBeNull();
        expect(port.onmessageerror).toBeNull();
        expect(harness.bridge.verifyModel).not.toHaveBeenCalled();
    });
});
