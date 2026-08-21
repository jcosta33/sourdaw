import { inject } from '#/infra/di/inject';

import { type DdspArtifact } from '../models/DdspArtifactManifest';

import { createDdspGenerationStorageSupport } from './ddspGenerationStorageSupport';
import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';
import { sha256ArrayBuffer } from './sha256ArrayBuffer';

/** Publishes a candidate only after every pinned artifact verifies and then reclaims indexed stale generations. */
export const publishDdspInstrumentGeneration = inject({ modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ modelStorageWorkerBridge, sha256ArrayBuffer }) =>
        async function publishDdspInstrumentGeneration(input: {
            artifacts: readonly DdspArtifact[];
            id: string;
            version: string;
        }): Promise<void> {
            const storage = createDdspGenerationStorageSupport({ modelStorageWorkerBridge, sha256ArrayBuffer });
            const index = await storage.readGenerationIndex(input.id);
            const currentGeneration = storage.generationFor(input);
            const verified = await Promise.all(
                input.artifacts.map((artifact) =>
                    modelStorageWorkerBridge.verifyModel({
                        family: 'ddsp',
                        modelId: storage.artifactModelId(input.id, input.version, artifact.path),
                        expectedSizeBytes: artifact.sizeBytes,
                        expectedSha256: artifact.sha256,
                    })
                )
            );
            if (!verified.every(Boolean)) {
                throw new Error(`DDSP generation verification failed for ${input.id}:${input.version}`);
            }
            await storage.writeBytes(currentGeneration.readyMarkerId, storage.readyMarkerBytes(input));
            const publishedIndex = {
                schemaVersion: 1 as const,
                currentVersion: input.version,
                generations: { ...index.generations, [input.version]: currentGeneration },
            };
            await storage.writeGenerationIndex(input.id, publishedIndex);

            const staleGenerations = Object.entries(publishedIndex.generations).filter(
                ([version]) => version !== input.version
            );
            let cleanupComplete = true;
            for (const [, staleGeneration] of staleGenerations) {
                const result = await storage.cleanupGeneration(staleGeneration);
                cleanupComplete &&= result.complete;
            }
            if (cleanupComplete && staleGenerations.length > 0) {
                await storage
                    .writeGenerationIndex(input.id, {
                        schemaVersion: 1,
                        currentVersion: input.version,
                        generations: { [input.version]: currentGeneration },
                    })
                    .catch(() => undefined);
            }
        }
);
