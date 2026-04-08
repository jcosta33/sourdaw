import { inject } from '#/infra/di/inject';
import { mapAllTracks } from '#/modules/Arrangement/repositories/track/mapAllTracks';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export const clearSolos = inject({ mapAllTracks })(
    ({ mapAllTracks }) =>
        function clearSolos(): void {
            mapAllTracks((t) => ({ ...t, soloed: false }));
            applySoloLogic();
        }
);
