import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from './clipLoopOrigin';
import { boundStretchRatio } from './stretchRatioBound';

/**
 * The one mapping from timeline beats to source seconds for a warped clip.
 *
 * A marker pins a source position (`originalBeat`, source beats at the
 * reference tempo R) to a warped beat (`warpedBeat`, file-relative: 0 is
 * source sample 0, as Detect writes and the editor draws). Between two
 * consecutive markers the source is stretched linearly in beats, so a warped
 * clip is beat-locked and follows the tempo map.
 *
 * Law:
 *  - R is `originalTempo`, falling back to the project base tempo. An invalid R
 *    leaves the clip on its legacy path.
 *  - Before the first marker the first segment's slope continues, after the
 *    last marker the last segment's slope continues. One marker plays one
 *    warped beat per source beat at R.
 *  - A part that enters the source at `sa` on `Ba` hears source
 *    `W⁻¹(W(sa) + (b − Ba))` at beat b. Only differences of warped beats reach
 *    the timeline, so the clip's head offset positions the content.
 *  - `Clip.stretchRatio` is ignored while warp is active, and any persisted
 *    stretch mode is realised as repitch: the only executor is varispeed, so
 *    each piece plays at one constant rate and pitch follows it.
 *
 * Pure. Lookups are binary searches over typed arrays and allocate nothing;
 * `projectWarpedPieces` allocates one bounded array per pass segment.
 */

export type WarpMarkerLike = Readonly<{ id?: string; originalBeat: number; warpedBeat: number }>;

export type WarpStateLike = Readonly<{
    enabled: boolean;
    markers: readonly WarpMarkerLike[];
    originalTempo: number | null;
}>;

export type WarpMap = Readonly<{
    referenceTempo: number;
    /** `originalBeat · 60 / R`, strictly increasing. */
    knotSourceSeconds: Float64Array;
    /** `warpedBeat`, strictly increasing. */
    knotBeats: Float64Array;
    /** Warped beats per source second: `[left, segment 0 … segment n−2, right]`. */
    slopes: Float64Array;
    /** Every normalised marker has `warpedBeat === originalBeat`. */
    isIdentity: boolean;
}>;

/** Supplied by the owner of the tempo map. */
export type WarpTimeline = Readonly<{
    /** The calling route's own placement law for the seconds between two beats. */
    secondsBetween: (fromBeat: number, toBeat: number) => number;
    /** Ascending: every tempo-change beat, plus the ramp lattice. */
    breakBeats: readonly number[];
    /** The one tempo governing the span, or null when a change or ramp touches it. */
    constantTempoOver: (fromBeat: number, toBeat: number) => number | null;
}>;

export type WarpPassSegment = Readonly<{
    anchorBeat: number;
    anchorSourceSeconds: number;
    startBeat: number;
    endBeat: number;
}>;

export type WarpPiece = Readonly<{
    startBeat: number;
    endBeat: number;
    sourceStartSeconds: number;
    sourceEndSeconds: number;
    /** `boundStretchRatio(Δsource / secondsBetween(start, end))`. */
    rate: number;
    /** The raw rate fell outside the shared bound; the piece reads `min(Δsource, rate·Δt)`. */
    rateClamped: boolean;
}>;

const TOLERANCE = CLIP_LOOP_WINDOW_BEAT_TOLERANCE;
/** Adjacent slopes this close, relative, are one straight line: the knot between them carries nothing. */
const COLLINEAR_RELATIVE_TOLERANCE = 1e-12;

/** An element read at an index the caller has bounded; NaN marks the impossible miss. */
function at(values: ArrayLike<number>, index: number): number {
    return values[index] ?? Number.NaN;
}

const mapCache = new WeakMap<readonly WarpMarkerLike[], { tempo: number; map: WarpMap | null }>();

function compareMarkers(alpha: WarpMarkerLike, beta: WarpMarkerLike): number {
    if (alpha.originalBeat !== beta.originalBeat) {
        return alpha.originalBeat - beta.originalBeat;
    }
    if (alpha.warpedBeat !== beta.warpedBeat) {
        return alpha.warpedBeat - beta.warpedBeat;
    }
    const alphaId = alpha.id ?? '';
    const betaId = beta.id ?? '';
    if (alphaId === betaId) {
        return 0;
    }
    return alphaId < betaId ? -1 : 1;
}

