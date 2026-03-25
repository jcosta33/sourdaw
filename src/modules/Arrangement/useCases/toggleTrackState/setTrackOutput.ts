import { updateTrack } from '#/modules/Arrangement/repositories/track';
import { setTrackOutput as engineSetTrackOutput } from '#/modules/AudioEngine/useCases/trackAudioControls';

export function setTrackOutput(trackId: string, outputId: string): void {
    updateTrack(trackId, (t) => ({ ...t, outputId }));
    engineSetTrackOutput(trackId, outputId);
}
