import { describe, expect, it } from 'vitest';

import { createNativeRecordingCaptureHistory, type NativeCaptureSnapshot } from '../nativeRecordingCaptureHistory';

const geometry = {
    secondsAtBeat: (beat: number) => beat / 2,
    beatAtSeconds: (seconds: number) => seconds * 2,
    isLooping: true,
    loopStart: 8,
    loopEnd: 12,
};

function observation(overrides: Partial<NativeCaptureSnapshot> = {}): NativeCaptureSnapshot {
    return {
        songSeconds: 4,
        contextSeconds: 50,
        audibleContextSeconds: 50,
        loopWraps: 0,
        admission: { geometry, admittedBatch: 1, serial: 1, located: false },
        geometry,
        clockIdentity: 'owned-native-clock',
        uncertaintySeconds: 0,
        calibrationAgeSeconds: 0,
        localUncertaintySeconds: null,
        quality: 'estimated',
        ...overrides,
    };
}

function createHistory() {
    return createNativeRecordingCaptureHistory(
        'track',
        { clockIdentity: 'owned-native-clock', serial: 1, loopWraps: 0 },
        0,
        () => undefined
    );
}

describe('native recording projection admission state', () => {
    it('keeps pending and non-forward observations recoverable by a valid owned date', () => {
        const history = createHistory();
        expect(history.projectionState()).toBe('pending');
        history.observe(observation({ forwardAuthorized: false }));
        expect(history.projectionState()).toBe('pending');
        expect(history.entryAt(50)).toBeNull();
        history.observe(observation());
        expect(history.projectionState()).toBe('known');
        expect(history.entryAt(50)).toMatchObject({ beat: 8, contextSeconds: 50 });
        history.refuseProjection('unavailable');
        expect(history.projectionState()).toBe('pending');
        history.observe(observation({ contextSeconds: 50.25, songSeconds: 4.25 }));
        expect(history.projectionState()).toBe('known');
    });

    it('keeps a genuinely refused ending refused after a later date arrives', () => {
        const history = createHistory();
        history.observe(observation());
        history.refuseProjection('ending');
        history.observe(observation({ contextSeconds: 50.25, songSeconds: 4.25 }));
        expect(history.projectionState()).toBe('refused');
        expect(history.isProjectionKnown()).toBe(false);
    });

    it('never clears a proven wrap gap across an admission change', () => {
        const history = createHistory();
        history.observe(observation());
        history.observe(
            observation({
                contextSeconds: 52.25,
                songSeconds: 4.25,
                loopWraps: 1,
                admission: { geometry, admittedBatch: 2, serial: 2, located: false },
            })
        );
        expect(history.projectionState()).toBe('refused');
        history.observe(
            observation({
                contextSeconds: 52.5,
                songSeconds: 4.5,
                loopWraps: 1,
                admission: { geometry, admittedBatch: 2, serial: 2, located: false },
            })
        );
        expect(history.projectionState()).toBe('refused');
        expect(history.isProjectionKnown()).toBe(false);
    });
});
