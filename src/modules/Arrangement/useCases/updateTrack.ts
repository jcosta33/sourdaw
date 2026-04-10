import { inject } from '#/infra/di/inject';
import { updateTrack as repoUpdateTrack } from '../repositories/track/updateTrack';
import { type Track } from '../stores/trackStore';

export const updateTrack = inject({ repoUpdateTrack })(
    ({ repoUpdateTrack }) =>
        function updateTrack(trackId: string, updater: (track: Track) => Track): void {
            repoUpdateTrack(trackId, updater);
        }
);
