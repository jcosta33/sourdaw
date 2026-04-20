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

export function foldMidiNote(
    note: number,
    srcRoot: number,
    srcScale: string,
    dstRoot: number,
    dstScale: string
): number {
    const srcPattern = SCALE_PATTERNS[srcScale] ?? SCALE_PATTERNS.chromatic!;
    const dstPattern = SCALE_PATTERNS[dstScale] ?? SCALE_PATTERNS.chromatic!;

    const srcPc = (((note - srcRoot) % 12) + 12) % 12;
    const srcOctave = Math.floor((note - srcRoot) / 12);

    // Find closest degree in source pattern
    let srcDegree = 0;
    let minDiff = 12;
    for (let i = 0; i < srcPattern.length; i++) {
        const patternNote = srcPattern[i];
        if (patternNote === undefined) {
            continue;
        }
        const diff = Math.abs(srcPc - patternNote);
        if (diff < minDiff) {
            minDiff = diff;
            srcDegree = i;
        }
    }

    const patternNoteAtDegree = srcPattern[srcDegree];
    if (patternNoteAtDegree === undefined) {
        return note;
    }
    const chromaticOffset = srcPc - patternNoteAtDegree;

    // Map degree to destination pattern
    // If destination pattern has fewer degrees, we wrap/modulo
    const dstDegree = srcDegree % dstPattern.length;
    const dstPc = dstPattern[dstDegree];

    if (dstPc === undefined) {
        return note;
    }

    // Proportional remapping for chromatic offset if gaps differ
    // (Simplification: just preserve the offset for now, but in microtuning we'd scale it)
    const resultNote = dstRoot + srcOctave * 12 + dstPc + chromaticOffset;

    // Safety clamp for MIDI range
    return Math.max(0, Math.min(127, Math.round(resultNote)));
}

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
