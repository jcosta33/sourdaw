import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { setTrackMute } from '../setTrackMute';

import type { AudioEngine } from '../../../models/AudioEngineState';

const createEngine = () => {
    const engineSetTrackMute = vi.fn<AudioEngine['setTrackMute']>();
    const engine: Pick<AudioEngine, 'setTrackMute'> = { setTrackMute: engineSetTrackMute };
    return { engine, engineSetTrackMute };
};

describe('setTrackMute', () => {
    it('should forward the track id and muted flag to the engine', () => {
        const { engine, engineSetTrackMute } = createEngine();
        const run = injectDependencies(setTrackMute, { audioEngine: engine });

        run('track-1', true);

        expect(engineSetTrackMute).toHaveBeenCalledTimes(1);
        expect(engineSetTrackMute).toHaveBeenCalledWith('track-1', true);
    });

    it('should forward an unmute with the same track id', () => {
        const { engine, engineSetTrackMute } = createEngine();
        const run = injectDependencies(setTrackMute, { audioEngine: engine });

        run('track-2', false);

        expect(engineSetTrackMute).toHaveBeenCalledTimes(1);
        expect(engineSetTrackMute).toHaveBeenCalledWith('track-2', false);
    });
});
