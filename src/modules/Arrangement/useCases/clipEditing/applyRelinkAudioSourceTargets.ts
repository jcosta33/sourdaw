import { type RelinkTarget } from '../../models/RelinkAudioSourceTarget';
import { type Clip } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

export function applyRelinkAudioSourceTargets(targets: readonly RelinkTarget[]): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    function update(trackId: string, alternativeId: string | null, clip: Clip): Clip {
        const target = targets.find(
            (item) => item.trackId === trackId && item.alternativeId === alternativeId && item.clipId === clip.id
        );
        if (!target) {
            return clip;
        }
        const next = Object.assign({}, clip);
        if (target.after.audioBufferId === undefined) {
            delete next.audioBufferId;
        } else {
            next.audioBufferId = target.after.audioBufferId;
        }
        return next;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => update(track.id, null, clip)),
            alternatives: track.alternatives.map((alternative) => {
                if (alternative.id === track.activeAlternativeId) {
                    return alternative;
                }
                return {
                    ...alternative,
                    clips: alternative.clips.map((clip) => update(track.id, alternative.id, clip)),
                };
            }),
        })),
    });
}
