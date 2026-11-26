import { describe, expect, it } from 'vitest';

import { projectAudioLoopPassAnchoredSegments, type AudioLoopPassAnchoredSegment } from '../audioSourceTime';
import {
    projectWarpedPieces,
    resolvePlaybackWarpMap,
    resolveWarpMap,
    sourceAtTimelineBeat,
    sourceAtWarpedBeat,
    timelineBeatAtSource,
    warpedBeatAtSource,
    type WarpMap,
    type WarpMarkerLike,
    type WarpPiece,
    type WarpTimeline,
} from '../audioWarpMap';
import { createSeededRandom } from '../SeededRandom/SeededRandom';
import { boundStretchRatio } from '../stretchRatioBound';

/**
 * Laws of the warp mapping. The tempo map is a closed-form model (instant
 * changes and linear ramps, the ramp cut on a 0.25-beat lattice), written here
 * independently of the Transport tempo map, so a law that holds proves the
 * mapping and not a shared helper.
 */

const SEED = 7348;
const CASE_COUNT = 500;
const TOL = 1e-9;
const RAMP_LATTICE_BEATS = 0.25;
const BEAT_EPSILON = 1e-6;

type ModelChange = { beat: number; tempo: number; linear: boolean };
type TempoModel = { baseTempo: number; changes: ModelChange[] };
type ModelSegment = { from: number; to: number; startTempo: number; endTempo: number };

function modelSegments(model: TempoModel): ModelSegment[] {
    const segments: ModelSegment[] = [];
    const first = model.changes[0];
    segments.push({
        from: 0,
        to: first ? first.beat : Infinity,
        startTempo: model.baseTempo,
        endTempo: model.baseTempo,
    });
    for (const [index, change] of model.changes.entries()) {
        const next = model.changes[index + 1];
        const ramps = change.linear && next !== undefined && next.beat > change.beat;
        segments.push({
            from: change.beat,
            to: next ? next.beat : Infinity,
            startTempo: change.tempo,
            endTempo: ramps ? next.tempo : change.tempo,
        });
    }
    return segments.filter((segment) => segment.to > segment.from);
}

function secondsFromZero(model: TempoModel, beat: number): number {
    let seconds = 0;
    for (const segment of modelSegments(model)) {
        if (segment.from >= beat) {
            break;
        }
        const end = Math.min(beat, segment.to);
        if (segment.startTempo === segment.endTempo) {
            seconds += (60 * (end - segment.from)) / segment.startTempo;
            continue;
        }
        const width = segment.to - segment.from;
        const tempoAtEnd =
            segment.startTempo + ((segment.endTempo - segment.startTempo) * (end - segment.from)) / width;
        seconds += ((60 * width) / (segment.endTempo - segment.startTempo)) * Math.log(tempoAtEnd / segment.startTempo);
    }
    return seconds;
}

function breakBeatsOf(model: TempoModel): number[] {
    const beats = new Set<number>();
    for (const [index, change] of model.changes.entries()) {
        beats.add(change.beat);
        const next = model.changes[index + 1];
        if (change.linear && next !== undefined) {
            for (let step = 1; change.beat + step * RAMP_LATTICE_BEATS < next.beat - BEAT_EPSILON; step++) {
                beats.add(change.beat + step * RAMP_LATTICE_BEATS);
            }
        }
    }
    return [...beats].toSorted((alpha, beta) => alpha - beta);
}

function buildTimeline(model: TempoModel, options: { withBreaks?: boolean } = {}): WarpTimeline {
    const segments = modelSegments(model);
    return {
        secondsBetween: (from, to) => secondsFromZero(model, to) - secondsFromZero(model, from),
        breakBeats: options.withBreaks === false ? [] : breakBeatsOf(model),
        constantTempoOver: (from, to) => {
            if (model.changes.some((change) => change.beat > from && change.beat < to)) {
                return null;
            }
            const governing = segments.findLast((segment) => segment.from <= from && from < segment.to);
            if (governing === undefined) {
                return null;
            }
            const ramped = segments.some(
                (segment) => segment.startTempo !== segment.endTempo && segment.from < to && segment.to > from
            );
            return ramped ? null : governing.startTempo;
        },
    };
}

const flat = (tempo: number): TempoModel => ({ baseTempo: tempo, changes: [] });
const step = (beat: number, tempo: number): ModelChange => ({ beat, tempo, linear: false });

function markersOf(pairs: readonly (readonly [number, number])[]): WarpMarkerLike[] {
    return pairs.map(([originalBeat, warpedBeat], index) => ({ id: `m${index}`, originalBeat, warpedBeat }));
}

function mapOf(pairs: readonly (readonly [number, number])[], originalTempo: number | null = 120): WarpMap {
    const map = resolveWarpMap({ enabled: true, markers: markersOf(pairs), originalTempo }, 120);
    if (map === null) {
        throw new Error('expected a warp map');
    }
    return map;
}

