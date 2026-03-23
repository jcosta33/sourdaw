import { updateTrack } from '#/modules/Track/repositories/trackRepository';
import { applySoloLogic } from '#/modules/Track/helpers/applySoloLogic';

export function toggleSoloSafe(trackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, soloSafe: !t.soloSafe }));
    applySoloLogic();
}
