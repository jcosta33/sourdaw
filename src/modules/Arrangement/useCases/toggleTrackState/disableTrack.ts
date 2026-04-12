import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackById } from '../../repositories/track/getTrackById';
import { setTrackMute as engineSetTrackMute } from '#/modules/AudioEngine/useCases';

export function disableTrack(trackId: string, disabled: boolean): void {
    const track = getTrackById(trackId);
    updateTrack(trackId, (t) => ({ ...t, disabled }));

    if (disabled) {
        engineSetTrackMute(trackId, true);
    } else {
        engineSetTrackMute(trackId, track?.muted ?? false);
    }
}
