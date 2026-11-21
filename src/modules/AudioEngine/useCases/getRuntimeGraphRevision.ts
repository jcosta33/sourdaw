import { inject } from '#/infra/di/inject';

import { audioEngine } from '../repositories/createWebAudioEngine';

export const getRuntimeGraphRevision = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getRuntimeGraphRevision(): number {
            return audioEngine.getRuntimeGraphRevision();
        }
);
