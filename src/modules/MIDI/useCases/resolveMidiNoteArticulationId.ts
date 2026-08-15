const LEVAIN_ARTICULATION_IDS: Readonly<Record<string, number>> = {
    sustain: 0,
    'sustain-non-vib': 1,
    'con-sordino': 2,
    flautando: 3,
    'sul-tasto': 4,
    'sul-ponticello': 5,
    harmonics: 6,
    spiccato: 7,
    staccato: 8,
    staccatissimo: 9,
    pizzicato: 10,
    'bartok-pizz': 11,
    'col-legno': 12,
    tremolo: 13,
    'trill-half': 14,
    'trill-whole': 15,
    legato: 16,
    'legato-portamento': 17,
    marcato: 18,
    sforzando: 19,
    'flutter-tongue': 20,
    'muted-straight': 21,
    'muted-cup': 22,
    'muted-harmon': 23,
    'muted-plunger': 24,
    crescendo: 25,
    decrescendo: 26,
    runs: 27,
};

type ResolveMidiNoteArticulationIdInput = {
    deviceType: string;
    articulation: string | undefined;
};

/** Canonical project-articulation projection for instruments with a per-note runtime surface. */
export function resolveMidiNoteArticulationId({
    deviceType,
    articulation,
}: ResolveMidiNoteArticulationIdInput): number | null {
    if (deviceType !== 'levain' || articulation === undefined) {
        return null;
    }
    // The name arrives from a project file, where `isValidMidiArticulation`
    // accepts any printable string. Indexing the literal directly resolves an
    // inherited name — `constructor`, `toString`, `__proto__` — to a function,
    // which is not nullish, so `?? null` would not fire and the function would
    // reach `port.postMessage` typed as a number and throw on the structured
    // clone.
    if (!Object.hasOwn(LEVAIN_ARTICULATION_IDS, articulation)) {
        return null;
    }
    return LEVAIN_ARTICULATION_IDS[articulation] ?? null;
}
