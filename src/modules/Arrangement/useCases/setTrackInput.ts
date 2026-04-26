import { updateTrack } from '../repositories/track/updateTrack';

export function setTrackInput(trackId: string, inputId: string | null): void {
    updateTrack(trackId, (time) => ({ ...time, inputId }));
}
