import { describe, expect, it } from 'vitest';

import { projectPpqEndpoints } from '#/modules/Transport/useCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { compileAutomationEvents } from '../compileAutomationEvents';

/**
 * A sampled automation segment is evaluated every 10 ms, and each sample needs
 * the beat its time falls on. The render's projector is quantised to whole
 * samples, so the full-range bisection every sample used to run only finds the
 * edge of a one-sample rounding step. A straight stretch of projection is now
 * interpolated and a ramp is bisected from the previous sample's bracket, the
 * segment cut at every tempo change inside it. These cases pin that against the
 * old bisection, kept here as the oracle: every sample keeps its exact time, its
 * value is one the curve takes within one sample of beat of the bisected beat,
 * and the number of projections no longer grows by forty per sample.
 */
type TempoChange = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };
type Projector = (beat: number) => number;

const SAMPLE_RATE = 48_000;
const BASE_TEMPO = 76;
const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;
const NON_LINEAR_CURVES = ['smooth', 'bezier', 'exponential', 's-curve'] as const;

/** The inversion every sample used before, copied as the oracle. */
function bisectedBeatAtTime(firstBeat: number, secondBeat: number, time: number, projectBeat: Projector): number {
    if (time <= projectBeat(firstBeat)) {
        return firstBeat;
    }
    if (time >= projectBeat(secondBeat)) {
        return secondBeat;
    }
    let lower = firstBeat;
    let upper = secondBeat;
    for (let iteration = 0; iteration < 40; iteration++) {
        const middle = (lower + upper) / 2;
        if (projectBeat(middle) < time) {
            lower = middle;
        } else {
            upper = middle;
        }
    }
    return (lower + upper) / 2;
}

function renderProjector(changes: readonly TempoChange[]): Projector {
    return (beat) =>
        projectPpqEndpoints({
            startPpq: beat,
            endPpq: beat,
            defaultTempo: BASE_TEMPO,
            sampleRate: SAMPLE_RATE,
            changes,
        }).startSeconds;
}

function countingProjector(projectBeat: Projector): { project: Projector; count: () => number } {
    let projections = 0;
    return {
        project: (beat) => {
            projections++;
            return projectBeat(beat);
        },
        count: () => projections,
    };
}

function lane(curve: AutomationPoint['curve'], beats: readonly number[]): AutomationPoint[] {
    const values = [0.1, 0.85, 0.2, 0.6, 0.4];
    const tensions = [0.42, -0.3, 0.7, 0.38, 0];
    return beats.map((beat, index) => ({ beat, value: values[index]!, curve, tension: tensions[index]! }));
}

type ExpectedSample = {
    time: number;
    oracleBeat: number;
    first: AutomationPoint;
    second: AutomationPoint;
    previous?: AutomationPoint;
    next?: AutomationPoint;
};

/** Every per-sample event the compiler emits for a fully visible lane, with the beat the old bisection gave it. */
function expectedSamples(points: readonly AutomationPoint[], projectBeat: Projector): ExpectedSample[] {
    const samples: ExpectedSample[] = [];
    for (let index = 0; index < points.length - 1; index++) {
        const first = points[index]!;
        const second = points[index + 1]!;
        const visibleStart = projectBeat(first.beat);
        const visibleEnd = projectBeat(second.beat);
        const steps = Math.max(1, Math.ceil((visibleEnd - visibleStart) / AUTOMATION_SAMPLE_INTERVAL_SEC));
        for (let step = 1; step <= steps; step++) {
            const time = visibleStart + ((visibleEnd - visibleStart) * step) / steps;
            samples.push({
                time,
                oracleBeat: bisectedBeatAtTime(first.beat, second.beat, time, projectBeat),
                first,
                second,
                previous: points[index - 1],
                next: points[index + 2],
            });
        }
    }
    return samples;
}

function curveValue(sample: ExpectedSample, beat: number): number {
    return evaluateAutomationCurve({
        firstPoint: sample.first,
        secondPoint: sample.second,
        beat,
        previousPoint: sample.previous,
        nextPoint: sample.next,
    });
}

function compileLane(points: AutomationPoint[], changes: readonly TempoChange[], projectBeat: Projector) {
    return compileAutomationEvents(points, 600, [...changes], 0, projectBeat).filter(
        (event) => event.type === 'linear'
    );
}

/**
 * Compiles the lane and checks every sample against the oracle: the same time,
 * bit for bit, and a value the curve takes within one sample of beat (at the
 * fastest tempo the map reaches) of the bisected beat.
 */
function expectWithinOneSampleOfBisection(
    points: AutomationPoint[],
    changes: readonly TempoChange[],
    fastestTempo: number
): void {
    const projectBeat = renderProjector(changes);
    const oneSampleOfBeat = fastestTempo / 60 / SAMPLE_RATE;
    const events = compileLane(points, changes, projectBeat);
    const expected = expectedSamples(points, projectBeat);

    expect(events.map((event) => event.timeSeconds)).toEqual(expected.map((sample) => sample.time));
    const outOfBound = events.flatMap((event, index) => {
        const sample = expected[index]!;
        const low = Math.max(sample.first.beat, sample.oracleBeat - oneSampleOfBeat);
        const high = Math.min(sample.second.beat, sample.oracleBeat + oneSampleOfBeat);
        const reachable = Array.from({ length: 17 }, (_, probe) =>
            curveValue(sample, low + ((high - low) * probe) / 16)
        );
        const slack = 1e-9;
        const lowest = Math.min(...reachable);
        const highest = Math.max(...reachable);
        return event.value < lowest - slack || event.value > highest + slack
            ? [`#${index} t=${event.timeSeconds}: ${event.value} outside [${lowest}, ${highest}]`]
            : [];
    });
    expect(outOfBound.slice(0, 5)).toEqual([]);
}

