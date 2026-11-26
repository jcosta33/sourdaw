import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { setTrackSoloGate } from '../setTrackSoloGate';

import type { AudioEngine } from '../../../models/AudioEngineState';

const createEngine = () => {
    const engineSetTrackSoloGate = vi.fn<AudioEngine['setTrackSoloGate']>();
    const engine: Pick<AudioEngine, 'setTrackSoloGate'> = { setTrackSoloGate: engineSetTrackSoloGate };
    return { engine, engineSetTrackSoloGate };
};

describe('setTrackSoloGate', () => {
    it('should forward a closed gate for the track to the engine', () => {
        const { engine, engineSetTrackSoloGate } = createEngine();
        const run = injectDependencies(setTrackSoloGate, { audioEngine: engine });

        run('track-1', true);

        expect(engineSetTrackSoloGate).toHaveBeenCalledTimes(1);
        expect(engineSetTrackSoloGate).toHaveBeenCalledWith('track-1', true);
    });

    it('should forward an opened gate with the same track id', () => {
        const { engine, engineSetTrackSoloGate } = createEngine();
        const run = injectDependencies(setTrackSoloGate, { audioEngine: engine });

        run('track-2', false);

        expect(engineSetTrackSoloGate).toHaveBeenCalledTimes(1);
        expect(engineSetTrackSoloGate).toHaveBeenCalledWith('track-2', false);
    });
});
