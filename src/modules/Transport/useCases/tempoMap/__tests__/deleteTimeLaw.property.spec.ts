import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BEAT_EPSILON, getTempoAtBeat, secondsBetweenBeats } from '../../../models/TempoMap';
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
const SEED = 0x5178;
const CASE_COUNT = 1500;
const DEFAULT_TEMPO = 120;
const SAMPLE_RATE = 48_000;
const FRAME_SECONDS = 1 / SAMPLE_RATE;
// The projection samples a ramp at this interval while the engine's segment budget allows,
// which it always does for maps this small.
const RAMP_SAMPLE_BEATS = 0.25;
const TIMELINE_BEATS = 12;
const GRID_DENOMINATORS = [3, 5, 6, 7, 10, 12, 1, 2, 4, 8, 16] as const;
// Near-equal pairs sit within tolerance of each other.
const PAIR_OFFSETS = [2e-15, 1e-9, 3e-7, 7e-7, 9.9e-7] as const;
// Bounds sit on a grid point or a change, or inside or just outside tolerance of one.
const BOUND_OFFSETS = [1e-9, 5e-7, 9.9e-7, 1.01e-6, 1.5e-6, 2.5e-6] as const;
const IMPLIED_METER = {
    numerator: defaultTransportState.timeSignatureNumerator,
    denominator: defaultTransportState.timeSignatureDenominator,
};

type Random = () => number;

type Maps = {
    tempo: readonly TempoChange[];
    meter: readonly TimeSignatureChange[];
};

type Cut = {
    startBeat: number;
    endBeat: number;
};

type Downbeat = {
    beat: number;
    numerator: number;
    denominator: number;
};

const frameCoverage = { cuts: 0, tempoChecked: 0, meterChecked: 0 };

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
    return random() < 0.45 ? 'linear' : 'instant';
}

