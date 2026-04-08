import { inject } from '#/infra/di/inject';
import { getTrackById } from '#/modules/Arrangement/repositories/track/getTrackById';
import { getVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';

/**
 * Get the effective gain for a track, multiplied by its VCA group gain.
 */
export const getEffectiveGain = inject({ getTrackById })(
    ({ getTrackById }) =>
        function getEffectiveGain(trackId: string, trackGain: number): number {
            const track = getTrackById(trackId);
            if (!track?.vcaGroupId) {
                return trackGain;
            }

            const group = getVcaGroupsState().find((g) => g.id === track.vcaGroupId);
            if (!group) {
                return trackGain;
            }

            return trackGain * group.gain;
        }
);
