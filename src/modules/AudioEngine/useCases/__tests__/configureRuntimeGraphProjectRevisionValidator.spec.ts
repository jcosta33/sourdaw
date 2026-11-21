import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { configureRuntimeGraphProjectRevisionValidator } from '../configureRuntimeGraphProjectRevisionValidator';

import type { AudioEngine } from '../../models/AudioEngineState';

describe('configureRuntimeGraphProjectRevisionValidator', () => {
    it('should install the validator on the engine', () => {
        const engineSet = vi.fn<AudioEngine['setRuntimeGraphProjectRevisionValidator']>();
        const engine: Pick<AudioEngine, 'setRuntimeGraphProjectRevisionValidator'> = {
            setRuntimeGraphProjectRevisionValidator: engineSet,
        };
        const run = injectDependencies(configureRuntimeGraphProjectRevisionValidator, { audioEngine: engine });
        const validator = (expectedProjectRevision: string) => expectedProjectRevision === 'rev-1';

        run(validator);

        expect(engineSet).toHaveBeenCalledTimes(1);
        expect(engineSet).toHaveBeenCalledWith(validator);
    });

    it('should clear the validator when given null', () => {
        const engineSet = vi.fn<AudioEngine['setRuntimeGraphProjectRevisionValidator']>();
        const engine: Pick<AudioEngine, 'setRuntimeGraphProjectRevisionValidator'> = {
            setRuntimeGraphProjectRevisionValidator: engineSet,
        };
        const run = injectDependencies(configureRuntimeGraphProjectRevisionValidator, { audioEngine: engine });

        run(null);

        expect(engineSet).toHaveBeenCalledWith(null);
    });
});
