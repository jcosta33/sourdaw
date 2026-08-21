import { vi } from 'vitest';

import { resolveDdspInstrument } from '../../models/DdspInstrumentCatalog';
import { type ModelStoragePort } from '../modelStorageWorkerBridge';

const instrument = resolveDdspInstrument('ddsp-violin');
const storage = { id: instrument.id, version: instrument.artifactVersion, artifacts: instrument.artifacts };
const indexModelId = `${instrument.id}/.generations.json`;

type StoredMetadata = { sha256: string; sizeBytes: number };

/** Test-only OPFS bridge for one DDSP instrument generation. */
export function createDdspStorageTestHarness(input?: {
    failDeletes?: Set<string>;
    files?: Map<string, ArrayBuffer>;
    metadata?: Map<string, StoredMetadata>;
    readPort?: MessagePort;
}) {
    function bytes(value: unknown): ArrayBuffer {
        return new TextEncoder().encode(JSON.stringify(value)).buffer;
    }

    function digest(value: ArrayBuffer): string {
        return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    function generation(version: string) {
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
            if (input?.readPort !== undefined && modelId.endsWith('.ready.json')) {
                return input.readPort;
            }
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

    return {
        bridge,
        bytes,
        digest,
        events,
        files,
        generation,
        indexModelId,
        instrument,
        metadata,
        readyMarkerBytes,
        storage,
    };
}
