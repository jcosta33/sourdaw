import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export function toggleSoloSafe(trackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, soloSafe: !t.soloSafe }));
    applySoloLogic();
}
