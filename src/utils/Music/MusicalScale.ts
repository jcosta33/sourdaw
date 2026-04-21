export const SCALE_PATTERNS: Record<string, number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
    melodicMinor: [0, 2, 3, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonicMajor: [0, 2, 4, 7, 9],
    pentatonicMinor: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    wholeTone: [0, 2, 4, 6, 8, 10],
    diminished: [0, 2, 3, 5, 6, 8, 9, 11],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_NAMES = Object.keys(SCALE_PATTERNS);

export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function quantizeCentsToScale(cents: number, root: number, scaleName: string): number {
    const pattern = SCALE_PATTERNS[scaleName] ?? SCALE_PATTERNS.chromatic!;
    const pc = (((Math.round(cents / 100) - root) % 12) + 12) % 12;

    if (pattern.includes(pc)) {
        return cents;
    }

    let bestDist = 12;
    let bestPc = pc;

    for (const scalePc of pattern) {
        const dist = Math.min(Math.abs(pc - scalePc), 12 - Math.abs(pc - scalePc));
        if (dist < bestDist) {
            bestDist = dist;
            bestPc = scalePc;
        }
    }

    const diff = (bestPc - pc) * 100;
    const actualDiff = Math.abs(diff) <= 600 ? diff : diff > 0 ? diff - 1200 : diff + 1200;

    return cents + actualDiff;
}

export function quantizeMidiNoteToScale(note: number, root: number, scaleName: string): number {
    const pattern = SCALE_PATTERNS[scaleName] ?? SCALE_PATTERNS.chromatic!;
    const pc = (((note - root) % 12) + 12) % 12;

    if (pattern.includes(pc)) {
        return note;
    }

    let bestDist = 12;
    let bestPc = pc;

    for (const scalePc of pattern) {
        const dist = Math.min(Math.abs(pc - scalePc), 12 - Math.abs(pc - scalePc));
        if (dist < bestDist) {
            bestDist = dist;
            bestPc = scalePc;
        }
    }

    const diff = bestPc - pc;
    const actualDiff = Math.abs(diff) <= 6 ? diff : diff > 0 ? diff - 12 : diff + 12;

    return Math.max(0, Math.min(127, note + actualDiff));
}
