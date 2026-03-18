import { updateTrack } from '../repositories/trackRepository';

export function setTrackInput(trackId: string, inputId: string | null): void {
    updateTrack(trackId, (t) => ({ ...t, inputId }));
}
