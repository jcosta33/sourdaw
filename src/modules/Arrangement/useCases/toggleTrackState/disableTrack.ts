import { setTrackMute as engineSetTrackMute } from '#/modules/AudioEngine/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';

export function disableTrack(trackId: string, disabled: boolean): void {
    const track = getTrackById(trackId);
    updateTrack(trackId, (t) => ({ ...t, disabled }));

    if (disabled) {
        engineSetTrackMute(trackId, true);
    } else {
        engineSetTrackMute(trackId, track?.muted ?? false);
    }
}
