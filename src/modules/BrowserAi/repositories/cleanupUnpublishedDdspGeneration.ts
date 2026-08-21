import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type DdspArtifact } from '../models/DdspArtifactManifest';

import { createDdspGenerationStorageSupport } from './ddspGenerationStorageSupport';
import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';
import { sha256ArrayBuffer } from './sha256ArrayBuffer';

/** Reclaims a failed candidate without disturbing a separately current generation. */
export const cleanupUnpublishedDdspGeneration = inject({ logger, modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ logger, modelStorageWorkerBridge, sha256ArrayBuffer }) =>
        async function cleanupUnpublishedDdspGeneration(input: {
            artifacts: readonly DdspArtifact[];
            id: string;
            version: string;
        }): Promise<void> {
            try {
                const storage = createDdspGenerationStorageSupport({ modelStorageWorkerBridge, sha256ArrayBuffer });
                const index = await storage.readGenerationIndex(input.id);
                if (index.currentVersion === input.version) {
                    return;
                }
                const candidate = storage.generationFor(input);
                const tracked = { ...index, generations: { ...index.generations, [input.version]: candidate } };
                await storage.writeGenerationIndex(input.id, tracked);
                const result = await storage.cleanupGeneration(candidate);
                if (result.complete) {
                    const generations = { ...tracked.generations };
                    delete generations[input.version];
                    await storage.writeGenerationIndex(input.id, { ...tracked, generations });
                }
            } catch (error) {
                logger.warn(`[DDSP storage] unpublished generation cleanup failed for ${input.id}: ${String(error)}`);
            }
        }
);
