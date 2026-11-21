import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const setTrackMute = inject({ audioEngine })(
    ({ audioEngine }) =>
        function setTrackMute(trackId: string, muted: boolean): void {
            audioEngine.setTrackMute(trackId, muted);
        }
);
