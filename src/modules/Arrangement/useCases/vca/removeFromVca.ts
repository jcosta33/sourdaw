import { updateTrack } from '../../repositories/track/updateTrack';
import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function removeFromVca(trackId: string): void {
    setVcaGroupsState(
        getVcaGroupsState().map((gain) => ({
            ...gain,
            trackIds: gain.trackIds.filter((id) => id !== trackId),
        }))
    );

    updateTrack(trackId, (time) => ({ ...time, vcaGroupId: null }));
}
