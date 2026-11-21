import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { initializeTrackStripFromSnapshot } from '../initializeTrackStripFromSnapshot';

import type { AudioEngine } from '../../models/AudioEngineState';
import type { RuntimeGraphDeltaResult } from '../../models/RuntimeGraphDelta';

describe('initializeTrackStripFromSnapshot', () => {
    it.each([
        [{ trackId: 'track-1' }, 'snapshot does not match the live strip'],
        [{ trackId: 'track-2' }, 'strip already exists'],
    ])('should hand the snapshot %j to the engine and return the engine result unchanged', (snapshot, reason) => {
        const rejected: RuntimeGraphDeltaResult = { acceptance: 'rejected', application: 'not-applied', reason };
        const engineInitialize = vi.fn<AudioEngine['initializeTrackStripFromSnapshot']>(() => rejected);
        const engine: Pick<AudioEngine, 'initializeTrackStripFromSnapshot'> = {
            initializeTrackStripFromSnapshot: engineInitialize,
        };
        const run = injectDependencies(initializeTrackStripFromSnapshot, { audioEngine: engine });

        const result = run(snapshot);

        expect(engineInitialize).toHaveBeenCalledTimes(1);
        expect(engineInitialize).toHaveBeenCalledWith(snapshot);
        expect(result).toBe(rejected);
    });
});
