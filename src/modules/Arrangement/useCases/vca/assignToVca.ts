import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function assignToVca(trackId: string, vcaGroupId: string): void {
    const groups = getVcaGroupsState();
    const targetGroup = groups.find((group) => group.id === vcaGroupId);
    const track = getTrackById(trackId);
    if (!targetGroup || !track) {
        return;
    }

    setVcaGroupsState(
        groups.map((group) => {
            const trackIdsWithoutMember = group.trackIds.filter((memberTrackId) => memberTrackId !== trackId);
            if (group.id !== vcaGroupId) {
                return { ...group, trackIds: trackIdsWithoutMember };
            }

            return { ...group, trackIds: [...trackIdsWithoutMember, trackId] };
        })
    );

    updateTrack(trackId, (currentTrack) => ({ ...currentTrack, vcaGroupId }));
}