/** Finite markers in order, each advancing both axes past the last kept one by more than the tolerance. */
function normaliseMarkers(markers: readonly WarpMarkerLike[]): WarpMarkerLike[] {
    const sorted = markers
        .filter((marker) => Number.isFinite(marker.originalBeat) && Number.isFinite(marker.warpedBeat))
        .toSorted(compareMarkers);
    const kept: WarpMarkerLike[] = [];
    for (const marker of sorted) {
        const last = kept[kept.length - 1];
        if (
            last === undefined ||
            (marker.originalBeat - last.originalBeat > TOLERANCE && marker.warpedBeat - last.warpedBeat > TOLERANCE)
        ) {
            kept.push(marker);
        }
    }
    return kept;
}

function buildMap(markers: readonly WarpMarkerLike[], tempo: number): WarpMap | null {
    const survivors = normaliseMarkers(markers);
    if (survivors.length === 0) {
        return null;
    }
    const secondsPerBeat = 60 / tempo;
    const sourceSeconds = survivors.map((marker) => marker.originalBeat * secondsPerBeat);
    const beats = survivors.map((marker) => marker.warpedBeat);
    const isIdentity = survivors.every((marker) => marker.warpedBeat === marker.originalBeat);
    const rawSlope = (index: number): number =>
        (at(beats, index + 1) - at(beats, index)) / (at(sourceSeconds, index + 1) - at(sourceSeconds, index));

    const kept = [0];
    for (let index = 1; index < survivors.length - 1; index++) {
        const before = rawSlope(index - 1);
        if (Math.abs(before - rawSlope(index)) > COLLINEAR_RELATIVE_TOLERANCE * Math.abs(rawSlope(index))) {
            kept.push(index);
        }
    }
    if (survivors.length > 1) {
        kept.push(survivors.length - 1);
    }

    const knotSourceSeconds = Float64Array.from(kept, (index) => at(sourceSeconds, index));
    const knotBeats = Float64Array.from(kept, (index) => at(beats, index));
    const slopes = new Float64Array(kept.length + 1);
    if (kept.length === 1) {
        slopes.fill(tempo / 60);
    } else {
        for (let segment = 0; segment + 1 < kept.length; segment++) {
            slopes[segment + 1] =
                (at(knotBeats, segment + 1) - at(knotBeats, segment)) /
                (at(knotSourceSeconds, segment + 1) - at(knotSourceSeconds, segment));
        }
        slopes[0] = at(slopes, 1);
        slopes[kept.length] = at(slopes, kept.length - 1);
    }
    return { referenceTempo: tempo, knotSourceSeconds, knotBeats, slopes, isIdentity };
}

/** The warp map a state describes, or null: disabled, absent, no usable marker, or an invalid R. */
export function resolveWarpMap(warp: WarpStateLike | undefined, projectBaseTempo: number): WarpMap | null {
    if (!warp?.enabled) {
        return null;
    }
    const tempo = warp.originalTempo ?? projectBaseTempo;
    if (!Number.isFinite(tempo) || tempo <= 0) {
        return null;
    }
    const cached = mapCache.get(warp.markers);
    if (cached?.tempo === tempo) {
        return cached.map;
    }
    const map = buildMap(warp.markers, tempo);
    mapCache.set(warp.markers, { tempo, map });
    return map;
}

/**
 * The map a route warps a clip with, or null when it must run its legacy code
 * untouched: no map (disabled, no marker, invalid R), or the identity fast
 * path, where the warped mapping equals legacy mathematically (every marker
 * unmoved, the tempo governing the clip equal to R, an effective ratio of 1).
 * The caller passes no warp state for a part that reads another buffer.
 */
