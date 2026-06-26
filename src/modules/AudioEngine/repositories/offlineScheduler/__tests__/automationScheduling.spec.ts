import { describe, it, expect, vi } from 'vitest';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { scheduleAutomationOnParam, scheduleTrackAutomation } from '../automationScheduling';

// A minimal AudioParam double exposing the scheduling methods the function calls.
function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
    };
}

function makeLane(overrides: Partial<AutomationLane>): AutomationLane {
    return {
        id: overrides.id ?? 'lane-1',
        trackId: overrides.trackId ?? 'track-1',
        clipId: overrides.clipId,
        parameterId: overrides.parameterId ?? 'gain',
        parameterName: overrides.parameterName ?? 'Gain',
        points: overrides.points ?? [],
        enabled: overrides.enabled ?? true,
        minValue: overrides.minValue ?? 0,
        maxValue: overrides.maxValue ?? 1,
    };
}

describe('scheduleAutomationOnParam', () => {
    it('seeds the param at the first point value at time 0', () => {
        const param = makeParam();
        // 120 bpm, no tempo changes → beatToSeconds(beat) === beat / 2.
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [{ beat: 0, value: 0.25, curve: 'linear', tension: 0 }],
            10,
            120,
            []
        );

        expect(param.setValueAtTime).toHaveBeenCalledWith(0.25, 0);
    });

    it('emits a linear ramp to the next point at its converted time', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 4, value: 1, curve: 'linear', tension: 0 },
            ],
            10,
            120,
            []
        );

        // beat 4 @ 120bpm → 2 seconds.
        expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(1, 2);
    });

    it('holds (step) a value rather than ramping when the curve is step', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                { beat: 0, value: 0.5, curve: 'step', tension: 0 },
                { beat: 2, value: 1, curve: 'step', tension: 0 },
            ],
            10,
            120,
            []
        );

        expect(param.linearRampToValueAtTime).not.toHaveBeenCalled();
        // A step lane re-asserts its value just before the next point's time.
        expect(param.setValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
    });

    it('schedules nothing for an empty point list', () => {
        const param = makeParam();
        scheduleAutomationOnParam(param as unknown as AudioParam, [], 10, 120, []);

        expect(param.setValueAtTime).not.toHaveBeenCalled();
        expect(param.linearRampToValueAtTime).not.toHaveBeenCalled();
    });
});

describe('scheduleTrackAutomation', () => {
    it('routes a gain lane to the track gain param and leaves pan untouched', () => {
        const gain = makeParam();
        const pan = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        scheduleTrackAutomation(
            [makeLane({ parameterId: 'gain', points: [{ beat: 0, value: 0.8, curve: 'linear', tension: 0 }] })],
            'track-1',
            gainNode,
            panNode,
            [],
            10,
            120,
            []
        );

        expect(gain.setValueAtTime).toHaveBeenCalledWith(0.8, 0);
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it('routes a pan lane to the track pan param', () => {
        const gain = makeParam();
        const pan = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        scheduleTrackAutomation(
            [makeLane({ parameterId: 'pan', points: [{ beat: 0, value: -0.5, curve: 'linear', tension: 0 }] })],
            'track-1',
            gainNode,
            panNode,
            [],
            10,
            120,
            []
        );

        expect(pan.setValueAtTime).toHaveBeenCalledWith(-0.5, 0);
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });

    it('ignores lanes belonging to a different track', () => {
        const gain = makeParam();
        const pan = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        scheduleTrackAutomation(
            [
                makeLane({
                    trackId: 'other-track',
                    parameterId: 'gain',
                    points: [{ beat: 0, value: 0.9, curve: 'linear', tension: 0 }],
                }),
            ],
            'track-1',
            gainNode,
            panNode,
            [],
            10,
            120,
            []
        );

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });

    it('ignores clip-scoped lanes (only track-level automation is scheduled here)', () => {
        const gain = makeParam();
        const pan = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        scheduleTrackAutomation(
            [
                makeLane({
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    points: [{ beat: 0, value: 0.4, curve: 'linear', tension: 0 }],
                }),
            ],
            'track-1',
            gainNode,
            panNode,
            [],
            10,
            120,
            []
        );

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });
});
