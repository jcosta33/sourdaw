import {
    garbageCollectCachedAudioBuffersByAge,
    garbageCollectCachedAudioBuffersBySize,
    garbageCollectFreezeAudioBuffers,
} from '#/modules/AudioEngine/useCases';
import { projectLoadFailureStore, projectStore } from '#/modules/Project/stores';

import { trackStore } from '../../stores/trackStore';

export async function cleanupUnusedFreezeFiles(): Promise<void> {
    // Everything below infers "no track references this buffer" ⇒ "this buffer
    // is garbage", which is only sound while the track store speaks for the
    // open project. After a load replaced the CRDT authority and then failed,
    // it holds the projection default instead: an empty track list, which is
    // truthy and sails straight past the `!state` guard below, so every
    // `freeze-*` row would be collected. The failure surface's Reload button
    // fires `beforeunload`, which is what calls this — one click away from
    // deleting every frozen render of a project it says was not modified.
    if (projectLoadFailureStore.value !== null) {
        return;
    }

    const project = projectStore.value;
    const state = trackStore.value;
    if (!project || !state) {
        return;
    }

    const activeBufferIds = new Set<string>();
    for (const track of state.tracks) {
        if (track.freezeState.frozenBufferId) {
            activeBufferIds.add(track.freezeState.frozenBufferId);
        }
    }

    // 1. Remove files not referenced by any track
    await garbageCollectFreezeAudioBuffers({ activeBufferIds, projectId: project.createdAt });

    // 2. Prune by age (30 days)
    await garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

    // 3. Cap total cache size (2GB)
    await garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 2 * 1024 * 1024 * 1024 });
}
