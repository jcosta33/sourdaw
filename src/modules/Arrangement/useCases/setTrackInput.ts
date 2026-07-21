import { getTrackById } from '../repositories/track/getTrackById';
import { updateTrack } from '../repositories/track/updateTrack';
import { getTrackEligibility } from '../stores/trackEligibility';

export function setTrackInput(trackId: string, inputId: string | null): boolean {
    const track = getTrackById(trackId);
    if (track && !getTrackEligibility(track.kind).acceptsInput && inputId !== null) {
        return false;
    }
    updateTrack(trackId, (time) => ({ ...time, inputId }));
    return true;
}
