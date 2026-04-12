import { updateTrack } from '../../repositories/track/updateTrack';
import { applySoloLogic } from '../../services/applySoloLogic';

export function soloTrack(trackId: string, soloed: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, soloed }));
    applySoloLogic();
}
