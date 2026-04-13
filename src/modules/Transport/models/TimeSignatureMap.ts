export type TimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

export const createTimeSignatureChange = (
    beat: number,
    numerator: number,
    denominator: number
): TimeSignatureChange => ({
    id: `ts-${crypto.randomUUID()}`,
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
    let currentDenominator = defaultDenominator;

    for (const change of sorted) {
        if (change.beat >= position) {
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
};
