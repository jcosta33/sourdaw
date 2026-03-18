export type TimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

let nextTimeSignatureChangeId = 1;

export const createTimeSignatureChange = (
    beat: number,
    numerator: number,
    denominator: number
): TimeSignatureChange => ({
    id: `ts-${nextTimeSignatureChangeId++}`,
    beat,
    numerator: Math.max(1, Math.min(32, numerator)),
    denominator: Math.max(1, Math.min(32, denominator)),
});

export const getTimeSignatureAtBeat = (
    changes: TimeSignatureChange[],
    beat: number,
    defaultNumerator: number,
    defaultDenominator: number
): { numerator: number; denominator: number } => {
    if (changes.length === 0) {
        return { numerator: defaultNumerator, denominator: defaultDenominator };
    }

    const sorted = [...changes].sort((a, b) => a.beat - b.beat);
    const before = sorted.filter((c) => c.beat <= beat);

    if (before.length === 0) {
        return { numerator: defaultNumerator, denominator: defaultDenominator };
    }

    const last = before[before.length - 1]!;
    return { numerator: last.numerator, denominator: last.denominator };
};

export const getBarBeatAtPosition = (
    changes: TimeSignatureChange[],
    position: number,
    defaultNumerator: number,
    defaultDenominator: number
): { bar: number; beat: number; tick: number } => {
    const sorted = [...changes].sort((a, b) => a.beat - b.beat);
    let bar = 1;
    let currentBeat = 0;
    let currentNumerator = defaultNumerator;

    for (const change of sorted) {
        if (change.beat >= position) {
            break;
        }
        const beatsInSegment = change.beat - currentBeat;
        bar += Math.floor(beatsInSegment / currentNumerator);
        currentBeat = change.beat;
        currentNumerator = change.numerator;
    }

    const remainingBeats = position - currentBeat;
    bar += Math.floor(remainingBeats / currentNumerator);
    const beatInBar = Math.floor(remainingBeats % currentNumerator) + 1;
    const tick = Math.floor((position % 1) * 480);

    void defaultDenominator;

    return { bar, beat: beatInBar, tick };
};
