import { inject } from '#/infra/di/inject';

import { type RuntimeGraphDeltaResult } from '../models/RuntimeGraphDelta';
import { audioEngine } from '../repositories/createWebAudioEngine';

/** Applies only the validated, immutable live-strip baseline used by rehydration. */
export const initializeTrackStripFromSnapshot = inject({ audioEngine })(
    ({ audioEngine }) =>
        function initializeTrackStripFromSnapshot(snapshot: unknown): RuntimeGraphDeltaResult {
            return audioEngine.initializeTrackStripFromSnapshot(snapshot);
        }
);
