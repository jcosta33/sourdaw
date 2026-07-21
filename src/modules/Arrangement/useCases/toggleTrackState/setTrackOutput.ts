import { setTrackOutput as engineSetTrackOutput } from '#/modules/AudioEngine/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';

export function setTrackOutput(trackId: string, outputId: string): void {
    const track = getTrackById(trackId);
    if (track && !getTrackEligibility(track.kind).acceptsOutput) {
        return;
    }
    updateTrack(trackId, (time) => ({ ...time, outputId }));
    engineSetTrackOutput(trackId, outputId);
}
