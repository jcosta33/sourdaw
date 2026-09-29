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

function makeParamDouble() {
    return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
}

/**
 * Records the writes one schedule lands on an AudioParam in true insertion
 * order — the order Web Audio breaks equal-time collisions with (a later
 * insertion wins). The mock context's own AudioParam keeps two separate call
 * arrays, which cannot say which of a same-time set/linear pair was inserted
 * later, so `scheduleEqLanes` points the resolved param's writes at one of
 * these instead.
 */
function makeParamRecorder() {
    const journal: RecordedParamEvent[] = [];
    return {
        journal,
        setValueAtTime: vi.fn((value: number, time: number) => {
            journal.push({ type: 'set', time, value });
        }),
        linearRampToValueAtTime: vi.fn((value: number, time: number) => {
            journal.push({ type: 'linear', time, value });
        }),
    };
}

type ParamRecorder = ReturnType<typeof makeParamRecorder>;

function recordedParamEvents(param: ParamRecorder): RecordedParamEvent[] {
    return [...param.journal].sort((first, second) => first.time - second.time);
}

function rampValueBetween(current: RecordedParamEvent, ramp: RecordedParamEvent, time: number): number {
    const span = ramp.time - current.time;
    return current.value + ((ramp.value - current.value) * (time - current.time)) / span;
}

/**
 * The value the recorded timeline holds at `time`, under Web Audio's own
 * semantics: a `linear` interpolates from the previous event's TIME as well
 * as its value, so a query inside a pending ramp takes the fraction of that
 * span — it must not return the value the timeline last held.
 */
