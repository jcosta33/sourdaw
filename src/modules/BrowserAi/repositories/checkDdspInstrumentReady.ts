import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type DdspArtifact } from '../models/DdspArtifactManifest';

import { createDdspGenerationStorageSupport } from './ddspGenerationStorageSupport';
import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';
import { sha256ArrayBuffer } from './sha256ArrayBuffer';

/** Reports readiness only when the current indexed generation has its verified marker and artifact bytes. */
export const checkDdspInstrumentReady = inject({ logger, modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ logger, modelStorageWorkerBridge, sha256ArrayBuffer }) =>
        async function checkDdspInstrumentReady(input: {
            artifacts: readonly DdspArtifact[];
            id: string;
            version: string;
        }): Promise<boolean> {
            try {
                const storage = createDdspGenerationStorageSupport({ modelStorageWorkerBridge, sha256ArrayBuffer });
                const index = await storage.readGenerationIndex(input.id);
                const expectedGeneration = storage.generationFor(input);
                if (
                    index.currentVersion !== input.version ||
                    !storage.sameGeneration(index.generations[input.version], expectedGeneration)
                ) {
                    return false;
                }
                const marker = storage.readyMarkerBytes(input);
                const markerPort = await modelStorageWorkerBridge.readModel({
                    family: 'ddsp',
                    modelId: expectedGeneration.readyMarkerId,
                    expectedSizeBytes: marker.byteLength,
                    expectedSha256: await sha256ArrayBuffer(marker),
                });
                if (markerPort === null) {
                    return false;
                }
                await storage.readPort(markerPort);
                return (
                    await Promise.all(
                        input.artifacts.map((artifact) =>
                            modelStorageWorkerBridge.verifyModel({
                                family: 'ddsp',
                                modelId: storage.artifactModelId(input.id, input.version, artifact.path),
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
