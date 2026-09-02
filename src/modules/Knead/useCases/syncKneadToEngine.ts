import { trackStore } from '#/modules/Arrangement/stores';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { readSecondsAtBeat, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { kneadStore, type KneadClipState } from '../stores/kneadStore';

/**
 * `startSeconds` is the clip's start beat integrated through the tempo map.
 *
 * The engine's Knead worklet selects a pitch blob by clip time in seconds, and
 * blob times are seconds into the clip's audio. Beats convert to seconds only
 * through the tempo map, which lives here rather than on the audio thread, so
 * the anchor is integrated once per push and shipped alongside the beats.
 */
type EngineKneadState = KneadClipState & { startBeat: number; endBeat: number; startSeconds: number };

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
                        startSeconds: readSecondsAtBeat({ beat: clip.startBeat }),
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
 *
 * The tempo sources are subscribed for the same reason: a tempo edit moves
 * every clip's `startSeconds` while leaving both those stores untouched, and a
 * stale anchor puts the engine back on a clip time the scheduler is not
 * playing.
 */
export function syncKneadToEngine(): () => void {
    const unsubscribeKnead = kneadStore.subscribe(() => pushKneadStateToEngine());
    const unsubscribeTracks = trackStore.subscribe(() => pushKneadStateToEngine());
    const unsubscribeTempoMap = tempoMapStore.subscribe(() => pushKneadStateToEngine());
    // The transport store carries the playhead, the play flag and the record
    // flag as well as the base tempo, and only the base tempo moves an anchor —
    // and only for a project with no tempo map, where it is the whole map.
    // Pushing on every transport write would re-send every blob on each
    // transport toggle.
    let lastBaseTempo = transportStore.value?.tempo;
    const unsubscribeTransport = transportStore.subscribe(() => {
        const baseTempo = transportStore.value?.tempo;
        if (baseTempo === lastBaseTempo) {
            return;
        }
        lastBaseTempo = baseTempo;
        pushKneadStateToEngine();
    });

    return () => {
        unsubscribeKnead();
        unsubscribeTracks();
        unsubscribeTempoMap();
        unsubscribeTransport();
    };
}
