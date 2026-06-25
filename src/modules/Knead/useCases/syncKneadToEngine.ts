import { trackStore } from '#/modules/Arrangement/stores';
import { audioEngine } from '#/modules/AudioEngine/useCases';

import { kneadStore, type KneadClipState } from '../stores/kneadStore';

type EngineKneadState = KneadClipState & { startBeat: number; endBeat: number };

/**
 * Pushes the current Knead pitch data to the AudioEngine for every track that
 * hosts a Knead device. Reads both the knead and track stores at call time, so
 * it produces correct engine state regardless of which store last mutated.
 */
function pushKneadStateToEngine(): void {
    const state = kneadStore.value;
    if (!state) {
        return;
    }
    const tracks = trackStore.value?.tracks ?? [];

    // For each track, check if it has a Knead device and sync its clips' states
    for (const track of tracks) {
        const hasKnead = track.devices.some((data) => data.type.toLowerCase() === 'knead');
        if (hasKnead) {
            // Collect all clips belonging to this track that have knead state
            const trackClipsState: Record<string, EngineKneadState> = {};
            for (const clip of track.clips) {
                const clipState = state.clips[clip.id];
                if (clipState) {
                    trackClipsState[clip.id] = {
                        ...clipState,
                        startBeat: clip.startBeat,
                        endBeat: clip.endBeat,
                    };
                }
            }

            audioEngine.syncKneadState(track.id, trackClipsState);
        }
    }
}

/**
 * Orchestrates the synchronization of Knead pitch data from the store
 * to the AudioEngine's real-time device nodes.
 *
 * Subscribes to both the kneadStore (pitch/blob edits) and the trackStore
 * (device add/remove, clip placement). Adding a Knead device is a trackStore
 * mutation; without the trackStore subscription the engine would not receive
 * the clip state until the kneadStore next mutated.
 */
export function syncKneadToEngine(): () => void {
    const unsubscribeKnead = kneadStore.subscribe(() => pushKneadStateToEngine());
    const unsubscribeTracks = trackStore.subscribe(() => pushKneadStateToEngine());

    return () => {
        unsubscribeKnead();
        unsubscribeTracks();
    };
}
