import { inject } from '#/infra/di/inject';
import { getVcaGroupsState, setVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export const removeFromVca = inject({ updateTrack })(
    ({ updateTrack }) =>
        function removeFromVca(trackId: string): void {
            setVcaGroupsState(
                getVcaGroupsState().map((g) => ({
                    ...g,
                    trackIds: g.trackIds.filter((id) => id !== trackId),
                }))
            );

            updateTrack(trackId, (t) => ({ ...t, vcaGroupId: null }));
        }
);
