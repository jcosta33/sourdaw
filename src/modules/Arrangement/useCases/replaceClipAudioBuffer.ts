import { clearClipPitchContour } from '#/modules/Knead/useCases';

import { trackStore } from '../stores/trackStore';

/**
 * Replace the audio buffer ID on a clip. Used when dropping a new audio file
 * onto a waveform editor to swap the clip's source audio.
 */
export function replaceClipAudioBuffer(clipId: string, newBufferId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    // The match accepts either the clip id or its previous buffer id; collect the
    // real clip ids up front so their now-stale pitch contours can be dropped
    // after the swap (contours key on clip id, not buffer id).
    const replacedClipIds = new Set<string>();
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.id === clipId || clip.audioBufferId === clipId) {
                replacedClipIds.add(clip.id);
            }
        }
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((time) => ({
            ...time,
            clips: time.clips.map((context) =>
                context.id === clipId || context.audioBufferId === clipId
                    ? { ...context, audioBufferId: newBufferId }
                    : context
            ),
        })),
    });

    // New source audio invalidates any analyzed pitch contour: clear it so the
    // PitchEditor gate re-opens instead of locking the waveform behind stale data.
    for (const replacedClipId of replacedClipIds) {
        clearClipPitchContour(replacedClipId);
    }
}
