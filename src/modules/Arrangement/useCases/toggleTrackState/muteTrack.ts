import { setTrackMute as engineSetTrackMute } from '#/modules/AudioEngine/useCases';

import { updateTrack } from '../../repositories/track/updateTrack';

import { applySoloLogic } from './applySoloLogic';

export function muteTrack(trackId: string, muted: boolean): void {
    updateTrack(trackId, (time) => ({ ...time, muted }));
    engineSetTrackMute(trackId, muted);
    applySoloLogic();
}
