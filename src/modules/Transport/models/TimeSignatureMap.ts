export type TimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

/**
 * Beat-ordered view of a change list, keyed by the list's own identity — same
 * contract and same reason as the tempo map's cache: the metronome resolves the
 * meter for every click it schedules, and the map is only ever written by
 * replacement, so a list that is identical is also unchanged. The returned array
 * is shared and must be treated as read-only.
 */
const sortedTimeSignatureChanges = new WeakMap<readonly TimeSignatureChange[], readonly TimeSignatureChange[]>();

function sortTimeSignatureChanges(changes: readonly TimeSignatureChange[]): readonly TimeSignatureChange[] {
    const cached = sortedTimeSignatureChanges.get(changes);
    if (cached) {
        return cached;
    }
    const sorted = [...changes].sort((alpha, beta) => alpha.beat - beta.beat);
    sortedTimeSignatureChanges.set(changes, sorted);
    return sorted;
}

/**
 * Float tolerance for deciding whether a beat sits exactly on a grid line.
 *
 * Bar and beat lengths are `numerator * (4 / denominator)` quarter notes, which
 * is inexact for any denominator that is not a power of two, so a position that
 * is mathematically an exact multiple can compute a hair above or below it.
 * Without the tolerance a bar line resolves one whole bar out.
 */
const GRID_EPSILON = 1e-9;

export function createTimeSignatureChange(beat: number, numerator: number, denominator: number): TimeSignatureChange {
    return {
        id: `ts-${crypto.randomUUID()}`,
        beat,
        numerator: Math.max(1, Math.min(32, numerator)),
        denominator: Math.max(1, Math.min(32, denominator)),
    };
}

export function getTimeSignatureAtBeat(
    changes: readonly TimeSignatureChange[],
    beat: number,
    defaultNumerator: number,
    defaultDenominator: number
): { numerator: number; denominator: number } {
    if (changes.length === 0) {
        return { numerator: defaultNumerator, denominator: defaultDenominator };
    }

    let last: TimeSignatureChange | undefined;
    for (const change of sortTimeSignatureChanges(changes)) {
        if (change.beat > beat) {
            break;
        }
        last = change;
    }

    if (!last) {
        return { numerator: defaultNumerator, denominator: defaultDenominator };
    }

    return { numerator: last.numerator, denominator: last.denominator };
}

export type TimeSignatureSegment = {
    /**
     * Beat the governing change takes effect on, and the origin this segment's
     * bars and beats are counted from. 0 when no change governs the position yet.
     */
    startBeat: number;
    numerator: number;
    denominator: number;
    /** Beat the next change takes effect on; `Infinity` for the last segment. */
    endBeat: number;
    /** One metrical beat in quarter notes: `4 / denominator`. */
    beatUnit: number;
};

/**
 * The stretch of timeline governed by one time signature, around `position`.
 *
 * Anything walking the meter grid needs the governing change's *beat*, not just
 * its numerator and denominator: bars and beats are counted from where the
 * change lands, so a change opens a bar at its own position and truncates the
 * bar in progress. `endBeat` bounds the walk so the caller can re-resolve there.
 */
export function getTimeSignatureSegmentAtBeat(
    changes: readonly TimeSignatureChange[],
    position: number,
    defaultNumerator: number,
    defaultDenominator: number
): TimeSignatureSegment {
    let governing: TimeSignatureChange | undefined;
    let next: TimeSignatureChange | undefined;

    for (const change of sortTimeSignatureChanges(changes)) {
        // A position landing exactly on a change adopts it, matching
        // `getBarBeatAtPosition`.
        if (change.beat > position) {
            next = change;
            break;
        }
        governing = change;
    }

    const denominator = governing?.denominator ?? defaultDenominator;

    return {
        startBeat: governing?.beat ?? 0,
        numerator: governing?.numerator ?? defaultNumerator,
        denominator,
        endBeat: next?.beat ?? Number.POSITIVE_INFINITY,
        beatUnit: 4 / denominator,
    };
}

/**
 * Every metrical beat in `[fromBeat, toBeat]`, in quarter notes, ascending.
 *
 * A metronome clicks the meter's beat, not the quarter note. Stepping whole
 * quarter notes clicks at the wrong rate for every meter whose denominator is
 * not 4 — in 6/8 the pulse is the eighth — and misses bar lines outright
 * whenever a bar is not a whole number of quarters: a 7/8 bar is 3.5 quarters,
 * so an integer grid only ever lands on every second bar line, and the accent
 * with it. 5/8 and 5/16 fail the same way.
 *
 * The grid is measured from the governing change's beat, the same origin
 * `getBarBeatAtPosition` counts from, so every beat returned here is one that
 * function agrees exists. Where a change lands the grid restarts, because the
 * change opens a bar there.
 */
