import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';
import { updateTrack } from '../../repositories/track/updateTrack';

export function removeFromVca(trackId: string): void {
    setVcaGroupsState(
        getVcaGroupsState().map((g) => ({
            ...g,
            trackIds: g.trackIds.filter((id) => id !== trackId),
        }))
    );

    updateTrack(trackId, (t) => ({ ...t, vcaGroupId: null }));
}
