import { describe, it, expect, vi } from 'vitest';

import { clampDeviceParameterValue, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { resolveDeviceParam, resolveDeviceParamScale } from '../../../services/deviceResolution';
import { createOfflineDeviceNode, type OfflineDeviceNode } from '../../deviceNodeFactory';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';
import { scheduleAutomationOnParam } from '../scheduleAutomationOnParam';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

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
    [
        'builtin-delay',
        'delay-mix',
        0,
        1,
        [
            [2, 'gain', 1, 0],
            [1, 'gain', -1, 1],
        ],
    ],
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

// Every offline device entry now carries a strategy that answers the single
// offline-automation capability; built-in Web Audio devices resolve through the
// real WebAudioDeviceStrategy over their offline node (OE-3).
function webAudioEntry(deviceId: string, deviceType: string, node: OfflineDeviceNode) {
    return { deviceId, deviceType, strategy: new WebAudioDeviceStrategy(node, deviceType) };
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

    it('crops a linear ramp to the rendered region with interpolated boundary values', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 4, value: 1, curve: 'linear', tension: 0 },
            ],
            0.5,
            120,
            [],
            1
        );

        expect(param.setValueAtTime.mock.calls[0]?.[0]).toBeCloseTo(0.5, 10);
        expect(param.setValueAtTime.mock.calls[0]?.[1]).toBe(0);
        expect(param.linearRampToValueAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(0.75, 10);
        expect(param.linearRampToValueAtTime.mock.calls.at(-1)?.[1]).toBeCloseTo(0.5, 10);
    });

    it('samples exponential curves only inside the rendered region', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                { beat: 0, value: 0, curve: 'exponential', tension: 0 },
                { beat: 130, value: 1, curve: 'linear', tension: 0 },
            ],
            1,
            120,
            [],
            64,
            (beat) => (beat / 130) ** 2 * 65
        );

        expect(param.setValueAtTime.mock.calls[0]?.[0]).toBeCloseTo(Math.sqrt(64 / 65), 10);
        expect(param.setValueAtTime.mock.calls[0]?.[1]).toBe(0);
        expect(param.linearRampToValueAtTime.mock.calls.length).toBeLessThanOrEqual(101);
        expect(param.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 1);
        const times = param.linearRampToValueAtTime.mock.calls.map((call) => call[1]);
        expect(Math.max(...times.slice(1).map((time, index) => time - times[index]!))).toBeLessThanOrEqual(0.010_001);
    });

    it('uses the canonical beat projector at both cropped boundaries', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 4, value: 1, curve: 'linear', tension: 0 },
            ],
            5,
            120,
            [],
            4,
            (beat) => beat * beat
        );

        expect(param.setValueAtTime.mock.calls[0]?.[0]).toBeCloseTo(0.5, 10);
        expect(param.setValueAtTime.mock.calls[0]?.[1]).toBe(0);
        expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(expect.closeTo(Math.sqrt(6.5) / 4, 10), 2.5);
        expect(param.linearRampToValueAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(0.75, 10);
        expect(param.linearRampToValueAtTime.mock.calls.at(-1)?.[1]).toBeCloseTo(5, 10);
    });

    it('collapses equal-beat points with the last value winning', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 2, value: 0.5, curve: 'linear', tension: 0 },
                { beat: 2, value: 0.9, curve: 'linear', tension: 0 },
            ],
            1,
            120,
            []
        );

        expect(param.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.9, 1);
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

    it('emits stairs as instantaneous set events', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                { beat: 0, value: 0, curve: 'stairs', tension: 0, stairSteps: 4 },
                { beat: 4, value: 1, curve: 'linear', tension: 0 },
            ],
            2,
            120,
            []
        );

        expect(param.linearRampToValueAtTime).not.toHaveBeenCalled();
        expect(param.setValueAtTime).toHaveBeenLastCalledWith(1, 2);
    });

    it.each([0, 2.5])('normalizes persisted stair counts (%s) to finite complete events', (stairSteps) => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                { beat: 0, value: 0, curve: 'stairs', tension: 0, stairSteps },
                { beat: 4, value: 1, curve: 'linear', tension: 0 },
            ],
            2,
            120,
            []
        );

        expect(param.setValueAtTime.mock.calls.flat().every(Number.isFinite)).toBe(true);
        expect(param.setValueAtTime).toHaveBeenLastCalledWith(1, 2);
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

            scheduleTrackAutomationFixture({
                lanes: [
                    makeLane({
                        parameterId: `device-1:${parameterId}`,
                        minValue: min,
                        maxValue: max,
                        points: [
                            { beat: 128, value: min, curve: 'linear', tension: 0 },
                            { beat: 130, value: max, curve: 'linear', tension: 0 },
                        ],
                    }),
                ],
                trackId: 'track-1',
                trackGainNode: { gain: makeParam() } as unknown as GainNode,
                trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
                deviceEntries: [webAudioEntry('device-1', deviceType, device)],
                durationSeconds: 10,
                defaultTempo: 120,
                changes: [],
                regionStartSeconds: 64,
            });

            for (const [index, [, , scale, offset]] of targetSpecs.entries()) {
                // AU-2: device params carry the control slew offline. The seed
                // still lands at the start value; the slew glides through
                // intermediate values and settles exactly on the end value.
                const startTarget = min * scale + offset;
                const endTarget = max * scale + offset;
                expect(params[index]!.setValueAtTime).toHaveBeenCalledWith(startTarget, 0);
                const ramps = vi.mocked(params[index]!.linearRampToValueAtTime).mock.calls.map((call) => call[0]);
                expect(ramps.at(-1)).toBeCloseTo(endTarget, 9);
                const intermediate = ramps.some(
                    (value) => Math.abs(value - startTarget) > 1e-6 && Math.abs(value - endTarget) > 1e-6
                );
                expect(intermediate).toBe(true);
            }
            device.dispose?.();
        }
    );

    it('routes a gain lane to the track gain param and leaves pan untouched', () => {
        const gain = makeParam();
        const pan = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({ parameterId: 'gain', points: [{ beat: 128, value: 0.8, curve: 'linear', tension: 0 }] }),
            ],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
        });

        expect(gain.setValueAtTime).toHaveBeenCalledWith(0.8, 0);
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it('routes a pan lane to the track pan param', () => {
        const gain = makeParam();
        const pan = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({ parameterId: 'pan', points: [{ beat: 128, value: -0.5, curve: 'linear', tension: 0 }] }),
            ],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
        });

        expect(pan.setValueAtTime).toHaveBeenCalledWith(-0.5, 0);
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });

    it('schedules a persisted Verse Two send reduction and restoration on the offline send gain', () => {
        const gain = makeParam();
        const pan = makeParam();
        const hallSend = makeParam();
        const originalLevel = 0.5;
        const reducedLevel = originalLevel * 10 ** (-3 / 20);

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'send:bus-hall',
                    points: [
                        { beat: 0, value: originalLevel, curve: 'step', tension: 0 },
                        { beat: 16, value: reducedLevel, curve: 'step', tension: 0 },
                        { beat: 32, value: originalLevel, curve: 'step', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain } as unknown as GainNode,
            trackPanNode: { pan } as unknown as StereoPannerNode,
            sendAutomationParams: new Map([['send:bus-hall', hallSend as unknown as AudioParam]]),
            deviceEntries: [],
            durationSeconds: 20,
            defaultTempo: 120,
            changes: [],
            compensationDelaySec: 0.05,
        });

        expect(hallSend.setValueAtTime).toHaveBeenCalledWith(reducedLevel, 8.05);
        expect(hallSend.setValueAtTime).toHaveBeenCalledWith(originalLevel, 16.05);
        expect(hallSend.linearRampToValueAtTime).not.toHaveBeenCalled();
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it('ignores lanes belonging to a different track', () => {
        const gain = makeParam();
        const pan = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    trackId: 'other-track',
                    parameterId: 'gain',
                    points: [{ beat: 0, value: 0.9, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
        });

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });

    it('schedules a clip-scoped lane within its clip span (AU-12 parity with live)', () => {
        const gain = makeParam();
        const pan = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;
        // Clip spans beats 128..132 → 64..66s at 120bpm; region starts at 64s.
        const clipBounds = new Map([['clip-1', { startBeat: 128, endBeat: 132 }]]);

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    points: [
                        { beat: 128, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 132, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
            sampleRate: 44_100,
            clipBoundsById: clipBounds,
        });

        // Before AU-12 clip automation was dropped from the bounce; now it seeds
        // at the clip-start value and ramps to the clip-end value.
        expect(gain.setValueAtTime).toHaveBeenCalledWith(0.2, 0);
        expect(gain.linearRampToValueAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(0.8, 10);
    });

    it('skips a clip-scoped lane whose clip bounds are unknown (AU-12)', () => {
        const gain = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan: makeParam() } as unknown as StereoPannerNode;

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    trackId: 'track-1',
                    clipId: 'missing-clip',
                    parameterId: 'gain',
                    points: [
                        { beat: 128, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 132, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
            sampleRate: 44_100,
            clipBoundsById: new Map(),
        });

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

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:delay-time',
                    points: [{ beat: 0, value: 500, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-delay', deviceNode)],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
        });

        expect(deviceParam.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it('compiles a canonical native-device lane into frame-addressed automation segments', () => {
        const scheduleParam = vi.fn();

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'fermenter-1:filterCutoff',
                    points: [
                        { beat: 128, value: 200, curve: 'linear', tension: 0 },
                        { beat: 130, value: 2_000, curve: 'linear', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [
                {
                    deviceId: 'fermenter-1',
                    deviceType: 'fermenter',
                    strategy: {
                        resolveOfflineAutomation: (name: string) => {
                            if (name !== 'filterCutoff') {
                                return null;
                            }
                            return {
                                kind: 'segments',
                                apply: (segments) => {
                                    scheduleParam('filterCutoff', segments);
                                },
                            };
                        },
                    },
                },
            ],
            durationSeconds: 2,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
            sampleRate: 1_000,
        });

        // AU-2: the native worklet lane is slewed offline too. The first segment
        // starts at the seed value, intermediate segments glide, and the last
        // segment lands exactly on the target; frames stay within the render.
        type Segment = { startFrame: number; endFrame: number; startValue: number; endValue: number };
        const segments = scheduleParam.mock.calls[0]![1] as Segment[];
        expect(segments[0]!.startValue).toBe(200);
        expect(segments.at(-1)!.endValue).toBeCloseTo(2_000, 6);
        expect(segments.some((segment) => segment.startValue > 201 && segment.startValue < 1_999)).toBe(true);
        expect(segments.every((segment) => segment.startFrame >= 0 && segment.endFrame >= segment.startFrame)).toBe(
            true
        );
    });

    it('does not let a native strategy steal a legacy bare Web Audio lane', () => {
        const delayMix = makeParam();
        const delayNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{} as AudioNode, {} as AudioNode, { gain: delayMix } as unknown as AudioNode],
        };

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({ parameterId: 'delay-mix', points: [{ beat: 0, value: 0.7, curve: 'linear', tension: 0 }] }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [
                {
                    deviceId: 'fermenter-1',
                    deviceType: 'fermenter',
                    strategy: {
                        resolveOfflineAutomation: (name: string) => {
                            if (name !== 'filterCutoff') {
                                return null;
                            }
                            return { kind: 'segments', apply: () => {} };
                        },
                    },
                },
                webAudioEntry('delay-1', 'builtin-delay', delayNode),
            ],
            durationSeconds: 2,
            defaultTempo: 120,
            changes: [],
        });

        expect(delayMix.setValueAtTime).toHaveBeenCalledWith(0.7, 0);
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
        const entries = [webAudioEntry('device-1', 'builtin-gain', deviceNode)];
        if (includeSecond) {
            entries.push(webAudioEntry('device-2', 'builtin-gain', secondNode));
        }

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId,
                    points: [{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: entries,
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
        });

        expect(deviceParam.setValueAtTime.mock.calls.length > 0).toBe(expectedId === 'device-1');
        expect(secondParam.setValueAtTime.mock.calls.length > 0).toBe(expectedId === 'device-2');
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it('slews device automation offline to match the live IIR recurrence (AU-2)', () => {
        const deviceParam = makeParam();
        const deviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{ gain: deviceParam } as unknown as AudioNode],
        };
        // A stepped 0 -> 1 device lane. Live low-passes the step through its
        // exponential slew (alpha 0.4 at 100Hz); offline must reproduce the glide
        // rather than the instantaneous step it emitted before AU-2.
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:gain-level',
                    points: [
                        { beat: 128, value: 0, curve: 'step', tension: 0 },
                        { beat: 130, value: 1, curve: 'step', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-gain', deviceNode)],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
        });

        const ramps = deviceParam.linearRampToValueAtTime.mock.calls.map((call) => call[0] as number);
        const postStep = ramps.filter((value) => value > 0);
        // The slew produces the exact IIR sequence y[n]=y[n-1]+0.4*(1-y[n-1]):
        // 0.4, 0.64, 0.784, ... and settles exactly on the target.
        expect(postStep[0]).toBeCloseTo(0.4, 10);
        expect(postStep[1]).toBeCloseTo(0.64, 10);
        expect(postStep[2]).toBeCloseTo(0.784, 10);
        expect(ramps.at(-1)).toBe(1);
        expect(postStep.length).toBeGreaterThan(5);
    });

    it('clamps the slewed value, not the target it chases (the position live clamps in)', () => {
        const deviceParam = makeParam();
        const deviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [{ gain: deviceParam } as unknown as AudioNode],
        };
        // Live order is `slewStep` → `clampDeviceParameterValue` →
        // `laneSlew.set(clamped)`: the clamp lands on the smoothed value and is
        // fed back into the recurrence. A clamp is not affine, so it does not
        // commute with the IIR — clamping the target instead renders a visibly
        // different, slower glide. This lane steps 0 → 2 against a [0, 1] range.
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:gain-level',
                    points: [
                        { beat: 128, value: 0, curve: 'step', tension: 0 },
                        { beat: 130, value: 2, curve: 'step', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-gain', deviceNode)],
            deviceParameterLaw: {
                acceptsAutomation: () => true,
                clampValue: ({ value }) => Math.min(1, Math.max(0, value)),
                // Identity: this case is about *where* the clamp lands in the
                // recurrence. A rounding quantiser would collapse the 0.8 / 1
                // sequence it exists to observe.
                quantiseValue: ({ value }) => value,
            },
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
        });

        const postStep = deviceParam.linearRampToValueAtTime.mock.calls
            .map((call) => call[0] as number)
            .filter((value) => value > 0);
        // Clamped-after-slew: y1 = clamp(0 + 0.4·2) = 0.8, y2 = clamp(0.8 +
        // 0.4·1.2) = 1, settled. Clamping the target would have produced the
        // 0.4, 0.64, 0.784, … sequence of a chase toward 1 instead.
        expect(postStep).toHaveLength(2);
        expect(postStep[0]).toBeCloseTo(0.8, 10);
        expect(postStep[1]).toBeCloseTo(1, 10);
    });

    // These link tests carry the lane on `pan`, not `gain`. What they assert is
    // the linkScale algebra on the resolved scalar, and a `gain` lane now runs
    // through the fader level law (dB conversion + the [0,1] ceiling the
    // live path has always applied), which clamps the very signed/above-unity
    // scalars these cases exist to observe. `pan` carries the scalar through
    // unaltered, so every expected number below is unaffected by that law.
    it('follows a linked lane offline, scaled by linkScale (AU-3 parity with live)', () => {
        const pan = makeParam();
        const gainNode = { gain: makeParam() } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        const source = makeLane({
            id: 'source',
            trackId: 'source-track',
            parameterId: 'pan',
            points: [
                { beat: 128, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 130, value: 0.8, curve: 'linear', tension: 0 },
            ],
        });
        // A link-only follower on track-1: empty local points, inverting link.
        const follower: AutomationLane = {
            ...makeLane({ id: 'follower', trackId: 'track-1', parameterId: 'pan', points: [] }),
            linkedLaneId: 'source',
            linkScale: -1,
        };

        scheduleTrackAutomationFixture({
            lanes: [source, follower],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
        });

        // Before AU-3 offline read the follower's empty points and rendered
        // silent; now it renders the source curve inverted (linkScale -1).
        expect(pan.setValueAtTime).toHaveBeenCalledWith(-0.2, 0);
        expect(pan.linearRampToValueAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(-0.8, 10);
    });

    it('scales a linked bezier lane by the resolved scalar, not by pre-scaling points (AU-3)', () => {
        const pan = makeParam();
        const gainNode = { gain: makeParam() } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        // A bezier source whose control-point altitudes (cp1.y/cp2.y) shape the
        // segment. Pre-scaling point.value would leave cp1.y/cp2.y unscaled and
        // distort the curve; live evaluates the curve, then multiplies the scalar.
        const sourceA = {
            beat: 0,
            value: 0,
            curve: 'bezier' as const,
            tension: 0,
            cp1: { x: 0.33, y: 0.8 },
            cp2: { x: 0.66, y: 0.8 },
        };
        const sourceB = { beat: 4, value: 1, curve: 'linear' as const, tension: 0 };
        const source = makeLane({
            id: 'source',
            trackId: 'source-track',
            parameterId: 'pan',
            points: [sourceA, sourceB],
        });
        const follower: AutomationLane = {
            ...makeLane({ id: 'follower', trackId: 'track-1', parameterId: 'pan', points: [] }),
            linkedLaneId: 'source',
            linkScale: 2,
        };

        scheduleTrackAutomationFixture({
            lanes: [source, follower],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
        });

        // Altitude parity at the segment midpoint (beat 2 → 1s at 120bpm): offline
        // must equal the live-scaled kernel output, not the point-pre-scaled
        // distortion the pre-scale produced.
        const expected = evaluateAutomationCurve({ firstPoint: sourceA, secondPoint: sourceB, beat: 2 }) * 2;
        const calls = pan.linearRampToValueAtTime.mock.calls as [number, number][];
        const nearest = calls.reduce((best, call) => (Math.abs(call[1] - 1) < Math.abs(best[1] - 1) ? call : best));
        expect(nearest[0]).toBeCloseTo(expected, 6);
        // The scaled altitude clears 1.0 (endpoints scale to [0,2]); the pre-scale
        // bug landed it well under, so this also fences the regression.
        expect(expected).toBeGreaterThan(1.2);
    });

    it('renders a chained link cross-track, multiplying linkScale (AU-3)', () => {
        const pan = makeParam();
        const gainNode = { gain: makeParam() } as unknown as GainNode;
        const panNode = { pan } as unknown as StereoPannerNode;

        // C (source) <- B (scale 0.5) <- A (scale -1, on track-1). Cumulative -0.5.
        const laneC = makeLane({
            id: 'C',
            trackId: 't-c',
            parameterId: 'pan',
            points: [
                { beat: 128, value: 0.4, curve: 'linear', tension: 0 },
                { beat: 130, value: 0.4, curve: 'linear', tension: 0 },
            ],
        });
        const laneB: AutomationLane = {
            ...makeLane({ id: 'B', trackId: 't-b', parameterId: 'pan', points: [] }),
            linkedLaneId: 'C',
            linkScale: 0.5,
        };
        const laneA: AutomationLane = {
            ...makeLane({ id: 'A', trackId: 'track-1', parameterId: 'pan', points: [] }),
            linkedLaneId: 'B',
            linkScale: -1,
        };

        scheduleTrackAutomationFixture({
            lanes: [laneA, laneB, laneC],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
        });

        expect(pan.setValueAtTime).toHaveBeenCalledWith(-0.2, 0);
    });

    it('skips a link cycle offline, leaving the param untouched (AU-3)', () => {
        const gain = makeParam();
        const gainNode = { gain } as unknown as GainNode;
        const panNode = { pan: makeParam() } as unknown as StereoPannerNode;

        const laneA: AutomationLane = {
            ...makeLane({ id: 'A', trackId: 'track-1', parameterId: 'gain', points: [] }),
            linkedLaneId: 'B',
        };
        const laneB: AutomationLane = {
            ...makeLane({ id: 'B', trackId: 't-b', parameterId: 'gain', points: [] }),
            linkedLaneId: 'A',
        };

        scheduleTrackAutomationFixture({
            lanes: [laneA, laneB],
            trackId: 'track-1',
            trackGainNode: gainNode,
            trackPanNode: panNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
        });

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });
});

