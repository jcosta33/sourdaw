import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const setBusGain = inject({ audioEngine })(
    ({ audioEngine }) =>
        function setBusGain(busId: string, gain: number): void {
            audioEngine.setBusGain(busId, gain);
        }
);
