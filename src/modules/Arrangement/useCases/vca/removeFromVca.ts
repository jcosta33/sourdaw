import { updateTrack } from '../../repositories/track/updateTrack';
import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function removeFromVca(trackId: string): void {
    setVcaGroupsState(
        getVcaGroupsState().map((g) => ({
            ...g,
            trackIds: g.trackIds.filter((id) => id !== trackId),
        }))
    );

    updateTrack(trackId, (t) => ({ ...t, vcaGroupId: null }));
}
