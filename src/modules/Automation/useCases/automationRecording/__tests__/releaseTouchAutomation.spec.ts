import { describe, it, expect, vi, beforeEach } from 'vitest';

import { captureTouchAutomationRecordingAuthority } from '../captureTouchAutomationRecordingAuthority';
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

    it.each(['owned', 'successor', 'ownerless', 'absent'] as const)(
        'releases only its latest recorded producer when the session is %s',
        (producer) => {
            const authority = captureTouchAutomationRecordingAuthority('t1', 'gain');
            let recordingOwner: symbol | undefined;
            if (producer === 'owned') {
                recordingOwner = authority.owner;
            } else if (producer === 'successor') {
                recordingOwner = Symbol('new gesture');
            }
            if (producer !== 'absent') {
                activeRecording.set('t1::gain', {
                    parameterId: 'gain',
                    trackId: 't1',
                    startBeat: 0,
                    lastValue: 0.5,
                    recordingOwner,
                    recordingMode: 'touch',
                });
                touchActive.add('t1::gain');
            }

            authority.release();

            expect(flushPendingPoints).toHaveBeenCalledTimes(producer === 'owned' ? 1 : 0);
            expect(touchActive.has('t1::gain')).toBe(producer === 'successor' || producer === 'ownerless');
            let expectedLastValue: number | null | undefined = 0.5;
            if (producer === 'owned') {
                expectedLastValue = null;
            } else if (producer === 'absent') {
                expectedLastValue = undefined;
            }
            expect(activeRecording.get('t1::gain')?.lastValue).toBe(expectedLastValue);
        }
    );

    it.each(['touch', 'latch', 'write'] as const)('gesture release obeys its latest admitted %s mode', (mode) => {
        const authority = captureTouchAutomationRecordingAuthority('t1', 'gain');
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.5,
            recordingOwner: authority.owner,
            recordingMode: mode,
        });
        touchActive.add('t1::gain');

        authority.release();

        expect(flushPendingPoints).toHaveBeenCalledTimes(mode === 'touch' ? 1 : 0);
        expect(touchActive.has('t1::gain')).toBe(mode !== 'touch');
        expect(activeRecording.get('t1::gain')?.lastValue).toBe(mode === 'touch' ? null : 0.5);
    });

    it('leaves an absent session untouched (no throw) on release', () => {
        expect(() => releaseTouchAutomation('ghost', 'gain')).not.toThrow();
        expect(activeRecording.has('ghost::gain')).toBe(false);
    });
});
