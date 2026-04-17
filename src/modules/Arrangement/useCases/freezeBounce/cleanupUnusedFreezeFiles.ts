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

    await audioBufferCache.garbageCollectFreezeFiles(activeIds);
}
