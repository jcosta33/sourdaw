import { getTrackById } from '#/modules/Track/repositories/trackRepository';
import { getVcaGroupsState } from '#/modules/Track/stores/vcaGroupStore';

/**
 * Get the effective gain for a track, multiplied by its VCA group gain.
 */
export function getEffectiveGain(trackId: string, trackGain: number): number {
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
