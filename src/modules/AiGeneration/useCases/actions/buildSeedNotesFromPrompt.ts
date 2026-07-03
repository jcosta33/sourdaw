/** Pitch-class offsets (semitones above the root) for the two scales we seed from. */
const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE_STEPS = [0, 2, 3, 5, 7, 8, 10] as const;

/** Note-name to pitch class (semitones above C). Covers sharps and flats. */
const PITCH_CLASS_BY_NAME: Record<string, number> = {
    c: 0,
    'c#': 1,
    db: 1,
    d: 2,
    'd#': 3,
    eb: 3,
    e: 4,
    f: 5,
    'f#': 6,
    gb: 6,
    g: 7,
    'g#': 8,
    ab: 8,
    a: 9,
    'a#': 10,
    bb: 10,
    b: 11,
};

/**
 * Build the seed notes the native MIDI model is primed with. Rather than a
 * fixed C-major run regardless of intent, derive a 4-note ascending scale walk
 * from any musical key + mode mentioned in the prompt (e.g. "moody bass in F#
 * minor"). When the prompt names no key, fall back to a documented default: an
 * ascending C-major fragment in octave 4, the same notes the handler used
 * before, kept so the no-key path is unchanged.
 *
 * Pure function (prompt to seed) so it can be unit-tested without the engine.
 *
 * @returns `[pitch, velocity, startBeat, durationBeats]` tuples.
 */
export function buildSeedNotesFromPrompt(prompt: string): Array<[number, number, number, number]> {
    const lower = prompt.toLowerCase();

    // Match a key token like "c", "f#", "bb" only when followed by a mode
    // word ("major"/"minor"/"maj"/"min") so we don't grab the "c" in "chill".
    const keyMatch = /\b([a-g](?:#|b)?)\s*(?:\b)?(major|maj|minor|min)\b/.exec(lower);

    let rootPc = 0; // default root: C
    let steps: readonly number[] = MAJOR_SCALE_STEPS;

    if (keyMatch) {
        const name = keyMatch[1] ?? '';
        const mode = keyMatch[2] ?? '';
        const pc = PITCH_CLASS_BY_NAME[name];
        if (pc !== undefined) {
            rootPc = pc;
        }
        steps = mode.startsWith('min') ? MINOR_SCALE_STEPS : MAJOR_SCALE_STEPS;
    }

    const rootMidi = 60 + rootPc; // octave 4 (C4 = 60)
    const velocities = [80, 75, 85, 80];
    return [0, 1, 2, 3].map((index): [number, number, number, number] => {
        const step = steps[index % steps.length] ?? 0;
        const velocity = velocities[index] ?? 80;
        return [rootMidi + step, velocity, index * 0.5, 0.5];
    });
}
