import { describe, expect, it, vi } from 'vitest';

import {
    AUTOMATION_BOUND_CASES,
    type AutomationLaneBoundCase,
    CASE_FIRST_BEAT,
    CASE_NEXT_BEAT,
    CASE_PREVIOUS_BEAT,
    CASE_SECOND_BEAT,
} from '#/utils/__tests__/automationCurveCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';
import { boundAutomationLaneValue } from '#/utils/automationLaneBound';

import { type AutomationLane, type AutomationPoint } from '../../../models/AutomationViewTypes';
import { type OfflineAutomationSegment } from '../../deviceStrategy/AudioDeviceStrategy';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

/**
 * #2539 lane-bound conformance gate — OFFLINE side. Do not delete without
 * replacing.
 *
 * The offline scheduler must bound every lane family's interpolated values by
 * the lane's declared range — gain, pan, sends AND device parameters — at the
 * same point live applies it (inside the value lookup, per segment, before the
 * link scale and before any parameter-family transform). Until #2538 only the
 * gain branch carried a bound; pan scheduled the raw curve, sends hardcode-
 * clamped [0, 1] regardless of the declared range, and device lanes met only
 * the device parameter's own law — so a smooth curve's overshoot printed into
 * bounces at levels the monitor had clamped away. The law now lives in one
 * kernel (`#/utils/automationLaneBound`); this spec pins the OFFLINE routing —
 * pan, send and both device bindings — against the shared case table, its
 * sibling in Automation `useCases` pins the live lookup, and
 * `src/utils/__tests__/automationLaneBound.spec.ts` pins the law itself. If any
 * branch re-forks its bound, one of these trips.
 *
 * A neutral identity beat→seconds projector is injected so an emitted event's
 * time is exactly its beat. Each case maps to the curve-table lane geometry
 * (segment on beats [0, 4], `smooth` neighbours at -4/8); the expectation is
 * the shared bound applied to the shared curve kernel's raw value at that beat
 * with live's bracketing — computed independently here, so the spec observes
 * the scheduler rather than sharing its implementation.
 */

const DEFAULT_TEMPO = 120;
const NO_CHANGES: { beat: number; tempo: number }[] = [];
const LANE_DURATION_SECONDS = CASE_SECOND_BEAT - CASE_FIRST_BEAT;
/** Identity projector → an event's timeSeconds is its beat. */
function identityProjector(beat: number): number {
    return beat;
}

function pointsFromCase(boundCase: AutomationLaneBoundCase): AutomationPoint[] {
    return [
        { beat: CASE_PREVIOUS_BEAT, value: boundCase.previousValue, curve: 'linear', tension: 0 },
        { beat: CASE_FIRST_BEAT, value: boundCase.segmentFirstValue, curve: 'smooth', tension: 0 },
        { beat: CASE_SECOND_BEAT, value: boundCase.segmentSecondValue, curve: 'linear', tension: 0 },
        { beat: CASE_NEXT_BEAT, value: boundCase.nextValue, curve: 'linear', tension: 0 },
    ];
}

/**
 * The lane-bound value live would hold at `beat`: the shared curve kernel on
 * the same bracketing + neighbour selection `getAutomationValueAtBeat` uses
 * (last point with beat <= target; endpoints hold), through the shared bound.
 */
function boundedLiveValueAtBeat(boundCase: AutomationLaneBoundCase, beat: number): number {
    const points = pointsFromCase(boundCase);
    let beforeIdx = -1;
    for (let index = 0; index < points.length; index++) {
        if (points[index]!.beat <= beat) {
            beforeIdx = index;
        } else {
            break;
        }
    }
    if (beforeIdx === -1) {
        // Unreachable: the lane's first point is at beat -4 and the render
        // window opens at beat 0 — fail loudly rather than inventing a value
        // if that geometry ever changes.
        throw new Error('conformance probe before the first lane point');
    }
    const first = points[beforeIdx]!;
    const second = points[beforeIdx + 1] ?? first;
    const raw = evaluateAutomationCurve({
        firstPoint: first,
        secondPoint: second,
        beat,
        previousPoint: points[beforeIdx - 1],
        nextPoint: points[beforeIdx + 2],
    });
    return boundAutomationLaneValue({
        value: raw,
        declaredMin: boundCase.declaredMin,
        declaredMax: boundCase.declaredMax,
        derivedCeiling: boundCase.derivedCeiling,
        segmentFirstValue: first.value,
        segmentSecondValue: second.value,
    });
}

function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    };
}

