import { describe, expect, it } from 'vitest';

import { createSeededRandom } from '#/utils/SeededRandom/SeededRandom';

import {
    beatToSamples,
    getGoverningTempoChange,
    getTempoAtBeat,
    samplesToBeat,
    secondsBetweenBeats,
    type TempoChange,
} from '../TempoMap';

/**
 * The integrator walked every segment from `fromBeat` and scanned the change list
 * per segment; it now resumes a tabled walk from beat 0 and finds changes by
 * binary search. Both are meant to return the very same bits, so the walk as it
 * stood before them is kept here as the oracle and every conversion is compared
 * with `Object.is` — a rounding step, a sign of zero or a NaN is a failure.
 */
type Random = () => number;
type OracleGoverning = { change: TempoChange; rampTarget: TempoChange | undefined };

function oracleSort(changes: readonly TempoChange[]): readonly TempoChange[] {
    return [...changes].sort((alpha, beta) => alpha.beat - beta.beat);
}

function oracleGoverning(sortedChanges: readonly TempoChange[], beat: number): OracleGoverning | undefined {
    if (sortedChanges.length === 0) {
        return undefined;
    }
    let previous: TempoChange | undefined;
    let next: TempoChange | undefined;
    for (const change of sortedChanges) {
        if (change.beat <= beat) {
            previous = change;
        } else {
            next = change;
            break;
        }
    }
    if (!previous) {
        return { change: sortedChanges[0]!, rampTarget: undefined };
    }
    if (!next || previous.curve === 'instant' || beat === previous.beat) {
        return { change: previous, rampTarget: undefined };
    }
    return { change: previous, rampTarget: next };
}

function oracleTempoAt(sortedChanges: readonly TempoChange[], beat: number, defaultTempo: number): number {
    const governing = oracleGoverning(sortedChanges, beat);
    if (!governing) {
        return defaultTempo;
    }
    if (!governing.rampTarget) {
        return governing.change.tempo;
    }
    const time = (beat - governing.change.beat) / (governing.rampTarget.beat - governing.change.beat);
    return governing.change.tempo + (governing.rampTarget.tempo - governing.change.tempo) * time;
}

function oracleSegmentRamp(
    changes: readonly TempoChange[],
    segmentStart: number
): { active: TempoChange | undefined; target: TempoChange | undefined } {
    let active: TempoChange | undefined;
    for (const change of changes) {
        if (change.beat > segmentStart) {
            return { active, target: change };
        }
        active = change;
    }
    return { active, target: undefined };
}

function oracleSeconds(
    sortedChanges: readonly TempoChange[],
    fromBeat: number,
    toBeat: number,
    defaultTempo: number
): number {
    if (fromBeat === toBeat) {
        return 0;
    }
    if (toBeat < fromBeat) {
        return -oracleSeconds(sortedChanges, toBeat, fromBeat, defaultTempo);
    }
    const boundaries = [fromBeat];
    for (const change of sortedChanges) {
        if (change.beat > fromBeat && change.beat < toBeat && change.beat !== boundaries.at(-1)) {
            boundaries.push(change.beat);
        }
    }
    boundaries.push(toBeat);
    let seconds = 0;
    let compensation = 0;
    for (let index = 0; index < boundaries.length - 1; index++) {
        const segmentStart = boundaries[index]!;
        const segmentEnd = boundaries[index + 1]!;
        const startTempo = oracleTempoAt(sortedChanges, segmentStart, defaultTempo);
        const { active, target } = oracleSegmentRamp(sortedChanges, segmentStart);
        let segmentSeconds: number;
        if (!active || active.curve === 'instant' || !target) {
            segmentSeconds = (segmentEnd - segmentStart) * (60 / startTempo);
        } else {
            const rampProgress = (segmentEnd - active.beat) / (target.beat - active.beat);
            const endTempo = active.tempo + (target.tempo - active.tempo) * rampProgress;
            const tempoDelta = endTempo - startTempo;
            if (tempoDelta === 0) {
                segmentSeconds = (segmentEnd - segmentStart) * (60 / startTempo);
            } else {
                const relativeTempoDelta = tempoDelta / startTempo;
                segmentSeconds =
                    (((segmentEnd - segmentStart) * 60) / startTempo) *
                    (Math.log1p(relativeTempoDelta) / relativeTempoDelta);
            }
        }
        const adjustedSeconds = segmentSeconds - compensation;
        const nextSeconds = seconds + adjustedSeconds;
        compensation = Number.isFinite(nextSeconds) ? nextSeconds - seconds - adjustedSeconds : 0;
        seconds = nextSeconds;
    }
    return seconds;
}