function project(input: {
    map: WarpMap;
    model: TempoModel;
    start: number;
    end: number;
    anchorBeat?: number;
    anchorSource?: number;
    duration?: number;
}): WarpPiece[] {
    return projectWarpedPieces({
        map: input.map,
        segment: {
            anchorBeat: input.anchorBeat ?? input.start,
            anchorSourceSeconds: input.anchorSource ?? 0,
            startBeat: input.start,
            endBeat: input.end,
        },
        sourceDurationSeconds: input.duration ?? 100,
        timeline: buildTimeline(input.model),
    });
}

type FixtureRow = {
    name: string;
    catches: string;
    pairs: [number, number][];
    model: TempoModel;
    start: number;
    end: number;
    anchorBeat?: number;
    anchorSource?: number;
    duration?: number;
    /** [startBeat, endBeat, sourceStart, sourceEnd, rate, rateClamped] */
    expected: [number, number, number, number, number, boolean][];
};

// T = R = 120 unless a row says otherwise: one beat is half a second.
const fixtures: FixtureRow[] = [
    {
        name: 'F1 unequal slopes',
        catches: 'averaging the slope (rate 1 everywhere)',
        pairs: [
            [0, 0],
            [4, 2],
            [8, 8],
        ],
        model: flat(120),
        start: 0,
        end: 8,
        expected: [
            [0, 2, 0, 2, 2, false],
            [2, 8, 2, 4, 2 / 3, false],
        ],
    },
    {
        name: 'F2 one moved marker',
        catches: 'rate 1 after the last marker instead of the extended slope',
        pairs: [
            [0, 0],
            [1, 1],
            [2, 2.5],
            [3, 3],
        ],
        model: flat(120),
        start: 0,
        end: 5,
        expected: [
            [0, 1, 0, 0.5, 1, false],
            [1, 2.5, 0.5, 1, 2 / 3, false],
            [2.5, 3, 1, 1.5, 2, false],
            [3, 5, 1.5, 3.5, 2, false],
        ],
    },
    {
        name: 'F3 marker before the clip start',
        catches: 'measuring from marker 0 or from the clip start',
        pairs: [
            [0, 0],
            [2, 3],
            [6, 6],
        ],
        model: flat(120),
        start: 10,
        end: 14,
        anchorSource: 2,
        expected: [
            [10, 11.5, 2, 3, 4 / 3, false],
            [11.5, 14, 3, 14 / 3, 4 / 3, false],
        ],
    },
    {
        name: 'F4 marker past the source end',
        catches: 'reading past the material',
        pairs: [
            [0, 0],
            [8, 4],
        ],
        model: flat(120),
        start: 0,
        end: 10,
        duration: 3,
        expected: [[0, 3, 0, 3, 2, false]],
    },
    {
        name: 'F5 negative entry',
        catches: 'the legacy two-beat silence',
        pairs: [
            [0, 0],
            [4, 2],
        ],
        model: flat(120),
        start: 0,
        end: 4,
        anchorSource: -1,
        expected: [
            [1, 3, 0, 2, 2, false],
            [3, 4, 2, 3, 2, false],
        ],
    },
    {
        name: 'F6a tempo change in a span',
        catches: 'one rate across a tempo step',
        pairs: [
            [0, 0],
            [8, 4],
        ],
        model: { baseTempo: 120, changes: [step(2, 60)] },
        start: 0,
        end: 4,
        expected: [
            [0, 2, 0, 2, 2, false],
            [2, 4, 2, 4, 1, false],
        ],
    },
    {
        name: 'F6b symmetric excursion',
        catches: 'midpoint bisection, which sees a flat chord',
        pairs: [
            [0, 0],
            [8, 4],
        ],
        model: { baseTempo: 120, changes: [step(1, 60), step(3, 120)] },
        start: 0,
        end: 4,
        expected: [
            [0, 1, 0, 1, 2, false],
            [1, 3, 1, 3, 1, false],
            [3, 4, 3, 4, 2, false],
        ],
    },
    {
        name: 'F9 two changes on one beat',
        catches: 'a missing or doubled cut at the shared beat',
        pairs: [
            [0, 0],
            [8, 4],
        ],
        model: { baseTempo: 120, changes: [step(2, 60), step(2, 90)] },
        start: 0,
        end: 4,
        expected: [
            [0, 2, 0, 2, 2, false],
            [2, 4, 2, 4, 1.5, false],
        ],
    },
    {
        name: 'F10 extreme squeeze',
        catches: 'a clamped rate that drifts the next piece off its knot',
        pairs: [
            [0, 0],
            [40, 0.01],
        ],
        model: flat(120),
        start: 0,
        end: 0.02,
        expected: [
            [0, 0.01, 0, 20, 100, true],
            [0.01, 0.02, 20, 40, 100, true],
        ],
    },
];

