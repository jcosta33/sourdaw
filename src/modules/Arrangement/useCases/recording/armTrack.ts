import { setMidiInputTrack } from '#/modules/AudioEngine/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';

export function armTrack(trackId: string, armed: boolean): void {
    updateTrack(trackId, (time) => ({ ...time, armed }));

    if (armed) {
        const track = getTrackById(trackId);
        if (track && track.kind === 'midi') {
            setMidiInputTrack(trackId);
        }
    }
}
