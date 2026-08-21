import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type DdspArtifact } from '../models/DdspArtifactManifest';

import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';
import { sha256ArrayBuffer } from './sha256ArrayBuffer';

type DdspStorageInput = { id: string; version: string; artifacts: DdspArtifact[] };

function artifactModelId(instrumentId: string, path: DdspArtifact['path']): string {
    return `${instrumentId}/${path}`;
}

function readyModelId(instrumentId: string, version: string): string {
    return `${instrumentId}/.ready-${version}.json`;
}

function readyBytes(input: DdspStorageInput): ArrayBuffer {
    return new TextEncoder().encode(
        JSON.stringify({
            version: input.version,
            artifacts: input.artifacts.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })),
        })
    ).buffer;
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

const checkDdspInstrumentReady = inject({ logger, modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ logger, modelStorageWorkerBridge, sha256ArrayBuffer }) =>
        async function checkDdspInstrumentReady(input: DdspStorageInput): Promise<boolean> {
            try {
                const marker = readyBytes(input);
                const markerHash = await sha256ArrayBuffer(marker);
                const markerPort = await modelStorageWorkerBridge.readModel({
                    family: 'ddsp',
                    modelId: readyModelId(input.id, input.version),
                    expectedSizeBytes: marker.byteLength,
                    expectedSha256: markerHash,
                });
                if (markerPort === null) {
                    return false;
                }
                await readPort(markerPort);
                return (
                    await Promise.all(
                        input.artifacts.map((artifact) =>
                            modelStorageWorkerBridge.verifyModel({
                                family: 'ddsp',
                                modelId: artifactModelId(input.id, artifact.path),
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

const writeDdspReadyMarker = inject({ modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ modelStorageWorkerBridge, sha256ArrayBuffer }) =>
        async function writeDdspReadyMarker(input: DdspStorageInput): Promise<void> {
            const bytes = readyBytes(input);
            const writeId = await modelStorageWorkerBridge.beginModelWrite({
                family: 'ddsp',
                modelId: readyModelId(input.id, input.version),
                expectedSizeBytes: bytes.byteLength,
                expectedSha256: await sha256ArrayBuffer(bytes),
                archive: false,
            });
            try {
                await modelStorageWorkerBridge.writeModelChunk({ writeId, chunk: bytes });
                await modelStorageWorkerBridge.commitModelWrite({ writeId });
            } catch (error) {
                await modelStorageWorkerBridge.abortModelWrite(writeId).catch(() => undefined);
                throw error;
            }
        }
);

const deleteDdspInstrumentArtifacts = inject({ modelStorageWorkerBridge })(
    ({ modelStorageWorkerBridge }) =>
        async function deleteDdspInstrumentArtifacts(input: DdspStorageInput): Promise<void> {
            await Promise.all(
                [
                    ...input.artifacts.map((artifact) => artifactModelId(input.id, artifact.path)),
                    readyModelId(input.id, input.version),
                ].map(async (modelId) => modelStorageWorkerBridge.deleteModel({ family: 'ddsp', modelId }))
            );
        }
);

export const ddspModelStorage = {
    checkDdspInstrumentReady,
    writeDdspReadyMarker,
    deleteDdspInstrumentArtifacts,
    cleanupDdspInstrumentArtifacts: async (input: DdspStorageInput): Promise<void> => {
        await deleteDdspInstrumentArtifacts(input).catch(() => undefined);
    },
};
