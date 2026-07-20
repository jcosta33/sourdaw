import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTracks } from '../../repositories/track/updateTracks';
import { getVcaGroupsState, setVcaGroupsState, type VcaGroup } from '../../stores/vcaGroupStore';

export function createVcaGroup(name: string, trackIds: string[]): VcaGroup {
    const validTrackIds = [...new Set(trackIds)].filter((trackId) => getTrackById(trackId) !== undefined);
    const validTrackIdSet = new Set(validTrackIds);
    const group: VcaGroup = {
        id: `vca-${crypto.randomUUID().slice(0, 8)}`,
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
