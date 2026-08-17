export type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

export type TempoRange = {
    fromBeat: number;
    toBeat: number;
};

/**
 * Beat-ordered view of a change list, keyed by the list's own identity.
 *
 * Every query below needs the changes in beat order, and the scheduler asks for
 * several conversions per scheduled event per tick — `beatToSamples` alone runs
 * three times for every MIDI note. Sorting inside each call put a copy plus a
 * comparison sort on that path for a list that does not change between calls.
 *
 * Identity is a sound key because the tempo map is only ever written by
 * replacement: `tempoMapStore.set` takes a freshly built array, and the store's
 * sanitizer either returns the same object or builds a new one. Nothing mutates
 * a change list in place, so a list that is identical is also unchanged. The
 * returned array is shared and must be treated as read-only.
 */
const sortedTempoChanges = new WeakMap<readonly TempoChange[], readonly TempoChange[]>();

function sortTempoChanges(changes: readonly TempoChange[]): readonly TempoChange[] {
    const cached = sortedTempoChanges.get(changes);
    if (cached) {
        return cached;
    }
    const sorted = [...changes].sort((alpha, beta) => alpha.beat - beta.beat);
    sortedTempoChanges.set(changes, sorted);
    return sorted;
}

/**
 * Which change supplies the tempo at a beat, and how.
 *
 * `getTempoAtBeatFromSorted` and `getGoverningTempoChange` are both built on the
 * single scan below so they can never disagree — the review found them agreeing
 * on `change` but not on the reported quantity, and disagreeing outright for a
 * non-finite beat.
 */
type SortedGoverningTempo = {
    /** The event whose `tempo` field an edit at this beat has to rewrite. */
    change: TempoChange;
    /** The following event, present only when the tempo is being ramped toward it. */
    rampTarget: TempoChange | undefined;
};

