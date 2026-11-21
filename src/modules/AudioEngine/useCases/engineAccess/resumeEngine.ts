import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const resumeEngine = inject({ audioEngine })(
    ({ audioEngine }) =>
        function resumeEngine(): Promise<void> {
            return audioEngine.resume();
        }
);