describe('fixtures', () => {
    it.each(fixtures)('$name', ({ pairs, model, start, end, anchorBeat, anchorSource, duration, expected }) => {
        const pieces = project({ map: mapOf(pairs), model, start, end, anchorBeat, anchorSource, duration });
        expect(pieces).toHaveLength(expected.length);
        for (const [index, row] of expected.entries()) {
            const [startBeat, endBeat, sourceStart, sourceEnd, rate, rateClamped] = row;
            const piece = pieces[index]!;
            expect(piece.startBeat).toBeCloseTo(startBeat, 9);
            expect(piece.endBeat).toBeCloseTo(endBeat, 9);
            expect(piece.sourceStartSeconds).toBeCloseTo(sourceStart, 9);
            expect(piece.sourceEndSeconds).toBeCloseTo(sourceEnd, 9);
            expect(piece.rate).toBeCloseTo(rate, 9);
            expect(piece.rateClamped).toBe(rateClamped);
        }
    });

    it('F3 reads the entry at W(entry) = 4.5 and lands the marker at beat 11.5', () => {
        const map = mapOf([
            [0, 0],
            [2, 3],
            [6, 6],
        ]);
        expect(warpedBeatAtSource(map, 2)).toBeCloseTo(4.5, 12);
        expect(timelineBeatAtSource(map, 10, 2, 3)).toBeCloseTo(11.5, 12);
    });

    it('F7 starts every loop pass on the loop entry exactly', () => {
        const map = mapOf([
            [0, 0],
            [2, 3],
        ]);
        const clip = { startBeat: 0, loopEnabled: true, audioOffsetSeconds: 0.25 };
        for (let iteration = 0; iteration < 4; iteration++) {
            const [segment] = projectAudioLoopPassAnchoredSegments({
                clip,
                loopLengthBeats: 2,
                iterationStartBeat: iteration * 2,
                iterationEndBeat: iteration * 2 + 2,
                stretchRatio: 1,
                tempoAtClipStart: 120,
                secondsAtBeat: (beat) => beat / 2,
            });
            const pieces = projectWarpedPieces({
                map,
                segment: { ...segment!, startBeat: iteration * 2, endBeat: iteration * 2 + 2 },
                sourceDurationSeconds: 10,
                timeline: buildTimeline(flat(120)),
            });
            expect(pieces[0]!.sourceStartSeconds).toBe(0.25);
        }
    });

    it('F8 an iteration that starts partway into a part ignores the tempo map', () => {
        const map = mapOf([
            [0, 0],
            [8, 6],
        ]);
        const clip = { startBeat: 0, loopEnabled: true, audioOffsetSeconds: 0 };
        const models = [
            { baseTempo: 120, changes: [step(2, 60)] },
            { baseTempo: 120, changes: [{ beat: 0.5, tempo: 120, linear: true }, step(3, 90)] },
        ];
        const outcomes = models.map((model) => {
            const [segment] = projectAudioLoopPassAnchoredSegments({
                clip,
                loopLengthBeats: 4,
                iterationStartBeat: 1,
                iterationEndBeat: 4,
                stretchRatio: 1,
                tempoAtClipStart: 120,
                secondsAtBeat: (beat) => secondsFromZero(model, beat),
            });
            const anchored = { ...segment!, startBeat: 1, endBeat: 4 };
            return {
                legacySource: segment!.sourceStartSeconds,
                pieces: projectWarpedPieces({
                    map,
                    segment: anchored,
                    sourceDurationSeconds: 50,
                    timeline: buildTimeline(model, { withBreaks: false }),
                }),
            };
        });
        expect(outcomes[0]!.legacySource).not.toBeCloseTo(outcomes[1]!.legacySource, 3);
        const shape = (pieces: WarpPiece[]) =>
            pieces.map(({ startBeat, endBeat, sourceStartSeconds, sourceEndSeconds }) => [
                startBeat,
                endBeat,
                sourceStartSeconds,
                sourceEndSeconds,
            ]);
        expect(shape(outcomes[0]!.pieces)).toEqual(shape(outcomes[1]!.pieces));
        expect(outcomes[0]!.pieces[0]!.sourceStartSeconds).toBeCloseTo(sourceAtTimelineBeat(map, 0, 0, 1), 12);
    });
});

