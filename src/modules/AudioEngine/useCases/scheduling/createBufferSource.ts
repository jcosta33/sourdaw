import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const createBufferSource = inject({ audioEngine })(
    ({ audioEngine }) =>
        function createBufferSource(): AudioBufferSourceNode {
            return audioEngine.context.createBufferSource();
        }
);
