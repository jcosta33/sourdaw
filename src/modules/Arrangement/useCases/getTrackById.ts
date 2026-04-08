import { inject } from '#/infra/di/inject';
import { getTrackById as repoGetTrackById } from '../repositories/track/getTrackById';
import { type Track } from '../models/Track';

export const getTrackById = inject({ repoGetTrackById })(
    ({ repoGetTrackById }) =>
        function getTrackById(trackId: string): Track | undefined {
            return repoGetTrackById(trackId);
        }
);
