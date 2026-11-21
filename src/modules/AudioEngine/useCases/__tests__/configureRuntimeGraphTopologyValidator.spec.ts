import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { configureRuntimeGraphTopologyValidator } from '../configureRuntimeGraphTopologyValidator';

import type { AudioEngine } from '../../models/AudioEngineState';

describe('configureRuntimeGraphTopologyValidator', () => {
    it('should install the validator on the engine', () => {
        const engineSet = vi.fn<AudioEngine['setRuntimeGraphTopologyValidator']>();
        const engine: Pick<AudioEngine, 'setRuntimeGraphTopologyValidator'> = {
            setRuntimeGraphTopologyValidator: engineSet,
        };
        const run = injectDependencies(configureRuntimeGraphTopologyValidator, { audioEngine: engine });
        const validator = (nodes: readonly unknown[]) => nodes.length === 0;

        run(validator);

        expect(engineSet).toHaveBeenCalledTimes(1);
        expect(engineSet).toHaveBeenCalledWith(validator);
    });

    it('should clear the validator when given null', () => {
        const engineSet = vi.fn<AudioEngine['setRuntimeGraphTopologyValidator']>();
        const engine: Pick<AudioEngine, 'setRuntimeGraphTopologyValidator'> = {
            setRuntimeGraphTopologyValidator: engineSet,
        };
        const run = injectDependencies(configureRuntimeGraphTopologyValidator, { audioEngine: engine });

        run(null);

        expect(engineSet).toHaveBeenCalledWith(null);
    });
});
