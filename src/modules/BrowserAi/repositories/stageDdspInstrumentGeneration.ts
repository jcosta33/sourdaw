import { inject } from '#/infra/di/inject';

import { type DdspArtifact } from '../models/DdspArtifactManifest';

import { createDdspGenerationStorageSupport } from './ddspGenerationStorageSupport';
import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';
import { sha256ArrayBuffer } from './sha256ArrayBuffer';

/** Records a candidate generation without changing the current ready generation. */
export const stageDdspInstrumentGeneration = inject({ modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ modelStorageWorkerBridge, sha256ArrayBuffer }) =>
        async function stageDdspInstrumentGeneration(input: {
            artifacts: readonly DdspArtifact[];
            id: string;
            version: string;
        }): Promise<void> {
            const storage = createDdspGenerationStorageSupport({ modelStorageWorkerBridge, sha256ArrayBuffer });
            const index = await storage.readGenerationIndex(input.id);
            const candidate = storage.generationFor(input);
            if (
                index.currentVersion === input.version ||
                storage.sameGeneration(index.generations[input.version], candidate)
            ) {
                return;
            }
            await storage.writeGenerationIndex(input.id, {
                ...index,
                generations: { ...index.generations, [input.version]: candidate },
            });
        }
);
