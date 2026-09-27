import { isClipCompatibleWithTrackKind } from '#/utils/isClipCompatibleWithTrackKind';

import { type TrackKind } from '../../models/Track';
import { getTrackEligibility } from '../../stores/trackEligibility';

/**
 * Whether a clip of `clipType` may be placed on a track of `trackKind`.
 * Tracks that don't render timeline content (bus/master/folder) never accept
 * clip placement, and MIDI tracks take only MIDI clips while audio tracks take
 * only audio clips.
 *
 * This is the single compatibility rule for every clip-placement route: the
 * timeline drag, `moveClip`, the duplicate core, and paste all enforce it here,
 * because the store eligibility flags alone admit bus/master/folder targets
 * that would hold a clip which is never scheduled. The kind-matching core is
 * shared with the AI clip-placement transformers (which cannot import module
 * code), so they refuse exactly the same destinations.
 */
export function isClipDropCompatible(clipType: 'audio' | 'midi', trackKind: TrackKind): boolean {
    if (!getTrackEligibility(trackKind).rendersTrackContent) {
        return false;
    }
    return isClipCompatibleWithTrackKind(clipType, trackKind);
}
