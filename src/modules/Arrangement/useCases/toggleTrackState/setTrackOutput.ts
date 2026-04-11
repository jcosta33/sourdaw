import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { setTrackOutput as engineSetTrackOutput } from '#/modules/AudioEngine/useCases';

export function setTrackOutput(trackId: string, outputId: string): void {
    updateTrack(trackId, (t) => ({ ...t, outputId }));
    engineSetTrackOutput(trackId, outputId);
}
