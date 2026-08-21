import { type DdspArtifact } from '../models/DdspArtifactManifest';

import { type ModelStoragePort } from './modelStorageWorkerBridge';

type DdspStorageInput = {
    artifacts: readonly DdspArtifact[];
    id: string;
    version: string;
};

type DdspGeneration = {
    artifactIds: string[];
    readyMarkerId: string;
};

type DdspGenerationIndex = {
    currentVersion: string | null;
    generations: Record<string, DdspGeneration>;
    schemaVersion: 1;
};

type StorageDependencies = {
    modelStorageWorkerBridge: ModelStoragePort;
    sha256ArrayBuffer: (bytes: ArrayBuffer) => Promise<string>;
};

const DDSP_GENERATION_INDEX_SCHEMA_VERSION = 1;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Private OPFS generation-index primitives shared by the focused DDSP repositories. */
export function createDdspGenerationStorageSupport({
    modelStorageWorkerBridge: modelStorage,
    sha256ArrayBuffer: sha256,
}: StorageDependencies) {
    function artifactModelId(instrumentId: string, version: string, path: DdspArtifact['path']): string {
        return `${instrumentId}/${version}/${path}`;
    }

    function readyMarkerId(instrumentId: string, version: string): string {
        return `${instrumentId}/${version}/.ready.json`;
    }

    function generationIndexId(instrumentId: string): string {
        return `${instrumentId}/.generations.json`;
    }

    function generationFor(input: DdspStorageInput): DdspGeneration {
        return {
            artifactIds: input.artifacts.map(({ path }) => artifactModelId(input.id, input.version, path)),
            readyMarkerId: readyMarkerId(input.id, input.version),
        };
    }

    function emptyGenerationIndex(): DdspGenerationIndex {
        return { schemaVersion: DDSP_GENERATION_INDEX_SCHEMA_VERSION, currentVersion: null, generations: {} };
    }

    function encodeJson(value: unknown): ArrayBuffer {
        return new TextEncoder().encode(JSON.stringify(value)).buffer;
    }

    function readyMarkerBytes(input: DdspStorageInput): ArrayBuffer {
        return encodeJson({
            version: input.version,
            artifacts: input.artifacts.map(({ path, sizeBytes, sha256: artifactSha256 }) => ({
                path,
                sizeBytes,
                sha256: artifactSha256,
            })),
        });
    }

    async function readPort(port: MessagePort): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const close = (): boolean => {
                if (settled) {
                    return false;
                }
                settled = true;
                port.onmessage = null;
                port.onmessageerror = null;
                port.close();
                return true;
            };
            const succeed = (value: ArrayBuffer): void => {
                if (close()) {
                    resolve(value);
                }
            };
            const fail = (error: Error): void => {
                if (close()) {
                    reject(error);
                }
            };
            port.onmessage = (event: MessageEvent<{ message?: string; modelData?: ArrayBuffer; type: string }>) => {
                if (event.data.type === 'model-data' && event.data.modelData !== undefined) {
                    succeed(event.data.modelData);
                    return;
                }
                fail(new Error(event.data.message ?? 'DDSP artifact transfer failed'));
            };
            port.onmessageerror = () => {
                fail(new Error('DDSP artifact transfer failed'));
            };
            port.start();
        });
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
        const actual = Object.keys(value).sort();
        const expected = [...keys].sort();
        return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
    }

    function isSafeArtifactId(instrumentId: string, version: string, modelId: string): boolean {
        const prefix = `${instrumentId}/${version}/`;
        if (!modelId.startsWith(prefix)) {
            return false;
        }
        const relativePath = modelId.slice(prefix.length);
        const segments = relativePath.split('/');
        return (
            segments.length > 0 &&
            segments.every((segment) => SAFE_PATH_SEGMENT.test(segment)) &&
            relativePath !== '.ready.json' &&
            relativePath !== '.generations.json'
        );
    }

    function parseGeneration(value: unknown, instrumentId: string, version: string): DdspGeneration | null {
        if (
            !SAFE_PATH_SEGMENT.test(version) ||
            !isRecord(value) ||
            !hasExactKeys(value, ['artifactIds', 'readyMarkerId'])
        ) {
            return null;
        }
        const { artifactIds, readyMarkerId: marker } = value;
        if (
            !Array.isArray(artifactIds) ||
            !artifactIds.every(
                (artifactId): artifactId is string =>
                    typeof artifactId === 'string' && isSafeArtifactId(instrumentId, version, artifactId)
            ) ||
            new Set(artifactIds).size !== artifactIds.length ||
            marker !== readyMarkerId(instrumentId, version)
        ) {
            return null;
        }
        return { artifactIds: [...artifactIds], readyMarkerId: marker };
    }

    function parseGenerationIndex(bytes: ArrayBuffer, instrumentId: string): DdspGenerationIndex {
        try {
            const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            if (
                !isRecord(value) ||
                !hasExactKeys(value, ['schemaVersion', 'currentVersion', 'generations']) ||
                value.schemaVersion !== DDSP_GENERATION_INDEX_SCHEMA_VERSION ||
                (value.currentVersion !== null && typeof value.currentVersion !== 'string') ||
                !isRecord(value.generations)
            ) {
                throw new Error('Unexpected generation index shape');
            }
            const generations: Record<string, DdspGeneration> = {};
            for (const [version, candidate] of Object.entries(value.generations)) {
                const generation = parseGeneration(candidate, instrumentId, version);
                if (generation === null) {
                    throw new Error(`Invalid generation metadata: ${version}`);
                }
                generations[version] = generation;
            }
            if (value.currentVersion !== null && generations[value.currentVersion] === undefined) {
                throw new Error('Current generation is missing');
            }
            return {
                schemaVersion: DDSP_GENERATION_INDEX_SCHEMA_VERSION,
                currentVersion: value.currentVersion,
                generations,
            };
        } catch (error) {
            throw new Error(`Invalid DDSP generation index for ${instrumentId}`, { cause: error });
        }
    }

    function sameGeneration(left: DdspGeneration | undefined, right: DdspGeneration): boolean {
        return (
            left !== undefined &&
            left.readyMarkerId === right.readyMarkerId &&
            left.artifactIds.length === right.artifactIds.length &&
            left.artifactIds.every((artifactId, index) => artifactId === right.artifactIds[index])
        );
    }

    async function readGenerationIndex(instrumentId: string): Promise<DdspGenerationIndex> {
        const port = await modelStorage.readModel({ family: 'ddsp', modelId: generationIndexId(instrumentId) });
        return port === null ? emptyGenerationIndex() : parseGenerationIndex(await readPort(port), instrumentId);
    }

    async function writeBytes(modelId: string, bytes: ArrayBuffer): Promise<void> {
        const expectedSizeBytes = bytes.byteLength;
        const writeId = await modelStorage.beginModelWrite({
            family: 'ddsp',
            modelId,
            expectedSizeBytes,
            expectedSha256: await sha256(bytes),
            archive: false,
        });
        try {
            const bytesWritten = await modelStorage.writeModelChunk({ writeId, chunk: bytes });
            if (bytesWritten !== expectedSizeBytes) {
                throw new Error(
                    `OPFS wrote ${String(bytesWritten)} of ${String(expectedSizeBytes)} DDSP metadata bytes`
                );
            }
            await modelStorage.commitModelWrite({ writeId });
        } catch (error) {
            await modelStorage.abortModelWrite(writeId).catch(() => undefined);
            throw error;
        }
    }

    async function writeGenerationIndex(instrumentId: string, index: DdspGenerationIndex): Promise<void> {
        await writeBytes(generationIndexId(instrumentId), encodeJson(index));
    }

    async function cleanupGeneration(generation: DdspGeneration): Promise<{ complete: boolean; errors: unknown[] }> {
        const errors: unknown[] = [];
        for (const modelId of [generation.readyMarkerId, ...generation.artifactIds]) {
            try {
                await modelStorage.deleteModel({ family: 'ddsp', modelId });
            } catch (error) {
                errors.push(error);
            }
        }
        return { complete: errors.length === 0, errors };
    }

    return {
        artifactModelId,
        cleanupGeneration,
        generationFor,
        readPort,
        readGenerationIndex,
        readyMarkerBytes,
        sameGeneration,
        writeBytes,
        writeGenerationIndex,
    };
}
