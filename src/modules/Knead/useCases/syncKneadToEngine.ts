import { trackStore } from '#/modules/Arrangement/stores';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { readSecondsAtBeat, readTempoAtBeat, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { kneadStore, type KneadClipState } from '../stores/kneadStore';

/**
 * `startSeconds` is the anchor the engine's Knead worklet subtracts from the
 * transport's song time to land on *source* time — seconds into the clip's
 * audio, where the blob windows live.
 *
 * Two clocks meet there and both are integrated here, on the main thread,
 * because the audio thread has neither of them. The clip's start beat goes
 * through the tempo map. The audio offset does not: it is converted at the
 * flat tempo governing the start beat, the same law the audio projector
 * applies (`projectOfflineAudioClipPlaybacks`) — the material was rendered at
 * one tempo, so a change inside the offset span moves the clip on the
 * timeline, never the point it seeks to inside the file. With both halves in
 * place, `songTime − startSeconds` at any playhead is the source position the
 * audio scheduler is reading, and the blob the worklet picks is the blob the
 * listener hears — even after a slip or a left-edge trim moved the clip's
 * entry into its own material (issue #3717).
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
                    const clipTempo = readTempoAtBeat({ beat: clip.startBeat });
                    const clipSecondsPerBeat = Number.isFinite(clipTempo) && clipTempo > 0 ? 60 / clipTempo : 0;
                    // A negative offset (left edge dragged past the file's
                    // start) opens a silent pre-roll: the anchor moves the
                    // other way, and the negative lookup window matches no
                    // blob — exactly the span in which nothing sounds.
                    const audioOffsetSeconds = (clip.audioOffsetBeats ?? 0) * clipSecondsPerBeat;
                    trackClipsState[clip.id] = {
                        ...clipState,
                        startBeat: clip.startBeat,
                        endBeat: clip.endBeat,
                        startSeconds: readSecondsAtBeat({ beat: clip.startBeat }) - audioOffsetSeconds,
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
