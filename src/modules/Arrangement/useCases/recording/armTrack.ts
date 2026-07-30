import { getMidiInputTrack, setMidiInputTrack } from '#/modules/MIDI/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';

export function armTrack(trackId: string, armed: boolean): boolean {
    const track = getTrackById(trackId);
    if (!track || track.armed === armed) {
        return false;
    }
    if (armed && !getTrackEligibility(track.kind).acceptsArm) {
        return false;
    }

    updateTrack(trackId, (time) => ({ ...time, armed }));

    if (armed) {
        if (track.kind === 'midi') {
            setMidiInputTrack(trackId);
        }
        return true;
    }

    // Disarming must not leave live WebMIDI input routed to a disarmed track.
    // Clear only when the routing still points at this track — another track
    // armed since must keep its routing.
    if (getMidiInputTrack() === trackId) {
        setMidiInputTrack(null);
    }
    return true;
}
