import { updateTrack } from '#/modules/Arrangement/repositories/track';
import { setTrackMute as engineSetTrackMute } from '#/modules/AudioEngine/useCases/trackAudioControls';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export function muteTrack(trackId: string, muted: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, muted }));
    engineSetTrackMute(trackId, muted);
    applySoloLogic();
}
