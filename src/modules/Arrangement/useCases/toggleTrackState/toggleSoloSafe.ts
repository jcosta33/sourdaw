import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export const toggleSoloSafe = inject({ updateTrack })(
    ({ updateTrack }) =>
        function toggleSoloSafe(trackId: string): void {
            updateTrack(trackId, (t) => ({ ...t, soloSafe: !t.soloSafe }));
            applySoloLogic();
        }
);
