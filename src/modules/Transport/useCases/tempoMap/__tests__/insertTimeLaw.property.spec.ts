import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BEAT_EPSILON } from '../../../models/TempoMap';
import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { tempoMapStore, type TempoChange } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore, type TimeSignatureChange } from '../../../stores/timeSignatureMapStore';
import { prepareTimelineMapStateRestore } from '../prepareTimelineMapStateRestore';
import { prepareTimelineMapTimeOperation } from '../prepareTimelineMapTimeOperation';
import { projectEngineTransportMaps } from '../projectEngineTransportMaps';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

// Seeded, so every case replays exactly; a failure names its case index.
const SEED = 0x5196;
const CASE_COUNT = 1500;
const DEFAULT_TEMPO = 120;
const SAMPLE_RATE = 48_000;
const FRAME_SECONDS = 1 / SAMPLE_RATE;
// The projection samples a ramp at this interval while the engine's segment budget allows,
// which it always does for maps this small.
const RAMP_SAMPLE_BEATS = 0.25;
const TIMELINE_BEATS = 12;
const GRID_DENOMINATORS = [3, 5, 6, 7, 10, 12, 1, 2, 4, 8, 16] as const;
// Near-equal pairs sit within tolerance of each other, or just past it and within twice it.
const PAIR_OFFSETS = [2e-15, 1e-9, 3e-7, 7e-7, 9.9e-7, 1.5e-6, 1.99e-6] as const;
// Insert points sit on a grid point or a change, or inside or just outside tolerance of one.
const POINT_OFFSETS = [1e-9, 5e-7, 9.9e-7, 1.01e-6, 1.5e-6, 2.5e-6] as const;
const IMPLIED_METER = {
    numerator: defaultTransportState.timeSignatureNumerator,
    denominator: defaultTransportState.timeSignatureDenominator,
};

type Random = () => number;

type Maps = {
    tempo: readonly TempoChange[];
    meter: readonly TimeSignatureChange[];
};

type Insert = {
    atBeat: number;
    durationBeats: number;
};

type Meter = {
    beat: number;
    numerator: number;
    denominator: number;
};

const frameCoverage = { inserts: 0, tempoChecked: 0, meterChecked: 0 };
// The shapes the law is most easily broken on, counted so the seeds cannot quietly stop
// reaching them: a linear change followed within 2ε by its target, an insert point with a
// change within ε on each side of it, and an insert inside such a narrow ramp.
const shapeCoverage = { narrowRampCases: 0, straddledInserts: 0, narrowRampInserts: 0 };

