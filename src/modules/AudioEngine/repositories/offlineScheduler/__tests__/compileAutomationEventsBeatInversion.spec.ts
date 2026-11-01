import { describe, expect, it } from 'vitest';

import { projectPpqEndpoints } from '#/modules/Transport/useCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { compileAutomationEvents } from '../compileAutomationEvents';

/**
 * A curve that is not a straight line is sampled every 10 ms, and each sample
 * needs the beat its time falls on. The render's projector is quantised to whole
 * samples, so bisecting it (the inversion every segment used) only finds the
 * edge of a one-sample rounding step; where the projection is a straight line
 * the beat is now interpolated instead. These cases pin both sides of that
 * split against the bisection as it stood: on a straight projection every
 * sample keeps its time and lands within one sample of beat of the bisected
 * value, and on a ramp or across a tempo change every sample is unchanged.
 */
type TempoChange = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };
type Projector = (beat: number) => number;

const SAMPLE_RATE = 48_000;
const BASE_TEMPO = 76;
const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;
const NON_LINEAR_CURVES = ['smooth', 'bezier', 'exponential', 's-curve'] as const;

/** Today's inversion, copied as the oracle. */
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

function lane(curve: AutomationPoint['curve']): AutomationPoint[] {
    return [
        { beat: 0, value: 0.1, curve, tension: 0.42 },
        { beat: 3.7, value: 0.85, curve, tension: -0.3 },
        { beat: 9, value: 0.2, curve, tension: 0.7 },
        { beat: 14.25, value: 0.6, curve, tension: 0.38 },
    ];
}

type ExpectedSample = {
    time: number;
    oracleBeat: number;
    first: AutomationPoint;
    second: AutomationPoint;
    previous?: AutomationPoint;
    next?: AutomationPoint;
};

/** Every per-sample event the compiler emits for a fully visible lane, with the bisected beat it used to take. */
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
    return compileAutomationEvents(points, 60, [...changes], 0, projectBeat).filter((event) => event.type === 'linear');
}

describe('compileAutomationEvents — beat inversion on a straight projection', () => {
    const changes: TempoChange[] = [{ id: 'base', beat: 0, tempo: BASE_TEMPO, curve: 'instant' }];
    const projectBeat = renderProjector(changes);
    // One sample of time, in beats, at the lane's tempo.
    const oneSampleOfBeat = BASE_TEMPO / 60 / SAMPLE_RATE;

    it.each(NON_LINEAR_CURVES)(
        'keeps every %s sample time and lands within one sample of beat of the bisection',
        (curve) => {
            const points = lane(curve);
            const events = compileLane(points, changes, projectBeat);
            const expected = expectedSamples(points, projectBeat);

            expect(events.map((event) => event.timeSeconds)).toEqual(expected.map((sample) => sample.time));
            const outOfBound: string[] = [];
            events.forEach((event, index) => {
                const sample = expected[index]!;
                const low = Math.max(sample.first.beat, sample.oracleBeat - oneSampleOfBeat);
                const high = Math.min(sample.second.beat, sample.oracleBeat + oneSampleOfBeat);
                const reachable = Array.from({ length: 17 }, (_, probe) =>
                    curveValue(sample, low + ((high - low) * probe) / 16)
                );
                const slack = 1e-9;
                if (event.value < Math.min(...reachable) - slack || event.value > Math.max(...reachable) + slack) {
                    outOfBound.push(
                        `t=${event.timeSeconds}: ${event.value} outside [${Math.min(...reachable)}, ${Math.max(...reachable)}]`
                    );
                }
            });
            expect(outOfBound).toEqual([]);
        }
    );

    it('projects only a handful of beats per segment instead of bisecting every sample', () => {
        let projections = 0;
        const countingProjector: Projector = (beat) => {
            projections++;
            return projectBeat(beat);
        };
        const points = lane('smooth');
        const events = compileLane(points, changes, countingProjector);

        // The bisection spent over forty projections on each of these samples.
        expect(events.length).toBeGreaterThan(500);
        expect(projections).toBeLessThan(10 * points.length);
    });
});

describe('compileAutomationEvents — beat inversion on a ramp or across a tempo change', () => {
    // A linear ramp from 78 to 76 bpm over beats 4 → 12, as Nebula Drift's peak ramps
    // back to its breakdown tempo; the lane's segments cross 4 and 12 and ride the ramp
    // in between.
    const changes: TempoChange[] = [
        { id: 'base', beat: 0, tempo: BASE_TEMPO, curve: 'instant' },
        { id: 'peak', beat: 4, tempo: 78, curve: 'linear' },
        { id: 'breakdown', beat: 12, tempo: BASE_TEMPO, curve: 'linear' },
    ];
    const projectBeat = renderProjector(changes);

    it.each(NON_LINEAR_CURVES)('emits every %s sample exactly as the bisection placed it', (curve) => {
        const points: AutomationPoint[] = [
            { beat: 0, value: 0.1, curve, tension: 0.42 },
            { beat: 5, value: 0.85, curve, tension: -0.3 },
            { beat: 11, value: 0.2, curve, tension: 0.7 },
            { beat: 14.25, value: 0.6, curve, tension: 0.38 },
        ];
        const events = compileLane(points, changes, projectBeat);
        const expected = expectedSamples(points, projectBeat);

        expect(events.length).toBe(expected.length);
        const differing = events.flatMap((event, index) => {
            const sample = expected[index]!;
            const value = curveValue(sample, sample.oracleBeat);
            return Object.is(event.timeSeconds, sample.time) && Object.is(event.value, value)
                ? []
                : [`#${index}: got ${event.timeSeconds}/${event.value}, expected ${sample.time}/${value}`];
        });
        expect(differing.slice(0, 5)).toEqual([]);
    });
});