function oracleBeatToSamples(
    changes: readonly TempoChange[],
    beat: number,
    defaultTempo: number,
    sampleRate: number
): number {
    return Math.round(oracleSeconds(oracleSort(changes), 0, beat, defaultTempo) * sampleRate);
}

function oracleSamplesToBeat(
    changes: readonly TempoChange[],
    samples: number,
    defaultTempo: number,
    sampleRate: number
): number {
    if (samples === 0) {
        return 0;
    }
    const sortedChanges = oracleSort(changes);
    const targetSeconds = samples / sampleRate;
    for (const change of sortedChanges) {
        if (Math.abs(oracleSeconds(sortedChanges, 0, change.beat, defaultTempo) - targetSeconds) < 1e-12) {
            return change.beat;
        }
    }
    let lowerBeat = targetSeconds < 0 ? -1 : 0;
    let upperBeat = targetSeconds < 0 ? 0 : 1;
    if (targetSeconds < 0) {
        while (oracleSeconds(sortedChanges, 0, lowerBeat, defaultTempo) > targetSeconds) {
            lowerBeat *= 2;
        }
    } else {
        while (oracleSeconds(sortedChanges, 0, upperBeat, defaultTempo) < targetSeconds) {
            upperBeat *= 2;
        }
    }
    for (let iteration = 0; iteration < 64; iteration++) {
        const midpoint = (lowerBeat + upperBeat) / 2;
        if (oracleSeconds(sortedChanges, 0, midpoint, defaultTempo) < targetSeconds) {
            lowerBeat = midpoint;
        } else {
            upperBeat = midpoint;
        }
    }
    return (lowerBeat + upperBeat) / 2;
}

// Seeded, so every case replays exactly; a failure names its case index.
const SEED = 0x5991;
const MAP_COUNT = 2500;
const SAMPLE_RATES = [44_100, 48_000, 96_000] as const;

function pick<T>(random: Random, values: readonly T[]): T {
    return values[Math.floor(random() * values.length)]!;
}

/** The neighbouring double above (`direction` 1) or below (-1) a finite value. */
function adjacentDouble(value: number, direction: 1 | -1): number {
    if (value === 0) {
        return direction * Number.MIN_VALUE;
    }
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0);
    view.setBigUint64(0, value > 0 === direction > 0 ? bits + 1n : bits - 1n);
    return view.getFloat64(0);
}

function randomBeat(random: Random): number {
    const kind = random();
    if (kind < 0.15) {
        return 0;
    }
    if (kind < 0.3) {
        return -Math.floor(random() * 8) - random() * 0.5;
    }
    if (kind < 0.6) {
        return Math.floor(random() * 64);
    }
    if (kind < 0.8) {
        return Math.floor(random() * 64) + pick(random, [1 / 3, 0.25, 0.1, 1e-7, 0.999_999_9]);
    }
    return random() * 64;
}

function randomMap(random: Random, caseIndex: number): TempoChange[] {
    const shape = random();
    if (shape < 0.05) {
        return [];
    }
    const count = shape < 0.15 ? 1 : 1 + Math.floor(random() * 8);
    const changes: TempoChange[] = [];
    for (let index = 0; index < count; index++) {
        const previous = changes.at(-1);
        // Shared beats are how a ramp arrives at a step; repeated tempos give the flat-ramp branch.
        const beat = previous && random() < 0.2 ? previous.beat : randomBeat(random);
        const tempo = previous && random() < 0.1 ? previous.tempo : 20 + random() * 979;
        changes.push({
            id: `case-${caseIndex}-${index}`,
            beat,
            tempo,
            curve: random() < 0.5 ? 'linear' : 'instant',
        });
    }
    // A NaN beat keeps the linear scans; it must still agree.
    if (random() < 0.02) {
        changes.push({ id: `case-${caseIndex}-nan`, beat: Number.NaN, tempo: 140, curve: 'linear' });
    }
    // Stored order is not beat order.
    return changes.sort(() => random() - 0.5);
}

