import { mapAllTracks } from '#/modules/Arrangement/repositories/track';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export function clearSolos(): void {
    mapAllTracks((t) => ({ ...t, soloed: false }));
    applySoloLogic();
}
