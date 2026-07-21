import { getMidiInputTrack, setMidiInputTrack } from '#/modules/MIDI/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';

export function armTrack(trackId: string, armed: boolean): void {
    updateTrack(trackId, (time) => ({ ...time, armed }));

    if (armed) {
        const track = getTrackById(trackId);
        if (track && track.kind === 'midi') {
            setMidiInputTrack(trackId);
        }
        return;
    }

    // Disarming must not leave live WebMIDI input routed to a disarmed track.
    // Clear only when the routing still points at this track — another track
    // armed since must keep its routing.
    if (getMidiInputTrack() === trackId) {
        setMidiInputTrack(null);
    }
}