export function resolvePlaybackWarpMap(input: {
    warp: WarpStateLike | undefined;
    projectBaseTempo: number;
    clipStartBeat: number;
    clipEndBeat: number;
    effectiveLegacyRatio: number;
    timeline: WarpTimeline;
}): WarpMap | null {
    const map = resolveWarpMap(input.warp, input.projectBaseTempo);
    if (map === null) {
        return null;
    }
    if (
        map.isIdentity &&
        input.effectiveLegacyRatio === 1 &&
        input.timeline.constantTempoOver(input.clipStartBeat, input.clipEndBeat) === map.referenceTempo
    ) {
        return null;
    }
    return map;
}

/** Index of the first element above `value` in an ascending array. */
function upperBound(sorted: ArrayLike<number>, value: number): number {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (at(sorted, mid) <= value) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

function scaleBySlope(delta: number, slope: number, rising: boolean): number {
    if (rising) {
        return slope * delta;
    }
    return delta / slope;
}

/** Piecewise-linear transfer from one knot axis to the other; `rising` maps source to beats. */
function interpolate(map: WarpMap, value: number, rising: boolean): number {
    let from = map.knotBeats;
    let to = map.knotSourceSeconds;
    if (rising) {
        from = map.knotSourceSeconds;
        to = map.knotBeats;
    }
    const { slopes } = map;
    const last = from.length - 1;
    let knot = upperBound(from, value) - 1;
    let slope = at(slopes, knot + 1);
    if (value <= at(from, 0)) {
        knot = 0;
        slope = at(slopes, 0);
    } else if (value >= at(from, last)) {
        knot = last;
        slope = at(slopes, last + 1);
    }
    return at(to, knot) + scaleBySlope(value - at(from, knot), slope, rising);
}

/** W: the warped beat of a source position. */
export function warpedBeatAtSource(map: WarpMap, sourceSeconds: number): number {
    return interpolate(map, sourceSeconds, true);
}

/** W⁻¹: the source position of a warped beat. */
export function sourceAtWarpedBeat(map: WarpMap, warpedBeat: number): number {
    return interpolate(map, warpedBeat, false);
}

/** The source heard at `beat` by a part that enters the source at `anchorSourceSeconds` on `anchorBeat`. */
export function sourceAtTimelineBeat(
    map: WarpMap,
    anchorBeat: number,
    anchorSourceSeconds: number,
    beat: number
): number {
    return sourceAtWarpedBeat(map, warpedBeatAtSource(map, anchorSourceSeconds) + (beat - anchorBeat));
}

/** The timeline beat at which such a part reaches `sourceSeconds`. */
export function timelineBeatAtSource(
    map: WarpMap,
    anchorBeat: number,
    anchorSourceSeconds: number,
    sourceSeconds: number
): number {
    return anchorBeat + warpedBeatAtSource(map, sourceSeconds) - warpedBeatAtSource(map, anchorSourceSeconds);
}

/** Priority on a tie, best first. */
const SPAN_END = 0;
const MARKER_KNOT = 1;
const SOURCE_CLAMP = 2;
const TEMPO_BREAK = 3;

type Cut = { beat: number; priority: number; source: number | null };

/** Insert in beat order; among equal beats the better priority comes first. */
function insertCut(cuts: Cut[], cut: Cut): void {
    let index = cuts.length;
    while (index > 0) {
        const previous = cuts[index - 1];
        if (
            previous === undefined ||
            previous.beat < cut.beat ||
            (previous.beat === cut.beat && previous.priority <= cut.priority)
        ) {
            break;
        }
        index -= 1;
    }
    cuts.splice(index, 0, cut);
}

function collectCuts(map: WarpMap, segment: WarpPassSegment, sourceDuration: number, timeline: WarpTimeline): Cut[] {
    const { anchorBeat, anchorSourceSeconds, startBeat, endBeat } = segment;
    const anchorWarped = warpedBeatAtSource(map, anchorSourceSeconds);
    const cuts: Cut[] = [
        { beat: startBeat, priority: SPAN_END, source: startBeat === anchorBeat ? anchorSourceSeconds : null },
        { beat: endBeat, priority: SPAN_END, source: null },
    ];
    const beatOfWarped = (warped: number): number => anchorBeat + warped - anchorWarped;
    const inside = (beat: number): boolean => beat > startBeat && beat < endBeat;

    const firstKnot = upperBound(map.knotBeats, anchorWarped + (startBeat - anchorBeat) - TOLERANCE);
    for (let knot = firstKnot; knot < map.knotBeats.length; knot++) {
        const beat = beatOfWarped(at(map.knotBeats, knot));
        if (beat >= endBeat) {
            break;
        }
        if (inside(beat)) {
            insertCut(cuts, { beat, priority: MARKER_KNOT, source: at(map.knotSourceSeconds, knot) });
        }
    }
    const headBeat = beatOfWarped(warpedBeatAtSource(map, 0));
    if (inside(headBeat)) {
        insertCut(cuts, { beat: headBeat, priority: SOURCE_CLAMP, source: 0 });
    }
    const tailBeat = beatOfWarped(warpedBeatAtSource(map, sourceDuration));
    if (inside(tailBeat)) {
        insertCut(cuts, { beat: tailBeat, priority: SOURCE_CLAMP, source: sourceDuration });
    }
    for (let index = upperBound(timeline.breakBeats, startBeat); index < timeline.breakBeats.length; index++) {
        const beat = at(timeline.breakBeats, index);
        if (beat >= endBeat) {
            break;
        }
        insertCut(cuts, { beat, priority: TEMPO_BREAK, source: null });
    }
    return cuts;
}

/** Cuts closer than the tolerance are one instant; the better priority keeps it. */
function mergeNearCuts(cuts: readonly Cut[]): Cut[] {
    const merged: Cut[] = [];
    for (const cut of cuts) {
        const last = merged[merged.length - 1];
        if (last === undefined || cut.beat - last.beat >= TOLERANCE) {
            merged.push(cut);
            continue;
        }
        if (cut.priority < last.priority) {
            merged[merged.length - 1] = cut;
        }
    }
    return merged;
}

/**
 * Split one loop part into constant-rate pieces. Cuts fall exactly on every
 * marker knot, every tempo-map break, the span ends, and the two source clamps
 * (silence until source 0, nothing past the material's end). A piece's rate is
 * its source span over the route's own seconds for its beats, so each piece
 * ends on the source position the mapping names however the tempo map moves.
 */
export function projectWarpedPieces(input: {
    map: WarpMap;
    segment: WarpPassSegment;
    sourceDurationSeconds: number;
    timeline: WarpTimeline;
}): WarpPiece[] {
    const { map, segment, sourceDurationSeconds, timeline } = input;
    if (!(segment.endBeat > segment.startBeat) || !(sourceDurationSeconds > 0)) {
        return [];
    }
    const { anchorBeat, anchorSourceSeconds } = segment;
    const sourceAt = (cut: Cut): number => {
        const source = cut.source ?? sourceAtTimelineBeat(map, anchorBeat, anchorSourceSeconds, cut.beat);
        return Math.min(sourceDurationSeconds, Math.max(0, source));
    };
    const cuts = mergeNearCuts(collectCuts(map, segment, sourceDurationSeconds, timeline));
    const pieces: WarpPiece[] = [];
    for (let index = 0; index + 1 < cuts.length; index++) {
        const from = cuts[index];
        const to = cuts[index + 1];
        if (from === undefined || to === undefined) {
            continue;
        }
        const middle = sourceAtTimelineBeat(map, anchorBeat, anchorSourceSeconds, (from.beat + to.beat) / 2);
        if (middle < 0 || middle > sourceDurationSeconds) {
            continue;
        }
        const seconds = timeline.secondsBetween(from.beat, to.beat);
        if (!(seconds > 0)) {
            continue;
        }
        const sourceStartSeconds = sourceAt(from);
        const sourceEndSeconds = sourceAt(to);
        const rawRate = (sourceEndSeconds - sourceStartSeconds) / seconds;
        const rate = boundStretchRatio(rawRate);
        pieces.push({
            startBeat: from.beat,
            endBeat: to.beat,
            sourceStartSeconds,
            sourceEndSeconds,
            rate,
            rateClamped: rate !== rawRate,
        });
    }
    return pieces;
}