describe('resolveWarpMap', () => {
    const unmoved = markersOf([
        [0, 0],
        [1, 1],
    ]);

    it.each([
        ['absent', undefined, 120],
        ['disabled', { enabled: false, markers: unmoved, originalTempo: 120 }, 120],
        ['marker-less', { enabled: true, markers: [], originalTempo: 120 }, 120],
        ['all markers unusable', { enabled: true, markers: markersOf([[Number.NaN, 1]]), originalTempo: 120 }, 120],
        ['zero reference tempo', { enabled: true, markers: unmoved, originalTempo: 0 }, 120],
        ['negative reference tempo', { enabled: true, markers: unmoved, originalTempo: -90 }, 120],
        ['infinite reference tempo', { enabled: true, markers: unmoved, originalTempo: Infinity }, 120],
        ['null tempo and a zero base tempo', { enabled: true, markers: unmoved, originalTempo: null }, 0],
    ])('is null when warp is %s', (_name, warp, base) => {
        expect(resolveWarpMap(warp, base)).toBeNull();
    });

    it('falls back to the base tempo when no reference tempo is stamped', () => {
        const map = resolveWarpMap({ enabled: true, markers: markersOf([[4, 4]]), originalTempo: null }, 60);
        expect(map?.referenceTempo).toBe(60);
        expect(map?.knotSourceSeconds[0]).toBe(4);
    });

    it('keeps the markers it was given and the same map for the same array', () => {
        const warp = { enabled: true, markers: unmoved, originalTempo: 120 };
        expect(resolveWarpMap(warp, 120)).toBe(resolveWarpMap({ ...warp, enabled: true }, 120));
        expect(resolveWarpMap({ ...warp, originalTempo: 90 }, 120)?.referenceTempo).toBe(90);
    });

    it('resolves markers that tie on the original beat by warped beat, whatever the input order', () => {
        const alpha = { id: 'a', originalBeat: 2, warpedBeat: 3 };
        const beta = { id: 'b', originalBeat: 2, warpedBeat: 2.5 };
        const gamma = { id: 'c', originalBeat: 5, warpedBeat: 6 };
        const forward = resolveWarpMap({ enabled: true, markers: [alpha, beta, gamma], originalTempo: 120 }, 120)!;
        const reversed = resolveWarpMap({ enabled: true, markers: [gamma, beta, alpha], originalTempo: 120 }, 120)!;
        expect(Array.from(forward.knotBeats)).toEqual([2.5, 6]);
        expect(Array.from(reversed.knotBeats)).toEqual([2.5, 6]);
    });

    it('merges the knot between two collinear spans and keeps the one that bends', () => {
        const straight = mapOf([
            [0, 0],
            [1, 2],
            [2, 4],
            [3, 6],
        ]);
        expect(straight.knotBeats.length).toBe(2);
        const bent = mapOf([
            [0, 0],
            [1, 2],
            [2, 5],
            [3, 6],
        ]);
        expect(bent.knotBeats.length).toBe(4);
    });

    it('extends the neighbouring slope outward, and one marker plays one beat per source beat', () => {
        const map = mapOf([
            [0, 0],
            [2, 1],
            [3, 5],
        ]);
        // 120 BPM reference: source 0, 1, 1.5 s; segments run at 1 and 8 beats per second.
        expect(Array.from(map.slopes)).toEqual([1, 1, 8, 8]);
        expect(Array.from(mapOf([[4, 10]]).slopes)).toEqual([2, 2]);
    });
});

describe('mapping functions', () => {
    const map = mapOf([
        [0, 0],
        [2, 1],
        [3, 5],
    ]);

    it('invert each other at knots, between them and past both ends', () => {
        for (const seconds of [-1, 0, 0.4, 1, 1.25, 1.5, 3]) {
            expect(sourceAtWarpedBeat(map, warpedBeatAtSource(map, seconds))).toBeCloseTo(seconds, 12);
        }
        expect(warpedBeatAtSource(map, 1)).toBe(1);
        expect(sourceAtWarpedBeat(map, 5)).toBe(1.5);
    });

    it('reads a part from its own entry', () => {
        expect(sourceAtTimelineBeat(map, 10, 1, 10)).toBe(1);
        expect(sourceAtTimelineBeat(map, 10, 1, 14)).toBeCloseTo(1.5, 12);
        expect(timelineBeatAtSource(map, 10, 1, 1.5)).toBeCloseTo(14, 12);
    });
});

describe('resolvePlaybackWarpMap identity fast path', () => {
    const base = {
        projectBaseTempo: 120,
        clipStartBeat: 0,
        clipEndBeat: 8,
        effectiveLegacyRatio: 1,
        timeline: buildTimeline(flat(120)),
    };
    const unmoved = {
        enabled: true,
        markers: markersOf([
            [0, 0],
            [3, 3],
        ]),
        originalTempo: 120,
    };
    const moved = {
        ...unmoved,
        markers: markersOf([
            [0, 0],
            [3, 3.5],
        ]),
    };

    it.each([
        ['G1 warp absent', { warp: undefined }],
        ['G1 warp disabled', { warp: { ...unmoved, enabled: false } }],
        ['G2 no marker survives', { warp: { ...unmoved, markers: [] } }],
        ['G3 invalid reference tempo', { warp: { ...unmoved, originalTempo: -1 } }],
        ['G4 unmoved markers on a flat map at R, ratio 1', { warp: unmoved }],
        ['G4 with the reference tempo taken from the base tempo', { warp: { ...unmoved, originalTempo: null } }],
    ])('returns null, so the caller runs legacy untouched: %s', (_name, override) => {
        expect(resolvePlaybackWarpMap({ ...base, ...override })).toBeNull();
    });

    it.each([
        ['a moved marker', { warp: moved }],
        ['an effective ratio other than 1', { warp: unmoved, effectiveLegacyRatio: 1.5 }],
        ['a reference tempo other than the clip tempo', { warp: { ...unmoved, originalTempo: 90 } }],
        [
            'a tempo change inside the clip',
            { warp: unmoved, timeline: buildTimeline({ baseTempo: 120, changes: [step(4, 90)] }) },
        ],
        [
            'a tempo ramp inside the clip',
            {
                warp: unmoved,
                timeline: buildTimeline({
                    baseTempo: 120,
                    changes: [{ beat: 1, tempo: 120, linear: true }, step(5, 140)],
                }),
            },
        ],
    ])('returns the map for %s', (_name, override) => {
        const map = resolvePlaybackWarpMap({ ...base, ...override });
        expect(map).not.toBeNull();
    });
});

