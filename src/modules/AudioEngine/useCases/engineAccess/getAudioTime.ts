import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getAudioTime = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getAudioTime(): number {
            return audioEngine.context?.currentTime ?? 0;
        }
);
