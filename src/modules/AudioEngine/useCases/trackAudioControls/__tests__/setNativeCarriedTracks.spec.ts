import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { setNativeCarriedTracks } from '../setNativeCarriedTracks';

import type { AudioEngine } from '../../../models/AudioEngineState';

describe('setNativeCarriedTracks', () => {
    it.each([[['track-1', 'track-3']], [['track-9']], [[]]])(
        'should hand the carried track set %j to the engine',
        (ids) => {
            const engineSetCarried = vi.fn<AudioEngine['setNativeCarriedTracks']>();
            const engine: Pick<AudioEngine, 'setNativeCarriedTracks'> = { setNativeCarriedTracks: engineSetCarried };
            const run = injectDependencies(setNativeCarriedTracks, { audioEngine: engine });
            const trackIds = new Set(ids);

            run(trackIds);

            expect(engineSetCarried).toHaveBeenCalledTimes(1);
            expect(engineSetCarried).toHaveBeenCalledWith(trackIds);
        }
    );
});
