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
 * #4909: a clip lane carrying exactly ONE point compiles to a lone zero-length
 * terminator at its clip window start. The scope law (#4736) gives that lane
 * every span its clip window covers, so the export must hold the single value
 * across the whole window — live writes it at lane entry (#4741), and a track
 * lane moving underneath must not take the window back. The oracle: a track
 * lane moving over beats 0-16 and a one-point clip lane on a clip at beats 4-8
 * on the same device parameter export the clip value across beats 4-8.
 *
 * Outside the window the export must equal the same schedule with the clip
 * lane removed — the track lane's (slewed) own curve, untouched — which keeps
 * the expectations exact without restating the device slew here.
 */

/**
 * The exported curve a recorded `setValueAtTime`/`linearRampToValueAtTime`
 * timeline plays — Web Audio's own semantics, as `automationExportFamilyScopeLaw`
 * states them.
 */
type RecordedParamEvent = { type: 'set' | 'linear'; time: number; value: number };

function makeParamDouble() {
    return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
}

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

function paramValueAt(events: RecordedParamEvent[], time: number): number {
    let value = 0;
    let current: RecordedParamEvent | undefined;
    for (const event of events) {
        if (event.time > time) {
            if (event.type === 'linear' && current && event.time > current.time) {
                const span = event.time - current.time;
                value = current.value + ((event.value - current.value) * (time - current.time)) / span;
            }
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

const IDENTITY_BEAT = (beat: number): number => beat;
const ORACLE_CLIP_BOUNDS = new Map([['clip-oracle', { startBeat: 4, endBeat: 8 }]]);

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

/** A `segments` consumer on the same (device, parameter). */
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

/** The issue's track lane: values moving over beats 0-16 (3 at beat 0, 7 at beat 16). */
function movingTrackLane(parameterId: string, minValue: number, maxValue: number): AutomationLane {
    return makeLane({
        id: 'lane-track',
        parameterId,
        parameterName: 'Oracle Param',
        minValue,
        maxValue,
        points: [
            { beat: 0, value: 3, curve: 'linear', tension: 0 },
            { beat: 16, value: 7, curve: 'linear', tension: 0 },
        ],
    });
}

/** The issue's clip lane: one point on a clip spanning beats 4-8. */
function onePointClipLane(parameterId: string, minValue: number, maxValue: number, value: number): AutomationLane {
    return makeLane({
        id: 'lane-clip',
        clipId: 'clip-oracle',
        parameterId,
        parameterName: 'Oracle Param',
        minValue,
        maxValue,
        points: [{ beat: 5, value, curve: 'linear', tension: 0 }],
    });
}

const AUDIO_PARAM_LAW = {
    acceptsAutomation: () => true,
    clampValue: ({ value }: { value: number }) => value,
    quantiseValue: ({ value }: { value: number }) => value,
};

function scheduleEqLanes(lanes: AutomationLane[]): ParamRecorder {
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
        deviceParameterLaw: AUDIO_PARAM_LAW,
        durationSeconds: 20,
        defaultTempo: 120,
        changes: [],
        projectBeatToSeconds: IDENTITY_BEAT,
        sampleRate: 100,
        slewTickSeconds: 1,
        clipBoundsById: ORACLE_CLIP_BOUNDS,
    });
    return recorder;
}

/** The merged `segments` stream the given lanes resolve on the segments-bound family. */
function oracleSegmentsStreamFor(lanes: AutomationLane[]): OfflineAutomationSegment[] {
    const segmentCalls: OfflineAutomationSegment[][] = [];
    scheduleTrackAutomationFixture({
        lanes,
        trackId: 'track-1',
        trackGainNode: { gain: makeParam() } as unknown as GainNode,
        trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
        deviceEntries: [segmentsEntry('eq-low-gain', segmentCalls)],
        durationSeconds: 20,
        defaultTempo: 120,
        changes: [],
        projectBeatToSeconds: IDENTITY_BEAT,
        sampleRate: 100,
        slewTickSeconds: 1,
        clipBoundsById: ORACLE_CLIP_BOUNDS,
    });
    if (segmentCalls.length !== 1) {
        throw new Error('expected exactly one segments apply');
    }
    return segmentCalls[0]!;
}

/** Arrangement's shipped law for `builtin-limiter/lim-ceiling` (as the #4437 spec states it). */
const LIMITER_CEILING_LAW = {
    acceptsAutomation: () => true,
    clampValue: ({ value }: { deviceType: string; paramId: string; value: number }) =>
        clampDeviceParameterValue({ deviceType: 'builtin-limiter', paramId: 'lim-ceiling', value }),
    quantiseValue: ({ value }: { value: number }) => value,
};

function scheduleCeilingLanes(lanes: AutomationLane[]) {
    const node = createOfflineDeviceNode({
        context: asBaseAudioContext(createMockAudioContext()),
        deviceType: 'builtin-limiter',
    });
    if (!node) {
        throw new Error('expected a builtin-limiter offline node');
    }
    const calls: { time: number | undefined; run: () => void }[] = [];
    scheduleTrackAutomationFixture({
        lanes,
        trackId: 'track-1',
        trackGainNode: { gain: makeParam() } as unknown as GainNode,
        trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
        deviceEntries: [webAudioEntry('device-1', 'builtin-limiter', node)],
        deviceParameterLaw: LIMITER_CEILING_LAW,
        durationSeconds: 20,
        defaultTempo: 120,
        changes: [],
        projectBeatToSeconds: IDENTITY_BEAT,
        sampleRate: 1000,
        slewTickSeconds: 1,
        clipBoundsById: ORACLE_CLIP_BOUNDS,
        scheduleFrame: (time, run) => {
            calls.push({ time, run });
        },
    });
    const ceiling = node.namedNodes!.ceiling as GainNode;
    // Runs the recorded writes the suspend handler does, in recording order,
    // and answers the ceiling the device holds at `time`.
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

describe('scheduleTrackAutomation — a one-point clip lane holds its value across its whole clip window (#4909)', () => {
    const eqLanes = (withClip: boolean): AutomationLane[] => {
        const track = movingTrackLane('device-1:eq-low-gain', 0, 24);
        return withClip ? [track, onePointClipLane('device-1:eq-low-gain', 0, 24, 9)] : [track];
    };

    it('exports the clip value across beats 4-8 on the audioParam family, under a moving track lane', () => {
        const events = recordedParamEvents(scheduleEqLanes(eqLanes(true)));
        const trackAlone = recordedParamEvents(scheduleEqLanes(eqLanes(false)));
        expect(paramValueAt(events, 1)).toBeCloseTo(paramValueAt(trackAlone, 1), 9);
        expect(paramValueAt(events, 4)).toBeCloseTo(9, 9);
        expect(paramValueAt(events, 7.5)).toBeCloseTo(9, 9);
        expect(paramValueAt(events, 10)).toBeCloseTo(paramValueAt(trackAlone, 10), 9);
    });

    it('resolves the same window ownership on the segments-bound family', () => {
        const segments = oracleSegmentsStreamFor(eqLanes(true));
        const trackAlone = oracleSegmentsStreamFor(eqLanes(false));
        expect(segmentValueAtTime(segments, 100)).toBeCloseTo(segmentValueAtTime(trackAlone, 100), 9);
        expect(segmentValueAtTime(segments, 500)).toBeCloseTo(9, 9);
        expect(segmentValueAtTime(segments, 750)).toBeCloseTo(9, 9);
        expect(segmentValueAtTime(segments, 1000)).toBeCloseTo(segmentValueAtTime(trackAlone, 1000), 9);
    });

    it('exports the clip ceiling across beats 4-8 on the curveWrite family, under a moving track lane', () => {
        // The ceiling's declared range is -3..0, so the oracle rides -2→-1 on
        // the track lane (moving over beats 0-16) and -1.5 on the clip point.
        const ceilingLanes = (withClip: boolean): AutomationLane[] => {
            const track = makeLane({
                id: 'lane-track',
                parameterId: 'device-1:lim-ceiling',
                parameterName: 'Ceiling',
                minValue: -3,
                maxValue: 0,
                points: [
                    { beat: 0, value: -2, curve: 'linear', tension: 0 },
                    { beat: 16, value: -1, curve: 'linear', tension: 0 },
                ],
            });
            const clip = makeLane({
                id: 'lane-clip',
                clipId: 'clip-oracle',
                parameterId: 'device-1:lim-ceiling',
                parameterName: 'Ceiling',
                minValue: -3,
                maxValue: 0,
                points: [{ beat: 5, value: -1.5, curve: 'linear', tension: 0 }],
            });
            return withClip ? [track, clip] : [track];
        };
        const ceilingAt = scheduleCeilingLanes(ceilingLanes(true));
        const trackAloneAt = scheduleCeilingLanes(ceilingLanes(false));
        expect(ceilingAt(1)).toBeCloseTo(trackAloneAt(1), 9);
        expect(ceilingAt(4)).toBeCloseTo(dbToGain(-1.5), 9);
        expect(ceilingAt(7.5)).toBeCloseTo(dbToGain(-1.5), 9);
        expect(ceilingAt(10)).toBeCloseTo(trackAloneAt(10), 9);
    });

    it('exports the clip fader value across beats 4-8 on the gain family, in both lane orders', () => {
        const gainLanes = (withClip: boolean, clipLast: boolean): AutomationLane[] => {
            const track = makeLane({
                id: 'lane-track',
                parameterId: 'gain',
                minValue: 0,
                maxValue: 1,
                points: [
                    { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                    { beat: 16, value: 0.6, curve: 'linear', tension: 0 },
                ],
            });
            const clip = makeLane({
                id: 'lane-clip',
                clipId: 'clip-oracle',
                parameterId: 'gain',
                minValue: 0,
                maxValue: 1,
                points: [{ beat: 5, value: 0.9, curve: 'linear', tension: 0 }],
            });
            if (withClip && clipLast) {
                return [track, clip];
            }
            if (withClip) {
                return [clip, track];
            }
            return [track];
        };
        const scheduleGain = (lanes: AutomationLane[]): RecordedParamEvent[] => {
            const recorder = makeParamRecorder();
            scheduleTrackAutomationFixture({
                lanes,
                trackId: 'track-1',
                trackGainNode: { gain: recorder } as unknown as GainNode,
                trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
                deviceEntries: [],
                durationSeconds: 20,
                defaultTempo: 120,
                changes: [],
                projectBeatToSeconds: IDENTITY_BEAT,
                sampleRate: 100,
                slewTickSeconds: 1,
                clipBoundsById: ORACLE_CLIP_BOUNDS,
            });
            return recordedParamEvents(recorder);
        };
        const trackAlone = scheduleGain(gainLanes(false, true));
        for (const clipLast of [true, false]) {
            const order = clipLast ? 'clip lane last' : 'clip lane first';
            const events = scheduleGain(gainLanes(true, clipLast));
            expect(paramValueAt(events, 1), `${order}: before the window the track lane plays`).toBeCloseTo(
                paramValueAt(trackAlone, 1),
                9
            );
            expect(paramValueAt(events, 4), `${order}: the single point owns the window from its start`).toBeCloseTo(
                0.9,
                9
            );
            expect(paramValueAt(events, 7.5), `${order}: held to the window end`).toBeCloseTo(0.9, 9);
            expect(paramValueAt(events, 10), `${order}: past the window the track lane plays`).toBeCloseTo(
                paramValueAt(trackAlone, 10),
                9
            );
        }
    });

    it('exports the clip pan value across beats 4-8 on the pan family', () => {
        const panLanes = (withClip: boolean): AutomationLane[] => {
            const track = makeLane({
                id: 'lane-track',
                parameterId: 'pan',
                minValue: -1,
                maxValue: 1,
                points: [
                    { beat: 0, value: -0.5, curve: 'linear', tension: 0 },
                    { beat: 16, value: 0.5, curve: 'linear', tension: 0 },
                ],
            });
            const clip = makeLane({
                id: 'lane-clip',
                clipId: 'clip-oracle',
                parameterId: 'pan',
                minValue: -1,
                maxValue: 1,
                points: [{ beat: 5, value: 0.8, curve: 'linear', tension: 0 }],
            });
            return withClip ? [track, clip] : [track];
        };
        const schedulePan = (lanes: AutomationLane[]): RecordedParamEvent[] => {
            const recorder = makeParamRecorder();
            scheduleTrackAutomationFixture({
                lanes,
                trackId: 'track-1',
                trackGainNode: { gain: makeParam() } as unknown as GainNode,
                trackPanNode: { pan: recorder } as unknown as StereoPannerNode,
                deviceEntries: [],
                durationSeconds: 20,
                defaultTempo: 120,
                changes: [],
                projectBeatToSeconds: IDENTITY_BEAT,
                sampleRate: 100,
                slewTickSeconds: 1,
                clipBoundsById: ORACLE_CLIP_BOUNDS,
            });
            return recordedParamEvents(recorder);
        };
        const events = schedulePan(panLanes(true));
        const trackAlone = schedulePan(panLanes(false));
        expect(paramValueAt(events, 1)).toBeCloseTo(paramValueAt(trackAlone, 1), 9);
        expect(paramValueAt(events, 4)).toBeCloseTo(0.8, 9);
        expect(paramValueAt(events, 7.5)).toBeCloseTo(0.8, 9);
        expect(paramValueAt(events, 10)).toBeCloseTo(paramValueAt(trackAlone, 10), 9);
    });

    it('exports the clip send value across beats 4-8 on the send family', () => {
        const sendLanes = (withClip: boolean): AutomationLane[] => {
            const track = makeLane({
                id: 'lane-track',
                parameterId: 'send:bus-oracle',
                minValue: 0,
                maxValue: 1,
                points: [
                    { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                    { beat: 16, value: 0.6, curve: 'linear', tension: 0 },
                ],
            });
            const clip = makeLane({
                id: 'lane-clip',
                clipId: 'clip-oracle',
                parameterId: 'send:bus-oracle',
                minValue: 0,
                maxValue: 1,
                points: [{ beat: 5, value: 0.9, curve: 'linear', tension: 0 }],
            });
            return withClip ? [track, clip] : [track];
        };
        const scheduleSend = (lanes: AutomationLane[]): RecordedParamEvent[] => {
            const recorder = makeParamRecorder();
            scheduleTrackAutomationFixture({
                lanes,
                trackId: 'track-1',
                trackGainNode: { gain: makeParam() } as unknown as GainNode,
                trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
                deviceEntries: [],
                sendAutomationParams: new Map([['send:bus-oracle', recorder as unknown as AudioParam]]),
                durationSeconds: 20,
                defaultTempo: 120,
                changes: [],
                projectBeatToSeconds: IDENTITY_BEAT,
                sampleRate: 100,
                slewTickSeconds: 1,
                clipBoundsById: ORACLE_CLIP_BOUNDS,
            });
            return recordedParamEvents(recorder);
        };
        const events = scheduleSend(sendLanes(true));
        const trackAlone = scheduleSend(sendLanes(false));
        expect(paramValueAt(events, 1)).toBeCloseTo(paramValueAt(trackAlone, 1), 9);
        expect(paramValueAt(events, 4)).toBeCloseTo(0.9, 9);
        expect(paramValueAt(events, 7.5)).toBeCloseTo(0.9, 9);
        expect(paramValueAt(events, 10)).toBeCloseTo(paramValueAt(trackAlone, 10), 9);
    });
});
