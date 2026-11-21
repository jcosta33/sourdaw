import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getCurrentTime = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getCurrentTime(): number {
            return audioEngine.context.currentTime;
        }
);
