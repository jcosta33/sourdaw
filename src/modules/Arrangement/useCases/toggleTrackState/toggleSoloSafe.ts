import { updateTrack } from '../../repositories/track/updateTrack';
import { applySoloLogic } from '../../services/applySoloLogic';

export function toggleSoloSafe(trackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, soloSafe: !t.soloSafe }));
    applySoloLogic();
}
