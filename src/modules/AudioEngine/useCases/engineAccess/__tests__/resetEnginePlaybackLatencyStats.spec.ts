import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { resetEnginePlaybackLatencyStats } from '../resetEnginePlaybackLatencyStats';

import type { AudioEngine } from '../../../models/AudioEngineState';

describe('resetEnginePlaybackLatencyStats', () => {
    it('should start a new measurement window on the engine', () => {
        const engineReset = vi.fn<AudioEngine['resetPlaybackLatencyStats']>();
        const engine: Pick<AudioEngine, 'resetPlaybackLatencyStats'> = { resetPlaybackLatencyStats: engineReset };
        const run = injectDependencies(resetEnginePlaybackLatencyStats, { audioEngine: engine });

        run();

        expect(engineReset).toHaveBeenCalledTimes(1);
    });
});
