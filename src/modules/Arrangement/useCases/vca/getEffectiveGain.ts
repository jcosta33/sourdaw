import { getTrackById } from '../../repositories/track/getTrackById';
import { deriveVcaMultiplier, getVcaGroupsState } from '../../stores/vcaGroupStore';

export function getEffectiveGain(trackId: string, trackGain: number): number {
    const track = getTrackById(trackId);

    // The multiplier itself comes from the shared derivation the offline render
    // also uses, so the two runtimes cannot disagree about what a VCA group does
    // to a track's level.
    return trackGain * deriveVcaMultiplier({ vcaGroupId: track?.vcaGroupId, groups: getVcaGroupsState() });
}
