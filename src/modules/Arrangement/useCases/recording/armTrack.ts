import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackById } from '../../repositories/track/getTrackById';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases';

export function armTrack(trackId: string, armed: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, armed }));

    if (armed) {
        const track = getTrackById(trackId);
        if (track && track.kind === 'midi') {
            setMidiInputTrack(trackId);
        }
    }
}