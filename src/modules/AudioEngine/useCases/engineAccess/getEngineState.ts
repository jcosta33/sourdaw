import { inject } from '#/infra/di/inject';

import { type AudioEngineState } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getEngineState = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getEngineState(): AudioEngineState {
            return audioEngine.getState();
        }
);
