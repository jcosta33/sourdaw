import { getVcaGroupsState, setVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export function assignToVca(trackId: string, vcaGroupId: string): void {
    const groups = getVcaGroupsState();
    const group = groups.find((g) => g.id === vcaGroupId);
    if (!group) {
        return;
    }

    if (!group.trackIds.includes(trackId)) {
        setVcaGroupsState(
            groups.map((g) => (g.id === vcaGroupId ? { ...g, trackIds: [...g.trackIds, trackId] } : g))
        );
    }

    updateTrack(trackId, (t) => ({ ...t, vcaGroupId }));
}
