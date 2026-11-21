import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const setTrackPan = inject({ audioEngine })(
    ({ audioEngine }) =>
        function setTrackPan(trackId: string, pan: number): void {
            audioEngine.setTrackPan(trackId, pan);
        }
);