function paramValueAt(events: RecordedParamEvent[], time: number): number {
    let value = 0;
    let current: RecordedParamEvent | undefined;
    for (const event of events) {
        if (event.time > time) {
            if (event.type === 'linear' && current && event.time > current.time) {
                value = rampValueBetween(current, event, time);
            }
            break;
        }
        if (event.type === 'linear' && current && event.time > current.time) {
            value = rampValueBetween(current, event, time);
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

/** A clip lane on the same window whose points stop two beats before the clip does. */
function shortClipLane(): AutomationLane {
    return makeLane({
        id: 'lane-clip-short',
        clipId: 'clip-a',
        parameterId: 'device-1:eq-low-gain',
        parameterName: 'EQ Low Gain',
        minValue: 0,
        maxValue: 24,
        points: [
            { beat: 2, value: 9, curve: 'linear', tension: 0 },
            { beat: 4, value: 9, curve: 'linear', tension: 0 },
        ],
    });
}

/** A clip lane carrying a single point inside its window. */
function onePointClipLane(): AutomationLane {
    return makeLane({
        id: 'lane-clip-one-point',
        clipId: 'clip-a',
        parameterId: 'device-1:eq-low-gain',
        parameterName: 'EQ Low Gain',
        minValue: 0,
        maxValue: 24,
        points: [{ beat: 3, value: 9, curve: 'linear', tension: 0 }],
    });
}

/**
 * A clip lane whose window opens on a ramp that starts at the exact value the
 * track lane holds — a value-continuous boundary, where the merge could
 * believe no event is needed at the window's start frame.
 */
function rampFromHeldClipLane(): AutomationLane {
    return makeLane({
        id: 'lane-clip-ramp-from-held',
        clipId: 'clip-a',
        parameterId: 'device-1:eq-low-gain',
        parameterName: 'EQ Low Gain',
        minValue: 0,
        maxValue: 24,
        points: [
            { beat: 2, value: 3, curve: 'linear', tension: 0 },
            { beat: 6, value: 9, curve: 'linear', tension: 0 },
        ],
    });
}

/** A clip lane that holds 8 and stops two beats before its window does. */
function heldShortClipLane(): AutomationLane {
    return makeLane({
        id: 'lane-clip-held',
        clipId: 'clip-a',
        parameterId: 'device-1:eq-low-gain',
        parameterName: 'EQ Low Gain',
        minValue: 0,
        maxValue: 24,
        points: [
            { beat: 2, value: 8, curve: 'linear', tension: 0 },
            { beat: 4, value: 8, curve: 'linear', tension: 0 },
        ],
    });
}

/**
 * A track lane that holds 8 through the clip's window end and only then ramps
 * away — the stretched clip tail hands back into a ramp that opens on the
 * value the timeline already holds.
 */
function rampAfterHandbackTrackLane(): AutomationLane {
    return makeLane({
        id: 'lane-track-handback',
        parameterId: 'device-1:eq-low-gain',
        parameterName: 'EQ Low Gain',
        minValue: 0,
        maxValue: 24,
        points: [
            { beat: 0, value: 8, curve: 'linear', tension: 0 },
            { beat: 6, value: 8, curve: 'linear', tension: 0 },
            { beat: 10, value: 16, curve: 'linear', tension: 0 },
        ],
    });
}

/** A clip lane scoped entirely before the export region. */
function earlyClipLane(): AutomationLane {
    return makeLane({
        id: 'lane-clip-early',
        clipId: 'clip-early',
        parameterId: 'device-1:eq-low-gain',
        parameterName: 'EQ Low Gain',
        minValue: 0,
        maxValue: 24,
        points: [
            { beat: -4, value: 9, curve: 'linear', tension: 0 },
            { beat: -2, value: 9, curve: 'linear', tension: 0 },
        ],
    });
}

const EARLY_CLIP_BOUNDS = new Map([['clip-early', { startBeat: -5, endBeat: -1 }]]);

const SHORT_CLIP_ORDERS = [
    ['track lane first', (): AutomationLane[] => [eqTrackLane(), shortClipLane()]],
    ['clip lane first', (): AutomationLane[] => [shortClipLane(), eqTrackLane()]],
] as const;

const ONE_POINT_ORDERS = [
    ['track lane first', (): AutomationLane[] => [eqTrackLane(), onePointClipLane()]],
    ['clip lane first', (): AutomationLane[] => [onePointClipLane(), eqTrackLane()]],
] as const;

const EARLY_CLIP_ORDERS = [
    ['track lane first', (): AutomationLane[] => [eqTrackLane(), earlyClipLane()]],
    ['clip lane first', (): AutomationLane[] => [earlyClipLane(), eqTrackLane()]],
] as const;

function scheduleEqLanes(
    lanes: AutomationLane[],
    clipBoundsById: Map<string, { startBeat: number; endBeat: number }> = SHARED_CLIP_BOUNDS
): ParamRecorder {
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
    const recorder = makeParamRecorder();
    const writable = eqParam as unknown as {
        setValueAtTime: ParamRecorder['setValueAtTime'];
        linearRampToValueAtTime: ParamRecorder['linearRampToValueAtTime'];
    };
    writable.setValueAtTime = recorder.setValueAtTime;
    writable.linearRampToValueAtTime = recorder.linearRampToValueAtTime;
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
        clipBoundsById,
    });
    return recorder;
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

const RAMP_FROM_HELD_ORDERS = [
    ['track lane first', (): AutomationLane[] => [eqTrackLane(), rampFromHeldClipLane()]],
    ['clip lane first', (): AutomationLane[] => [rampFromHeldClipLane(), eqTrackLane()]],
] as const;

const HANDBACK_ORDERS = [
    ['track lane first', (): AutomationLane[] => [rampAfterHandbackTrackLane(), heldShortClipLane()]],
    ['clip lane first', (): AutomationLane[] => [heldShortClipLane(), rampAfterHandbackTrackLane()]],
] as const;

/**
 * The same lanes through the `segments`-bound consumer, at the audioParam
 * fixture's sample rate — the merge the applied splice must be identical to.
 * Sampled instants sit a quarter second off the integer slew grid, so no
 * query lands on an event frame where equal-time insertion order would
 * decide the value.
 */
function identityAssertAtSeams(
    order: string,
    events: RecordedParamEvent[],
    segments: readonly OfflineAutomationSegment[]
): void {
    for (let time = 0.25; time <= 9.75; time += 0.5) {
        expect(paramValueAt(events, time), `${order}: the splice holds at ${time}s`).toBeCloseTo(
            segmentValueAtTime(segments, time * 100),
            9
        );
    }
}

/** The merged `segments` stream the same lanes resolve on the segments-bound family. */
function eqSegmentsStreamFor(lanes: AutomationLane[]): OfflineAutomationSegment[] {
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
    if (segmentCalls.length !== 1) {
        throw new Error('expected exactly one segments apply');
    }
    return segmentCalls[0]!;
}

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

    it('anchors a window-opening ramp that starts at the value the timeline already holds, in both lane orders', () => {
        for (const [order, buildLanes] of RAMP_FROM_HELD_ORDERS) {
            const lanes = buildLanes();
            const events = recordedParamEvents(scheduleEqLanes(lanes));
            const segments = eqSegmentsStreamFor(lanes);
            expect(
                events.some((event) => event.type === 'set' && event.time === 2),
                `${order}: the ramp anchors on the window's first frame`
            ).toBe(true);
            // The clip ramp opens on the track's held 3. Web Audio interpolates
            // the ramp from the previous event's time as well as its value, so
            // without the anchor the ramp reaches back over the hold in front
            // of it and the timeline drifts off 3 before the window even opens.
            expect(paramValueAt(events, 1), `${order}: the hold in front of the window survives`).toBeCloseTo(3, 9);
            identityAssertAtSeams(order, events, segments);
        }
    });

    it('anchors the ramp a stretched clip tail hands back to, in both lane orders', () => {
        for (const [order, buildLanes] of HANDBACK_ORDERS) {
            const lanes = buildLanes();
            const events = recordedParamEvents(scheduleEqLanes(lanes));
            const segments = eqSegmentsStreamFor(lanes);
            expect(
                events.some((event) => event.type === 'set' && event.time === 6),
                `${order}: the handback ramp anchors on the window's last frame`
            ).toBe(true);
            // The clip tail is stretched to the window end holding 8, and the
            // track's ramp away opens on that same 8: without an anchor on the
            // handback frame the ramp reaches back to the timeline's first
            // event and bleeds into the stretched hold.
            expect(paramValueAt(events, 5), `${order}: the stretched hold survives the handback`).toBeCloseTo(8, 9);
            identityAssertAtSeams(order, events, segments);
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

describe('scheduleTrackAutomation — a clip lane owns every frame of its clip window, not just its compiled extent', () => {
    it('plays the clip value to the window end when its points stop early, in both lane orders', () => {
        for (const [order, buildLanes] of SHORT_CLIP_ORDERS) {
            const events = recordedParamEvents(scheduleEqLanes(buildLanes()));
            expect(paramValueAt(events, 1), `${order}: before the window the track lane plays`).toBeCloseTo(3, 9);
            expect(paramValueAt(events, 4), `${order}: at the last point the clip lane plays`).toBeCloseTo(9, 9);
            // The points stop at 4 but the clip plays to 6: the value the lane
            // held at its last point owns the window tail — live holds the
            // param there, so a track value inside the window is the defect.
            expect(
                paramValueAt(events, 5.5),
                `${order}: the window tail past the last point stays the clip's`
            ).toBeCloseTo(9, 9);
            expect(paramValueAt(events, 7), `${order}: past the window the track lane plays`).toBeCloseTo(3, 9);
        }
    });

    it('holds a one-point clip lane’s value across its whole window, in both lane orders', () => {
        for (const [order, buildLanes] of ONE_POINT_ORDERS) {
            const events = recordedParamEvents(scheduleEqLanes(buildLanes()));
            expect(paramValueAt(events, 1), `${order}: before the window the track lane plays`).toBeCloseTo(3, 9);
            expect(paramValueAt(events, 3), `${order}: the single point’s value`).toBeCloseTo(9, 9);
            expect(paramValueAt(events, 5.9), `${order}: held to the window end`).toBeCloseTo(9, 9);
            expect(paramValueAt(events, 7), `${order}: past the window the track lane plays`).toBeCloseTo(3, 9);
        }
    });
});

describe('scheduleTrackAutomation — a clip lane whose window misses the export region compiles to nothing', () => {
    it('schedules the export cleanly with the track lane applying alone, in both lane orders', () => {
        for (const [order, buildLanes] of EARLY_CLIP_ORDERS) {
            const events = recordedParamEvents(scheduleEqLanes(buildLanes(), EARLY_CLIP_BOUNDS));
            for (const time of [1, 5, 9]) {
                expect(paramValueAt(events, time), `${order}: the track lane applies alone at ${time}`).toBeCloseTo(
                    3,
                    9
                );
            }
        }
    });
});
