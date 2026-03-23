import { updateTrackState, getTrackById } from '#/modules/Track/repositories/trackRepository';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases/webMidiInput';

export function selectTrack(trackId: string | null): void {
    updateTrackState({ selectedTrackId: trackId });

    if (trackId) {
        const track = getTrackById(trackId);
        if (track && track.kind === 'midi') {
            setMidiInputTrack(trackId);
        }
    }
}
