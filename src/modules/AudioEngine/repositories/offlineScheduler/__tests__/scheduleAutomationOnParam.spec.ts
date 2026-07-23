import { describe, it, expect, vi } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { scheduleAutomationOnParam } from '../scheduleAutomationOnParam';

function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
    };
}

function point(overrides: Partial<AutomationPoint> & { beat: number; value: number }): AutomationPoint {
    return { curve: 'linear', tension: 0, ...overrides };
}

// 120 bpm, no tempo changes → beatToSeconds(beat) === beat / 2.
describe('scheduleAutomationOnParam — latency compensation (M-038)', () => {
    /// Regression: clip scheduling shifts audio by the track's compensation
    /// delay while automation stayed at uncompensated times, so automation
    /// landed offset against the audio it shapes.
    it('shifts every compiled event by the compensation delay', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [point({ beat: 0, value: 0.2 }), point({ beat: 4, value: 0.8 })],
            10,
            120,
            [],
            0,
            undefined,
            0.25
        );

        // Beat 4 → 2.0s at 120bpm, +0.25s compensation = 2.25s.
        expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 2.25);
        // The compiled seed lands at the shifted origin…
        expect(param.setValueAtTime).toHaveBeenCalledWith(0.2, 0.25);
        // …and is re-anchored at time 0 so the param holds the correct value
        // across the gap the shift opens.
        expect(param.setValueAtTime).toHaveBeenCalledWith(0.2, 0);
    });

    it('keeps event times untouched when there is no compensation delay', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [point({ beat: 0, value: 0.2 }), point({ beat: 4, value: 0.8 })],
            10,
            120,
            []
        );

        expect(param.setValueAtTime).toHaveBeenCalledWith(0.2, 0);
        expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 2);
        const shifted = param.linearRampToValueAtTime.mock.calls.some((call) => (call[1] as number) > 2);
        expect(shifted).toBe(false);
    });

    it('combines region offset and compensation like clip scheduling does', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [point({ beat: 0, value: 0 }), point({ beat: 8, value: 1 })],
            10,
            120,
            [],
            2, // regionStartSeconds — beat 4 at 120bpm
            undefined,
            0.5
        );

        // The region-start seed value (0.5 at beat 4, within numeric
        // inversion tolerance) is re-anchored at time 0.
        const anchoredSeed = param.setValueAtTime.mock.calls.find((call) => call[1] === 0);
        expect(anchoredSeed?.[0]).toBeCloseTo(0.5, 6);
        // Beat 8 → 4.0s absolute → 2.0s region-relative → 2.5s compensated.
        expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(1, 2.5);
    });

    it('schedules nothing for an empty lane', () => {
        const param = makeParam();
        scheduleAutomationOnParam(param as unknown as AudioParam, [], 10, 120, [], 0, undefined, 0.25);

        expect(param.setValueAtTime).not.toHaveBeenCalled();
        expect(param.linearRampToValueAtTime).not.toHaveBeenCalled();
    });
});
