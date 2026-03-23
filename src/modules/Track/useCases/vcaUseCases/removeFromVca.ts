import { getVcaGroupsState, setVcaGroupsState } from '#/modules/Track/stores/vcaGroupStore';
import { updateTrack } from '#/modules/Track/repositories/trackRepository';

export function removeFromVca(trackId: string): void {
    setVcaGroupsState(
        getVcaGroupsState().map((g) => ({
            ...g,
            trackIds: g.trackIds.filter((id) => id !== trackId),
        }))
    );

    updateTrack(trackId, (t) => ({ ...t, vcaGroupId: null }));
}
