import { afterEach, describe, expect, it } from 'vitest';

import { type AudioGraphBackend } from '../../../models/AudioGraphBackend';
import { hasLiveNativeGraphSession } from '../hasLiveNativeGraphSession';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';

const stubBackend: AudioGraphBackend = {
    backendId: 'stub-backend',
    apply: () => {
        throw new Error('not used in this spec');
    },
    dispose: () => {},
};

describe('hasLiveNativeGraphSession', () => {
    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.rolling = false;
    });

    it('is false with no session backend', () => {
        nativeLiveGraphSession.backend = null;

        expect(hasLiveNativeGraphSession()).toBe(false);
    });

    it('is true once a session holds a backend, whether or not it is rolling', () => {
        nativeLiveGraphSession.backend = stubBackend;
        nativeLiveGraphSession.rolling = false;

        expect(hasLiveNativeGraphSession()).toBe(true);
    });
});