function createRandom(seed: number): Random {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = state;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function integer(random: Random, min: number, max: number): number {
    return min + Math.floor(random() * (max - min + 1));
}

function pick<TItem>(random: Random, items: readonly TItem[]): TItem {
    return items[Math.floor(random() * items.length)]!;
}

// Stable, so changes on one beat keep their list order: the first is where a ramp
// arrives and the last governs from that beat on.
function byBeat<TChange extends { beat: number }>(changes: readonly TChange[]): TChange[] {
    return [...changes].sort((left, right) => left.beat - right.beat);
}

function uniqueSorted(beats: readonly number[]): number[] {
    return [...new Set(beats)].sort((left, right) => left - right);
}

function gridBeats(random: Random, count: number): number[] {
    const denominator = pick(random, GRID_DENOMINATORS);
    const steps = new Set<number>();
    while (steps.size < count) {
        steps.add(integer(random, 0, TIMELINE_BEATS * denominator));
    }
    return Array.from(steps, (step) => step / denominator);
}

function randomTempo(random: Random): number {
    return 40 + random() * 200;
}

function randomCurve(random: Random): TempoChange['curve'] {
    return random() < 0.5 ? 'linear' : 'instant';
}

// The first change of a near-equal pair may ramp, so a linear change is often followed
// within 2ε by its target: a ramp narrower than the tolerance.
function generateTempo(random: Random): TempoChange[] {
    const changes: TempoChange[] = [];
    for (const [index, beat] of gridBeats(random, integer(random, 1, 6)).entries()) {
        const id = `t${index}`;
        if (random() < 0.3) {
            changes.push({ id, beat, tempo: randomTempo(random), curve: randomCurve(random) });
            changes.push({
                id: `${id}-pair`,
                beat: beat + pick(random, PAIR_OFFSETS),
                tempo: randomTempo(random),
                curve: randomCurve(random),
            });
            continue;
        }
        changes.push({ id, beat, tempo: randomTempo(random), curve: randomCurve(random) });
    }
    return byBeat(changes);
}

function randomMeter(random: Random): { numerator: number; denominator: number } {
    return { numerator: integer(random, 2, 7), denominator: pick(random, [2, 4, 8, 16]) };
}

function generateMeter(random: Random): TimeSignatureChange[] {
    const changes: TimeSignatureChange[] = [];
    for (const [index, beat] of gridBeats(random, integer(random, 0, 3)).entries()) {
        const id = `m${index}`;
        changes.push({ id, beat, ...randomMeter(random) });
        if (random() < 0.2) {
            changes.push({ id: `${id}-pair`, beat: beat + pick(random, PAIR_OFFSETS), ...randomMeter(random) });
        }
    }
    return byBeat(changes);
}

function chooseBasePoint(random: Random, anchors: readonly number[]): number {
    const denominator = pick(random, GRID_DENOMINATORS);
    if (anchors.length > 0 && random() < 0.5) {
        return pick(random, anchors);
    }
    return integer(random, 0, TIMELINE_BEATS * denominator) / denominator;
}

function choosePoint(random: Random, anchors: readonly number[]): number {
    const base = chooseBasePoint(random, anchors);
    if (random() < 0.4) {
        return base;
    }
    const offset = pick(random, POINT_OFFSETS);
    return random() < 0.5 ? base - offset : base + offset;
}

// Two changes up to 2ε apart, so an insert point between them has a change within ε on
// each side.
function nearEqualGaps(beats: readonly number[]): Array<[number, number]> {
    const sorted = uniqueSorted(beats);
    const gaps: Array<[number, number]> = [];
    for (const [index, beat] of sorted.entries()) {
        const next = sorted[index + 1];
        if (next !== undefined && next - beat <= 2 * BEAT_EPSILON) {
            gaps.push([beat, next]);
        }
    }
    return gaps;
}

function chooseInsert(random: Random, maps: Maps): Insert {
    const anchors = [...maps.tempo, ...maps.meter].map(({ beat }) => beat);
    const gaps = nearEqualGaps(anchors);
    let atBeat = Math.max(0, choosePoint(random, anchors));
    if (gaps.length > 0 && random() < 0.35) {
        const [low, high] = pick(random, gaps);
        atBeat = low + (high - low) / 2;
    }
    const denominator = pick(random, GRID_DENOMINATORS);
    return { atBeat, durationBeats: integer(random, 1, 4 * denominator) / denominator };
}

function countShapes(before: Maps, insert: Insert): void {
    const beats = [...before.tempo, ...before.meter].map(({ beat }) => beat);
    const below = beats.some((beat) => beat < insert.atBeat && beat >= insert.atBeat - BEAT_EPSILON);
    const above = beats.some((beat) => beat >= insert.atBeat && beat <= insert.atBeat + BEAT_EPSILON);
    if (below && above) {
        shapeCoverage.straddledInserts += 1;
    }
    const ramp = rampAtPoint(before.tempo, insert);
    if (ramp && ramp.target.beat - ramp.governing.beat <= 2 * BEAT_EPSILON) {
        shapeCoverage.narrowRampInserts += 1;
    }
}

function hasNarrowRamp(changes: readonly TempoChange[]): boolean {
    const sorted = byBeat(changes);
    return sorted.some((change) => {
        const target = sorted.find(({ beat }) => beat > change.beat);
        return change.curve === 'linear' && target !== undefined && target.beat - change.beat <= 2 * BEAT_EPSILON;
    });
}

function readMaps(): Maps {
    return {
        tempo: tempoMapStore.value?.changes ?? [],
        meter: timeSignatureMapStore.value?.changes ?? [],
    };
}

// --- An oracle of its own: the reading the law is stated in, independent of the map readers.

// Exact, as the arrangement classifies clips and markers: before the point stays, and
// everything from it on moves by exactly the inserted span.
function isKept(beat: number, { atBeat }: Insert): boolean {
    return beat < atBeat;
}

function shiftedByInsert(beat: number, insert: Insert): number {
    return beat + insert.durationBeats;
}

type TempoSegment = {
    governing: TempoChange;
    target: TempoChange | undefined;
};

type Ramp = {
    governing: TempoChange;
    target: TempoChange;
};

// The last change at or before the beat governs, and a linear one ramps toward the first
// change after its own beat. Before the first change the map reads that change's tempo.
function tempoSegmentAt(sorted: readonly TempoChange[], beat: number): TempoSegment | undefined {
    let governing: TempoChange | undefined;
    for (const change of sorted) {
        if (change.beat <= beat) {
            governing = change;
        }
    }
    if (!governing) {
        return sorted[0] ? { governing: sorted[0], target: undefined } : undefined;
    }
    const pivot = governing.beat;
    const target = governing.curve === 'linear' ? sorted.find((change) => change.beat > pivot) : undefined;
    return { governing, target };
}

// A ramp holds its own tempo before it starts and its target's once it arrives.
function lineTempo({ governing, target }: TempoSegment, beat: number): number {
    if (!target || beat <= governing.beat) {
        return governing.tempo;
    }
    if (beat >= target.beat) {
        return target.tempo;
    }
    const share = (beat - governing.beat) / (target.beat - governing.beat);
    return governing.tempo + share * (target.tempo - governing.tempo);
}

function oracleTempo(changes: readonly TempoChange[], beat: number): number {
    const segment = tempoSegmentAt(byBeat(changes), beat);
    return segment ? lineTempo(segment, beat) : DEFAULT_TEMPO;
}

function oracleSlope(changes: readonly TempoChange[], beat: number): number {
    const segment = tempoSegmentAt(byBeat(changes), beat);
    if (!segment?.target) {
        return 0;
    }
    return Math.abs((segment.target.tempo - segment.governing.tempo) / (segment.target.beat - segment.governing.beat));
}

// Seconds across a span in which one segment governs: a tempo linear in beats integrates
// to 60 ln(end / start) / slope.
function segmentSeconds(segment: TempoSegment | undefined, fromBeat: number, toBeat: number): number {
    if (!segment) {
        return ((toBeat - fromBeat) * 60) / DEFAULT_TEMPO;
    }
    const startTempo = lineTempo(segment, fromBeat);
    const endTempo = lineTempo(segment, toBeat);
    if (startTempo === endTempo) {
        return ((toBeat - fromBeat) * 60) / startTempo;
    }
    return ((toBeat - fromBeat) * 60 * Math.log(endTempo / startTempo)) / (endTempo - startTempo);
}

function oracleSeconds(changes: readonly TempoChange[], toBeat: number): number {
    const sorted = byBeat(changes);
    const bounds = uniqueSorted([0, ...sorted.map(({ beat }) => beat).filter((beat) => beat > 0 && beat < toBeat)]);
    let seconds = 0;
    for (const [index, fromBeat] of bounds.entries()) {
        const segmentEnd = bounds[index + 1] ?? toBeat;
        seconds += segmentSeconds(tempoSegmentAt(sorted, fromBeat), fromBeat, segmentEnd);
    }
    return seconds;
}

// The change kept last before the point and the change it ramps toward, when it ramps.
function rampAtPoint(changes: readonly TempoChange[], insert: Insert): Ramp | undefined {
    const sorted = byBeat(changes);
    const kept = sorted.filter(({ beat }) => isKept(beat, insert));
    const governing = kept[kept.length - 1];
    const target = governing && sorted.find(({ beat }) => beat > governing.beat);
    if (!governing || governing.curve !== 'linear' || !target) {
        return undefined;
    }
    return { governing, target };
}

// The tempo arriving at the insert point from before it: what the change kept last before
// the point reads there, along its ramp when it ramps; the lead-in tempo when none is kept.
function tempoArrivingAt(changes: readonly TempoChange[], insert: Insert): number {
    const sorted = byBeat(changes);
    const kept = sorted.filter(({ beat }) => isKept(beat, insert));
    const governing = kept[kept.length - 1];
    if (!governing) {
        return sorted[0]?.tempo ?? DEFAULT_TEMPO;
    }
    const ramp = rampAtPoint(changes, insert);
    return ramp ? lineTempo(ramp, insert.atBeat) : governing.tempo;
}

// Two float readings of one line differ by its slope times a few rounding steps of the
// beat they are read at.
function withinTempoTolerance(actual: number, expected: number, slope: number, beat: number): number {
    return Math.abs(actual - expected) - (1e-9 * Math.max(1, expected) + slope * 1e-14 * Math.max(1, beat));
}

// --- The law.

// Kept before the point, and shifted by exactly the inserted span from it on.
function expectClassified<TChange extends { id: string; beat: number }>(
    before: readonly TChange[],
    after: readonly TChange[],
    insert: Insert,
    context: string
): void {
    const afterById = new Map(after.map((change) => [change.id, change]));
    for (const change of before) {
        const found = afterById.get(change.id);
        if (isKept(change.beat, insert)) {
            expect(found, `${context}: kept ${change.id}`).toEqual(change);
            continue;
        }
        expect(found, `${context}: shifted ${change.id}`).toEqual({
            ...change,
            beat: shiftedByInsert(change.beat, insert),
        });
    }
    expect(
        after.every((change, index) => index === 0 || after[index - 1]!.beat <= change.beat),
        `${context}: beat order`
    ).toBe(true);
}

// Only the ramp arrival on the point and its continuation on the span end are created,
// and a meter never is.
function expectCreatedOnlyArrivalAndContinuation(before: Maps, after: Maps, insert: Insert, context: string): void {
    const tempoIds = new Set(before.tempo.map(({ id }) => id));
    const created = after.tempo.filter(({ id }) => !tempoIds.has(id));
    const arrivals = created.filter(({ beat, curve }) => beat === insert.atBeat && curve === 'instant');
    const continuations = created.filter(
        ({ beat, curve }) => beat === insert.atBeat + insert.durationBeats && curve === 'linear'
    );
    expect(arrivals.length + continuations.length, `${context}: created ${JSON.stringify(created)}`).toBe(
        created.length
    );
    expect(arrivals.length, `${context}: arrivals`).toBeLessThanOrEqual(1);
    expect(continuations.length, `${context}: continuations`).toBeLessThanOrEqual(arrivals.length);
    // Every change that was on the point now sits on the span end, so the arrival is alone
    // on its beat and the ramp before the point arrives at it whatever order the list has.
    expect(
        after.tempo.filter(({ beat }) => beat === insert.atBeat),
        `${context}: changes on the point`
    ).toEqual(arrivals);
    const meterIds = new Set(before.meter.map(({ id }) => id));
    expect(
        after.meter.filter(({ id }) => !meterIds.has(id)),
        `${context}: created meters`
    ).toEqual([]);
}

function horizonOf(before: Maps, { atBeat }: Insert): number {
    return Math.max(atBeat, ...before.tempo.map(({ beat }) => beat), ...before.meter.map(({ beat }) => beat)) + 8;
}

function expectTempoBeforePointKept(before: Maps, after: Maps, { atBeat }: Insert, context: string): void {
    const anchors = uniqueSorted([0, ...before.tempo.map(({ beat }) => beat)]).filter((beat) => beat < atBeat);
    for (const [index, beat] of anchors.entries()) {
        const next = anchors[index + 1] ?? atBeat;
        for (const probe of [beat, beat + (next - beat) / 2, beat + (next - beat) * 0.9]) {
            if (probe >= atBeat) {
                continue;
            }
            const expectedTempo = oracleTempo(before.tempo, probe);
            const tempo = oracleTempo(after.tempo, probe);
            expect(
                withinTempoTolerance(tempo, expectedTempo, oracleSlope(before.tempo, probe), atBeat),
                `${context}: tempo before the point at ${probe} reads ${tempo}, was ${expectedTempo}`
            ).toBeLessThanOrEqual(0);
            expect(
                Math.abs(oracleSeconds(after.tempo, probe) - oracleSeconds(before.tempo, probe)),
                `${context}: seconds before the point at ${probe}`
            ).toBeLessThanOrEqual(1e-9);
        }
    }
}

function rampSlope(ramp: Ramp | undefined): number {
    if (!ramp) {
        return 0;
    }
    return Math.abs((ramp.target.tempo - ramp.governing.tempo) / (ramp.target.beat - ramp.governing.beat));
}

function expectSpanHoldsArrivingTempo(before: Maps, after: Maps, insert: Insert, context: string): void {
    const expectedTempo = tempoArrivingAt(before.tempo, insert);
    const spanEnd = insert.atBeat + insert.durationBeats;
    const slope = rampSlope(rampAtPoint(before.tempo, insert));
    for (const probe of [insert.atBeat, insert.atBeat + insert.durationBeats / 2, spanEnd * (1 - 1e-12)]) {
        const tempo = oracleTempo(after.tempo, probe);
        expect(
            withinTempoTolerance(tempo, expectedTempo, slope, spanEnd),
            `${context}: tempo inside the span at ${probe} reads ${tempo}, arriving ${expectedTempo}`
        ).toBeLessThanOrEqual(0);
    }
}

// Two changes within a float step of a probe read on either side of it once a shift has
// rounded them, so no probe sits between near-equal changes.
function isBetweenNearEqualChanges(changes: readonly { beat: number }[], beat: number): boolean {
    return changes.some((change) => change.beat !== beat && Math.abs(change.beat - beat) <= 2 * BEAT_EPSILON);
}

// Material from the point on sits at its old beat plus exactly the span, with its tempo.
function expectTempoAfterPointShifted(before: Maps, after: Maps, insert: Insert, context: string): void {
    const { atBeat, durationBeats } = insert;
    const anchors = uniqueSorted([
        atBeat,
        ...before.tempo.map(({ beat }) => beat).filter((beat) => beat >= atBeat),
        horizonOf(before, insert),
    ]);
    for (const [index, beat] of anchors.entries()) {
        const next = anchors[index + 1];
        const probes = next === undefined ? [beat] : [beat, beat + (next - beat) / 2];
        for (const oldBeat of probes) {
            if (isBetweenNearEqualChanges(before.tempo, oldBeat)) {
                continue;
            }
            const newBeat = oldBeat + durationBeats;
            const expectedTempo = oracleTempo(before.tempo, oldBeat);
            const tempo = oracleTempo(after.tempo, newBeat);
            const slope = Math.max(oracleSlope(before.tempo, oldBeat), oracleSlope(after.tempo, newBeat));
            expect(
                withinTempoTolerance(tempo, expectedTempo, slope, newBeat),
                `${context}: tempo at old beat ${oldBeat} reads ${tempo}, was ${expectedTempo}`
            ).toBeLessThanOrEqual(0);
        }
    }
}

function collapseWithinTolerance<TChange extends { beat: number }>(changes: readonly TChange[]): TChange[] {
    const sorted = byBeat(changes.filter(({ beat }) => Number.isFinite(beat) && beat >= 0));
    return sorted.filter((change, index) => {
        const next = sorted[index + 1];
        return next === undefined || next.beat - change.beat > BEAT_EPSILON;
    });
}

// Every downbeat of a bar a moved meter change opens moves with it.
function movedMeterDownbeats(changes: readonly TimeSignatureChange[], insert: Insert, toBeat: number): Meter[] {
    const segments = collapseWithinTolerance(changes);
    const downbeats: Meter[] = [];
    for (const [index, segment] of segments.entries()) {
        if (isKept(segment.beat, insert)) {
            continue;
        }
        const segmentEnd = segments[index + 1]?.beat ?? Number.POSITIVE_INFINITY;
        const barBeats = (segment.numerator * 4) / segment.denominator;
        for (let bar = 0; ; bar += 1) {
            const beat = segment.beat + bar * barBeats;
            if (beat >= segmentEnd - BEAT_EPSILON || beat > toBeat) {
                break;
            }
            downbeats.push({ beat, numerator: segment.numerator, denominator: segment.denominator });
        }
    }
    return downbeats;
}

function governingMeterAt(changes: readonly TimeSignatureChange[], beat: number): Meter {
    const atOrBefore = byBeat(changes).filter((change) => change.beat <= beat);
    return atOrBefore[atOrBefore.length - 1] ?? { beat: 0, ...IMPLIED_METER };
}

function expectMeterDownbeatsShifted(before: Maps, after: Maps, insert: Insert, context: string): void {
    for (const downbeat of movedMeterDownbeats(before.meter, insert, horizonOf(before, insert))) {
        const newBeat = shiftedByInsert(downbeat.beat, insert);
        // A rounding step past the position, so a change computed onto it by another
        // float expression still governs it.
        const segment = governingMeterAt(after.meter, newBeat + 1e-9);
        expect([segment.numerator, segment.denominator], `${context}: meter at old downbeat ${downbeat.beat}`).toEqual([
            downbeat.numerator,
            downbeat.denominator,
        ]);
        const barBeats = (segment.numerator * 4) / segment.denominator;
        const phase = (((newBeat - segment.beat) % barBeats) + barBeats) % barBeats;
        expect(
            Math.min(phase, barBeats - phase),
            `${context}: bar phase at old downbeat ${downbeat.beat}`
        ).toBeLessThanOrEqual(1e-9);
    }
}

function tempoBoundaryBeats(changes: readonly TempoChange[]): number[] {
    const governing = collapseWithinTolerance(changes);
    const beats = [0];
    for (const [index, change] of governing.entries()) {
        beats.push(change.beat);
        const next = governing[index + 1];
        if (change.curve !== 'linear' || !next || next.beat <= change.beat) {
            continue;
        }
        for (let beat = change.beat + RAMP_SAMPLE_BEATS; beat < next.beat - BEAT_EPSILON; beat += RAMP_SAMPLE_BEATS) {
            beats.push(beat);
        }
    }
    return beats;
}

// Every two boundaries the projection could open are either one beat within tolerance (and
// folded into one segment) or at least a frame apart. It reads the map, never the
// projection, so a case is never excluded by its own result.
function separatedByAFrame(beats: readonly number[], tempo: readonly TempoChange[]): boolean {
    const sorted = uniqueSorted(beats);
    return sorted.every((beat, index) => {
        const next = sorted[index + 1];
        if (next === undefined || next - beat <= BEAT_EPSILON) {
            return true;
        }
        const seconds = oracleSeconds(tempo, next) - oracleSeconds(tempo, beat);
        return seconds >= FRAME_SECONDS * (1 + 1e-6);
    });
}

function expectStrictlyIncreasingFrames(segments: readonly { startSeconds: number }[], context: string): void {
    const frames = segments.map(({ startSeconds }) => Math.round(startSeconds * SAMPLE_RATE));
    for (const [index, frame] of frames.entries()) {
        if (index > 0) {
            expect(frame, `${context}: frame ${index} of ${frames.join(',')}`).toBeGreaterThan(frames[index - 1]!);
        }
    }
}

function expectProjectedFramesIncrease(after: Maps, context: string): void {
    const projected = projectEngineTransportMaps();
    frameCoverage.inserts += 1;
    if (separatedByAFrame(tempoBoundaryBeats(after.tempo), after.tempo)) {
        frameCoverage.tempoChecked += 1;
        expectStrictlyIncreasingFrames(projected.tempo, `${context}: tempo`);
    }
    const meterBeats = [0, ...collapseWithinTolerance(after.meter).map(({ beat }) => beat)];
    if (separatedByAFrame(meterBeats, after.tempo)) {
        frameCoverage.meterChecked += 1;
        expectStrictlyIncreasingFrames(projected.timeSignature, `${context}: meter`);
    }
}

type AppliedInsert = {
    before: Maps;
    after: Maps;
    inversePlan: ReturnType<typeof prepareTimelineMapTimeOperation>['inversePlan'];
};

function runCase(index: number): void {
    const random = createRandom(SEED * 7919 + index);
    tempoMapStore.set({ changes: generateTempo(random) });
    timeSignatureMapStore.set({ changes: generateMeter(random) });
    if (hasNarrowRamp(readMaps().tempo)) {
        shapeCoverage.narrowRampCases += 1;
    }

    const applied: AppliedInsert[] = [];
    const insertCount = integer(random, 1, 3);
    for (let step = 0; step < insertCount; step += 1) {
        const before = readMaps();
        const insert = chooseInsert(random, before);
        const context = `case ${index}, insert ${step} of ${insert.durationBeats} at ${insert.atBeat}`;
        countShapes(before, insert);
        const transaction = prepareTimelineMapTimeOperation({ operation: { type: 'insert', ...insert } });
        expect(transaction.status, context).toBe('ready');
        if (transaction.hasChanges) {
            expect(transaction.apply(), context).toBe(true);
        }
        const after = readMaps();

        expectClassified(before.tempo, after.tempo, insert, `${context} tempo`);
        expectClassified(before.meter, after.meter, insert, `${context} meter`);
        expectCreatedOnlyArrivalAndContinuation(before, after, insert, context);
        expectTempoBeforePointKept(before, after, insert, context);
        expectSpanHoldsArrivingTempo(before, after, insert, context);
        expectTempoAfterPointShifted(before, after, insert, context);
        expectMeterDownbeatsShifted(before, after, insert, context);
        expectProjectedFramesIncrease(after, context);
        applied.push({ before, after, inversePlan: transaction.inversePlan });
    }

    for (const [step, { before, after, inversePlan }] of [...applied.entries()].reverse()) {
        const context = `case ${index}, undo of insert ${step}`;
        expect(readMaps(), context).toEqual(after);
        if (inversePlan) {
            expect(prepareTimelineMapStateRestore(inversePlan).apply(), context).toBe(true);
        }
        expect(readMaps(), context).toEqual(before);
    }
}

describe('Insert Time keeps the maps before the point, holds the arriving tempo across the span and shifts the rest with the content', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: DEFAULT_TEMPO });
    });

    it.each(Array.from({ length: CASE_COUNT }, (_, index) => index))('holds for seeded case %i', (index) => {
        runCase(index);
    });

    // Runs after every case above: the frame law must have been checked on most inserts, so
    // the precondition cannot quietly exclude the cases it exists to cover. A pair just past
    // ε is under a frame apart by construction, so those maps are the ones it leaves out.
    it('checked projected frames on most inserts', () => {
        expect(frameCoverage.inserts).toBeGreaterThan(CASE_COUNT);
        expect(frameCoverage.tempoChecked / frameCoverage.inserts).toBeGreaterThan(0.75);
        expect(frameCoverage.meterChecked / frameCoverage.inserts).toBeGreaterThan(0.8);
    });

    it('reached narrow ramps and insert points with a change within tolerance on each side', () => {
        expect(shapeCoverage.narrowRampCases).toBeGreaterThanOrEqual(400);
        expect(shapeCoverage.straddledInserts).toBeGreaterThanOrEqual(500);
        expect(shapeCoverage.narrowRampInserts).toBeGreaterThanOrEqual(200);
    });
});
