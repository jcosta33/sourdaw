import { inject } from '#/infra/di/inject';
import { getTrackById } from '../../repositories/track/getTrackById';
import { assignTrackToVCA, removeTrackFromVCA } from '../vcaFader';

/**
 * Toggle a track's membership in the given VCA group. If the track is already in that
 * group, remove it; otherwise assign it to the group (swapping out any prior membership).
 */
export const toggleVcaMembership = inject({ getTrackById })(
    ({ getTrackById }) =>
        function toggleVcaMembership(trackId: string, vcaGroupId: string): void {
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
);
