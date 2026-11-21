import { inject } from '#/infra/di/inject';

import { type RuntimeGraphProjectRevisionValidator } from '../models/RuntimeGraphDelta';
import { audioEngine } from '../repositories/createWebAudioEngine';

/**
 * Binds project freshness at composition time without giving AudioEngine a
 * dependency on the CRDT document or its stores.
 */
export const configureRuntimeGraphProjectRevisionValidator = inject({ audioEngine })(
    ({ audioEngine }) =>
        function configureRuntimeGraphProjectRevisionValidator(
            validator: RuntimeGraphProjectRevisionValidator | null
        ): void {
            audioEngine.setRuntimeGraphProjectRevisionValidator(validator);
        }
);
