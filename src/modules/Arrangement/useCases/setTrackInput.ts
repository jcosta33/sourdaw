import { updateTrack } from '../repositories/track';

export function setTrackInput(trackId: string, inputId: string | null): void {
    updateTrack(trackId, (t) => ({ ...t, inputId }));
}
