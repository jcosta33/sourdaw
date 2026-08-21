import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type DdspArtifact } from '../models/DdspArtifactManifest';

import { modelStorageWorkerBridge, type ModelStoragePort } from './modelStorageWorkerBridge';
import { sha256ArrayBuffer } from './sha256ArrayBuffer';

type DdspStorageInput = { id: string; version: string; artifacts: DdspArtifact[] };

type DdspGeneration = {
    artifactIds: string[];
    readyMarkerId: string;
};

type DdspGenerationIndex = {
    schemaVersion: 1;
    currentVersion: string | null;
    generations: Record<string, DdspGeneration>;
};

type StorageDependencies = {
    modelStorageWorkerBridge: ModelStoragePort;
    sha256ArrayBuffer: (bytes: ArrayBuffer) => Promise<string>;
};

const DDSP_GENERATION_INDEX_SCHEMA_VERSION = 1;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function artifactModelId(instrumentId: string, version: string, path: DdspArtifact['path']): string {
    return `${instrumentId}/${version}/${path}`;
}

function readyModelId(instrumentId: string, version: string): string {
    return `${instrumentId}/${version}/.ready.json`;
}

function generationIndexModelId(instrumentId: string): string {
    return `${instrumentId}/.generations.json`;
}

function generationFor(input: DdspStorageInput): DdspGeneration {
    return {
        artifactIds: input.artifacts.map(({ path }) => artifactModelId(input.id, input.version, path)),
        readyMarkerId: readyModelId(input.id, input.version),
    };
}

function emptyGenerationIndex(): DdspGenerationIndex {
    return {
        schemaVersion: DDSP_GENERATION_INDEX_SCHEMA_VERSION,
        currentVersion: null,
        generations: {},
    };
}

function encodeJson(value: unknown): ArrayBuffer {
    return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function readyBytes(input: DdspStorageInput): ArrayBuffer {
    return encodeJson({
        version: input.version,
        artifacts: input.artifacts.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })),
    });
}

async function readPort(port: MessagePort): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        port.onmessage = (event: MessageEvent<{ type: string; modelData?: ArrayBuffer; message?: string }>) => {
            port.close();
            if (event.data.type === 'model-data' && event.data.modelData) {
                resolve(event.data.modelData);
                return;
            }
            reject(new Error(event.data.message ?? 'DDSP artifact transfer failed'));
        };
        port.start();
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
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
    const artifactIds = value.artifactIds;
    const readyMarkerId = value.readyMarkerId;
    if (
        !Array.isArray(artifactIds) ||
        !artifactIds.every(
            (artifactId): artifactId is string =>
                typeof artifactId === 'string' && isSafeArtifactId(instrumentId, version, artifactId)
        ) ||
        new Set(artifactIds).size !== artifactIds.length ||
        readyMarkerId !== readyModelId(instrumentId, version)
    ) {
        return null;
    }
    return { artifactIds: [...artifactIds], readyMarkerId };
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
            const parsed = parseGeneration(candidate, instrumentId, version);
            if (parsed === null) {
                throw new Error(`Invalid generation metadata: ${version}`);
            }
            generations[version] = parsed;
        }
        const currentVersion = value.currentVersion;
        if (currentVersion !== null && generations[currentVersion] === undefined) {
            throw new Error('Current generation is missing');
        }
        return {
            schemaVersion: DDSP_GENERATION_INDEX_SCHEMA_VERSION,
            currentVersion,
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

async function readGenerationIndex(modelStorage: ModelStoragePort, instrumentId: string): Promise<DdspGenerationIndex> {
    const port = await modelStorage.readModel({
        family: 'ddsp',
        modelId: generationIndexModelId(instrumentId),
    });
    if (port === null) {
        return emptyGenerationIndex();
    }
    return parseGenerationIndex(await readPort(port), instrumentId);
}

async function writeBytes(
    { modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 }: StorageDependencies,
    modelId: string,
    bytes: ArrayBuffer
): Promise<void> {
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
            throw new Error(`OPFS wrote ${String(bytesWritten)} of ${String(expectedSizeBytes)} DDSP metadata bytes`);
        }
        await modelStorage.commitModelWrite({ writeId });
    } catch (error) {
        await modelStorage.abortModelWrite(writeId).catch(() => undefined);
        throw error;
    }
}

async function writeGenerationIndex(
    dependencies: StorageDependencies,
    instrumentId: string,
    index: DdspGenerationIndex
) {
    await writeBytes(dependencies, generationIndexModelId(instrumentId), encodeJson(index));
}

async function cleanupGeneration(
    modelStorage: ModelStoragePort,
    generation: DdspGeneration
): Promise<{ complete: boolean; errors: unknown[] }> {
    const errors: unknown[] = [];
    try {
        await modelStorage.deleteModel({ family: 'ddsp', modelId: generation.readyMarkerId });
    } catch (error) {
        errors.push(error);
    }
    for (const artifactId of generation.artifactIds) {
        try {
            await modelStorage.deleteModel({ family: 'ddsp', modelId: artifactId });
        } catch (error) {
            errors.push(error);
        }
    }
    return { complete: errors.length === 0, errors };
}

