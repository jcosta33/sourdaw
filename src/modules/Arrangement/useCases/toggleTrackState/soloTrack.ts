import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export const soloTrack = inject({ updateTrack })(
    ({ updateTrack }) =>
        function soloTrack(trackId: string, soloed: boolean): void {
            updateTrack(trackId, (t) => ({ ...t, soloed }));
            applySoloLogic();
        }
);
