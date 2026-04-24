import { updateTracks } from '../../repositories/track/updateTracks';
import { getVcaGroupsState, setVcaGroupsState, type VcaGroup } from '../../stores/vcaGroupStore';

export function createVcaGroup(name: string, trackIds: string[]): VcaGroup {
    const group: VcaGroup = {
        id: `vca-${crypto.randomUUID().slice(0, 8)}`,
        name,
        gain: 1.0,
        muted: false,
        trackIds: [...trackIds],
    };
    setVcaGroupsState([...getVcaGroupsState(), group]);

    updateTracks(
        (time) => trackIds.includes(time.id),
        (time) => ({ ...time, vcaGroupId: group.id })
    );

    return group;
}