/** A minimal offline lane on the given parameter, declaring the case's range. */
function offlineLane(boundCase: AutomationLaneBoundCase, parameterId: string): AutomationLane {
    return {
        id: `lane-${boundCase.name}`,
        trackId: 'track-1',
        parameterId,
        parameterName: 'Param',
        points: pointsFromCase(boundCase),
        enabled: true,
        minValue: boundCase.declaredMin,
        maxValue: boundCase.declaredMax,
    };
}

/** Every (beat, value) the scheduler wrote onto a param mock. */
function paramWrites(param: ReturnType<typeof makeParam>): { beat: number; value: number }[] {
    return [...param.setValueAtTime.mock.calls, ...param.linearRampToValueAtTime.mock.calls].map(
        ([value, timeSeconds]) => ({ beat: timeSeconds as number, value: value as number })
    );
}

type CommonInput = Parameters<typeof scheduleTrackAutomationFixture>[0];

/** The render-context inputs every branch render shares. */
function commonFixtureInput(boundCase: AutomationLaneBoundCase, lane: AutomationLane): CommonInput {
    return {
        lanes: [lane],
        trackId: 'track-1',
        trackGainNode: { gain: makeParam() } as unknown as GainNode,
        trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
        deviceEntries: [],
        durationSeconds: LANE_DURATION_SECONDS,
        defaultTempo: DEFAULT_TEMPO,
        changes: NO_CHANGES,
        projectBeatToSeconds: identityProjector,
        // The row's ceiling arrives by injection — the same law live computes
        // internally, handed in because this repository may not reach into
        // Automation's business contracts.
        resolveLaneCeiling: () => boundCase.derivedCeiling,
    };
}

