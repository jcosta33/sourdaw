import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAudioTime: vi.fn(),
    triggerToasterPad: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioTime: mocks.getAudioTime,
}));

vi.mock('../triggerPad', () => ({
    triggerToasterPad: mocks.triggerToasterPad,
}));

import { activeNoteRepeatSessions } from '../noteRepeatState';
import { startNoteRepeat } from '../startNoteRepeat';
import { stopNoteRepeat } from '../stopNoteRepeat';

describe('startNoteRepeat', () => {
    beforeEach(() => {
        activeNoteRepeatSessions.clear();
        vi.clearAllMocks();
        vi.useFakeTimers();
        mocks.getAudioTime.mockReturnValue(1000);
    });

    it('triggers the pad immediately on start and sets the session interval from rate+bpm', () => {
        // rate 1/4 at 120 bpm: (60000/120) * 1 = 500ms per beat → 0.5s interval.
        startNoteRepeat('dev-1', 3, 100, 120, '1/4');

        expect(mocks.triggerToasterPad).toHaveBeenCalledTimes(1);
        expect(mocks.triggerToasterPad).toHaveBeenCalledWith('dev-1', 3, 100);

        const session = activeNoteRepeatSessions.get('dev-1');
        expect(session).toBeDefined();
        // intervalSec = 500ms / 1000 = 0.5s.
        expect(session?.intervalSec).toBeCloseTo(0.5, 5);
        // nextTriggerTime = audioTime(1000) + 0.5 = 1000.5.
        expect(session?.nextTriggerTime).toBeCloseTo(1000.5, 5);
    });

    it('stops any existing session before starting a new one (one session per device)', () => {
        startNoteRepeat('dev-1', 0, 80, 120, '1/4');
        const firstTimeoutId = activeNoteRepeatSessions.get('dev-1')?.timeoutId;

        startNoteRepeat('dev-1', 5, 120, 120, '1/16');
        const session = activeNoteRepeatSessions.get('dev-1');

        // The session was replaced — pad 5, not pad 0.
        expect(session?.padIndex).toBe(5);
        expect(session?.velocity).toBe(120);
        // The old timeout should have been cleared (different timeoutId object).
        expect(session?.timeoutId).not.toBe(firstTimeoutId);
    });

    it('schedules retriggers at the rate interval and advances nextTriggerTime', () => {
        startNoteRepeat('dev-1', 0, 100, 120, '1/4');

        // Initial trigger on start.
        expect(mocks.triggerToasterPad).toHaveBeenCalledTimes(1);

        // Advance fake timers by the interval (500ms). The scheduler should fire.
        mocks.getAudioTime.mockReturnValue(1000.5);
        vi.advanceTimersByTime(500);

        // Two triggers now: start + first retrigger.
        expect(mocks.triggerToasterPad).toHaveBeenCalledTimes(2);
        expect(mocks.triggerToasterPad).toHaveBeenLastCalledWith('dev-1', 0, 100);

        // nextTriggerTime advanced by one interval.
        const session = activeNoteRepeatSessions.get('dev-1');
        expect(session?.nextTriggerTime).toBeCloseTo(1001.0, 5);
    });

    it('rate 1/16 at 120 bpm produces a 125ms interval', () => {
        // (60000/120) * 0.25 = 125ms → 0.125s interval.
        startNoteRepeat('dev-1', 0, 100, 120, '1/16');

        const session = activeNoteRepeatSessions.get('dev-1');
        expect(session?.intervalSec).toBeCloseTo(0.125, 5);
    });

    it('rate 1/8t (triplet) at 120 bpm produces a ~166.67ms interval', () => {
        // (60000/120) * (1/3) = 166.666...ms → ~0.1667s.
        startNoteRepeat('dev-1', 0, 100, 120, '1/8t');

        const session = activeNoteRepeatSessions.get('dev-1');
        expect(session?.intervalSec).toBeCloseTo(1 / 6, 4);
    });
});

describe('stopNoteRepeat', () => {
    beforeEach(() => {
        activeNoteRepeatSessions.clear();
        vi.clearAllMocks();
        vi.useFakeTimers();
        mocks.getAudioTime.mockReturnValue(1000);
    });

    it('removes the session and clears the pending timeout', () => {
        startNoteRepeat('dev-1', 0, 100, 120, '1/4');
        expect(activeNoteRepeatSessions.has('dev-1')).toBe(true);

        stopNoteRepeat('dev-1');

        expect(activeNoteRepeatSessions.has('dev-1')).toBe(false);
    });

    it('stops further retriggers after stop', () => {
        startNoteRepeat('dev-1', 0, 100, 120, '1/4');
        stopNoteRepeat('dev-1');

        const triggerCountBefore = mocks.triggerToasterPad.mock.calls.length;
        vi.advanceTimersByTime(2000);

        // No additional triggers fire after stop.
        expect(mocks.triggerToasterPad.mock.calls.length).toBe(triggerCountBefore);
    });

    it('is a no-op when no session exists for the device', () => {
        expect(() => stopNoteRepeat('dev-nope')).not.toThrow();
        expect(activeNoteRepeatSessions.size).toBe(0);
    });
});
