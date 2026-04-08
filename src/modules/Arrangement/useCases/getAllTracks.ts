import { inject } from '#/infra/di/inject';
import { getAllTracks as repoGetAllTracks } from '../repositories/track/getAllTracks';
import { type Track } from '../models/Track';

export const getAllTracks = inject({ repoGetAllTracks })(
    ({ repoGetAllTracks }) =>
        function getAllTracks(): Track[] {
            return repoGetAllTracks();
        }
);