function getGoverningTempoFromSorted(
    sortedChanges: readonly TempoChange[],
    beat: number
): SortedGoverningTempo | undefined {
    if (sortedChanges.length === 0) {
        return undefined;
    }

    let previous: TempoChange | undefined;
    let next: TempoChange | undefined;
    for (const change of sortedChanges) {
        // A non-finite beat fails this comparison for every change, so `previous`
        // stays undefined and the first change governs — the same answer the
        // reported tempo gives. Scanning for "the last change at or before the
        // beat" instead would silently pick the *last* change.
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
    // `beat === previous.beat` is the ramp's own start point. The interpolation
    // factor there is 0, so `getTempoAtBeat` returns `previous.tempo` exactly —
    // the readout *is* that event's value and a write to it is well defined.
    // Reporting a ramp target there made a map whose first change sits at beat 0
    // with `curve: 'linear'` read-only at the default playhead position, and a
    // map of all-`linear` changes read-only everywhere but after the last one.
    if (!next || previous.curve === 'instant' || beat === previous.beat) {
        return { change: previous, rampTarget: undefined };
    }
    return { change: previous, rampTarget: next };
}

function getTempoAtBeatFromSorted(changes: readonly TempoChange[], beat: number, defaultTempo: number): number {
    const governing = getGoverningTempoFromSorted(changes, beat);
    if (!governing) {
        return defaultTempo;
    }
    if (!governing.rampTarget) {
        return governing.change.tempo;
    }

    const time = (beat - governing.change.beat) / (governing.rampTarget.beat - governing.change.beat);
    return governing.change.tempo + (governing.rampTarget.tempo - governing.change.tempo) * time;
}

function getActiveTempoChange(changes: readonly TempoChange[], beat: number): TempoChange | undefined {
    let active: TempoChange | undefined;
    for (const change of changes) {
        if (change.beat > beat) {
            break;
        }
        active = change;
    }
    return active;
}

export function createTempoChange(beat: number, tempo: number, curve: TempoChange['curve'] = 'instant'): TempoChange {
    return {
        id: `tempo-${crypto.randomUUID()}`,
        beat,
        tempo: Math.max(20, Math.min(999, tempo)),
        curve,
    };
}

export function getTempoAtBeat(changes: readonly TempoChange[], beat: number, defaultTempo: number): number {
    return getTempoAtBeatFromSorted(sortTempoChanges(changes), beat, defaultTempo);
}

export type GoverningTempo = {
    /** The event a transport-tempo edit at this beat has to rewrite. */
    change: TempoChange;
    /**
     * True when `getTempoAtBeat` reports an interpolated value here rather than
     * `change.tempo` itself — a `linear` change with a later change to ramp
     * toward. On such a segment the tempo in force is not any event's `tempo`,
     * so no single BPM written to one event can produce it: assigning the typed
     * value to `change.tempo` moves the readout somewhere else again. Callers
     * must refuse the write instead of silently editing the ramp's start point.
     */
    interpolated: boolean;
};

/**
 * The tempo change that supplies the tempo `getTempoAtBeat` reports at `beat`,
 * together with whether that reported tempo is the change's own value.
 *
 * Shares `getGoverningTempoFromSorted` with `getTempoAtBeat`, so the two can
 * only ever name the same change — including the fallback to the first change
 * when the beat precedes every change or is non-finite. `defaultTempo` is
 * consulted only for an empty map, so with any non-empty map some change always
 * governs; `undefined` therefore means "no map at all", the one case where the
 * transport's base tempo is still the governing value.
 */
export function getGoverningTempoChange(changes: readonly TempoChange[], beat: number): GoverningTempo | undefined {
    const governing = getGoverningTempoFromSorted(sortTempoChanges(changes), beat);
    if (!governing) {
        return undefined;
    }
    return { change: governing.change, interpolated: governing.rampTarget !== undefined };
}

function secondsAcrossSortedTempoRange(
    sortedChanges: readonly TempoChange[],
    fromBeat: number,
    toBeat: number,
    defaultTempo: number
): number {
    if (fromBeat === toBeat) {
        return 0;
    }
    if (toBeat < fromBeat) {
        return -secondsAcrossSortedTempoRange(sortedChanges, toBeat, fromBeat, defaultTempo);
    }

    const boundaries = [fromBeat];
    for (const change of sortedChanges) {
        if (change.beat > fromBeat && change.beat < toBeat && change.beat !== boundaries.at(-1)) {
            boundaries.push(change.beat);
        }
    }
    boundaries.push(toBeat);
    let seconds = 0;
    for (let index = 0; index < boundaries.length - 1; index++) {
        const segmentStart = boundaries[index]!;
        const segmentEnd = boundaries[index + 1]!;
        const startTempo = getTempoAtBeatFromSorted(sortedChanges, segmentStart, defaultTempo);
        const activeChange = getActiveTempoChange(sortedChanges, segmentStart);
        if (!activeChange || activeChange.curve === 'instant') {
            seconds += ((segmentEnd - segmentStart) * 60) / startTempo;
            continue;
        }

        const endTempo = getTempoAtBeatFromSorted(sortedChanges, segmentEnd, defaultTempo);
        const tempoDelta = endTempo - startTempo;
        if (tempoDelta === 0) {
            seconds += ((segmentEnd - segmentStart) * 60) / startTempo;
        } else {
            const relativeTempoDelta = tempoDelta / startTempo;
            seconds +=
                (((segmentEnd - segmentStart) * 60) / startTempo) *
                (Math.log1p(relativeTempoDelta) / relativeTempoDelta);
        }
    }
    return seconds;
}

/**
 * Wall-clock seconds the transport spends travelling from `fromBeat` to
 * `toBeat`, integrating every tempo change and ramp in between.
 *
 * This is the only correct beat → time conversion for anything the scheduler
 * places on the timeline. A flat `secondsPerBeat = 60 / tempo` is right only
 * while the window contains no tempo change; with one inside it, the reading is
 * wrong by the whole area between the two tempo curves, and the affected voices
 * drift against every path that does integrate the map. Negative spans are
 * supported (the result is negative), so a caller may pass the playhead as
 * `fromBeat` and a beat behind it as `toBeat`.
 */
export function secondsBetweenBeats(
    changes: readonly TempoChange[],
    fromBeat: number,
    toBeat: number,
    defaultTempo: number
): number {
    return secondsAcrossSortedTempoRange(sortTempoChanges(changes), fromBeat, toBeat, defaultTempo);
}

export function beatToSamples(
    changes: readonly TempoChange[],
    beat: number,
    defaultTempo: number,
    sampleRate: number
): number {
    const sortedChanges = sortTempoChanges(changes);
    return Math.round(secondsAcrossSortedTempoRange(sortedChanges, 0, beat, defaultTempo) * sampleRate);
}

export function samplesToBeat(
    changes: readonly TempoChange[],
    samples: number,
    defaultTempo: number,
    sampleRate: number
): number {
    if (samples === 0) {
        return 0;
    }
    const sortedChanges = sortTempoChanges(changes);
    const targetSeconds = samples / sampleRate;
    for (const change of sortedChanges) {
        if (
            Math.abs(secondsAcrossSortedTempoRange(sortedChanges, 0, change.beat, defaultTempo) - targetSeconds) < 1e-12
        ) {
            return change.beat;
        }
    }

    let lowerBeat = targetSeconds < 0 ? -1 : 0;
    let upperBeat = targetSeconds < 0 ? 0 : 1;
    if (targetSeconds < 0) {
        while (secondsAcrossSortedTempoRange(sortedChanges, 0, lowerBeat, defaultTempo) > targetSeconds) {
            lowerBeat *= 2;
        }
    } else {
        while (secondsAcrossSortedTempoRange(sortedChanges, 0, upperBeat, defaultTempo) < targetSeconds) {
            upperBeat *= 2;
        }
    }

    for (let iteration = 0; iteration < 64; iteration++) {
        const midpoint = (lowerBeat + upperBeat) / 2;
        const midpointSeconds = secondsAcrossSortedTempoRange(sortedChanges, 0, midpoint, defaultTempo);
        if (midpointSeconds < targetSeconds) {
            lowerBeat = midpoint;
        } else {
            upperBeat = midpoint;
        }
    }
    return (lowerBeat + upperBeat) / 2;
}

export function splitRangeAtTempoChanges(
    changes: readonly TempoChange[],
    fromBeat: number,
    toBeat: number
): TempoRange[] {
    if (toBeat <= fromBeat) {
        return [];
    }
    const boundaries = [
        fromBeat,
        ...sortTempoChanges(changes)
            .map((change) => change.beat)
            .filter((beat, index, beats) => beat > fromBeat && beat < toBeat && beat !== beats[index - 1]),
        toBeat,
    ];
    return boundaries.slice(0, -1).map((segmentStart, index) => ({
        fromBeat: segmentStart,
        toBeat: boundaries[index + 1]!,
    }));
}
