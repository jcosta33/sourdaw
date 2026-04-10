import { inject } from '#/infra/di/inject';
import { getTrackById as repoGetTrackById } from '../repositories/track/getTrackById';
import { type Track } from '../stores/trackStore';

export const getTrackById = inject({ repoGetTrackById })(
    ({ repoGetTrackById }) =>
        function getTrackById(trackId: string): Track | undefined {
            return repoGetTrackById(trackId);
        }
);
