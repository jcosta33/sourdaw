import { updateTrackState } from '../../repositories/track/updateTrackState';
import { getTrackById } from '../../repositories/track/getTrackById';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases';

export function selectTrack(trackId: string | null): void {
    updateTrackState({ selectedTrackId: trackId });

    if (trackId) {
        const track = getTrackById(trackId);
        if (track && track.kind === 'midi') {
            setMidiInputTrack(trackId);
        }
    }
}
