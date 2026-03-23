import { getVcaGroupsState, setVcaGroupsState, type VcaGroup } from '#/modules/Track/stores/vcaGroupStore';
import { updateTracks } from '#/modules/Track/repositories/trackRepository';

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
        (t) => trackIds.includes(t.id),
        (t) => ({ ...t, vcaGroupId: group.id })
    );

    return group;
}
