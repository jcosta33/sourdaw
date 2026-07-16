import { updateTrack } from '../../repositories/track/updateTrack';

import { applySoloLogic } from './applySoloLogic';

export function soloTrack(trackId: string, soloed: boolean): void {
    updateTrack(trackId, (time) => ({ ...time, soloed }));
    applySoloLogic();
}