type Corruption = 'none' | 'duplicate' | 'crossing' | 'near-tie' | 'non-finite' | 'original-tie';
type MarkerClass = 'valid' | 'identity' | 'squeeze' | 'corrupt';

type CaseInput = {
    index: number;
    markerClass: MarkerClass;
    corruption: Corruption;
    markers: WarpMarkerLike[];
    cleanMarkers: WarpMarkerLike[];
    shuffled: WarpMarkerLike[];
    originalTempo: number | null;
    referenceTempo: number;
    baseTempo: number;
    model: TempoModel;
    otherModel: TempoModel;
    ratio: number;
    clip: {
        startBeat: number;
        endBeat: number;
        loopLength: number;
        loopEnabled: boolean;
        audioOffsetSeconds: number;
        audioLoopStartSeconds: number;
        audioLoopPassEntrySeconds: number;
        audioLoopPassOriginBeat: number;
        loopOriginBeat: number;
    };
    duration: number;
};

function markerClassAt(roll: number): MarkerClass {
    if (roll < 0.4) {
        return 'valid';
    }
    if (roll < 0.5) {
        return 'identity';
    }
    return roll < 0.6 ? 'squeeze' : 'corrupt';
}

function generateCases(): CaseInput[] {
    const random = createSeededRandom(SEED);
    const uniform = (low: number, high: number): number => low + random() * (high - low);
    const integer = (low: number, high: number): number => Math.floor(uniform(low, high + 1));
    const pick = <Item>(items: readonly Item[]): Item => items[integer(0, items.length - 1)]!;

    const drawTempo = (): number => (random() < 0.5 ? pick([60, 87.5, 120, 174]) : uniform(40, 240));

    const modelFor = (baseTempo: number, force: 'flat' | 'any'): TempoModel => {
        if (force === 'flat') {
            return flat(baseTempo);
        }
        const count = integer(0, 4);
        const beats = Array.from({ length: count }, () => uniform(0, 40)).toSorted((alpha, beta) => alpha - beta);
        const changes = beats.map((beat): ModelChange => ({ beat, tempo: uniform(30, 300), linear: random() < 0.4 }));
        if (changes.length > 1 && random() < 0.3) {
            changes[1] = { ...changes[1]!, beat: changes[0]!.beat };
        }
        return { baseTempo, changes };
    };

    const cases: CaseInput[] = [];
    for (let index = 0; index < CASE_COUNT; index++) {
        const roll = random();
        const markerClass = markerClassAt(roll);
        const originalTempo = random() < 0.25 ? null : drawTempo();
        const baseTempo = random() < 0.3 ? pick([60, 87.5, 120, 174]) : uniform(40, 240);
        const referenceTempo = originalTempo ?? baseTempo;

        let pairs: [number, number][];
        if (markerClass === 'squeeze') {
            pairs = [
                [0, 0],
                [40, 0.01],
            ];
        } else {
            const count = integer(1, 12);
            let original = uniform(-4, 0);
            let warped = original;
            pairs = [];
            for (let marker = 0; marker < count; marker++) {
                const jitter = markerClass === 'identity' ? 0 : uniform(-2, 2);
                warped = Math.max(original + jitter, marker === 0 ? original + jitter : warped + 0.05);
                pairs.push([original, markerClass === 'identity' ? original : warped]);
                original += uniform(0.05, 6);
            }
        }
        const cleanMarkers = markersOf(pairs);
        let markers = [...cleanMarkers];
        let corruption: Corruption = 'none';
        if (markerClass === 'corrupt') {
            corruption = pick(['duplicate', 'crossing', 'near-tie', 'non-finite', 'original-tie'] as const);
            const source = markers[integer(0, markers.length - 1)]!;
            if (corruption === 'duplicate') {
                markers.push({ ...source, id: 'dup' });
            } else if (corruption === 'crossing' && markers.length > 1) {
                const [first, second] = [markers[0]!, markers[markers.length - 1]!];
                markers = markers.map((marker) => {
                    if (marker === first) {
                        return { ...marker, warpedBeat: second.warpedBeat };
                    }
                    return marker === second ? { ...marker, warpedBeat: first.warpedBeat } : marker;
                });
            } else if (corruption === 'near-tie') {
                markers.push({
                    id: 'near',
                    originalBeat: source.originalBeat + 1e-10,
                    warpedBeat: source.warpedBeat + 0.4,
                });
            } else if (corruption === 'non-finite') {
                markers.push({ id: 'bad', originalBeat: pick([Number.NaN, Infinity, -Infinity]), warpedBeat: 1 });
            } else {
                markers.push({ id: 'tie', originalBeat: source.originalBeat, warpedBeat: source.warpedBeat + 0.3 });
            }
        }
        const shuffled = markers.toSorted(() => random() - 0.5);

        const startBeat = uniform(0, 32);
        const length = uniform(0.2, 32);
        const loopEnabled = random() < 0.5;
        const loopLength = uniform(0.5, 8);
        const offset = uniform(-2, 10);
        const passOrigin = random() < 0.5 ? startBeat : startBeat - uniform(0, loopLength);
        const flatMap = random() < 0.3;
        cases.push({
            index,
            markerClass,
            corruption,
            markers,
            cleanMarkers,
            shuffled,
            originalTempo,
            referenceTempo,
            baseTempo,
            model: modelFor(flatMap ? referenceTempo : baseTempo, flatMap ? 'flat' : 'any'),
            otherModel: modelFor(uniform(40, 240), 'any'),
            ratio: random() < 0.8 ? 1 : 1.5,
            clip: {
                startBeat,
                endBeat: startBeat + length,
                loopLength,
                loopEnabled,
                audioOffsetSeconds: offset,
                audioLoopStartSeconds: uniform(-1, 4),
                audioLoopPassEntrySeconds: uniform(-1, 4),
                audioLoopPassOriginBeat: passOrigin,
                loopOriginBeat: passOrigin - uniform(0, loopLength),
            },
            duration: uniform(0.5, 30),
        });
    }
    return cases;
}

