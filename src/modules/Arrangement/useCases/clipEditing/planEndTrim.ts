import { type Clip } from '../../models/Track';

/**
 * The clip a trim of the end leaves, as a pure law over the clip as it stands. Null when the
 * request is not finite or not past the clip's start, so nothing is written.
 */
export function planEndTrim(clip: Clip, newEndBeat: number): Clip | null {
    if (!Number.isFinite(newEndBeat) || newEndBeat <= clip.startBeat) {
        return null;
    }
    return { ...clip, endBeat: newEndBeat };
}
