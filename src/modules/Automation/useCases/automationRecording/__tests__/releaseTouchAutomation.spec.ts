import { describe, it, expect, vi, beforeEach } from 'vitest';

import { releaseTouchAutomation } from '../releaseTouchAutomation';

const { activeRecording, touchActive, flushPendingPoints } = vi.hoisted(() => {
    const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
    const touchActive = new Set<string>();
    return {
        activeRecording,
        touchActive,
        flushPendingPoints: vi.fn(),
    };
});

vi.mock('../recordingSessionState', () => ({
    activeRecording,
    touchActive,
}));

vi.mock('../flushPendingPoints', () => ({
    flushPendingPoints,
}));

describe('releaseTouchAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.clear();
        touchActive.clear();
    });

    it('removes the key from touchActive and flushes pending points for that parameter', () => {
        touchActive.add('t1::gain');

        releaseTouchAutomation('t1', 'gain');

        expect(touchActive.has('t1::gain')).toBe(false);
        expect(flushPendingPoints).toHaveBeenCalledTimes(1);
        expect(flushPendingPoints).toHaveBeenCalledWith('t1::gain');
    });

    it('is a no-op on touchActive when the key was not active', () => {
        releaseTouchAutomation('t2', 'pan');

        expect(flushPendingPoints).toHaveBeenCalledWith('t2::pan');
        expect(touchActive.size).toBe(0);
    });

    // Regression (Batch B fix 2): latch's isRecordingAutomation stays true while
    // session.lastValue !== null, so without clearing it on release the lane keeps
    // being skipped by applyAutomation and the engine drifts off the curve.
    it('resets the latch session lastValue on release so recording disarms', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.5,
        });
        touchActive.add('t1::gain');

        releaseTouchAutomation('t1', 'gain');

        expect(activeRecording.get('t1::gain')?.lastValue).toBeNull();
    });

    it('leaves an absent session untouched (no throw) on release', () => {
        expect(() => releaseTouchAutomation('ghost', 'gain')).not.toThrow();
        expect(activeRecording.has('ghost::gain')).toBe(false);
    });
});
