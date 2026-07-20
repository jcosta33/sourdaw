import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function removeFromVca(trackId: string): boolean {
    const groups = getVcaGroupsState();
    const updatedGroups = groups.map((group) => {
        const trackIds = group.trackIds.filter((id) => id !== trackId);
        if (trackIds.length === group.trackIds.length) {
            return group;
        }

        return { ...group, trackIds };
    });
    const groupMembershipChanged = updatedGroups.some((group, index) => group !== groups[index]);
    const track = getTrackById(trackId);
    const trackMembershipChanged = track !== undefined && (track.vcaGroupId ?? null) !== null;
    if (!groupMembershipChanged && !trackMembershipChanged) {
        return false;
    }

    if (groupMembershipChanged) {
        setVcaGroupsState(updatedGroups);
    }

    if (trackMembershipChanged) {
        updateTrack(trackId, (currentTrack) => ({ ...currentTrack, vcaGroupId: null }));
    }

    return true;
}