const checkDdspInstrumentReady = inject({ logger, modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ logger, modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 }) =>
        async function checkDdspInstrumentReady(input: DdspStorageInput): Promise<boolean> {
            try {
                const index = await readGenerationIndex(modelStorage, input.id);
                const expectedGeneration = generationFor(input);
                if (
                    index.currentVersion !== input.version ||
                    !sameGeneration(index.generations[input.version], expectedGeneration)
                ) {
                    return false;
                }
                const marker = readyBytes(input);
                const markerPort = await modelStorage.readModel({
                    family: 'ddsp',
                    modelId: expectedGeneration.readyMarkerId,
                    expectedSizeBytes: marker.byteLength,
                    expectedSha256: await sha256(marker),
                });
                if (markerPort === null) {
                    return false;
                }
                await readPort(markerPort);
                return (
                    await Promise.all(
                        input.artifacts.map((artifact) =>
                            modelStorage.verifyModel({
                                family: 'ddsp',
                                modelId: artifactModelId(input.id, input.version, artifact.path),
                                expectedSizeBytes: artifact.sizeBytes,
                                expectedSha256: artifact.sha256,
                            })
                        )
                    )
                ).every(Boolean);
            } catch (error) {
                logger.warn(`[DDSP storage] readiness check failed for ${input.id}: ${String(error)}`);
                return false;
            }
        }
);

const stageDdspInstrumentGeneration = inject({ modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 }) =>
        async function stageDdspInstrumentGeneration(input: DdspStorageInput): Promise<void> {
            const index = await readGenerationIndex(modelStorage, input.id);
            if (index.currentVersion === input.version) {
                return;
            }
            const candidate = generationFor(input);
            if (sameGeneration(index.generations[input.version], candidate)) {
                return;
            }
            await writeGenerationIndex(
                { modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 },
                input.id,
                {
                    ...index,
                    generations: { ...index.generations, [input.version]: candidate },
                }
            );
        }
);

const publishDdspInstrumentGeneration = inject({ modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 }) =>
        async function publishDdspInstrumentGeneration(input: DdspStorageInput): Promise<void> {
            const index = await readGenerationIndex(modelStorage, input.id);
            const currentGeneration = generationFor(input);
            const verified = await Promise.all(
                input.artifacts.map((artifact) =>
                    modelStorage.verifyModel({
                        family: 'ddsp',
                        modelId: artifactModelId(input.id, input.version, artifact.path),
                        expectedSizeBytes: artifact.sizeBytes,
                        expectedSha256: artifact.sha256,
                    })
                )
            );
            if (!verified.every(Boolean)) {
                throw new Error(`DDSP generation verification failed for ${input.id}:${input.version}`);
            }

            await writeBytes(
                { modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 },
                currentGeneration.readyMarkerId,
                readyBytes(input)
            );
            const publishedIndex: DdspGenerationIndex = {
                schemaVersion: DDSP_GENERATION_INDEX_SCHEMA_VERSION,
                currentVersion: input.version,
                generations: { ...index.generations, [input.version]: currentGeneration },
            };
            await writeGenerationIndex(
                { modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 },
                input.id,
                publishedIndex
            );

            const staleGenerations = Object.entries(publishedIndex.generations).filter(
                ([version]) => version !== input.version
            );
            let cleanupComplete = true;
            for (const [, staleGeneration] of staleGenerations) {
                const result = await cleanupGeneration(modelStorage, staleGeneration);
                cleanupComplete &&= result.complete;
            }
            if (cleanupComplete && staleGenerations.length > 0) {
                await writeGenerationIndex(
                    { modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 },
                    input.id,
                    {
                        schemaVersion: DDSP_GENERATION_INDEX_SCHEMA_VERSION,
                        currentVersion: input.version,
                        generations: { [input.version]: currentGeneration },
                    }
                ).catch(() => undefined);
            }
        }
);

const removeDdspInstrumentGenerations = inject({ modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 }) =>
        async function removeDdspInstrumentGenerations(input: { id: string }): Promise<void> {
            const index = await readGenerationIndex(modelStorage, input.id);
            const entries = Object.entries(index.generations);
            if (entries.length === 0) {
                return;
            }
            const dependencies = { modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 };
            if (index.currentVersion !== null) {
                await writeGenerationIndex(dependencies, input.id, { ...index, currentVersion: null });
            }

            const remaining: Record<string, DdspGeneration> = {};
            const errors: unknown[] = [];
            for (const [version, candidate] of entries) {
                const result = await cleanupGeneration(modelStorage, candidate);
                if (!result.complete) {
                    remaining[version] = candidate;
                    errors.push(...result.errors);
                }
            }
            await writeGenerationIndex(dependencies, input.id, {
                schemaVersion: DDSP_GENERATION_INDEX_SCHEMA_VERSION,
                currentVersion: null,
                generations: remaining,
            });
            if (errors.length > 0) {
                throw errors[0];
            }
        }
);

const cleanupUnpublishedDdspGeneration = inject({ logger, modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ logger, modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 }) =>
        async function cleanupUnpublishedDdspGeneration(input: DdspStorageInput): Promise<void> {
            try {
                const index = await readGenerationIndex(modelStorage, input.id);
                if (index.currentVersion === input.version) {
                    return;
                }
                const candidate = generationFor(input);
                const tracked: DdspGenerationIndex = {
                    ...index,
                    generations: { ...index.generations, [input.version]: candidate },
                };
                const dependencies = { modelStorageWorkerBridge: modelStorage, sha256ArrayBuffer: sha256 };
                await writeGenerationIndex(dependencies, input.id, tracked);
                const result = await cleanupGeneration(modelStorage, candidate);
                if (result.complete) {
                    const generations = { ...tracked.generations };
                    delete generations[input.version];
                    await writeGenerationIndex(dependencies, input.id, { ...tracked, generations });
                }
            } catch (error) {
                logger.warn(`[DDSP storage] unpublished generation cleanup failed for ${input.id}: ${String(error)}`);
            }
        }
);

export const ddspModelStorage = {
    checkDdspInstrumentReady,
    stageDdspInstrumentGeneration,
    publishDdspInstrumentGeneration,
    removeDdspInstrumentGenerations,
    cleanupUnpublishedDdspGeneration,
};
