import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTracks } from '../../repositories/track/updateTracks';
import { getVcaGroupsState, setVcaGroupsState, type VcaGroup } from '../../stores/vcaGroupStore';

export function createVcaGroup(name: string, trackIds: string[], vcaGroupId?: string): VcaGroup {
    const validTrackIds = [...new Set(trackIds)].filter((trackId) => getTrackById(trackId) !== undefined);
    const validTrackIdSet = new Set(validTrackIds);
    const groupId = vcaGroupId ?? `vca-${crypto.randomUUID().slice(0, 8)}`;
    if (getVcaGroupsState().some((existingGroup) => existingGroup.id === groupId)) {
        throw new Error(`VCA group id already exists: ${groupId}`);
    }

    const group: VcaGroup = {
        id: groupId,
        name,
        gain: 1.0,
        muted: false,
        trackIds: validTrackIds,
    };
    const groupsWithoutReassignedTracks = getVcaGroupsState().map((existingGroup) => ({
        ...existingGroup,
        trackIds: existingGroup.trackIds.filter((trackId) => !validTrackIdSet.has(trackId)),
    }));
    setVcaGroupsState([...groupsWithoutReassignedTracks, group]);

    updateTracks(
        (track) => validTrackIdSet.has(track.id),
        (track) => ({ ...track, vcaGroupId: group.id })
    );

    return group;
}
