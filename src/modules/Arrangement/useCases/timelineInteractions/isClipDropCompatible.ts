import { type TrackKind } from '../../models/Track';
import { getTrackEligibility } from '../../stores/trackEligibility';

/**
 * Whether a clip of `clipType` may be dropped on a track of `trackKind`.
 * Tracks that don't render timeline content (bus/master/folder) never accept
 * clip drops, and MIDI tracks take only MIDI clips while audio tracks take
 * only audio clips.
 */
export function isClipDropCompatible(clipType: 'audio' | 'midi', trackKind: TrackKind): boolean {
    if (!getTrackEligibility(trackKind).rendersTrackContent) {
        return false;
    }
    if (trackKind === 'audio') {
        return clipType === 'audio';
    }
    if (trackKind === 'midi') {
        return clipType === 'midi';
    }
    return false;
}