describe('compileAutomationEvents — beat inversion on a straight projection', () => {
    const changes: TempoChange[] = [{ id: 'base', beat: 0, tempo: BASE_TEMPO, curve: 'instant' }];

    it.each(NON_LINEAR_CURVES)('keeps every %s sample within one sample of beat of the bisection', (curve) => {
        expectWithinOneSampleOfBisection(lane(curve, [0, 3.7, 9, 14.25]), changes, BASE_TEMPO);
    });

    it('projects only a handful of beats per segment instead of bisecting every sample', () => {
        const counter = countingProjector(renderProjector(changes));
        const points = lane('smooth', [0, 3.7, 9, 14.25]);
        const events = compileLane(points, changes, counter.project);

        // The full-range bisection spent over forty projections on each of these samples.
        expect(events.length).toBeGreaterThan(500);
        expect(counter.count()).toBeLessThan(10 * points.length);
    });
});

describe('compileAutomationEvents — beat inversion on a ramp or across a tempo change', () => {
    // Nebula Drift's shape: steady, then a linear ramp 78 → 76 over beats 4 → 12,
    // steady after it. The lane's segments cross 4 and 12 and ride the ramp between.
    const rampChanges: TempoChange[] = [
        { id: 'base', beat: 0, tempo: BASE_TEMPO, curve: 'instant' },
        { id: 'peak', beat: 4, tempo: 78, curve: 'linear' },
        { id: 'breakdown', beat: 12, tempo: BASE_TEMPO, curve: 'linear' },
    ];

    it.each([...NON_LINEAR_CURVES, 'linear' as const])(
        'keeps every %s sample on and across the ramp within one sample of beat of the bisection',
        (curve) => {
            expectWithinOneSampleOfBisection(lane(curve, [0, 5, 11, 14.25]), rampChanges, 78);
        }
    );

    it('splits a segment at the change where a steady stretch meets a ramp', () => {
        // One segment, beats 1 → 9: steady at 76 up to beat 4, then on the ramp.
        expectWithinOneSampleOfBisection(lane('smooth', [1, 9]), rampChanges, 78);
    });

    it('brackets a steep ramp, 40 → 400 BPM over one beat', () => {
        const steepChanges: TempoChange[] = [
            { id: 'slow', beat: 0, tempo: 40, curve: 'linear' },
            { id: 'fast', beat: 1, tempo: 400, curve: 'instant' },
        ];
        expectWithinOneSampleOfBisection(lane('exponential', [0, 1, 3]), steepChanges, 400);
        expectWithinOneSampleOfBisection(lane('smooth', [0, 0.4, 2]), steepChanges, 400);
    });

    it.each(['linear', 'smooth'] as const)(
        'ends a cropped %s segment on the boundary beat the full bisection solved, on an unquantised projector',
        (curve) => {
            // Not quantised, so the warm start's bracket shows: interior samples sit within it of
            // the full bisection, and the cropped end must be the full bisection's own beat.
            const projectSquare: Projector = (beat) => beat * beat;
            const points = lane(curve, [0, 4, 6]);
            const regionStart = 4;
            for (const duration of [5, 5.3, 6.71]) {
                const events = compileAutomationEvents(points, duration, [], regionStart, projectSquare).filter(
                    (event) => event.type === 'linear'
                );
                const visibleStart = regionStart;
                const visibleEnd = regionStart + duration;
                const visibleStartBeat = bisectedBeatAtTime(0, 4, visibleStart, projectSquare);
                const visibleEndBeat = bisectedBeatAtTime(0, 4, visibleEnd, projectSquare);
                const steps = Math.ceil((visibleEnd - visibleStart) / AUTOMATION_SAMPLE_INTERVAL_SEC);
                const bracket =
                    (((visibleEndBeat - visibleStartBeat) * ((visibleEnd - visibleStart) / steps)) /
                        (visibleEnd - visibleStart)) *
                    2 ** -12;
                const segment = { first: points[0]!, second: points[1]!, next: points[2] };
                const valueAt = (beat: number) => curveValue({ ...segment, time: 0, oracleBeat: beat }, beat);

                expect(events.map((event) => event.timeSeconds)).toEqual(
                    Array.from(
                        { length: steps },
                        (_, offset) => visibleStart + ((visibleEnd - visibleStart) * (offset + 1)) / steps - regionStart
                    )
                );
                expect(Object.is(events.at(-1)!.value, valueAt(visibleEndBeat))).toBe(true);
                const outsideBracket = events.slice(0, -1).flatMap((event) => {
                    const oracleBeat = bisectedBeatAtTime(
                        visibleStartBeat,
                        visibleEndBeat,
                        event.timeSeconds + regionStart,
                        projectSquare
                    );
                    const reachable = [valueAt(oracleBeat - bracket), valueAt(oracleBeat + bracket)];
                    return event.value < Math.min(...reachable) - 1e-12 || event.value > Math.max(...reachable) + 1e-12
                        ? [`${duration}s t=${event.timeSeconds}: ${event.value}`]
                        : [];
                });
                expect(outsideBracket.slice(0, 5)).toEqual([]);
            }
        }
    );

    it('spends far fewer projections per ramp sample than a full-range bisection', () => {
        const counter = countingProjector(renderProjector(rampChanges));
        const points = lane('smooth', [4, 8, 12]);
        const events = compileLane(points, rampChanges, counter.project);

        // The full-range bisection spent at least forty-two projections on each sample.
        expect(events.length).toBeGreaterThan(500);
        expect(counter.count()).toBeLessThan(20 * events.length);
    });
});
