import { inject } from '#/infra/di/inject';

import { type RuntimeGraphTopologyValidator } from '../models/RuntimeGraphDelta';
import { audioEngine } from '../repositories/createWebAudioEngine';

/** Binds project-owned topology validation without giving AudioEngine project-store access. */
export const configureRuntimeGraphTopologyValidator = inject({ audioEngine })(
    ({ audioEngine }) =>
        function configureRuntimeGraphTopologyValidator(validator: RuntimeGraphTopologyValidator | null): void {
            audioEngine.setRuntimeGraphTopologyValidator(validator);
        }
);
