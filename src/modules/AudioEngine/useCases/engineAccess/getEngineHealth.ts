import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

import type { AudioEngineHealth } from '../../models/AudioEngineState';

export const getEngineHealth = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getEngineHealth(): AudioEngineHealth {
            return audioEngine.getHealth();
        }
);