/**
 * AU-2 / F1: a **stepped** device parameter has to leave the offline render as
 * the same integer the monitor delivers.
 *
 * The live applier filters continuously and quantises once at the delivery
 * (`applyAutomation`: `slewStep` → clamp → `quantiseDeviceParameterValue` →
 * `updateDeviceParam`). Offline built its slew from `clampValue` alone and
 * emitted the smoothed number verbatim, so a lane on `bacteria/bitDepth`
 * (declared `int`, 1..24) had the monitor stepping down 14, 13, 12 while the
 * bounce handed the worklet 14.4, 13.44, 12.864, 12.5184 — the exact class of
 * monitor/bounce divergence AU-2 exists to close.
 *
 * The sequence below is arithmetic on the shared kernel, not a transcript of
 * whatever the code currently emits. α = 0.4 from 16 toward 12:
 *   14.4, 13.44, 12.864, 12.5184, 12.31104, 12.186624, …
 * `Math.round` of those is 14, 13, 13, 13, 12, 12 — note the 12.5184 → 13,
 * which is why the ride visits 13 three times before it reaches 12.
 *
 * The leading 16 is the seed, not a delivery: offline emits it as the `set`
 * event that holds the parameter before the glide starts, and live's engine is
 * already holding the same stored base (its seed tick is sub-epsilon and
 * dispatches nothing). It is asserted because the seed goes through the same
 * emission path and would otherwise be the one unquantised value in the stream.
 */
