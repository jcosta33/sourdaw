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

/** Display names for the `SCALE_PATTERNS` identifiers; option values stay the identifiers. */
export const SCALE_LABELS: Record<string, string> = {
    major: 'Major',
    minor: 'Minor',
    harmonicMinor: 'Harmonic Minor',
    melodicMinor: 'Melodic Minor',
    dorian: 'Dorian',
    phrygian: 'Phrygian',
    lydian: 'Lydian',
    mixolydian: 'Mixolydian',
    pentatonicMajor: 'Pentatonic Major',
    pentatonicMinor: 'Pentatonic Minor',
    blues: 'Blues',
    wholeTone: 'Whole Tone',
    diminished: 'Diminished',
    chromatic: 'Chromatic',
};

export function getScaleLabel(scaleName: string): string {
    return SCALE_LABELS[scaleName] ?? scaleName;
}

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
    let actualDiff: number;
    if (Math.abs(diff) <= 600) {
        actualDiff = diff;
    } else if (diff > 0) {
        actualDiff = diff - 1200;
    } else {
        actualDiff = diff + 1200;
    }

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
    let actualDiff: number;
    if (Math.abs(diff) <= 6) {
        actualDiff = diff;
    } else if (diff > 0) {
        actualDiff = diff - 12;
    } else {
        actualDiff = diff + 12;
    }

    const snapped = note + actualDiff;
    if (snapped >= MIN_MIDI_PITCH && snapped <= MAX_MIDI_PITCH) {
        return snapped;
    }
    return nearestInScalePitchInRange(note, root, pattern, actualDiff > 0 ? -1 : 1);
}

const MIN_MIDI_PITCH = 0;
const MAX_MIDI_PITCH = 127;

/** Walks from `note` in `direction` to the first in-scale pitch; used when the nearest degree lies outside MIDI range. */
function nearestInScalePitchInRange(note: number, root: number, pattern: readonly number[], direction: 1 | -1): number {
    let pitch = note;
    while (pitch >= MIN_MIDI_PITCH && pitch <= MAX_MIDI_PITCH) {
        if (pattern.includes((((pitch - root) % 12) + 12) % 12)) {
            return pitch;
        }
        pitch += direction;
    }
    return note;
}
