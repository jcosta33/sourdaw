import { type Clip } from '../stores/trackStore';

/**
 * The clip a fragment is cut from, entering its media `offsetBeats` into it at
 * the fragment's own `startBeat`. Every consumer enters the material using the
 * offset field alone, so the fragment carries its whole distance from the media
 * origin. A fragment already on the clip's own offset leaves the clip untouched,
 * so an unshifted region stays byte-identical to its source.
 */
export function withMediaOffsetBeats(clip: Clip, offsetBeats: number): Clip {
    if (clip.type === 'audio') {
        if (offsetBeats === (clip.audioOffsetBeats ?? 0)) {
            return clip;
        }
        return { ...clip, audioOffsetBeats: offsetBeats };
    }
    if (offsetBeats === (clip.midiOffsetBeats ?? 0)) {
        return clip;
    }
    return { ...clip, midiOffsetBeats: offsetBeats };
}
