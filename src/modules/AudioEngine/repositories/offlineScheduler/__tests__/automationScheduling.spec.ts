import { describe, it, expect, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { resolveDeviceParam, resolveDeviceParamScale } from '../../../services/deviceResolution';
import { createOfflineDeviceNode, type OfflineDeviceNode } from '../../deviceNodeFactory';
import { scheduleTrackAutomation } from '../automationScheduling';
import { scheduleAutomationOnParam } from '../scheduleAutomationOnParam';

type ParamProperty = 'frequency' | 'Q' | 'gain';
type ExpectedParamTarget = readonly [node: string | number, property: ParamProperty, scale: number, offset: number];
type WebAudioTarget = readonly [
    deviceType: string,
    parameterId: string,
    min: number,
    max: number,
    targets: readonly ExpectedParamTarget[],
];

const GENERATED_WEB_AUDIO_TARGETS = [
    ['builtin-filter', 'filter-cutoff', 20, 20_000, [['filter', 'frequency', 1, 0]]],
    ['builtin-filter', 'filter-resonance', 0.1, 20, [['filter', 'Q', 1, 0]]],
    [
        'builtin-distortion',
        'dist-mix',
        0,
        1,
        [
            ['wet', 'gain', 1, 0],
            ['dry', 'gain', -1, 1],
        ],
    ],
    ['builtin-delay', 'delay-feedback', 0, 0.95, [[4, 'gain', 1, 0]]],
    ['builtin-delay', 'delay-mix', 0, 1, [[2, 'gain', 1, 0]]],
    ['builtin-autopan', 'autopan-rate', 0.1, 10, [['lfo', 'frequency', 1, 0]]],
    [
        'builtin-autopan',
        'autopan-depth',
        0,
        1,
        [
            ['lfoGainL', 'gain', 0.5, 0],
            ['lfoGainR', 'gain', -0.5, 0],
        ],
    ],
    ['builtin-phaser', 'phaser-rate', 0.1, 10, [['lfo', 'frequency', 1, 0]]],
    [
        'builtin-phaser',
        'phaser-depth',
        0,
        1,
        [
            ['lfoGain', 'gain', 1000, 0],
            ['wet', 'gain', 0.5, 0.25],
            ['dry', 'gain', -0.5, 0.75],
        ],
    ],
    [
        'builtin-chorus',
        'chorus-rate',
        0.1,
        10,
        [
            ['lfo1', 'frequency', 1, 0],
            ['lfo2', 'frequency', 1.2, 0],
        ],
    ],
    [
        'builtin-chorus',
        'chorus-depth',
        0,
        20,
        [
            ['lfoGain1', 'gain', 1 / 1000, 0],
            ['lfoGain2', 'gain', 1 / 1000, 0],
        ],
    ],
    ['builtin-tremolo', 'trem-rate', 0.1, 20, [['lfo', 'frequency', 1, 0]]],
    ['builtin-tremolo', 'trem-depth', 0, 1, [['lfoDepth', 'gain', 1, 0]]],
    ['builtin-stereo-widener', 'width-amount', 0, 3, [['sideGain', 'gain', 1, 0]]],
] as const satisfies readonly WebAudioTarget[];

function resolveExpectedParam(device: OfflineDeviceNode, [nodeKey, property]: ExpectedParamTarget): AudioParam {
    const node = typeof nodeKey === 'string' ? device.namedNodes?.[nodeKey] : device.nodes[nodeKey];
    if (!node) {
        throw new Error(`Expected semantic node ${String(nodeKey)}`);
    }
    const audioParam = (node as unknown as Partial<Record<ParamProperty, AudioParam>>)[property];
    if (!audioParam) {
        throw new Error(`Expected ${String(nodeKey)}.${property} AudioParam`);
    }
    return audioParam;
}

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
    it.each(GENERATED_WEB_AUDIO_TARGETS)(
        'resolves and schedules generated %s:%s automation with truthful scaling',
        (deviceType, parameterId, min, max, targetSpecs) => {
            const context = createMockAudioContext();
            const device = createOfflineDeviceNode({ context: asBaseAudioContext(context), deviceType });
            if (!device) {
                throw new Error(`Expected ${deviceType} factory`);
            }
            const params = targetSpecs.map((target) => resolveExpectedParam(device, target));
            expect(resolveDeviceParam(deviceType, parameterId, device)).toBe(params[0]);
            expect(resolveDeviceParamScale(deviceType, parameterId)).toBe(targetSpecs[0][2]);

            scheduleTrackAutomation(
                [
                    makeLane({
                        parameterId: `device-1:${parameterId}`,
                        minValue: min,
                        maxValue: max,
                        points: [
                            { beat: 0, value: min, curve: 'linear', tension: 0 },
                            { beat: 2, value: max, curve: 'linear', tension: 0 },
                        ],
                    }),
                ],
                'track-1',
                { gain: makeParam() } as unknown as GainNode,
                { pan: makeParam() } as unknown as StereoPannerNode,
                [{ deviceId: 'device-1', deviceType, node: device }],
                10,
                120,
                []
            );

            for (const [index, [, , scale, offset]] of targetSpecs.entries()) {
                expect(params[index]!.setValueAtTime).toHaveBeenCalledWith(min * scale + offset, 0);
                expect(params[index]!.linearRampToValueAtTime).toHaveBeenCalledWith(max * scale + offset, 1);
            }
            device.dispose?.();
        }
    );

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

    it('routes a canonical delay lane and scales milliseconds to seconds', () => {
        const gain = makeParam();
        const pan = makeParam();
        const deviceParam = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;
        const deviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [
                {} as AudioNode,
                {} as AudioNode,
                {} as AudioNode,
                { delayTime: deviceParam } as unknown as AudioNode,
            ],
        };

        scheduleTrackAutomation(
            [
                makeLane({
                    parameterId: 'device-1:delay-time',
                    points: [{ beat: 0, value: 500, curve: 'linear', tension: 0 }],
                }),
            ],
            'track-1',
            gainNode,
            panNode,
            [{ deviceId: 'device-1', deviceType: 'builtin-delay', node: deviceNode }],
            10,
            120,
            []
        );

        expect(deviceParam.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it.each<[string, string, boolean, string | null]>([
        ['unique bare', 'gain-level', false, 'device-1'],
        ['same-type canonical', 'device-2:gain-level', true, 'device-2'],
        ['ambiguous type', 'builtin-gain:gain-level', true, null],
        ['ambiguous bare', 'gain-level', true, null],
        ['wrong canonical', 'missing:gain-level', true, null],
    ])('resolves %s device target', (_name, parameterId, includeSecond, expectedId) => {
        const gain = makeParam();
        const pan = makeParam();
        const deviceParam = makeParam();
        const secondParam = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;
        const deviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{ gain: deviceParam } as unknown as AudioNode],
        };
        const secondNode = { ...deviceNode, nodes: [{ gain: secondParam } as unknown as AudioNode] };
        const entries = [{ deviceId: 'device-1', deviceType: 'builtin-gain', node: deviceNode }];
        if (includeSecond) {
            entries.push({ deviceId: 'device-2', deviceType: 'builtin-gain', node: secondNode });
        }

        scheduleTrackAutomation(
            [
                makeLane({
                    parameterId,
                    points: [{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
                }),
            ],
            'track-1',
            gainNode,
            panNode,
            entries,
            10,
            120,
            []
        );

        expect(deviceParam.setValueAtTime.mock.calls.length > 0).toBe(expectedId === 'device-1');
        expect(secondParam.setValueAtTime.mock.calls.length > 0).toBe(expectedId === 'device-2');
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });
});
