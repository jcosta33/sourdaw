import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { ddspModelStorage } from '../ddspModelStorage';

const instrument = DDSP_INSTRUMENT_CATALOG[0];
const storage = {
    id: instrument.id,
    version: instrument.artifactVersion!,
    artifacts: instrument.artifacts!,
};
const indexModelId = `${instrument.id}/.generations.json`;

type GenerationIndex = {
    schemaVersion: 1;
    currentVersion: string | null;
    generations: Record<string, { artifactIds: string[]; readyMarkerId: string }>;
};

type StoredMetadata = { sizeBytes: number; sha256: string };

function bytes(value: unknown): ArrayBuffer {
    return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function decode(value: ArrayBuffer | undefined): GenerationIndex {
    if (value === undefined) {
        throw new Error('Expected stored generation index');
    }
    return JSON.parse(new TextDecoder().decode(value)) as GenerationIndex;
}

function generation(
    version: string,
    artifactIds = storage.artifacts.map(({ path }) => `${instrument.id}/${version}/${path}`)
) {
    return {
        artifactIds,
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
    files?: Map<string, ArrayBuffer>;
    failDeletes?: Set<string>;
    metadata?: Map<string, StoredMetadata>;
}) {
    const files = input?.files ?? new Map<string, ArrayBuffer>();
    const failDeletes = input?.failDeletes ?? new Set<string>();
    const metadata = input?.metadata ?? expectedArtifactMetadata();
    const events: string[] = [];
    const writes = new Map<
        string,
        { modelId: string; chunks: ArrayBuffer[]; expectedSizeBytes: number; expectedSha256: string }
    >();
    let writeNumber = 0;
    return {
        files,
        metadata,
        events,
        bridge: {
            abortModelWrite: vi.fn(async (writeId: string) => {
                writes.delete(writeId);
            }),
            beginModelWrite: vi.fn(
                async ({
                    modelId,
                    expectedSizeBytes,
                    expectedSha256,
                }: {
                    modelId: string;
                    expectedSizeBytes: number;
                    expectedSha256: string;
                }) => {
                    const writeId = `write-${String(++writeNumber)}`;
                    writes.set(writeId, { modelId, chunks: [], expectedSizeBytes, expectedSha256 });
                    return writeId;
                }
            ),
            writeModelChunk: vi.fn(async ({ writeId, chunk }: { writeId: string; chunk: ArrayBuffer }) => {
                const write = writes.get(writeId);
                if (write === undefined) {
                    throw new Error(`Unknown test write: ${writeId}`);
                }
                const transferred = structuredClone(chunk, { transfer: [chunk] });
                write.chunks.push(transferred);
                return transferred.byteLength;
            }),
            commitModelWrite: vi.fn(async ({ writeId }: { writeId: string }) => {
                const write = writes.get(writeId);
                if (write === undefined) {
                    throw new Error(`Unknown test write: ${writeId}`);
                }
                const storedBytes = write.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
                const stored = new Uint8Array(storedBytes);
                let offset = 0;
                for (const chunk of write.chunks) {
                    stored.set(new Uint8Array(chunk), offset);
                    offset += chunk.byteLength;
                }
                if (storedBytes !== write.expectedSizeBytes) {
                    throw new Error(`Unexpected stored size for ${write.modelId}`);
                }
                files.set(write.modelId, stored.buffer);
                metadata.set(write.modelId, {
                    sizeBytes: write.expectedSizeBytes,
                    sha256: write.expectedSha256,
                });
                events.push(`commit:${write.modelId}`);
                writes.delete(writeId);
                return { storedBytes, extractedPath: null };
            }),
            readModel: vi.fn(
                async ({
                    modelId,
                    expectedSizeBytes,
                    expectedSha256,
                }: {
                    modelId: string;
                    expectedSizeBytes?: number;
                    expectedSha256?: string;
                }) => {
                    const stored = files.get(modelId);
                    const storedMetadata = metadata.get(modelId);
                    if (
                        expectedSizeBytes !== undefined &&
                        (storedMetadata?.sizeBytes !== expectedSizeBytes || storedMetadata.sha256 !== expectedSha256)
                    ) {
                        return null;
                    }
                    return stored === undefined ? null : modelDataPort(stored.slice(0));
                }
            ),
            verifyModel: vi.fn(
                async ({
                    modelId,
                    expectedSizeBytes,
                    expectedSha256,
                }: {
                    modelId: string;
                    expectedSizeBytes: number;
                    expectedSha256: string;
                }) => {
                    const storedMetadata = metadata.get(modelId);
                    return storedMetadata?.sizeBytes === expectedSizeBytes && storedMetadata.sha256 === expectedSha256;
                }
            ),
            deleteModel: vi.fn(async ({ modelId }: { modelId: string }) => {
                events.push(`delete:${modelId}`);
                if (failDeletes.has(modelId)) {
                    throw new Error(`OPFS denied: ${modelId}`);
                }
                files.delete(modelId);
                metadata.delete(modelId);
            }),
        },
    };
}

function injectStorage(bridge: ReturnType<typeof storageBridge>['bridge']): void {
    const sha256 = vi.fn().mockResolvedValue('sha');
    injectDependencies(ddspModelStorage.checkDdspInstrumentReady, {
        logger: { warn: vi.fn() },
        modelStorageWorkerBridge: bridge,
        sha256ArrayBuffer: sha256,
    });
    injectDependencies(ddspModelStorage.stageDdspInstrumentGeneration, {
        modelStorageWorkerBridge: bridge,
        sha256ArrayBuffer: sha256,
    });
    injectDependencies(ddspModelStorage.publishDdspInstrumentGeneration, {
        modelStorageWorkerBridge: bridge,
        sha256ArrayBuffer: sha256,
    });
    injectDependencies(ddspModelStorage.removeDdspInstrumentGenerations, {
        modelStorageWorkerBridge: bridge,
        sha256ArrayBuffer: sha256,
    });
    injectDependencies(ddspModelStorage.cleanupUnpublishedDdspGeneration, {
        logger: { warn: vi.fn() },
        modelStorageWorkerBridge: bridge,
        sha256ArrayBuffer: sha256,
    });
}

describe('ddspModelStorage generation index', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('publishes v2 before deleting the exact indexed v1 generation and leaves v2 ready', async () => {
        const v1 = 'v1';
        const v1Generation = generation(v1);
        const foreignPath = `${instrument.id}/foreign/not-indexed.bin`;
        const files = new Map<string, ArrayBuffer>([
            [indexModelId, bytes({ schemaVersion: 1, currentVersion: v1, generations: { [v1]: v1Generation } })],
            [foreignPath, bytes('foreign')],
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
            `delete:${v1Generation.readyMarkerId}`,
            ...v1Generation.artifactIds.map((artifactId) => `delete:${artifactId}`),
            `commit:${indexModelId}`,
        ]);
        expect(testStorage.bridge.deleteModel.mock.calls.map(([input]) => input.modelId)).toEqual([
            v1Generation.readyMarkerId,
            ...v1Generation.artifactIds,
        ]);
        expect(testStorage.bridge.deleteModel).not.toHaveBeenCalledWith(
            expect.objectContaining({ modelId: expect.stringContaining(`/${storage.version}/`) })
        );
        expect(testStorage.bridge.deleteModel).not.toHaveBeenCalledWith({ modelId: foreignPath });
        expect(files.has(foreignPath)).toBe(true);
        expect(decode(files.get(indexModelId))).toEqual({
            schemaVersion: 1,
            currentVersion: storage.version,
            generations: { [storage.version]: generation(storage.version) },
        });
        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(true);
    });

    it.each(['size', 'sha256'] as const)(
        'fails readiness and publication when one admitted artifact has the wrong %s',
        async (field) => {
            const currentGeneration = generation(storage.version);
            const marker = readyMarkerBytes();
            const markerId = currentGeneration.readyMarkerId;
            const foreignPath = `${instrument.id}/foreign/not-indexed.bin`;
            const metadata = expectedArtifactMetadata();
            const brokenArtifactId = currentGeneration.artifactIds[1]!;
            const expected = metadata.get(brokenArtifactId)!;
            metadata.set(brokenArtifactId, {
                sizeBytes: field === 'size' ? expected.sizeBytes + 1 : expected.sizeBytes,
                sha256: field === 'sha256' ? '0'.repeat(64) : expected.sha256,
            });
            metadata.set(markerId, { sizeBytes: marker.byteLength, sha256: 'sha' });
            const files = new Map<string, ArrayBuffer>([
                [
                    indexModelId,
                    bytes({
                        schemaVersion: 1,
                        currentVersion: storage.version,
                        generations: { [storage.version]: currentGeneration },
                    }),
                ],
                [markerId, marker],
                [foreignPath, bytes('foreign')],
            ]);
            const testStorage = storageBridge({ files, metadata });
            injectStorage(testStorage.bridge);

            await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
            await expect(ddspModelStorage.publishDdspInstrumentGeneration(storage)).rejects.toThrow(
                'DDSP generation verification failed'
            );

            expect(testStorage.bridge.beginModelWrite).not.toHaveBeenCalled();
            expect(testStorage.bridge.deleteModel).not.toHaveBeenCalled();
            expect(files.has(markerId)).toBe(true);
            expect(files.has(foreignPath)).toBe(true);
        }
    );

    it('keeps v2 current and ready with stale metadata when indexed v1 cleanup partially fails', async () => {
        const v1 = 'v1';
        const v1Generation = generation(v1);
        const failedPath = v1Generation.artifactIds[1]!;
        const files = new Map<string, ArrayBuffer>([
            [indexModelId, bytes({ schemaVersion: 1, currentVersion: v1, generations: { [v1]: v1Generation } })],
        ]);
        const testStorage = storageBridge({ files, failDeletes: new Set([failedPath]) });
        injectStorage(testStorage.bridge);

        await expect(ddspModelStorage.publishDdspInstrumentGeneration(storage)).resolves.toBeUndefined();

        expect(decode(files.get(indexModelId))).toEqual({
            schemaVersion: 1,
            currentVersion: storage.version,
            generations: {
                [v1]: v1Generation,
                [storage.version]: generation(storage.version),
            },
        });
        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(true);
    });

    it('fails closed on a malformed index for readiness and publication', async () => {
        const testStorage = storageBridge({
            files: new Map([[indexModelId, bytes({ currentVersion: storage.version, generations: [] })]]),
        });
        injectStorage(testStorage.bridge);

        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
        await expect(ddspModelStorage.publishDdspInstrumentGeneration(storage)).rejects.toThrow(
            'Invalid DDSP generation index'
        );
        expect(testStorage.bridge.beginModelWrite).not.toHaveBeenCalled();
        expect(testStorage.bridge.deleteModel).not.toHaveBeenCalled();
    });

    it('clears current before removal and preserves cleanup metadata after an artifact delete fails', async () => {
        const currentGeneration = generation(storage.version);
        const failedPath = currentGeneration.artifactIds[1]!;
        const foreignPath = `${instrument.id}/foreign/not-indexed.bin`;
        const files = new Map<string, ArrayBuffer>([
            [
                indexModelId,
                bytes({
                    schemaVersion: 1,
                    currentVersion: storage.version,
                    generations: { [storage.version]: currentGeneration },
                }),
            ],
            [foreignPath, bytes('foreign')],
        ]);
        const testStorage = storageBridge({ files, failDeletes: new Set([failedPath]) });
        injectStorage(testStorage.bridge);

        await expect(ddspModelStorage.removeDdspInstrumentGenerations({ id: instrument.id })).rejects.toThrow(
            'OPFS denied'
        );

        expect(testStorage.events).toEqual([
            `commit:${indexModelId}`,
            `delete:${currentGeneration.readyMarkerId}`,
            ...currentGeneration.artifactIds.map((artifactId) => `delete:${artifactId}`),
            `commit:${indexModelId}`,
        ]);
        expect(testStorage.bridge.deleteModel.mock.calls.map(([input]) => input.modelId)).toEqual([
            currentGeneration.readyMarkerId,
            ...currentGeneration.artifactIds,
        ]);
        expect(testStorage.bridge.deleteModel).not.toHaveBeenCalledWith({ modelId: foreignPath });
        expect(files.has(foreignPath)).toBe(true);
        expect(decode(files.get(indexModelId))).toEqual({
            schemaVersion: 1,
            currentVersion: null,
            generations: { [storage.version]: currentGeneration },
        });
        await expect(ddspModelStorage.checkDdspInstrumentReady(storage)).resolves.toBe(false);
    });
});