describe('automation lane-bound conformance — offline scheduler applies the shared bound', () => {
    for (const boundCase of AUTOMATION_BOUND_CASES) {
        it(`"${boundCase.name}" — pan branch: every emitted value equals the shared bound on the shared kernel`, () => {
            const pan = makeParam();
            scheduleTrackAutomationFixture({
                ...commonFixtureInput(boundCase, offlineLane(boundCase, 'pan')),
                trackPanNode: { pan } as unknown as StereoPannerNode,
            });

            const writes = paramWrites(pan);
            expect(writes.length).toBeGreaterThan(0);
            for (const write of writes) {
                expect(write.value, `pan "${boundCase.name}" at beat ${write.beat}`).toBeCloseTo(
                    boundedLiveValueAtBeat(boundCase, write.beat),
                    10
                );
            }
        });

        it(`"${boundCase.name}" — send branch: bound first, then the send pot's own [0, 1] law`, () => {
            // Live order: `getAutomationValueAtBeat` bounds to the declared
            // range, then `TrackNode.scheduleSendAutomation` clamps [0, 1] on
            // the write. The expectation composes the same two laws in the
            // same order.
            const send = makeParam();
            scheduleTrackAutomationFixture({
                ...commonFixtureInput(boundCase, offlineLane(boundCase, 'send:bus-hall')),
                sendAutomationParams: new Map([['send:bus-hall', send as unknown as AudioParam]]),
            });

            const writes = paramWrites(send);
            expect(writes.length).toBeGreaterThan(0);
            for (const write of writes) {
                const expected = Math.max(0, Math.min(1, boundedLiveValueAtBeat(boundCase, write.beat)));
                expect(write.value, `send "${boundCase.name}" at beat ${write.beat}`).toBeCloseTo(expected, 10);
            }
        });

        it(`"${boundCase.name}" — device segments binding: nothing emitted outside the raised range`, () => {
            // The segments (worklet) device binding, under its real AU-2 slew.
            // A device lane always slews offline, so the exact per-beat equality
            // the pan/send rows assert would be a statement about the IIR
            // recurrence rather than about the bound (that recurrence's parity
            // is pinned by `automationSlewGrainParity.spec.ts`). What the bound
            // guarantees here — and what losing it violates on the crest rows,
            // whose raw kernel value exceeds the ceiling — is the output
            // domain: nothing seeded into, fed by, or emitted from the
            // recurrence leaves [declaredMin, raised ceiling], and the glide
            // settles on the bounded tail target.
            const segments: OfflineAutomationSegment[] = [];
            scheduleTrackAutomationFixture({
                ...commonFixtureInput(boundCase, offlineLane(boundCase, 'device-1:gain-level')),
                // Past the lane's last point (beat 8), so the glide settles on
                // the held tail value inside the window and the settle is
                // observable rather than cut off at the curve's end.
                durationSeconds: 10,
                sampleRate: 100,
                deviceEntries: [
                    {
                        deviceId: 'device-1',
                        deviceType: 'builtin-gain',
                        strategy: {
                            resolveOfflineAutomation: (name: string) =>
                                name === 'gain-level'
                                    ? { kind: 'segments', apply: (compiled) => segments.push(...compiled) }
                                    : null,
                        },
                    },
                ],
            });

            expect(segments.length).toBeGreaterThan(0);
            const finiteRange = Number.isFinite(boundCase.declaredMin) && Number.isFinite(boundCase.declaredMax);
            if (finiteRange) {
                const floor = boundCase.declaredMin;
                const highestStored = Math.max(boundCase.segmentFirstValue, boundCase.segmentSecondValue);
                const ceiling = Math.max(boundCase.declaredMax, Math.min(boundCase.derivedCeiling, highestStored));
                for (const segment of segments) {
                    for (const value of [segment.startValue, segment.endValue]) {
                        expect(value, `device segments "${boundCase.name}" value ${value}`).toBeGreaterThanOrEqual(
                            floor
                        );
                        expect(value, `device segments "${boundCase.name}" value ${value}`).toBeLessThanOrEqual(
                            ceiling
                        );
                    }
                }
            } else {
                // A non-finite declared range disables the law on both sides —
                // what must still hold is that the render is not NaN-silenced.
                for (const segment of segments) {
                    for (const value of [segment.startValue, segment.endValue]) {
                        expect(Number.isFinite(value), `device segments "${boundCase.name}" value ${value}`).toBe(true);
                    }
                }
            }
            // The lane's tail holds the last point's value; the glide settles
            // on its bounded self (settle is declared at 1e-6, so the emitted
            // value carries float residue at that scale).
            expect(segments.at(-1)!.startValue).toBeCloseTo(
                boundAutomationLaneValue({
                    value: boundCase.nextValue,
                    declaredMin: boundCase.declaredMin,
                    declaredMax: boundCase.declaredMax,
                    derivedCeiling: boundCase.derivedCeiling,
                    segmentFirstValue: boundCase.nextValue,
                    segmentSecondValue: boundCase.nextValue,
                }),
                6
            );
        });
    }

    it('bounds the device AudioParam binding too, before the binding affine and device law', () => {
        // One row (the canonical crest) on the AudioParam device sub-branch —
        // its full-branch regression, including the raw chase, lives in
        // `laneOvershootBoundParity.spec.ts`; this pins that the binding's
        // affine post-transform does not smuggle the bound away. Same domain
        // argument as the segments rows: under the real slew, the observable
        // is that no emitted value leaves the raised range.
        const boundCase = AUTOMATION_BOUND_CASES[0]!;
        const audioParam = makeParam();
        scheduleTrackAutomationFixture({
            ...commonFixtureInput(boundCase, offlineLane(boundCase, 'device-1:gain-level')),
            deviceEntries: [
                {
                    deviceId: 'device-1',
                    deviceType: 'builtin-gain',
                    strategy: {
                        resolveOfflineAutomation: (name: string) =>
                            name === 'gain-level'
                                ? {
                                      kind: 'audioParam',
                                      targets: [
                                          { audioParam: audioParam as unknown as AudioParam, scale: 1, offset: 0 },
                                      ],
                                  }
                                : null,
                    },
                },
            ],
        });

        const writes = paramWrites(audioParam);
        expect(writes.length).toBeGreaterThan(0);
        for (const write of writes) {
            expect(write.value, `device audioParam at beat ${write.beat}`).toBeLessThanOrEqual(boundCase.declaredMax);
            expect(write.value, `device audioParam at beat ${write.beat}`).toBeGreaterThanOrEqual(
                boundCase.declaredMin
            );
        }
        // Non-vacuous for a crest row: the raw kernel value crosses the
        // declared ceiling, so an unbound branch emits past it.
        expect(
            writes.some((write) =>
                write.beat >= 1 && write.beat <= 3
                    ? evaluateAutomationCurve({
                          firstPoint: { beat: 0, value: boundCase.segmentFirstValue, curve: 'smooth', tension: 0 },
                          secondPoint: { beat: 4, value: boundCase.segmentSecondValue, curve: 'linear', tension: 0 },
                          beat: write.beat,
                          previousPoint: { beat: -4, value: boundCase.previousValue, curve: 'linear', tension: 0 },
                          nextPoint: { beat: 8, value: boundCase.nextValue, curve: 'linear', tension: 0 },
                      }) > boundCase.declaredMax
                    : false
            )
        ).toBe(true);
    });
});
