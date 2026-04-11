import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { setTrackMute as engineSetTrackMute } from '#/modules/AudioEngine/useCases';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

export const muteTrack = inject({ updateTrack })(
    ({ updateTrack }) =>
        function muteTrack(trackId: string, muted: boolean): void {
            updateTrack(trackId, (t) => ({ ...t, muted }));
            engineSetTrackMute(trackId, muted);
            applySoloLogic();
        }
);
