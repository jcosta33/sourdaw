import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getRuntimeGraphRevision } from '../getRuntimeGraphRevision';

import type { AudioEngine } from '../../models/AudioEngineState';

describe('getRuntimeGraphRevision', () => {
    it('should return the revision the engine reports', () => {
        const engineGetRevision = vi.fn<AudioEngine['getRuntimeGraphRevision']>(() => 42);
        const engine: Pick<AudioEngine, 'getRuntimeGraphRevision'> = { getRuntimeGraphRevision: engineGetRevision };
        const run = injectDependencies(getRuntimeGraphRevision, { audioEngine: engine });

        expect(run()).toBe(42);
        expect(engineGetRevision).toHaveBeenCalledTimes(1);
    });
});
