import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const setTrackGain = inject({ audioEngine })(
    ({ audioEngine }) =>
        function setTrackGain(trackId: string, gain: number): void {
            audioEngine.setTrackGain(trackId, gain);
        }
);
