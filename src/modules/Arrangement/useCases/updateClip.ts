import { getTrackState } from '../repositories/track/getTrackState';
import { updateClip as repoUpdateClip } from '../repositories/track/updateClip';
import { getTrackEligibility } from '../stores/trackEligibility';
import { type Clip } from '../stores/trackStore';

export function updateClip(clipId: string, updater: (clip: Clip) => Clip): void {
    const state = getTrackState();
    const owner = state?.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    if (owner && !getTrackEligibility(owner.kind).acceptsClipUpdate) {
        return;
    }
    repoUpdateClip(clipId, updater);
}
