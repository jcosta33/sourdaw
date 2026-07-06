import {
    garbageCollectCachedAudioBuffersByAge,
    garbageCollectCachedAudioBuffersBySize,
    garbageCollectFreezeAudioBuffers,
} from '#/modules/AudioEngine/useCases';

import { trackStore } from '../../stores/trackStore';

export async function cleanupUnusedFreezeFiles(): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const activeBufferIds = new Set<string>();
    for (const track of state.tracks) {
        if (track.freezeState.frozenBufferId) {
            activeBufferIds.add(track.freezeState.frozenBufferId);
        }
    }

    // 1. Remove files not referenced by any track
    await garbageCollectFreezeAudioBuffers({ activeBufferIds });

    // 2. Prune by age (30 days)
    await garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

    // 3. Cap total cache size (2GB)
    await garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 2 * 1024 * 1024 * 1024 });
}
