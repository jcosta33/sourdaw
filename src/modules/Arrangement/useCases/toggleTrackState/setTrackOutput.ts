import { setTrackOutput as engineSetTrackOutput } from '#/modules/AudioEngine/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';

export function setTrackOutput(trackId: string, outputId: string): boolean {
    const track = getTrackById(trackId);
    if (track && !getTrackEligibility(track.kind).acceptsOutput) {
        return false;
    }

    const targetTrack = getTrackById(outputId);
    if (targetTrack && !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
        return false;
    }

    updateTrack(trackId, (time) => ({ ...time, outputId }));
    engineSetTrackOutput(trackId, outputId);
    return true;
}
