import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { applySoloLogic } from '../../services/applySoloLogic';

export function clearSolos(): void {
    mapAllTracks((t) => ({ ...t, soloed: false }));
    applySoloLogic();
}
