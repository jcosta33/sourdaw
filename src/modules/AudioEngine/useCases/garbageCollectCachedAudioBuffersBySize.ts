import { logger } from '#/infra/logger/appLogger';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';

import { garbageCollectAudioBufferCacheBySize } from '../stores/audioBufferCache';

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
            deletedCount = await garbageCollectAudioBufferCacheBySize(maxSizeBytes, scope);
            return deletedCount;
        });
    } catch (error) {
        logger.warn('[audioBufferCache] Size-based collection failed', { error });
        return deletedCount;
    }
}
