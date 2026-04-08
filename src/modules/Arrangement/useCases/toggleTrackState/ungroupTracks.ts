import { inject } from '#/infra/di/inject';
import { mapAllTracks } from '#/modules/Arrangement/repositories/track/mapAllTracks';

export const ungroupTracks = inject({ mapAllTracks })(
    ({ mapAllTracks }) =>
        function ungroupTracks(groupId: string): void {
            mapAllTracks((t) => (t.groupId === groupId ? { ...t, groupId: null } : t));
        }
);
