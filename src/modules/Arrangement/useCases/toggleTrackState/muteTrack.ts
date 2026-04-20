import { setTrackMute as engineSetTrackMute } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../../repositories/track/updateTrack';
import { applySoloLogic } from '../../services/applySoloLogic';

export function muteTrack(trackId: string, muted: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, muted }));
    engineSetTrackMute(trackId, muted);
    applySoloLogic();
}
