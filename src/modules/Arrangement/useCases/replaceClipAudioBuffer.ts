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
}
