import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { initializeTrackStripFromSnapshot } from '../initializeTrackStripFromSnapshot';

import type { AudioEngine } from '../../models/AudioEngineState';
import type { RuntimeGraphDeltaResult } from '../../models/RuntimeGraphDelta';

describe('initializeTrackStripFromSnapshot', () => {
    it('should hand the snapshot to the engine and return the engine result unchanged', () => {
        const rejected: RuntimeGraphDeltaResult = {
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'snapshot does not match the live strip',
        };
        const engineInitialize = vi.fn<AudioEngine['initializeTrackStripFromSnapshot']>(() => rejected);
        const engine: Pick<AudioEngine, 'initializeTrackStripFromSnapshot'> = {
            initializeTrackStripFromSnapshot: engineInitialize,
        };
        const run = injectDependencies(initializeTrackStripFromSnapshot, { audioEngine: engine });
        const snapshot = { trackId: 'track-1' };

        const result = run(snapshot);

        expect(engineInitialize).toHaveBeenCalledTimes(1);
        expect(engineInitialize).toHaveBeenCalledWith(snapshot);
        expect(result).toBe(rejected);
    });
});
