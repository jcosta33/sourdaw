import { inject } from '#/infra/di/inject';
import { getVcaGroupsState, setVcaGroupsState, type VcaGroup } from '#/modules/Arrangement/stores/vcaGroupStore';
import { updateTracks } from '#/modules/Arrangement/repositories/track/updateTracks';

export const createVcaGroup = inject({ updateTracks })(
    ({ updateTracks }) =>
        function createVcaGroup(name: string, trackIds: string[]): VcaGroup {
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
);
