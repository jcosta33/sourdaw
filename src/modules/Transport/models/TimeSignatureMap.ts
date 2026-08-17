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
        const startBeat = endBeat - numerator * (4 / denominator);
        bars.push({ startBeat, numerator, denominator });
        endBeat = startBeat;
    }

    return bars.reverse();
}
