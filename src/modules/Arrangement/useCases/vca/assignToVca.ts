import { updateTrack } from '../../repositories/track/updateTrack';
import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function assignToVca(trackId: string, vcaGroupId: string): void {
    const groups = getVcaGroupsState();
    const group = groups.find((gain) => gain.id === vcaGroupId);
    if (!group) {
        return;
    }

    if (!group.trackIds.includes(trackId)) {
        setVcaGroupsState(groups.map((gain) => (gain.id === vcaGroupId ? { ...gain, trackIds: [...gain.trackIds, trackId] } : gain)));
    }

    updateTrack(trackId, (time) => ({ ...time, vcaGroupId }));
}
