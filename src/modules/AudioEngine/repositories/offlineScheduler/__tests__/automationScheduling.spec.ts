import { describe, it, expect, vi } from 'vitest';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { scheduleTrackAutomation } from '../automationScheduling';
import { scheduleAutomationOnParam } from '../scheduleAutomationOnParam';

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

    it('routes a canonical lane to only the requested device when two devices share a type', () => {
        const gain = makeParam();
        const pan = makeParam();
        const firstDeviceParam = makeParam();
        const secondDeviceParam = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;
        const firstDeviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{ gain: firstDeviceParam } as unknown as AudioNode],
        };
        const secondDeviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{ gain: secondDeviceParam } as unknown as AudioNode],
        };

        scheduleTrackAutomation(
            [
                makeLane({
                    parameterId: 'device-2:gain-level',
                    points: [{ beat: 0, value: 0.65, curve: 'linear', tension: 0 }],
                }),
            ],
            'track-1',
            gainNode,
            panNode,
            [
                { deviceId: 'device-1', deviceType: 'builtin-gain', node: firstDeviceNode },
                { deviceId: 'device-2', deviceType: 'builtin-gain', node: secondDeviceNode },
            ],
            10,
            120,
            []
        );

        expect(firstDeviceParam.setValueAtTime).not.toHaveBeenCalled();
        expect(secondDeviceParam.setValueAtTime).toHaveBeenCalledWith(0.65, 0);
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it('routes a direct device lane to the first device exposing that param', () => {
        const gain = makeParam();
        const pan = makeParam();
        const deviceParam = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;
        const deviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{ gain: deviceParam } as unknown as AudioNode],
        };

        scheduleTrackAutomation(
            [
                makeLane({
                    parameterId: 'gain-level',
                    points: [{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
                }),
            ],
            'track-1',
            gainNode,
            panNode,
            [{ deviceId: 'device-1', deviceType: 'builtin-gain', node: deviceNode }],
            10,
            120,
            []
        );

        expect(deviceParam.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it('accepts a type-prefixed legacy lane when exactly one device resolves it', () => {
        const deviceParam = makeParam();
        const deviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{ gain: deviceParam } as unknown as AudioNode],
        };

        scheduleTrackAutomation(
            [
                makeLane({
                    parameterId: 'builtin-gain:gain-level',
                    points: [{ beat: 0, value: 0.4, curve: 'linear', tension: 0 }],
                }),
            ],
            'track-1',
            { gain: makeParam() } as unknown as GainNode,
            { pan: makeParam() } as unknown as StereoPannerNode,
            [{ deviceId: 'device-1', deviceType: 'builtin-gain', node: deviceNode }],
            10,
            120,
            []
        );

        expect(deviceParam.setValueAtTime).toHaveBeenCalledWith(0.4, 0);
    });

    it.each(['builtin-gain:gain-level', 'gain-level'])('rejects ambiguous legacy target %s', (parameterId) => {
        const firstParam = makeParam();
        const secondParam = makeParam();
        function makeDeviceNode(param: ReturnType<typeof makeParam>) {
            return {
                inputNode: {} as AudioNode,
                outputNode: {} as AudioNode,
                nodes: [{ gain: param } as unknown as AudioNode],
            };
        }

        scheduleTrackAutomation(
            [makeLane({ parameterId, points: [{ beat: 0, value: 0.4, curve: 'linear', tension: 0 }] })],
            'track-1',
            { gain: makeParam() } as unknown as GainNode,
            { pan: makeParam() } as unknown as StereoPannerNode,
            [
                { deviceId: 'device-1', deviceType: 'builtin-gain', node: makeDeviceNode(firstParam) },
                { deviceId: 'device-2', deviceType: 'builtin-gain', node: makeDeviceNode(secondParam) },
            ],
            10,
            120,
            []
        );

        expect(firstParam.setValueAtTime).not.toHaveBeenCalled();
        expect(secondParam.setValueAtTime).not.toHaveBeenCalled();
    });

    it.each(['missing:gain-level', 'device-1:eq-low-gain'])('fails closed for canonical target %s', (parameterId) => {
        const gainParam = makeParam();
        const eqParam = makeParam();
        scheduleTrackAutomation(
            [makeLane({ parameterId, points: [{ beat: 0, value: 0.4, curve: 'linear', tension: 0 }] })],
            'track-1',
            { gain: makeParam() } as unknown as GainNode,
            { pan: makeParam() } as unknown as StereoPannerNode,
            [
                {
                    deviceId: 'device-1',
                    deviceType: 'builtin-gain',
                    node: {
                        inputNode: {} as AudioNode,
                        outputNode: {} as AudioNode,
                        nodes: [{ gain: gainParam } as unknown as AudioNode],
                    },
                },
                {
                    deviceId: 'device-2',
                    deviceType: 'builtin-eq',
                    node: {
                        inputNode: {} as AudioNode,
                        outputNode: {} as AudioNode,
                        nodes: [{ gain: eqParam } as unknown as AudioNode],
                    },
                },
            ],
            10,
            120,
            []
        );

        expect(gainParam.setValueAtTime).not.toHaveBeenCalled();
        expect(eqParam.setValueAtTime).not.toHaveBeenCalled();
    });

    it('preserves offline parameter scaling after canonical resolution', () => {
        const delayTime = makeParam();
        const delayNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{}, {}, {}, { delayTime }] as AudioNode[],
        };

        scheduleTrackAutomation(
            [
                makeLane({
                    parameterId: 'delay-1:delay-time',
                    points: [{ beat: 0, value: 500, curve: 'linear', tension: 0 }],
                }),
            ],
            'track-1',
            { gain: makeParam() } as unknown as GainNode,
            { pan: makeParam() } as unknown as StereoPannerNode,
            [{ deviceId: 'delay-1', deviceType: 'builtin-delay', node: delayNode }],
            10,
            120,
            []
        );

        expect(delayTime.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
    });
});
