import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { applyRuntimeGraphDelta } from '../applyRuntimeGraphDelta';

import type { AudioEngine } from '../../models/AudioEngineState';
import type { RuntimeGraphDeltaResult } from '../../models/RuntimeGraphDelta';

describe('applyRuntimeGraphDelta', () => {
    it('should hand the delta to the engine and return the engine result unchanged', () => {
        const rejected: RuntimeGraphDeltaResult = {
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'stale project revision',
        };
        const engineApply = vi.fn<AudioEngine['applyRuntimeGraphDelta']>(() => rejected);
        const engine: Pick<AudioEngine, 'applyRuntimeGraphDelta'> = { applyRuntimeGraphDelta: engineApply };
        const run = injectDependencies(applyRuntimeGraphDelta, { audioEngine: engine });
        const delta = { nodes: ['track-1'] };

        const result = run(delta);

        expect(engineApply).toHaveBeenCalledTimes(1);
        expect(engineApply).toHaveBeenCalledWith(delta);
        expect(result).toBe(rejected);
    });
});
