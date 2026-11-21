import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const stopAllScheduled = inject({ audioEngine })(
    ({ audioEngine }) =>
        function stopAllScheduled(): void {
            audioEngine.stopAllScheduled();
        }
);
