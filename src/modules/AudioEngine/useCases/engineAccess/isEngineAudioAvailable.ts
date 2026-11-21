import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

/** False when the engine fell back to its silent shim and no tap carries signal. */
export const isEngineAudioAvailable = inject({ audioEngine })(
    ({ audioEngine }) =>
        function isEngineAudioAvailable(): boolean {
            return audioEngine.isAudioAvailable();
        }
);
