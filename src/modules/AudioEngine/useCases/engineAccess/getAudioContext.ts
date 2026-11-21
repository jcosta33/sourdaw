import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getAudioContext = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getAudioContext(): AudioContext {
            return audioEngine.context;
        }
);

export { audioEngine };
