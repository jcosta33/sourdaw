import { mapAllTracks } from '#/modules/Track/repositories/trackRepository';
import { applySoloLogic } from '#/modules/Track/helpers/applySoloLogic';

export function clearSolos(): void {
    mapAllTracks((t) => ({ ...t, soloed: false }));
    applySoloLogic();
}