type PassSegment = AudioLoopPassAnchoredSegment & { startBeat: number; endBeat: number };

function sourceFieldsOf(clip: CaseInput['clip']) {
    if (clip.loopEnabled) {
        return clip;
    }
    return { startBeat: clip.startBeat, loopEnabled: false, audioOffsetSeconds: clip.audioOffsetSeconds };
}

function passSegmentsOf(input: CaseInput, secondsAtBeat: (beat: number) => number): PassSegment[][] {
    const { clip } = input;
    const loopLength = clip.loopEnabled ? clip.loopLength : clip.endBeat - clip.startBeat;
    const iterations: PassSegment[][] = [];
    for (let index = 0; index < 12; index++) {
        const iterationStart = clip.startBeat + index * loopLength;
        if (iterationStart >= clip.endBeat) {
            break;
        }
        const iterationEnd = Math.min(iterationStart + loopLength, clip.endBeat);
        const segments = projectAudioLoopPassAnchoredSegments({
            clip: sourceFieldsOf(clip),
            loopLengthBeats: loopLength,
            iterationStartBeat: iterationStart,
            iterationEndBeat: iterationEnd,
            stretchRatio: 1,
            tempoAtClipStart: input.baseTempo,
            secondsAtBeat,
        });
        iterations.push(
            segments.map((segment) => ({
                ...segment,
                startBeat: iterationStart + segment.startOffsetBeats,
                endBeat: iterationStart + segment.endOffsetBeats,
            }))
        );
    }
    return iterations;
}

const coverage = {
    cases: 0,
    crossingDropped: 0,
    rampInsidePiece: 0,
    clampedRate: 0,
    preRollCut: 0,
    endCut: 0,
    midPartIteration: 0,
    knotsChecked: 0,
    fastPathNull: 0,
    warpedPath: 0,
    controlCases: 0,
    invarianceCases: 0,
};

function assertNormalisation(input: CaseInput, map: WarpMap | null): void {
    const warp = { enabled: true, originalTempo: input.originalTempo };
    const permuted = resolveWarpMap({ ...warp, markers: input.shuffled }, input.baseTempo);
    expect(permuted === null).toBe(map === null);
    if (map === null || permuted === null) {
        return;
    }
    for (const field of ['knotSourceSeconds', 'knotBeats', 'slopes'] as const) {
        expect(Array.from(permuted[field], (value) => (Object.is(value, 0) ? 0 : value))).toEqual(
            Array.from(map[field], (value) => (Object.is(value, 0) ? 0 : value))
        );
    }
    expect(map.referenceTempo).toBe(input.referenceTempo);
    for (let knot = 1; knot < map.knotBeats.length; knot++) {
        expect(map.knotBeats[knot]! - map.knotBeats[knot - 1]!).toBeGreaterThan(TOL);
        expect(map.knotSourceSeconds[knot]!).toBeGreaterThan(map.knotSourceSeconds[knot - 1]!);
    }
    const rebuilt = resolveWarpMap(
        {
            ...warp,
            originalTempo: input.referenceTempo,
            markers: Array.from(map.knotBeats, (warpedBeat, knot) => ({
                originalBeat: (map.knotSourceSeconds[knot]! * input.referenceTempo) / 60,
                warpedBeat,
            })),
        },
        input.baseTempo
    )!;
    expect(rebuilt.knotBeats.length).toBe(map.knotBeats.length);
    for (const [knot, beat] of map.knotBeats.entries()) {
        expect(rebuilt.knotBeats[knot]!).toBeCloseTo(beat, 12);
        expect(rebuilt.knotSourceSeconds[knot]!).toBeCloseTo(map.knotSourceSeconds[knot]!, 9);
    }
    const isValid = input.markerClass === 'valid';
    expect(map.knotBeats.length).toBe(isValid ? input.markers.length : map.knotBeats.length);
    if (input.corruption === 'crossing' && map.knotBeats.length < input.markers.length) {
        coverage.crossingDropped++;
    }
    for (const marker of isValid ? input.cleanMarkers : []) {
        const seconds = (marker.originalBeat * 60) / input.referenceTempo;
        const beat = timelineBeatAtSource(map, 0, 0, seconds);
        expect(sourceAtTimelineBeat(map, 0, 0, beat)).toBeCloseTo(seconds, 9);
        expect(warpedBeatAtSource(map, seconds)).toBeCloseTo(marker.warpedBeat, 9);
    }
}

