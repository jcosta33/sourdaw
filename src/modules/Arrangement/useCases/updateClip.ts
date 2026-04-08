import { inject } from '#/infra/di/inject';
import { updateClip as repoUpdateClip } from '../repositories/track/updateClip';
import { type Clip } from '../models/Track';

export const updateClip = inject({ repoUpdateClip })(
    ({ repoUpdateClip }) =>
        function updateClip(clipId: string, updater: (clip: Clip) => Clip): void {
            repoUpdateClip(clipId, updater);
        }
);
