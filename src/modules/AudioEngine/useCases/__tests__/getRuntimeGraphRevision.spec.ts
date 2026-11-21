import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getRuntimeGraphRevision } from '../getRuntimeGraphRevision';

import type { AudioEngine } from '../../models/AudioEngineState';

describe('getRuntimeGraphRevision', () => {
    it.each([0, 42])('should return the revision %s the engine reports', (revision) => {
        const engineGetRevision = vi.fn<AudioEngine['getRuntimeGraphRevision']>(() => revision);
        const engine: Pick<AudioEngine, 'getRuntimeGraphRevision'> = { getRuntimeGraphRevision: engineGetRevision };
        const run = injectDependencies(getRuntimeGraphRevision, { audioEngine: engine });

        expect(run()).toBe(revision);
        expect(engineGetRevision).toHaveBeenCalledTimes(1);
    });
});
