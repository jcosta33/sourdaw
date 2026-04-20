import { kneadStore } from '../stores/kneadStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioEngine } from '#/modules/AudioEngine/useCases';

/**
 * Orchestrates the synchronization of Knead pitch data from the store
 * to the AudioEngine's real-time device nodes.
 */
export function syncKneadToEngine(): () => void {
    // Listen to changes in the kneadStore
    const unsubscribeKnead = kneadStore.subscribe((state) => {
        if (!state) return;
        const tracks = trackStore.value?.tracks ?? [];
        
        // For each track, check if it has a Knead device and sync its clips' states
        for (const track of tracks) {
            const hasKnead = track.devices.some(d => d.type.toLowerCase() === 'knead');
            if (hasKnead) {
                // Collect all clips belonging to this track that have knead state
                const trackClipsState: Record<string, any> = {};
                for (const clip of track.clips) {
                    if (state.clips[clip.id]) {
                        trackClipsState[clip.id] = {
                            ...state.clips[clip.id],
                            startBeat: clip.startBeat,
                            endBeat: clip.endBeat,
                        };
                    }
                }
                
                audioEngine.syncKneadState(track.id, trackClipsState);
            }
        }
    });

    return () => {
        unsubscribeKnead();
    };
}
