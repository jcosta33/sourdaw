import { assignTrackToVCA, removeTrackFromVCA } from '../vcaFader';
import { getTrackById } from '../../repositories/track/getTrackById';

/**
 * Toggle a track's membership in the given VCA group. If the track is already in that
 * group, remove it; otherwise assign it to the group (swapping out any prior membership).
 */
export function toggleVcaMembership(trackId: string, vcaGroupId: string): void {
    const track = getTrackById(trackId);
    if (!track) {
        return;
    }
    if (track.vcaGroupId === vcaGroupId) {
        removeTrackFromVCA(trackId);
    } else {
        assignTrackToVCA(trackId, vcaGroupId);
    }
}
