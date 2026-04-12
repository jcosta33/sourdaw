import { getTrackById } from '../../repositories/track/getTrackById';
import { getVcaGroupsState } from '../../stores/vcaGroupStore';

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
