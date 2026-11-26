import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { setTrackOutput } from '../setTrackOutput';

import type { AudioEngine } from '../../../models/AudioEngineState';

const createEngine = () => {
    const engineSetTrackOutput = vi.fn<AudioEngine['setTrackOutput']>();
    const engine: Pick<AudioEngine, 'setTrackOutput'> = { setTrackOutput: engineSetTrackOutput };
    return { engine, engineSetTrackOutput };
};

describe('setTrackOutput', () => {
    it('should forward the track id and output id with no pad binding', () => {
        const { engine, engineSetTrackOutput } = createEngine();
        const run = injectDependencies(setTrackOutput, { audioEngine: engine });

        run('track-1', 'bus-a');

        expect(engineSetTrackOutput).toHaveBeenCalledTimes(1);
        expect(engineSetTrackOutput).toHaveBeenCalledWith('track-1', 'bus-a', undefined);
    });

    it('should forward the pad binding unchanged', () => {
        const { engine, engineSetTrackOutput } = createEngine();
        const run = injectDependencies(setTrackOutput, { audioEngine: engine });
        const padBinding = { toasterParentTrackId: 'toaster-7', padIndex: 3 };

        run('track-2', 'bus-b', padBinding);

        expect(engineSetTrackOutput).toHaveBeenCalledTimes(1);
        expect(engineSetTrackOutput).toHaveBeenCalledWith('track-2', 'bus-b', padBinding);
    });
});
