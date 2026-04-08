import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export const toggleChordTrackFollow = inject({ updateTrack })(
    ({ updateTrack }) =>
        function toggleChordTrackFollow(trackId: string): void {
            updateTrack(trackId, (track) => ({
                ...track,
                followChordTrack: !track.followChordTrack,
            }));
        }
);
