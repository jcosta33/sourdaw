import { inject } from '#/infra/di/inject';

import { createDdspGenerationStorageSupport } from './ddspGenerationStorageSupport';
import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';
import { sha256ArrayBuffer } from './sha256ArrayBuffer';

/** Removes tracked DDSP generations while invalidating current readiness before physical cleanup. */
export const removeDdspInstrumentGenerations = inject({ modelStorageWorkerBridge, sha256ArrayBuffer })(
    ({ modelStorageWorkerBridge, sha256ArrayBuffer }) =>
        async function removeDdspInstrumentGenerations({ id }: { id: string }): Promise<void> {
            const storage = createDdspGenerationStorageSupport({ modelStorageWorkerBridge, sha256ArrayBuffer });
            const index = await storage.readGenerationIndex(id);
            const entries = Object.entries(index.generations);
            if (entries.length === 0) {
                return;
            }
            if (index.currentVersion !== null) {
                await storage.writeGenerationIndex(id, { ...index, currentVersion: null });
            }
            const remaining: Record<string, (typeof index.generations)[string]> = {};
            const errors: unknown[] = [];
            for (const [version, generation] of entries) {
                const result = await storage.cleanupGeneration(generation);
                if (!result.complete) {
                    remaining[version] = generation;
                    errors.push(...result.errors);
                }
            }
            await storage.writeGenerationIndex(id, { schemaVersion: 1, currentVersion: null, generations: remaining });
            if (errors.length > 0) {
                throw errors[0];
            }
        }
);
