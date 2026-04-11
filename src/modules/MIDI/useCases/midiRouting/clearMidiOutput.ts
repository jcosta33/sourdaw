import { updateTrack } from '#/modules/Arrangement/useCases';

export function clearMidiOutput(trackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: null }));
}