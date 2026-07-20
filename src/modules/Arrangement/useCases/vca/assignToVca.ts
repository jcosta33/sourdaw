import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function assignToVca(trackId: string, vcaGroupId: string): boolean {
    const groups = getVcaGroupsState();
    const targetGroup = groups.find((group) => group.id === vcaGroupId);
    const track = getTrackById(trackId);
    if (!targetGroup || !track) {
        return false;
    }

    const updatedGroups = groups.map((group) => {
        const trackIdsWithoutMember = group.trackIds.filter((memberTrackId) => memberTrackId !== trackId);
        let nextTrackIds = trackIdsWithoutMember;
        if (group.id === vcaGroupId) {
            nextTrackIds = [...trackIdsWithoutMember, trackId];
        }

        const membershipUnchanged =
            nextTrackIds.length === group.trackIds.length &&
            nextTrackIds.every((memberTrackId, index) => memberTrackId === group.trackIds[index]);
        if (membershipUnchanged) {
            return group;
        }

        return { ...group, trackIds: nextTrackIds };
    });
    const groupMembershipChanged = updatedGroups.some((group, index) => group !== groups[index]);
    const trackMembershipChanged = (track.vcaGroupId ?? null) !== vcaGroupId;
    if (!groupMembershipChanged && !trackMembershipChanged) {
        return false;
    }

    if (groupMembershipChanged) {
        setVcaGroupsState(updatedGroups);
    }

    if (trackMembershipChanged) {
        updateTrack(trackId, (currentTrack) => ({ ...currentTrack, vcaGroupId }));
    }

    return true;
}
