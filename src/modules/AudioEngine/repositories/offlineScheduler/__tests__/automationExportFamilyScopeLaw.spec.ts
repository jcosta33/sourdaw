import { expect, vi, describe, it } from 'vitest';

import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { resolveDeviceParam } from '../../../services/deviceResolution';
import { createOfflineDeviceNode, type OfflineDeviceNode } from '../../deviceNodeFactory';
import { type OfflineAutomationBinding, type OfflineAutomationSegment } from '../../deviceStrategy/AudioDeviceStrategy';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

/**
 * The exported curve a recorded `setValueAtTime`/`linearRampToValueAtTime`
 * timeline plays. Web Audio sorts the timeline by time and lets a later
 * insertion win at an equal time — which is exactly the mechanism the defect
 * rides: two lanes scheduling one parameter collide on the same slew-grid
 * times, so whichever lane schedules last decides the shared instants. The
 * sort below must therefore be stable, and `Array#sort` is.
 */
type RecordedParamEvent = { type: 'set' | 'linear'; time: number; value: number };

type ParamDouble = ReturnType<typeof makeParamDouble>;

function makeParamDouble() {
    return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
}

function recordedParamEvents(param: ParamDouble): RecordedParamEvent[] {
    const events: RecordedParamEvent[] = [];
    for (const [value, time] of param.setValueAtTime.mock.calls as Array<[number, number]>) {
        events.push({ type: 'set', time, value });
    }
    for (const [value, time] of param.linearRampToValueAtTime.mock.calls as Array<[number, number]>) {
        events.push({ type: 'linear', time, value });
    }
    return events.sort((first, second) => first.time - second.time);
}

function paramValueAt(events: RecordedParamEvent[], time: number): number {
    let value = 0;
    let current: RecordedParamEvent | undefined;
    for (const event of events) {
        if (event.time > time) {
            break;
        }
        if (event.type === 'linear' && current && event.time > current.time) {
            const span = event.time - current.time;
            value = current.value + ((event.value - current.value) * (time - current.time)) / span;
        } else {
            value = event.value;
        }
        current = event;
    }
    return value;
}

/** The value a merged segment stream holds at a frame (the worklet's own semantics). */
function segmentValueAtTime(segments: readonly OfflineAutomationSegment[], frame: number): number {
    let value = 0;
    for (const segment of segments) {
        if (segment.startFrame > frame) {
            break;
        }
        if (segment.endFrame <= segment.startFrame || frame >= segment.endFrame) {
            value = segment.endValue;
            continue;
        }
        const fraction = (frame - segment.startFrame) / (segment.endFrame - segment.startFrame);
        value = segment.startValue + (segment.endValue - segment.startValue) * fraction;
    }
    return value;
}

// Identity beat→seconds and a coarse integer slew tick keep every event and
// write time an exact integer, so the two lanes' schedules collide exactly the
// way they do on the shipping 10 ms grid — deterministically, without leaning
// on float-accidental near-collisions.
const IDENTITY_BEAT = (beat: number): number => beat;
const SHARED_CLIP_BOUNDS = new Map([['clip-a', { startBeat: 2, endBeat: 6 }]]);

