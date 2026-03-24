import { updateTrack } from '#/modules/Arrangement/repositories/trackRepository';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export function soloTrack(trackId: string, soloed: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, soloed }));
    applySoloLogic();
}
