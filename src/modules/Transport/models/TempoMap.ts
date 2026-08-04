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

function sortTempoChanges(changes: readonly TempoChange[]): TempoChange[] {
    return [...changes].sort((alpha, beta) => alpha.beat - beta.beat);
}

function getTempoAtBeatFromSorted(changes: readonly TempoChange[], beat: number, defaultTempo: number): number {
    if (changes.length === 0) {
        return defaultTempo;
    }

    let previous: TempoChange | undefined;
    let next: TempoChange | undefined;
    for (const change of changes) {
        if (change.beat <= beat) {
            previous = change;
        } else {
            next = change;
            break;
        }
    }
    if (!previous) {
        return changes[0]!.tempo;
    }
    if (!next || previous.curve === 'instant') {
        return previous.tempo;
    }

    const time = (beat - previous.beat) / (next.beat - previous.beat);
    return previous.tempo + (next.tempo - previous.tempo) * time;
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

/**
 * The tempo change that supplies the tempo `getTempoAtBeat` reports at `beat` —
 * i.e. the event a transport-tempo edit at that playhead position must rewrite.
 *
 * Mirrors `getTempoAtBeatFromSorted` exactly, including its fallback to the
 * first change when the playhead sits before every change: `defaultTempo` is
 * consulted only for an empty map, so with any non-empty map some change always
 * governs. Returns `undefined` only when there is no map at all, which is the
 * case where the transport's base tempo is still the governing value.
 *
 * For a `linear` change the reported tempo is interpolated toward the next
 * change, so the governing event's own tempo is what an edit sets — the readout
 * then re-interpolates from the new value.
 */
export function getGoverningTempoChange(changes: readonly TempoChange[], beat: number): TempoChange | undefined {
    if (changes.length === 0) {
        return undefined;
    }

    const sortedChanges = sortTempoChanges(changes);
    return getActiveTempoChange(sortedChanges, beat) ?? sortedChanges[0];
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