export function getMetricalBeatsBetween(
    changes: readonly TimeSignatureChange[],
    fromBeat: number,
    toBeat: number,
    defaultNumerator: number,
    defaultDenominator: number
): number[] {
    const beats: number[] = [];
    let segment = getTimeSignatureSegmentAtBeat(changes, fromBeat, defaultNumerator, defaultDenominator);

    // A beat unit that is not a positive finite number never advances the walk:
    // a zero denominator gives Infinity, a negative one steps backwards. Only a
    // corrupt map produces either, and silence beats a hang.
    if (!Number.isFinite(segment.beatUnit) || segment.beatUnit <= 0) {
        return beats;
    }

    let beat =
        segment.startBeat +
        Math.ceil((fromBeat - segment.startBeat) / segment.beatUnit - GRID_EPSILON) * segment.beatUnit;

    while (beat <= toBeat + GRID_EPSILON) {
        if (beat >= segment.endBeat - GRID_EPSILON) {
            segment = getTimeSignatureSegmentAtBeat(changes, segment.endBeat, defaultNumerator, defaultDenominator);
            // The change's own beat is always a beat, so the walk resumes there
            // rather than carrying the outgoing grid across the seam. `endBeat`
            // is strictly above `startBeat` for every segment, so this advances.
            beat = segment.startBeat;
            continue;
        }
        beats.push(beat);
        beat += segment.beatUnit;
    }

    return beats;
}

export function getBarBeatAtPosition(
    changes: readonly TimeSignatureChange[],
    position: number,
    defaultNumerator: number,
    defaultDenominator: number
): { bar: number; beat: number; tick: number } {
    const sorted = sortTimeSignatureChanges(changes);
    let bar = 1;
    let currentBeat = 0;
    let currentNumerator = defaultNumerator;
    let currentDenominator = defaultDenominator;

    for (const change of sorted) {
        // A position landing exactly on a change beat must adopt the new time
        // signature, so consume the change before breaking (`>` not `>=`).
        if (change.beat > position) {
            break;
        }
        const quarterNotesInSegment = change.beat - currentBeat;
        const quarterNotesPerBar = currentNumerator * (4 / currentDenominator);
        bar += Math.floor(quarterNotesInSegment / quarterNotesPerBar);
        currentBeat = change.beat;
        currentNumerator = change.numerator;
        currentDenominator = change.denominator;
    }

    const beatUnit = 4 / currentDenominator;
    const quarterNotesPerBar = currentNumerator * beatUnit;
    const remainingQuarters = position - currentBeat;
    bar += Math.floor(remainingQuarters / quarterNotesPerBar);
    const quartersIntoBar = remainingQuarters % quarterNotesPerBar;
    const beatInBar = Math.floor(quartersIntoBar / beatUnit) + 1;
    const quartersIntoBeat = quartersIntoBar % beatUnit;
    const tick = Math.floor((quartersIntoBeat / beatUnit) * 480);

    return { bar, beat: beatInBar, tick };
}

export type TimelineBar = {
    /** Timeline position of the bar's first beat, in quarter notes. May be negative. */
    startBeat: number;
    numerator: number;
    denominator: number;
};

/**
 * The `barCount` bars immediately preceding `beat`, oldest first.
 *
 * Count-in and pre-roll both lead *into* a point on the timeline, so the meter
 * that sizes them is the one governing the bars they occupy — not the one at the
 * point they lead into, and not the transport's flat numerator. The walk runs
 * backwards and reads the map once per bar, because each bar's length decides
 * where the previous one starts.
 *
 * A bar ending exactly on a time-signature change belongs to the *outgoing*
 * meter: the change starts a new bar at its own beat (the same rule
 * `getBarBeatAtPosition` applies going forwards), so the lookup below takes the
 * last change strictly before the bar's end.
 *
 * Every start returned lands on the forward grid — walking back from a position
 * and walking forward from the origin agree about where bars begin. Subtracting
 * a bar length per step does not give that, because a change need not fall on a
 * bar line: nothing snaps one, and moving or deleting a range can leave one
 * mid-bar. With 4/4 from the origin and 3/4 at beat 5, the forward grid opens
 * bars at 0, 4, 5, 8; plain subtraction from 11 yields 8, 5, then 1, opening the
 * pre-roll three quarter notes early. So each step lands on the last grid line
 * strictly below the bar's end instead.
 *
 * A bar truncated by a mid-bar change is therefore shorter than the meter
 * reported alongside it — that meter is the one governing the bar, not a
 * statement of its length. Callers needing the length take it from the next
 * start, or from `beat` for the last bar.
 *
 * Bars before the timeline origin have negative start beats. That is the correct
 * answer, not an error: counting in to beat 0 has to happen somewhere, and the
 * tempo map extends its first change backwards.
 */
export function getPrecedingBars(
    changes: readonly TimeSignatureChange[],
    beat: number,
    barCount: number,
    defaultNumerator: number,
    defaultDenominator: number
): TimelineBar[] {
    const sorted = sortTimeSignatureChanges(changes);
    const bars: TimelineBar[] = [];
    let endBeat = beat;

    for (let index = 0; index < barCount; index++) {
        let governing: TimeSignatureChange | undefined;
        for (const change of sorted) {
            if (change.beat >= endBeat) {
                break;
            }
            governing = change;
        }
        const numerator = governing?.numerator ?? defaultNumerator;
        const denominator = governing?.denominator ?? defaultDenominator;
        const barLength = numerator * (4 / denominator);
        const segmentStart = governing?.beat ?? 0;
        const barsBack = Math.ceil((endBeat - segmentStart) / barLength - GRID_EPSILON) - 1;
        const startBeat =
            governing === undefined
                ? // No change governs yet, so the default meter's grid runs from
                  // the origin and extends backwards past it.
                  barsBack * barLength
                : // Within a segment the grid starts at the change, so a bar can
                  // never open before it: `barsBack` only goes negative when a
                  // change sits a float hair below `endBeat`.
                  segmentStart + Math.max(0, barsBack) * barLength;
        bars.push({ startBeat, numerator, denominator });
        endBeat = startBeat;
    }

    return bars.reverse();
}
