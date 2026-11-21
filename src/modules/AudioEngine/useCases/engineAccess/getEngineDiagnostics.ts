import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

import type { AudioEngineDiagnostics } from '../../models/AudioEngineState';

export const getEngineDiagnostics = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getEngineDiagnostics(): AudioEngineDiagnostics {
            return audioEngine.getDiagnostics();
        }
);
