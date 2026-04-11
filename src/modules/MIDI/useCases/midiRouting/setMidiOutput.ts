import { updateTrack } from '#/modules/Arrangement/useCases';

export function setMidiOutput(trackId: string, destinationTrackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: destinationTrackId }));
}