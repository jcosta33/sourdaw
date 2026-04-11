import { updateTrack } from '../../repositories/track/updateTrack';

export function setTrackNotes(trackId: string, notes: string): void {
    updateTrack(trackId, (t) => ({ ...t, notes }));
}