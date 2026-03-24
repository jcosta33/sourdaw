import { updateTrack } from '#/modules/Arrangement/repositories/trackRepository';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export function toggleSoloSafe(trackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, soloSafe: !t.soloSafe }));
    applySoloLogic();
}
