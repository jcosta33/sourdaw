import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { setNativeCarriedTracks } from '../setNativeCarriedTracks';

import type { AudioEngine } from '../../../models/AudioEngineState';

describe('setNativeCarriedTracks', () => {
    it('should hand the carried track set to the engine', () => {
        const engineSetCarried = vi.fn<AudioEngine['setNativeCarriedTracks']>();
        const engine: Pick<AudioEngine, 'setNativeCarriedTracks'> = { setNativeCarriedTracks: engineSetCarried };
        const run = injectDependencies(setNativeCarriedTracks, { audioEngine: engine });
        const trackIds = new Set(['track-1', 'track-3']);

        run(trackIds);

        expect(engineSetCarried).toHaveBeenCalledTimes(1);
        expect(engineSetCarried).toHaveBeenCalledWith(trackIds);
    });
});
