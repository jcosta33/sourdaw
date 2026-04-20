import { trackStore } from '../../stores/trackStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

export async function cleanupUnusedFreezeFiles(): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const activeIds = new Set<string>();
    for (const track of state.tracks) {
        if (track.freezeState?.frozenBufferId) {
            activeIds.add(track.freezeState.frozenBufferId);
        }
    }

    // 1. Remove files not referenced by any track
    await audioBufferCache.garbageCollectFreezeFiles(activeIds);

    // 2. Prune by age (30 days)
    await audioBufferCache.garbageCollectByAge(30);

    // 3. Cap total cache size (2GB)
    await audioBufferCache.garbageCollectBySize(2 * 1024 * 1024 * 1024);
}
