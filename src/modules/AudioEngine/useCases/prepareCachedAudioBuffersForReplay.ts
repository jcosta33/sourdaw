import { audioBufferCache } from '../stores/audioBufferCache';
import { openAudioBufferResidencyHold } from '../stores/audioBufferResidencyHolds';

/**
 * Make the buffers an undo or redo entry restores resident before it replays.
 * The cache may have evicted a buffer only the history names once its PCM was
 * durably stored; this reads each such buffer back from storage, and holds every
 * named id until the returned release runs, so writes racing the replay cannot
 * evict it again before the restored clip references it. Call the release in a
 * `finally` once the entry has applied or failed.
 */
export async function prepareCachedAudioBuffersForReplay(bufferIds: readonly string[]): Promise<() => void> {
    const hold = openAudioBufferResidencyHold();
    for (const id of bufferIds) {
        hold.retain(id);
    }
    try {
        await audioBufferCache.rehydrateEvicted(bufferIds);
    } catch (error) {
        hold.release();
        throw error;
    }
    return hold.release;
}
