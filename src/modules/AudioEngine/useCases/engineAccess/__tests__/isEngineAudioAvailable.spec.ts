import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { isEngineAudioAvailable } from '../isEngineAudioAvailable';

import type { AudioEngine } from '../../../models/AudioEngineState';

describe('isEngineAudioAvailable', () => {
    it.each([true, false])('should report %s when the engine reports it', (available) => {
        const engineIsAvailable = vi.fn<AudioEngine['isAudioAvailable']>(() => available);
        const engine: Pick<AudioEngine, 'isAudioAvailable'> = { isAudioAvailable: engineIsAvailable };
        const run = injectDependencies(isEngineAudioAvailable, { audioEngine: engine });

        expect(run()).toBe(available);
        expect(engineIsAvailable).toHaveBeenCalledTimes(1);
    });
});
