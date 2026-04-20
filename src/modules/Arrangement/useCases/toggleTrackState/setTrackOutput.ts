import { setTrackOutput as engineSetTrackOutput } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../../repositories/track/updateTrack';

export function setTrackOutput(trackId: string, outputId: string): void {
    updateTrack(trackId, (t) => ({ ...t, outputId }));
    engineSetTrackOutput(trackId, outputId);
}