function makeParam() {
    return makeParamDouble();
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

function webAudioEntry(deviceId: string, deviceType: string, node: OfflineDeviceNode) {
    return { deviceId, deviceType, contributesAudio: true, strategy: new WebAudioDeviceStrategy(node, deviceType) };
}

/** A `segments` consumer on the same (device, parameter), for the equivalence cases. */
function segmentsEntry(bareParameterId: string, calls: OfflineAutomationSegment[][]) {
    return {
        deviceId: 'device-1',
        deviceType: 'bacteria',
        strategy: {
            resolveOfflineAutomation: (name: string): OfflineAutomationBinding | null => {
                if (name !== bareParameterId) {
                    return null;
                }
                return {
                    kind: 'segments',
                    apply: (segments: readonly OfflineAutomationSegment[]) => void calls.push([...segments]),
                };
            },
        },
    };
}

function eqTrackLane(): AutomationLane {
    return makeLane({
        id: 'lane-track',
        parameterId: 'device-1:eq-low-gain',
        parameterName: 'EQ Low Gain',
        minValue: 0,
        maxValue: 24,
        points: [
            { beat: 0, value: 3, curve: 'linear', tension: 0 },
            { beat: 10, value: 3, curve: 'linear', tension: 0 },
        ],
    });
}

function eqClipLane(): AutomationLane {
    return makeLane({
        id: 'lane-clip',
        clipId: 'clip-a',
        parameterId: 'device-1:eq-low-gain',
        parameterName: 'EQ Low Gain',
        minValue: 0,
        maxValue: 24,
        points: [
            { beat: 2, value: 9, curve: 'linear', tension: 0 },
            { beat: 6, value: 9, curve: 'linear', tension: 0 },
        ],
    });
}

function scheduleEqLanes(lanes: AutomationLane[]): ParamDouble {
    const node = createOfflineDeviceNode({
        context: asBaseAudioContext(createMockAudioContext()),
        deviceType: 'builtin-eq',
    });
    if (!node) {
        throw new Error('expected a builtin-eq offline node');
    }
    const eqParam = resolveDeviceParam('builtin-eq', 'eq-low-gain', node);
    if (!eqParam) {
        throw new Error('expected eq-low-gain to resolve an AudioParam');
    }
    scheduleTrackAutomationFixture({
        lanes,
        trackId: 'track-1',
        trackGainNode: { gain: makeParam() } as unknown as GainNode,
        trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
        deviceEntries: [webAudioEntry('device-1', 'builtin-eq', node)],
        durationSeconds: 10,
        defaultTempo: 120,
        changes: [],
        projectBeatToSeconds: IDENTITY_BEAT,
        sampleRate: 100,
        slewTickSeconds: 1,
        clipBoundsById: SHARED_CLIP_BOUNDS,
    });
    return eqParam as unknown as ParamDouble;
}

/** Arrangement's shipped law for `builtin-limiter/lim-ceiling` (as the #4437 spec states it). */
const LIMITER_CEILING_LAW = {
    acceptsAutomation: () => true,
    clampValue: ({ value }: { deviceType: string; paramId: string; value: number }) =>
        clampDeviceParameterValue({ deviceType: 'builtin-limiter', paramId: 'lim-ceiling', value }),
    quantiseValue: ({ value }: { value: number }) => value,
};

/** The same two-lane project, retargeted onto the limiter ceiling's `curveWrite` binding. */
function ceilingLanes(eqLanes: AutomationLane[]): AutomationLane[] {
    return eqLanes.map((lane) =>
        makeLane({
            ...ceilingLaneShape(),
            id: lane.id,
            clipId: lane.clipId,
            points: ceilingLanePoints(Boolean(lane.clipId)),
        })
    );
}

function ceilingLaneShape() {
    return {
        parameterId: 'device-1:lim-ceiling',
        parameterName: 'Ceiling',
        minValue: -3,
        maxValue: 0,
    };
}

function ceilingLanePoints(clipScoped: boolean): AutomationLane['points'] {
    if (clipScoped) {
        return [
            { beat: 2, value: -0.5, curve: 'linear', tension: 0 },
            { beat: 6, value: -0.5, curve: 'linear', tension: 0 },
        ];
    }
    return [
        { beat: 0, value: -2, curve: 'linear', tension: 0 },
        { beat: 10, value: -2, curve: 'linear', tension: 0 },
    ];
}

function makeLimiterNode(): OfflineDeviceNode {
    const node = createOfflineDeviceNode({
        context: asBaseAudioContext(createMockAudioContext()),
        deviceType: 'builtin-limiter',
    });
    if (!node) {
        throw new Error('expected a builtin-limiter offline node');
    }
    return node;
}

function scheduleCeilingLanes(lanes: AutomationLane[]) {
    const node = makeLimiterNode();
    const calls: { time: number | undefined; run: () => void }[] = [];
    scheduleTrackAutomationFixture({
        lanes,
        trackId: 'track-1',
        trackGainNode: { gain: makeParam() } as unknown as GainNode,
        trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
        deviceEntries: [webAudioEntry('device-1', 'builtin-limiter', node)],
        deviceParameterLaw: LIMITER_CEILING_LAW,
        durationSeconds: 10,
        defaultTempo: 120,
        changes: [],
        projectBeatToSeconds: IDENTITY_BEAT,
        sampleRate: 1000,
        slewTickSeconds: 1,
        clipBoundsById: SHARED_CLIP_BOUNDS,
        scheduleFrame: (time, run) => {
            calls.push({ time, run });
        },
    });
    const ceiling = node.namedNodes!.ceiling as GainNode;
    // Runs the recorded writes the suspend handler does, in recording order,
    // and answers the ceiling the device holds at `time`: at colliding times
    // the later-recorded write wins, which is the mechanism under test.
    return (time: number): number => {
        let value = 0;
        for (const call of calls) {
            call.run();
            if (call.time !== undefined && call.time <= time) {
                value = ceiling.gain.value;
            }
        }
        return value;
    };
}

const BOTH_LANE_ORDERS = [
    ['track lane first', (): AutomationLane[] => [eqTrackLane(), eqClipLane()]],
    ['clip lane first', (): AutomationLane[] => [eqClipLane(), eqTrackLane()]],
] as const;

describe('scheduleTrackAutomation — the scope law reaches the audioParam and curveWrite export families', () => {
    it('exports the clip lane curve inside its window in both lane orders on an audioParam device (builtin-eq eq-low-gain)', () => {
        for (const [order, buildLanes] of BOTH_LANE_ORDERS) {
            const events = recordedParamEvents(scheduleEqLanes(buildLanes()));
            expect(paramValueAt(events, 1), `${order}: before the window the track lane plays`).toBeCloseTo(3, 9);
            expect(paramValueAt(events, 4), `${order}: inside the window the clip lane plays`).toBeCloseTo(9, 9);
            expect(paramValueAt(events, 8), `${order}: after the window the track lane plays`).toBeCloseTo(3, 9);
        }
    });

    it('splices the audioParam export to the same curve the segments-bound merge resolves for the same lanes', () => {
        for (const [, buildLanes] of BOTH_LANE_ORDERS) {
            const lanes = buildLanes();
            const events = recordedParamEvents(scheduleEqLanes(lanes));

            const segmentCalls: OfflineAutomationSegment[][] = [];
            scheduleTrackAutomationFixture({
                lanes,
                trackId: 'track-1',
                trackGainNode: { gain: makeParam() } as unknown as GainNode,
                trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
                deviceEntries: [segmentsEntry('eq-low-gain', segmentCalls)],
                durationSeconds: 10,
                defaultTempo: 120,
                changes: [],
                projectBeatToSeconds: IDENTITY_BEAT,
                sampleRate: 100,
                slewTickSeconds: 1,
                clipBoundsById: SHARED_CLIP_BOUNDS,
            });
            expect(segmentCalls).toHaveLength(1);

            for (let time = 0.5; time <= 9.5; time += 0.5) {
                expect(paramValueAt(events, time)).toBeCloseTo(segmentValueAtTime(segmentCalls[0]!, time * 100), 9);
            }
        }
    });

    it('exports the clip lane ceiling inside its window in both lane orders on the curveWrite family (limiter ceiling)', () => {
        for (const [order, buildLanes] of BOTH_LANE_ORDERS) {
            const ceilingAt = scheduleCeilingLanes(ceilingLanes(buildLanes()));
            expect(ceilingAt(1), `${order}: before the window the track lane holds`).toBeCloseTo(dbToGain(-2), 9);
            expect(ceilingAt(4), `${order}: inside the window the clip lane holds`).toBeCloseTo(dbToGain(-0.5), 9);
            expect(ceilingAt(8), `${order}: after the window the track lane holds`).toBeCloseTo(dbToGain(-2), 9);
        }
    });

    it('splices the curveWrite schedule to the same curve the segments-bound merge resolves for the same lanes', () => {
        for (const [, buildLanes] of BOTH_LANE_ORDERS) {
            const eqLanes = buildLanes();
            const ceilingAt = scheduleCeilingLanes(ceilingLanes(eqLanes));

            const segmentCalls: OfflineAutomationSegment[][] = [];
            scheduleTrackAutomationFixture({
                lanes: ceilingLanes(eqLanes),
                trackId: 'track-1',
                trackGainNode: { gain: makeParam() } as unknown as GainNode,
                trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
                deviceEntries: [segmentsEntry('lim-ceiling', segmentCalls)],
                durationSeconds: 10,
                defaultTempo: 120,
                changes: [],
                projectBeatToSeconds: IDENTITY_BEAT,
                sampleRate: 1000,
                slewTickSeconds: 1,
                clipBoundsById: SHARED_CLIP_BOUNDS,
            });
            expect(segmentCalls).toHaveLength(1);

            for (let time = 0.5; time <= 9.5; time += 0.5) {
                expect(ceilingAt(time)).toBeCloseTo(dbToGain(segmentValueAtTime(segmentCalls[0]!, time * 1000)), 9);
            }
        }
    });
});