/** How far an unclamped piece's rate lands from its declared source end; a clamped piece owes nothing. */
function unclampedResidual(piece: WarpPiece, seconds: number): number {
    if (piece.rateClamped) {
        return 0;
    }
    return Math.abs(piece.sourceStartSeconds + piece.rate * seconds - piece.sourceEndSeconds);
}

function assertPieceLaws(input: {
    map: WarpMap;
    timeline: WarpTimeline;
    segment: PassSegment;
    duration: number;
    pieces: WarpPiece[];
}): void {
    const { map, timeline, segment, duration, pieces } = input;
    const sa = segment.anchorSourceSeconds;
    for (const [index, piece] of pieces.entries()) {
        expect(piece.startBeat).toBeLessThan(piece.endBeat);
        expect(piece.sourceStartSeconds).toBeGreaterThanOrEqual(0);
        expect(piece.sourceEndSeconds).toBeLessThanOrEqual(duration);
        expect(piece.sourceStartSeconds).toBeLessThanOrEqual(piece.sourceEndSeconds);
        for (const next of pieces.slice(index + 1, index + 2)) {
            expect(next.startBeat).toBe(piece.endBeat);
            expect(next.sourceStartSeconds).toBe(piece.sourceEndSeconds);
        }
        const seconds = timeline.secondsBetween(piece.startBeat, piece.endBeat);
        const raw = (piece.sourceEndSeconds - piece.sourceStartSeconds) / seconds;
        expect(piece.rate).toBe(boundStretchRatio(raw));
        expect(piece.rateClamped).toBe(boundStretchRatio(raw) !== raw);
        if (piece.rateClamped) {
            coverage.clampedRate++;
        }
        expect(unclampedResidual(piece, seconds)).toBeLessThan(1e-12 * (1 + duration));
        for (const breakBeat of timeline.breakBeats) {
            expect(breakBeat > piece.startBeat + TOL && breakBeat < piece.endBeat - TOL).toBe(false);
        }
        if (timeline.constantTempoOver(piece.startBeat, piece.endBeat) === null) {
            coverage.rampInsidePiece++;
        }
    }

    if (segment.startBeat > segment.anchorBeat) {
        coverage.midPartIteration++;
    }
    const anchoredFirst = pieces
        .slice(0, 1)
        .filter(
            (piece) =>
                piece.startBeat === segment.startBeat &&
                segment.startBeat === segment.anchorBeat &&
                sa >= 0 &&
                sa <= duration
        );
    for (const piece of anchoredFirst) {
        expect(piece.sourceStartSeconds).toBe(sa);
    }
    const preRolled = pieces.slice(0, 1).filter((piece) => sa < 0 && piece.startBeat > segment.startBeat);
    for (const piece of preRolled) {
        expect(piece.sourceStartSeconds).toBe(0);
        expect(piece.startBeat).toBeCloseTo(timelineBeatAtSource(map, segment.anchorBeat, sa, 0), 9);
        coverage.preRollCut++;
    }
    const endCut = pieces.slice(-1).filter((piece) => piece.endBeat < segment.endBeat - 1e-6);
    for (const piece of endCut) {
        expect(piece.sourceEndSeconds).toBe(duration);
        coverage.endCut++;
    }

    const anchorWarped = warpedBeatAtSource(map, sa);
    const interiorKnots = Array.from(map.knotBeats.entries(), ([knot, warped]) => ({
        beat: segment.anchorBeat + warped - anchorWarped,
        seconds: map.knotSourceSeconds[knot]!,
    })).filter(
        ({ beat, seconds }) =>
            beat > segment.startBeat + 1e-6 && beat < segment.endBeat - 1e-6 && seconds > 0 && seconds < duration
    );
    for (const { beat, seconds } of interiorKnots) {
        const ending = pieces.findIndex((piece) => piece.endBeat === beat);
        expect(ending).toBeGreaterThanOrEqual(0);
        expect(pieces[ending]!.sourceEndSeconds).toBe(seconds);
        expect(pieces[ending + 1]?.startBeat).toBe(beat);
        expect(pieces[ending + 1]?.sourceStartSeconds).toBe(seconds);
        expect(sourceAtTimelineBeat(map, segment.anchorBeat, sa, beat)).toBeCloseTo(seconds, 9);
        coverage.knotsChecked++;
    }

    let previous = -Infinity;
    for (let sample = 0; sample < 64; sample++) {
        const beat = segment.startBeat + ((segment.endBeat - segment.startBeat) * sample) / 63;
        const source = sourceAtTimelineBeat(map, segment.anchorBeat, sa, beat);
        expect(source).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = source;
    }
}

