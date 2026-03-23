import { updateTrack } from '#/modules/Track/repositories/trackRepository';
import { applySoloLogic } from '#/modules/Track/helpers/applySoloLogic';

export function soloTrack(trackId: string, soloed: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, soloed }));
    applySoloLogic();
}
