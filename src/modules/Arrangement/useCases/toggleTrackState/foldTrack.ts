import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export const foldTrack = inject({ updateTrack })(
    ({ updateTrack }) =>
        function foldTrack(trackId: string, folded: boolean): void {
            updateTrack(trackId, (t) => ({ ...t, collapsed: folded }));
        }
);
