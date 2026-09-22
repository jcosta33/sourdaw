import { removeClip } from '../clip/removeClip';
import { getTrackStoreState } from '../getTrackStoreState';

/**
 * Retire a recording gesture's provisional result.
 *
 * One implementation serves every caller that has to take a recording back
 * without a history entry: the `discardRecording` action's inverse, and the
 * failure path of a commit that never landed. Both remove the clip and retire
 * the takes naming it — and the lane those takes leave empty — through
 * `removeClip`, so a failed commit cannot leave a visible recording that no
 * entry owns (#4439).
 */
export function discardRecording(clipId: string): boolean {
    const exists =
        getTrackStoreState()?.tracks.some((track) => track.clips.some((clip) => clip.id === clipId)) === true;
    if (!exists) {
        return false;
    }
    removeClip(clipId);
    return true;
}
