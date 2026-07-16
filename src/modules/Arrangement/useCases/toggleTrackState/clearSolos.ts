import { mapAllTracks } from '../../repositories/track/mapAllTracks';

import { applySoloLogic } from './applySoloLogic';

export function clearSolos(): void {
    mapAllTracks((time) => ({ ...time, soloed: false }));
    applySoloLogic();
}