function queryBeats(random: Random, changes: readonly TempoChange[]): number[] {
    const beats = [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const change of changes) {
        if (Number.isFinite(change.beat)) {
            beats.push(change.beat, adjacentDouble(change.beat, 1), adjacentDouble(change.beat, -1));
        }
    }
    for (let index = 0; index < 6; index++) {
        beats.push(random() * 96 - 16);
    }
    return beats;
}

function describeCase(caseIndex: number, changes: readonly TempoChange[], defaultTempo: number): string {
    const map = changes.map((change) => `${change.beat}@${change.tempo}/${change.curve}`).join(', ');
    return `case ${caseIndex} [${map}] default ${defaultTempo}`;
}

describe('tempo-map conversions match the segment-by-segment walk bit for bit', () => {
    it('agrees on secondsBetweenBeats, beatToSamples, samplesToBeat and the tempo readouts', () => {
        const random = createSeededRandom(SEED);
        const mismatches: string[] = [];
        let comparisons = 0;
        const compare = (label: string, actual: unknown, expected: unknown) => {
            comparisons++;
            if (!Object.is(actual, expected)) {
                mismatches.push(`${label}: got ${String(actual)}, expected ${String(expected)}`);
            }
        };

        for (let caseIndex = 0; caseIndex < MAP_COUNT; caseIndex++) {
            const changes = randomMap(random, caseIndex);
            const defaultTempo = 20 + random() * 280;
            const sampleRate = pick(random, SAMPLE_RATES);
            const sorted = oracleSort(changes);
            const label = describeCase(caseIndex, changes, defaultTempo);
            const beats = queryBeats(random, changes);

            for (const beat of beats) {
                compare(
                    `${label} seconds 0→${beat}`,
                    secondsBetweenBeats(changes, 0, beat, defaultTempo),
                    oracleSeconds(sorted, 0, beat, defaultTempo)
                );
                compare(
                    `${label} seconds ${beat}→0`,
                    secondsBetweenBeats(changes, beat, 0, defaultTempo),
                    oracleSeconds(sorted, beat, 0, defaultTempo)
                );
                const otherBeat = pick(random, beats);
                compare(
                    `${label} seconds ${beat}→${otherBeat}`,
                    secondsBetweenBeats(changes, beat, otherBeat, defaultTempo),
                    oracleSeconds(sorted, beat, otherBeat, defaultTempo)
                );
                compare(
                    `${label} samples at ${beat}`,
                    beatToSamples(changes, beat, defaultTempo, sampleRate),
                    oracleBeatToSamples(changes, beat, defaultTempo, sampleRate)
                );
                compare(
                    `${label} tempo at ${beat}`,
                    getTempoAtBeat(changes, beat, defaultTempo),
                    oracleTempoAt(sorted, beat, defaultTempo)
                );
                const governing = getGoverningTempoChange(changes, beat);
                const expectedGoverning = oracleGoverning(sorted, beat);
                compare(`${label} governing change at ${beat}`, governing?.change, expectedGoverning?.change);
                compare(
                    `${label} governing interpolation at ${beat}`,
                    governing?.interpolated,
                    expectedGoverning === undefined ? undefined : expectedGoverning.rampTarget !== undefined
                );
            }

            const sampleQueries = [0, Math.floor(random() * 4_000_000) - 1_000_000, Math.floor(random() * 50_000)];
            for (const change of changes) {
                if (Number.isFinite(change.beat)) {
                    sampleQueries.push(oracleBeatToSamples(changes, change.beat, defaultTempo, sampleRate));
                }
            }
            for (const samples of sampleQueries) {
                compare(
                    `${label} beat at ${samples} samples / ${sampleRate}`,
                    samplesToBeat(changes, samples, defaultTempo, sampleRate),
                    oracleSamplesToBeat(changes, samples, defaultTempo, sampleRate)
                );
            }
        }

        expect(mismatches.slice(0, 10)).toEqual([]);
        expect(comparisons).toBeGreaterThan(MAP_COUNT * 20);
    });
});
