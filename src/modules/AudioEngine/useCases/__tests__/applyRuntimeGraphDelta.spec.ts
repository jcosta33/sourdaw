import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { applyRuntimeGraphDelta } from '../applyRuntimeGraphDelta';

import type { AudioEngine } from '../../models/AudioEngineState';
import type { RuntimeGraphDeltaResult } from '../../models/RuntimeGraphDelta';

describe('applyRuntimeGraphDelta', () => {
    it.each([
        [{ nodes: ['track-1'] }, 'stale project revision'],
        [{ nodes: ['track-2', 'bus-a'] }, 'topology mismatch'],
    ])('should hand the delta %j to the engine and return the engine result unchanged', (delta, reason) => {
        const rejected: RuntimeGraphDeltaResult = { acceptance: 'rejected', application: 'not-applied', reason };
        const engineApply = vi.fn<AudioEngine['applyRuntimeGraphDelta']>(() => rejected);
        const engine: Pick<AudioEngine, 'applyRuntimeGraphDelta'> = { applyRuntimeGraphDelta: engineApply };
        const run = injectDependencies(applyRuntimeGraphDelta, { audioEngine: engine });

        const result = run(delta);

        expect(engineApply).toHaveBeenCalledTimes(1);
        expect(engineApply).toHaveBeenCalledWith(delta);
        expect(result).toBe(rejected);
    });
});
