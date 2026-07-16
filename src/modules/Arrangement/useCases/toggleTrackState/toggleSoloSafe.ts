import { updateTrack } from '../../repositories/track/updateTrack';

import { applySoloLogic } from './applySoloLogic';

export function toggleSoloSafe(trackId: string): void {
    updateTrack(trackId, (time) => ({ ...time, soloSafe: !time.soloSafe }));
    applySoloLogic();
}
