import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { resolveDdspInstrument } from '../../models/DdspInstrumentCatalog';
import { ddspModelStorage } from '../ddspModelStorage';
import { type ModelStoragePort } from '../modelStorageWorkerBridge';

const instrument = resolveDdspInstrument('ddsp-violin');
const storage = {
    id: instrument.id,
    version: instrument.artifactVersion,
    artifacts: instrument.artifacts,
};
const indexModelId = `${instrument.id}/.generations.json`;

type Generation = { artifactIds: string[]; readyMarkerId: string };
type GenerationIndex = { schemaVersion: 1; currentVersion: string | null; generations: Record<string, Generation> };
type StoredMetadata = { sha256: string; sizeBytes: number };

function bytes(value: unknown): ArrayBuffer {
    return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function digest(value: ArrayBuffer): string {
    return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decode(value: ArrayBuffer | undefined): GenerationIndex {
    if (value === undefined) {
        throw new Error('Expected stored generation index');
    }
    return JSON.parse(new TextDecoder().decode(value)) as GenerationIndex;
}

function generation(version: string): Generation {
    return {
        artifactIds: storage.artifacts.map(({ path }) => `${instrument.id}/${version}/${path}`),
        readyMarkerId: `${instrument.id}/${version}/.ready.json`,
    };
}

function readyMarkerBytes(): ArrayBuffer {
    return bytes({
        version: storage.version,
        artifacts: storage.artifacts.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })),
    });
}

function modelDataPort(modelData: ArrayBuffer): MessagePort {
    const channel = new MessageChannel();
    channel.port2.postMessage({ type: 'model-data', modelData }, [modelData]);
    channel.port2.close();
    return channel.port1;
}

function expectedArtifactMetadata(): Map<string, StoredMetadata> {
    return new Map(
        storage.artifacts.map(({ path, sizeBytes, sha256 }) => [
            `${instrument.id}/${storage.version}/${path}`,
            { sizeBytes, sha256 },
        ])
    );
}