// The first change of a near-equal pair is instant: a ramp narrower than the tolerance has
// both ends on one beat, so it has no slope the law could keep.
function generateTempo(random: Random): TempoChange[] {
    const changes: TempoChange[] = [];
    for (const [index, beat] of gridBeats(random, integer(random, 1, 6)).entries()) {
        const id = `t${index}`;
        if (random() < 0.3) {
            changes.push({ id, beat, tempo: randomTempo(random), curve: 'instant' });
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

function chooseBaseBeat(random: Random, anchors: readonly number[]): number {
    const denominator = pick(random, GRID_DENOMINATORS);
    if (anchors.length > 0 && random() < 0.5) {
        return pick(random, anchors);
    }
    return integer(random, 0, TIMELINE_BEATS * denominator) / denominator;
}

function chooseBeat(random: Random, anchors: readonly number[]): number {
    const base = chooseBaseBeat(random, anchors);
    if (random() < 0.4) {
        return base;
    }
    const offset = pick(random, BOUND_OFFSETS);
    return random() < 0.5 ? base - offset : base + offset;
}

function chooseCut(random: Random, maps: Maps): Cut {
    const anchors = [...maps.tempo, ...maps.meter].map(({ beat }) => beat);
    const startBeat = Math.max(0, chooseBeat(random, anchors));
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const endBeat = chooseBeat(random, anchors);
        if (endBeat > startBeat) {
            return { startBeat, endBeat };
        }
    }
    const denominator = pick(random, GRID_DENOMINATORS);
    return { startBeat, endBeat: startBeat + integer(random, 1, 4 * denominator) / denominator };
}

function readMaps(): Maps {
    return {
        tempo: tempoMapStore.value?.changes ?? [],
        meter: timeSignatureMapStore.value?.changes ?? [],
    };
}

function shiftedPastCut(beat: number, { startBeat, endBeat }: Cut): number {
    const shiftedBeat = beat - (endBeat - startBeat);
    return shiftedBeat - startBeat <= BEAT_EPSILON ? startBeat : shiftedBeat;
}

// The law, stated per change: kept below S − ε, removed up to E − ε, and shifted by
// exactly the content span from there, landing exactly on S when within ε of it.
function expectClassified<TChange extends { id: string; beat: number }>(
    before: readonly TChange[],
    after: readonly TChange[],
    cut: Cut,
    context: string
): void {
    const afterById = new Map(after.map((change) => [change.id, change]));
    for (const change of before) {
        const found = afterById.get(change.id);
        if (change.beat < cut.startBeat - BEAT_EPSILON) {
            expect(found, `${context}: kept ${change.id}`).toEqual(change);
            continue;
        }
        if (change.beat < cut.endBeat - BEAT_EPSILON) {
            expect(found, `${context}: removed ${change.id}`).toBeUndefined();
            continue;
        }
        expect(found, `${context}: shifted ${change.id}`).toEqual({
            ...change,
            beat: shiftedPastCut(change.beat, cut),
        });
    }
}

function expectCarriedPlacement(before: Maps, after: Maps, { startBeat }: Cut, context: string): void {
    const tempoIds = new Set(before.tempo.map(({ id }) => id));
    for (const change of after.tempo.filter(({ id }) => !tempoIds.has(id))) {
        // An arrival or a carried tempo sits on the cut; a kept lead-in sits on beat 0.
        expect([startBeat, 0], `${context}: created tempo at ${change.beat}`).toContain(change.beat);
    }
    const meterIds = new Set(before.meter.map(({ id }) => id));
    for (const change of after.meter.filter(({ id }) => !meterIds.has(id))) {
        // A carried meter opens on the cut or on an old downbeat more than ε past it.
        expect(
            change.beat === startBeat || change.beat > startBeat + BEAT_EPSILON,
            `${context}: created meter at ${change.beat}`
        ).toBe(true);
    }
}

function tempoSlope(changes: readonly TempoChange[], beat: number): number {
    let previous: TempoChange | undefined;
    let next: TempoChange | undefined;
    for (const change of byBeat(changes)) {
        if (change.beat <= beat) {
            previous = change;
            continue;
        }
        next = change;
        break;
    }
    if (!previous || previous.curve !== 'linear' || !next) {
        return 0;
    }
    return Math.abs((next.tempo - previous.tempo) / (next.beat - previous.beat));
}

// A ramp whose target sits on the cut but before its start has reached that target's tempo
// there, and never reads past it, so it arrives at the start at the target's tempo a little
// later than it did: its slope changes by at most (S − T) / (S − G) of the ramp's rise.
function rampArrivalAllowance(changes: readonly TempoChange[], startBeat: number): { tempo: number; seconds: number } {
    const sorted = byBeat(changes);
    const kept = sorted.filter(({ beat }) => beat < startBeat - BEAT_EPSILON);
    const ramping = kept[kept.length - 1];
    const target = ramping && sorted.find(({ beat }) => beat > ramping.beat);
    if (!ramping || ramping.curve !== 'linear' || !target || target.beat >= startBeat) {
        return { tempo: 0, seconds: 0 };
    }
    const tempo = (Math.abs(target.tempo - ramping.tempo) * (startBeat - target.beat)) / (startBeat - ramping.beat);
    const slowest = Math.min(ramping.tempo, target.tempo);
    return { tempo, seconds: (60 * tempo * (startBeat - ramping.beat)) / (slowest * slowest) };
}

function expectTempoBeforeCutKept(before: Maps, after: Maps, { startBeat }: Cut, context: string): void {
    const allowance = rampArrivalAllowance(before.tempo, startBeat);
    const cutStart = startBeat - BEAT_EPSILON;
    const anchors = uniqueSorted([0, ...before.tempo.map(({ beat }) => beat)]).filter((beat) => beat < cutStart);
    for (const [index, beat] of anchors.entries()) {
        const next = anchors[index + 1] ?? cutStart;
        for (const probe of [beat, beat + (next - beat) / 2, beat + (next - beat) * 0.9]) {
            if (probe >= cutStart) {
                continue;
            }
            const expectedTempo = getTempoAtBeat(before.tempo, probe, DEFAULT_TEMPO);
            const tempo = getTempoAtBeat(after.tempo, probe, DEFAULT_TEMPO);
            expect(Math.abs(tempo - expectedTempo), `${context}: tempo before the cut at ${probe}`).toBeLessThanOrEqual(
                1e-9 * Math.max(1, expectedTempo) + allowance.tempo
            );
            const expectedSeconds = secondsBetweenBeats(before.tempo, 0, probe, DEFAULT_TEMPO);
            const seconds = secondsBetweenBeats(after.tempo, 0, probe, DEFAULT_TEMPO);
            expect(
                Math.abs(seconds - expectedSeconds),
                `${context}: seconds before the cut at ${probe}`
            ).toBeLessThanOrEqual(1e-9 + allowance.seconds);
        }
    }
}

function horizonOf(before: Maps, { endBeat }: Cut): number {
    return Math.max(endBeat, ...before.tempo.map(({ beat }) => beat), ...before.meter.map(({ beat }) => beat)) + 8;
}

// Two changes within ε are one beat, and which of them reads between them is a rounding
// accident (a shift can round a float-step pair onto one beat), so no probe sits there.
function isBetweenNearEqualChanges(changes: readonly TempoChange[], beat: number): boolean {
    return changes.some((change) => change.beat !== beat && Math.abs(change.beat - beat) <= 2 * BEAT_EPSILON);
}

// Content after the cut sits at its old beat less the span. A change within ε of the end
// lands on the start, up to ε from where content puts it, so a ramp it opens reads within
// its slope times that distance; nothing within 2ε of the cut is compared.
function expectTempoAfterCutKept(before: Maps, after: Maps, cut: Cut, context: string): void {
    const { startBeat, endBeat } = cut;
    const span = endBeat - startBeat;
    const anchors = uniqueSorted([
        endBeat + 3 * BEAT_EPSILON,
        ...before.tempo.map(({ beat }) => beat).filter((beat) => beat > endBeat + 2 * BEAT_EPSILON),
        horizonOf(before, cut),
    ]);
    for (const [index, beat] of anchors.entries()) {
        const next = anchors[index + 1];
        const probes = next === undefined ? [beat] : [beat, beat + (next - beat) / 2];
        for (const oldBeat of probes) {
            const newBeat = oldBeat - span;
            if (newBeat <= startBeat + 2 * BEAT_EPSILON || isBetweenNearEqualChanges(before.tempo, oldBeat)) {
                continue;
            }
            const expectedTempo = getTempoAtBeat(before.tempo, oldBeat, DEFAULT_TEMPO);
            const tempo = getTempoAtBeat(after.tempo, newBeat, DEFAULT_TEMPO);
            const slope = Math.max(tempoSlope(before.tempo, oldBeat), tempoSlope(after.tempo, newBeat));
            expect(
                Math.abs(tempo - expectedTempo),
                `${context}: tempo after the cut at old beat ${oldBeat}`
            ).toBeLessThanOrEqual(1e-9 * Math.max(1, expectedTempo) + 2 * BEAT_EPSILON * slope);
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

function meterDownbeats(changes: readonly TimeSignatureChange[], fromBeat: number, toBeat: number): Downbeat[] {
    const governing = collapseWithinTolerance(changes);
    const segments: Downbeat[] = governing.map(({ beat, numerator, denominator }) => ({
        beat,
        numerator,
        denominator,
    }));
    if (!governing[0] || governing[0].beat > 0) {
        segments.unshift({ beat: 0, ...IMPLIED_METER });
    }
    const downbeats: Downbeat[] = [];
    for (const [index, segment] of segments.entries()) {
        const segmentEnd = segments[index + 1]?.beat ?? Number.POSITIVE_INFINITY;
        const barBeats = (segment.numerator * 4) / segment.denominator;
        for (let bar = 0; ; bar += 1) {
            const beat = segment.beat + bar * barBeats;
            if (beat >= segmentEnd - BEAT_EPSILON || beat > toBeat) {
                break;
            }
            if (beat >= fromBeat) {
                downbeats.push({ beat, numerator: segment.numerator, denominator: segment.denominator });
            }
        }
    }
    return downbeats;
}

function governingMeterAt(changes: readonly TimeSignatureChange[], beat: number): Downbeat {
    const atOrBefore = byBeat(changes).filter((change) => change.beat <= beat);
    return atOrBefore[atOrBefore.length - 1] ?? { beat: 0, ...IMPLIED_METER };
}

// Every old downbeat from E − ε on moves with its material, so it lands where a change
// there would (exactly on S when within ε of it) and still opens a bar of its meter.
function expectDownbeatsAfterCutKept(before: Maps, after: Maps, cut: Cut, context: string): void {
    for (const downbeat of meterDownbeats(before.meter, cut.endBeat - BEAT_EPSILON, horizonOf(before, cut))) {
        const newBeat = shiftedPastCut(downbeat.beat, cut);
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
        ).toBeLessThanOrEqual(2 * BEAT_EPSILON + 1e-9);
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

// The precondition #5214 leaves open: every two boundaries the projection could open are
// either one beat within tolerance (and folded into one segment) or at least a frame apart.
// It reads the map, never the projection, so a case is never excluded by its own result.
function separatedByAFrame(beats: readonly number[], tempo: readonly TempoChange[]): boolean {
    const sorted = uniqueSorted(beats);
    return sorted.every((beat, index) => {
        const next = sorted[index + 1];
        if (next === undefined || next - beat <= BEAT_EPSILON) {
            return true;
        }
        const seconds = secondsBetweenBeats(tempo, beat, next, DEFAULT_TEMPO);
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
    frameCoverage.cuts += 1;
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

type AppliedCut = {
    before: Maps;
    after: Maps;
    inversePlan: ReturnType<typeof prepareTimelineMapTimeOperation>['inversePlan'];
};

function runCase(index: number): void {
    const random = createRandom(SEED * 7919 + index);
    tempoMapStore.set({ changes: generateTempo(random) });
    timeSignatureMapStore.set({ changes: generateMeter(random) });

    const applied: AppliedCut[] = [];
    const cutCount = integer(random, 1, 3);
    for (let step = 0; step < cutCount; step += 1) {
        const before = readMaps();
        const cut = chooseCut(random, before);
        const context = `case ${index}, cut ${step} [${cut.startBeat}, ${cut.endBeat})`;
        const transaction = prepareTimelineMapTimeOperation({ operation: { type: 'delete', ...cut } });
        expect(transaction.status, context).toBe('ready');
        if (transaction.hasChanges) {
            expect(transaction.apply(), context).toBe(true);
        }
        const after = readMaps();

        expectClassified(before.tempo, after.tempo, cut, `${context} tempo`);
        expectClassified(before.meter, after.meter, cut, `${context} meter`);
        expectCarriedPlacement(before, after, cut, context);
        expectTempoBeforeCutKept(before, after, cut, context);
        expectTempoAfterCutKept(before, after, cut, context);
        expectDownbeatsAfterCutKept(before, after, cut, context);
        expectProjectedFramesIncrease(after, context);
        applied.push({ before, after, inversePlan: transaction.inversePlan });
    }

    for (const [step, { before, after, inversePlan }] of [...applied.entries()].reverse()) {
        const context = `case ${index}, undo of cut ${step}`;
        expect(readMaps(), context).toEqual(after);
        if (inversePlan) {
            expect(prepareTimelineMapStateRestore(inversePlan).apply(), context).toBe(true);
        }
        expect(readMaps(), context).toEqual(before);
    }
}

describe('Delete Time keeps the maps before the cut and shifts those after it with the content', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: DEFAULT_TEMPO });
    });

    it.each(Array.from({ length: CASE_COUNT }, (_, index) => index))('holds for seeded case %i', (index) => {
        runCase(index);
    });

    // Runs after every case above: the frame law must have been checked on most cuts, so
    // the precondition cannot quietly exclude the cases it exists to cover.
    it('checked projected frames on most cuts', () => {
        expect(frameCoverage.cuts).toBeGreaterThan(CASE_COUNT);
        expect(frameCoverage.tempoChecked / frameCoverage.cuts).toBeGreaterThan(0.8);
        expect(frameCoverage.meterChecked / frameCoverage.cuts).toBeGreaterThan(0.8);
    });
});
