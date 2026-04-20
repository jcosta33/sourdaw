import { updateTrack } from '../../repositories/track/updateTrack';
import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function assignToVca(trackId: string, vcaGroupId: string): void {
    const groups = getVcaGroupsState();
    const group = groups.find((g) => g.id === vcaGroupId);
    if (!group) {
        return;
    }

    if (!group.trackIds.includes(trackId)) {
        setVcaGroupsState(groups.map((g) => (g.id === vcaGroupId ? { ...g, trackIds: [...g.trackIds, trackId] } : g)));
    }

    updateTrack(trackId, (t) => ({ ...t, vcaGroupId }));
}
