import { logger } from '#/infra/logger/appLogger';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';

import { createCheckpointAudioRetentionRepository } from '../repositories/checkpointAudioRetention';
import { garbageCollectAudioBufferCacheBySize, openAudioBufferCacheDatabase } from '../stores/audioBufferCache';

type GarbageCollectCachedAudioBuffersBySizeInput = {
    maxSizeBytes: number;
};

type GarbageCollectCachedAudioBuffersBySizeOutput = Promise<number>;

export async function garbageCollectCachedAudioBuffersBySize({
    maxSizeBytes,
}: GarbageCollectCachedAudioBuffersBySizeInput): GarbageCollectCachedAudioBuffersBySizeOutput {
    let deletedCount = 0;
    try {
        return await withProjectAudioStorageLock(async (scope) => {
            const checkpointRetention = createCheckpointAudioRetentionRepository({
                openDatabase: openAudioBufferCacheDatabase,
            });
            const census = await checkpointRetention.collectCensus();
            const mutableBudget = Math.max(0, maxSizeBytes - census.immutableBytes);
            deletedCount = await garbageCollectAudioBufferCacheBySize(mutableBudget, scope, census.retainedBufferIds);
            return deletedCount;
        });
    } catch (error) {
        logger.warn('[audioBufferCache] Size-based collection failed', { error });
        return deletedCount;
    }
}
