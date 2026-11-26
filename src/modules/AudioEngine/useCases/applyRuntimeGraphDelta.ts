import { inject } from '#/infra/di/inject';

import { type RuntimeGraphDeltaResult } from '../models/RuntimeGraphDelta';
import { audioEngine } from '../repositories/createWebAudioEngine';

export const applyRuntimeGraphDelta = inject({ audioEngine })(
    ({ audioEngine }) =>
        function applyRuntimeGraphDelta(delta: unknown): RuntimeGraphDeltaResult {
            return audioEngine.applyRuntimeGraphDelta(delta);
        }
);