function storageBridge(input?: {
    failDeletes?: Set<string>;
    files?: Map<string, ArrayBuffer>;
    metadata?: Map<string, StoredMetadata>;
}) {
    const files = input?.files ?? new Map<string, ArrayBuffer>();
    const metadata = input?.metadata ?? expectedArtifactMetadata();
    const failDeletes = input?.failDeletes ?? new Set<string>();
    const writes = new Map<string, { chunks: ArrayBuffer[]; modelId: string; metadata: StoredMetadata }>();
    const events: string[] = [];
    let nextWrite = 0;
    const bridge = {
        abortModelWrite: vi.fn<ModelStoragePort['abortModelWrite']>(async (writeId) => {
            writes.delete(writeId);
        }),
        beginModelWrite: vi.fn<ModelStoragePort['beginModelWrite']>(
            async ({ modelId, expectedSha256, expectedSizeBytes }) => {
                if (expectedSha256 === undefined || expectedSizeBytes === undefined) {
                    throw new Error('DDSP metadata writes must be verified');
                }
                const writeId = `write-${String(++nextWrite)}`;
                writes.set(writeId, {
                    modelId,
                    chunks: [],
                    metadata: { sha256: expectedSha256, sizeBytes: expectedSizeBytes },
                });
                return writeId;
            }
        ),
        writeModelChunk: vi.fn<ModelStoragePort['writeModelChunk']>(async ({ writeId, chunk }) => {
            const write = writes.get(writeId);
            if (write === undefined) {
                throw new Error(`Unknown write ${writeId}`);
            }
            const copy = structuredClone(chunk, { transfer: [chunk] });
            write.chunks.push(copy);
            return copy.byteLength;
        }),
        commitModelWrite: vi.fn<ModelStoragePort['commitModelWrite']>(async ({ writeId }) => {
            const write = writes.get(writeId);
            if (write === undefined) {
                throw new Error(`Unknown write ${writeId}`);
            }
            const stored = new Uint8Array(write.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
            let offset = 0;
            for (const chunk of write.chunks) {
                stored.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
            }
            if (stored.byteLength !== write.metadata.sizeBytes) {
                throw new Error(`Unexpected byte count for ${write.modelId}`);
            }
            files.set(write.modelId, stored.buffer);
            metadata.set(write.modelId, write.metadata);
            writes.delete(writeId);
            events.push(`commit:${write.modelId}`);
            return { storedBytes: stored.byteLength, extractedPath: null };
        }),
        readModel: vi.fn<ModelStoragePort['readModel']>(async ({ modelId, expectedSha256, expectedSizeBytes }) => {
            const content = files.get(modelId);
            const stored = metadata.get(modelId);
            if (
                content === undefined ||
                (expectedSizeBytes !== undefined &&
                    (stored?.sizeBytes !== expectedSizeBytes || stored.sha256 !== expectedSha256))
            ) {
                return null;
            }
            return modelDataPort(content.slice(0));
        }),
        verifyModel: vi.fn<ModelStoragePort['verifyModel']>(async ({ modelId, expectedSha256, expectedSizeBytes }) => {
            const stored = metadata.get(modelId);
            return stored?.sizeBytes === expectedSizeBytes && stored.sha256 === expectedSha256;
        }),
        deleteModel: vi.fn<ModelStoragePort['deleteModel']>(async ({ modelId }) => {
            events.push(`delete:${modelId}`);
            if (failDeletes.has(modelId)) {
                throw new Error(`OPFS denied: ${modelId}`);
            }
            files.delete(modelId);
            metadata.delete(modelId);
        }),
    };
    return { bridge, events, files, metadata };
}

function injectStorage(bridge: ReturnType<typeof storageBridge>['bridge']): void {
    const sha256ArrayBuffer = vi.fn(async (value: ArrayBuffer) => digest(value));
    const dependencies = { modelStorageWorkerBridge: bridge, sha256ArrayBuffer };
    injectDependencies(ddspModelStorage.checkDdspInstrumentReady, {
        ...dependencies,
        logger: { warn: vi.fn() },
    });
    injectDependencies(ddspModelStorage.stageDdspInstrumentGeneration, dependencies);
    injectDependencies(ddspModelStorage.publishDdspInstrumentGeneration, dependencies);
    injectDependencies(ddspModelStorage.removeDdspInstrumentGenerations, dependencies);
    injectDependencies(ddspModelStorage.cleanupUnpublishedDdspGeneration, {
        ...dependencies,
        logger: { warn: vi.fn() },
    });
}

describe('ddspModelStorage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('publishes only after every pinned artifact verifies, then cleans exactly indexed stale artifacts', async () => {
        const v1 = 'v1';
        const stale = generation(v1);
        const untracked = `${instrument.id}/untracked.bin`;
        const files = new Map<string, ArrayBuffer>([
            [indexModelId, bytes({ schemaVersion: 1, currentVersion: v1, generations: { [v1]: stale } })],
            [untracked, bytes('keep')],
        ]);
        const testStorage = storageBridge({ files });
        injectStorage(testStorage.bridge);

        await ddspModelStorage.publishDdspInstrumentGeneration(storage);

        expect(testStorage.bridge.verifyModel.mock.calls.map(([input]) => input)).toEqual(
            storage.artifacts.map(({ path, sizeBytes, sha256 }) => ({
                family: 'ddsp',
                modelId: `${instrument.id}/${storage.version}/${path}`,
                expectedSizeBytes: sizeBytes,
                expectedSha256: sha256,
            }))
        );
        expect(testStorage.events).toEqual([
            `commit:${instrument.id}/${storage.version}/.ready.json`,
            `commit:${indexModelId}`,
            `delete:${stale.readyMarkerId}`,
            ...stale.artifactIds.map((artifactId) => `delete:${artifactId}`),
            `commit:${indexModelId}`,
        ]);
        expect(testStorage.files.has(untracked)).toBe(true);
        expect(decode(testStorage.files.get(indexModelId))).toEqual({
            schemaVersion: 1,
            currentVersion: storage.version,
            generations: { [storage.version]: generation(storage.version) },
        });
        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(true);
    });

    it.each(['sizeBytes', 'sha256'] as const)('fails closed when an artifact has the wrong %s', async (field) => {
        const current = generation(storage.version);
        const marker = readyMarkerBytes();
        const metadata = expectedArtifactMetadata();
        const brokenId = current.artifactIds[1]!;
        const expected = metadata.get(brokenId)!;
        metadata.set(brokenId, {
            sizeBytes: field === 'sizeBytes' ? expected.sizeBytes + 1 : expected.sizeBytes,
            sha256: field === 'sha256' ? '0'.repeat(64) : expected.sha256,
        });
        metadata.set(current.readyMarkerId, { sizeBytes: marker.byteLength, sha256: digest(marker) });
        const testStorage = storageBridge({
            files: new Map([
                [
                    indexModelId,
                    bytes({
                        schemaVersion: 1,
                        currentVersion: storage.version,
                        generations: { [storage.version]: current },
                    }),
                ],
                [current.readyMarkerId, marker],
            ]),
            metadata,
        });
        injectStorage(testStorage.bridge);

        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
        await expect(ddspModelStorage.publishDdspInstrumentGeneration(storage)).rejects.toThrow(
            'DDSP generation verification failed'
        );
        expect(testStorage.bridge.beginModelWrite).not.toHaveBeenCalled();
    });

    it('fails closed on malformed generation metadata without deleting an unknown file', async () => {
        const untracked = `${instrument.id}/untracked.bin`;
        const testStorage = storageBridge({
            files: new Map([
                [indexModelId, bytes({ schemaVersion: 1, currentVersion: storage.version, generations: [] })],
                [untracked, bytes('keep')],
            ]),
        });
        injectStorage(testStorage.bridge);

        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
        await expect(ddspModelStorage.publishDdspInstrumentGeneration(storage)).rejects.toThrow(
            'Invalid DDSP generation index'
        );
        expect(testStorage.bridge.deleteModel).not.toHaveBeenCalled();
        expect(testStorage.files.has(untracked)).toBe(true);
    });

    it('clears current readiness before removal, but retains metadata when an artifact delete fails', async () => {
        const current = generation(storage.version);
        const failedId = current.artifactIds[1]!;
        const testStorage = storageBridge({
            failDeletes: new Set([failedId]),
            files: new Map([
                [
                    indexModelId,
                    bytes({
                        schemaVersion: 1,
                        currentVersion: storage.version,
                        generations: { [storage.version]: current },
                    }),
                ],
            ]),
        });
        injectStorage(testStorage.bridge);

        await expect(ddspModelStorage.removeDdspInstrumentGenerations({ id: instrument.id })).rejects.toThrow(
            'OPFS denied'
        );

        expect(decode(testStorage.files.get(indexModelId))).toEqual({
            schemaVersion: 1,
            currentVersion: null,
            generations: { [storage.version]: current },
        });
        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
    });

    it('removes a staged failed generation without disturbing the already-current one', async () => {
        const current = generation('v1');
        const testStorage = storageBridge({
            files: new Map([
                [indexModelId, bytes({ schemaVersion: 1, currentVersion: 'v1', generations: { v1: current } })],
            ]),
        });
        injectStorage(testStorage.bridge);

        await ddspModelStorage.cleanupUnpublishedDdspGeneration(storage);

        expect(decode(testStorage.files.get(indexModelId))).toEqual({
            schemaVersion: 1,
            currentVersion: 'v1',
            generations: { v1: current },
        });
        expect(testStorage.bridge.deleteModel).toHaveBeenCalledWith(
            expect.objectContaining({ modelId: `${instrument.id}/${storage.version}/.ready.json` })
        );
    });
});
