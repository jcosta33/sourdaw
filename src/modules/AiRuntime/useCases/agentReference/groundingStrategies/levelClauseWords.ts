/**
 * Verbs that carry a level whose own phrase follows the target: "make Drums 3 dB quieter". "Set" and the
 * other verbs that set any value are read by `isGenericDeviceIntent`, not here.
 */
export const LEVEL_CARRIER_VERBS: readonly string[] = ['make'];

/** The prepositions that join a level noun to the object it belongs to: "the volume on the Drums". */
export const LEVEL_NOUN_PREPOSITIONS: ReadonlySet<string> = new Set(['of', 'on', 'for']);

/**
 * The kinds of song section a request names a stretch of the song by, in normalized singular words:
 * "lower Drums in the chorus by 3 dB". A level clause naming one asks for that stretch, never the whole
 * fader, whether or not the project has such a section.
 */
export const SONG_SECTION_NOUNS: readonly string[] = [
    'intro',
    'verse',
    'prechorus',
    'chorus',
    'refrain',
    'hook',
    'bridge',
    'breakdown',
    'buildup',
    'drop',
    'interlude',
    'outro',
    'section',
];

/**
 * The words that name a device's own control or processing rather than a track's fader, in normalized
 * singular words: "put Drums threshold at -6 dB", "set Drums to -6 dB of gain reduction", "put Drums at
 * -6 dB on the high shelf", "set Drums to normalize at -6 dB". A level clause naming one is about that
 * control, never the fader. "Frequency" needs no entry: it is a word of a metric's name, which a level
 * clause refuses as well.
 */
export const DEVICE_CONTROL_WORDS: readonly string[] = [
    'threshold',
    'ratio',
    'attack',
    'release',
    'knee',
    'makeup',
    'reduction',
    'shelf',
    'filter',
    'cutoff',
    'resonance',
    'eq',
    'compress',
    'compressor',
    'compression',
    'limit',
    'limiter',
    'normalize',
    'normalise',
    'drive',
    'saturation',
    'decay',
    'feedback',
    'width',
    'wet',
    'dry',
];