describe('seeded property laws', () => {
    const cases = generateCases();

    it.each(cases)('case $index ($markerClass, $corruption)', (input) => {
        coverage.cases++;
        const map = resolveWarpMap(
            { enabled: true, markers: input.markers, originalTempo: input.originalTempo },
            input.baseTempo
        );
        assertNormalisation(input, map);
        if (map === null) {
            return;
        }
        const timeline = buildTimeline(input.model);
        const secondsAtBeat = (beat: number): number => secondsFromZero(input.model, beat);
        const resolved = resolvePlaybackWarpMap({
            warp: { enabled: true, markers: input.markers, originalTempo: input.originalTempo },
            projectBaseTempo: input.baseTempo,
            clipStartBeat: input.clip.startBeat,
            clipEndBeat: input.clip.endBeat,
            effectiveLegacyRatio: input.ratio,
            timeline,
        });
        const identical =
            map.isIdentity &&
            input.ratio === 1 &&
            timeline.constantTempoOver(input.clip.startBeat, input.clip.endBeat) === map.referenceTempo;
        expect(resolved).toBe(identical ? null : map);
        if (identical) {
            coverage.fastPathNull++;
        } else {
            coverage.warpedPath++;
        }

        const iterations = passSegmentsOf(input, secondsAtBeat);
        const permutedMap = resolveWarpMap(
            { enabled: true, markers: input.shuffled, originalTempo: input.originalTempo },
            input.baseTempo
        )!;
        for (const segments of iterations) {
            for (const segment of segments) {
                const pieces = projectWarpedPieces({ map, segment, sourceDurationSeconds: input.duration, timeline });
                assertPieceLaws({ map, timeline, segment, duration: input.duration, pieces });
                expect(
                    projectWarpedPieces({ map: permutedMap, segment, sourceDurationSeconds: input.duration, timeline })
                ).toEqual(pieces);

                // Tempo-map invariance: without tempo-break cuts only the rates differ.
                const alone = buildTimeline(input.model, { withBreaks: false });
                const other = buildTimeline(input.otherModel, { withBreaks: false });
                const geometry = (pieceList: WarpPiece[]) =>
                    pieceList.map((piece) => [
                        piece.startBeat,
                        piece.endBeat,
                        piece.sourceStartSeconds,
                        piece.sourceEndSeconds,
                    ]);
                const onOwn = projectWarpedPieces({
                    map,
                    segment,
                    sourceDurationSeconds: input.duration,
                    timeline: alone,
                });
                const onOther = projectWarpedPieces({
                    map,
                    segment,
                    sourceDurationSeconds: input.duration,
                    timeline: other,
                });
                expect(geometry(onOther)).toEqual(geometry(onOwn));
                coverage.invarianceCases++;
            }
        }
    });

    // Control: one marker shifted by 1e-12 leaves the identity fast path, and the general path
    // still reproduces the seconds law, so the fast path is not hiding a broken general path.
    const controlCases = cases.filter(
        (input) =>
            input.markerClass === 'identity' &&
            input.model.changes.length === 0 &&
            input.model.baseTempo === input.referenceTempo
    );

    it.each(controlCases)('control case $index: a 1e-12 shift matches the seconds law', (input) => {
        coverage.controlCases++;
        const timeline = buildTimeline(input.model);
        const secondsAtBeat = (beat: number): number => secondsFromZero(input.model, beat);
        const shifted = input.cleanMarkers.map((marker, index) => ({
            ...marker,
            warpedBeat: marker.warpedBeat + (index === 0 ? 1e-12 : 0),
        }));
        const control = resolvePlaybackWarpMap({
            warp: { enabled: true, markers: shifted, originalTempo: input.originalTempo },
            projectBaseTempo: input.baseTempo,
            clipStartBeat: input.clip.startBeat,
            clipEndBeat: input.clip.endBeat,
            effectiveLegacyRatio: 1,
            timeline,
        });
        expect(control).not.toBeNull();
        for (const segment of passSegmentsOf(input, secondsAtBeat).flat()) {
            const pieces = projectWarpedPieces({
                map: control!,
                segment,
                sourceDurationSeconds: input.duration,
                timeline,
            });
            for (const piece of pieces) {
                const legacy = (beat: number): number =>
                    segment.sourceStartSeconds + secondsAtBeat(beat) - secondsAtBeat(segment.startBeat);
                expect(Math.abs(piece.sourceStartSeconds - legacy(piece.startBeat))).toBeLessThan(1e-9);
                expect(Math.abs(piece.sourceEndSeconds - legacy(piece.endBeat))).toBeLessThan(1e-9);
            }
        }
    });

    it('reached every kind of input the laws are about', () => {
        expect(coverage.cases).toBe(CASE_COUNT);
        expect(coverage.crossingDropped).toBeGreaterThan(10);
        expect(coverage.rampInsidePiece).toBeGreaterThan(10);
        expect(coverage.clampedRate).toBeGreaterThan(10);
        expect(coverage.preRollCut).toBeGreaterThan(10);
        expect(coverage.endCut).toBeGreaterThan(10);
        expect(coverage.midPartIteration).toBeGreaterThan(10);
        expect(coverage.knotsChecked).toBeGreaterThan(100);
        expect(coverage.fastPathNull).toBeGreaterThan(5);
        expect(coverage.warpedPath).toBeGreaterThan(100);
        expect(coverage.controlCases).toBeGreaterThan(5);
        expect(coverage.invarianceCases).toBeGreaterThan(100);
    });
});
