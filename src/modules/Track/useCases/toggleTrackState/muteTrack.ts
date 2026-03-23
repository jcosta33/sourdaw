import { updateTrack } from '#/modules/Track/repositories/trackRepository';
import { setTrackMute as engineSetTrackMute } from '#/modules/AudioEngine/useCases/trackAudioControls';
import { applySoloLogic } from '#/modules/Track/helpers/applySoloLogic';

export function muteTrack(trackId: string, muted: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, muted }));
    engineSetTrackMute(trackId, muted);
    applySoloLogic();
}