const BIT_DEPTH_LIVE_DELIVERY = [16, 14, 13, 12] as const;

/** Consecutive duplicates collapsed — the sequence of *distinct* indices. */
function distinctRun(values: readonly number[]): number[] {
    const run: number[] = [];
    for (const value of values) {
        if (run.at(-1) !== value) {
            run.push(value);
        }
    }
    return run;
}

describe('scheduleTrackAutomation — stepped device parameters offline', () => {
    /** Arrangement's shipped law for `bacteria/bitDepth`, as bootstrap injects it. */
    const bitDepthLaw = {
        acceptsAutomation: () => true,
        clampValue: ({ value }: { deviceType: string; paramId: string; value: number }) =>
            clampDeviceParameterValue({ deviceType: 'bacteria', paramId: 'bitDepth', value }),
        quantiseValue: ({ value }: { deviceType: string; paramId: string; value: number }) =>
            quantiseDeviceParameterValue({ deviceType: 'bacteria', paramId: 'bitDepth', value }),
    };

    it('emits the integers live delivers on a worklet (segments) lane, not the filter state', () => {
        const scheduleParam = vi.fn();

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    // 16 is the parameter's default and 12 is not, so the two
                    // endpoints disagree under rounding; a ride parked at the
                    // default would satisfy an integer assertion vacuously.
                    parameterId: 'bacteria-1:bitDepth',
                    points: [
                        { beat: 0, value: 16, curve: 'step', tension: 0 },
                        { beat: 2, value: 12, curve: 'step', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [
                {
                    deviceId: 'bacteria-1',
                    deviceType: 'bacteria',
                    strategy: {
                        resolveOfflineAutomation: (name: string) =>
                            name === 'bitDepth'
                                ? {
                                      kind: 'segments',
                                      apply: (compiled) => {
                                          scheduleParam(compiled);
                                      },
                                  }
                                : null,
                    },
                },
            ],
            deviceParameterLaw: bitDepthLaw,
            durationSeconds: 3,
            defaultTempo: 120,
            changes: [],
            sampleRate: 1_000,
        });

        type Segment = { startFrame: number; endFrame: number; startValue: number; endValue: number };
        const segments = scheduleParam.mock.calls[0]![0] as Segment[];
        const emitted = segments.map((segment) => segment.startValue);

        expect(emitted.filter((value) => !Number.isInteger(value))).toEqual([]);
        expect(distinctRun(emitted)).toEqual([...BIT_DEPTH_LIVE_DELIVERY]);
    });

    it('quantises an AudioParam-backed lane in device space, then maps forward through the binding', () => {
        const audioParam = makeParam();
        // A binding whose affine is not the identity: the quantiser is a law on
        // the *device* value, so it has to run before scale/offset, exactly where
        // `clampScaledStep` already puts the clamp. Quantising in AudioParam
        // units instead would snap to a grid of 1 *there* — a tenth of a bit.
        const scale = 10;
        const offset = 3;

        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'bacteria-1:bitDepth',
                    points: [
                        { beat: 0, value: 16, curve: 'step', tension: 0 },
                        { beat: 2, value: 12, curve: 'step', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [
                {
                    deviceId: 'bacteria-1',
                    deviceType: 'bacteria',
                    strategy: {
                        resolveOfflineAutomation: (name: string) =>
                            name === 'bitDepth'
                                ? {
                                      kind: 'audioParam',
                                      targets: [{ audioParam: audioParam as unknown as AudioParam, scale, offset }],
                                  }
                                : null,
                    },
                },
            ],
            deviceParameterLaw: bitDepthLaw,
            durationSeconds: 3,
            defaultTempo: 120,
            changes: [],
        });

        const ramps = audioParam.linearRampToValueAtTime.mock.calls.map((call) => call[0] as number);
        const deviceSpace = ramps.map((value) => (value - offset) / scale);

        // Mapping back through the affine reintroduces float error at the 1e-15
        // level, so the integrality check is made at 1e-9, well below the 1.0
        // grid it is testing for and well above the noise.
        const rounded = deviceSpace.map((value) => Math.round(value * 1e9) / 1e9);
        expect(rounded.filter((value) => !Number.isInteger(value))).toEqual([]);
        expect(distinctRun(rounded)).toEqual([...BIT_DEPTH_LIVE_DELIVERY]);
    });
});
