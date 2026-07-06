import { describe, it, expect, beforeEach } from 'vitest';

import { activeRecording, pendingPoints, RECORDING_MODES, touchActive } from '../recordingSessionState';

describe('recordingSessionState', () => {
    beforeEach(() => {
        activeRecording.clear();
        pendingPoints.clear();
        touchActive.clear();
    });

    describe('state collections', () => {
        it('should expose live mutable recording collections', () => {
            activeRecording.set('t1::gain', {
                parameterId: 'gain',
                trackId: 't1',
                startBeat: 2,
                lastValue: 0.5,
            });
            pendingPoints.set('t1::gain', [{ beat: 2, value: 0.5, curve: 'linear', tension: 0 }]);
            touchActive.add('t1::gain');

            expect(activeRecording.get('t1::gain')?.lastValue).toBe(0.5);
            expect(pendingPoints.get('t1::gain')?.map((point) => point.beat)).toEqual([2]);
            expect(touchActive.has('t1::gain')).toBe(true);
        });
    });

    describe('RECORDING_MODES', () => {
        it('should include write, touch, and latch', () => {
            expect(RECORDING_MODES.has('write')).toBe(true);
            expect(RECORDING_MODES.has('touch')).toBe(true);
            expect(RECORDING_MODES.has('latch')).toBe(true);
            expect(RECORDING_MODES.has('read')).toBe(false);
        });
    });
});
