import type { ExecutableAppActionDescriptor } from './sharedDescriptorParts';

const CHORD_QUALITIES = [
    'major',
    'minor',
    'dim',
    'aug',
    'sus2',
    'sus4',
    '7',
    'maj7',
    'min7',
    'dim7',
    'aug7',
    '6',
    'min6',
    '9',
    'add9',
    'min9',
    '7sus4',
] as const;

/** Chord-track edits change the project's harmonic reference, never a clip's notes. */
export const chordTrackDescriptors = [
    {
        actionType: 'addChordEvent',
        risk: 'bounded-reversible',
        description: 'Add one chord to the project chord track at an explicit beat.',
        intentPhrases: ['add chord', 'add a chord', 'insert chord', 'insert a chord', 'place a chord'],
        targetRules: [],
        valueRules: [
            { argument: 'beat', kind: 'number-if-present', requiredInPrompt: true, match: 'exact', connector: 'beat' },
        ],
        parameters: {
            properties: {
                beat: { type: 'number', minimum: 0, description: 'Chord start in beats (bar 1 = beat 0)' },
                root: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 11,
                    description: 'Root pitch class, C = 0 through B = 11',
                },
                quality: { type: 'string', enum: [...CHORD_QUALITIES], description: 'Chord quality' },
                duration: {
                    type: 'number',
                    minimum: 0.25,
                    description: 'Chord length in beats, at least 0.25; defaults to 4',
                },
            },
            required: ['beat', 'root', 'quality'],
        },
    },
    {
        actionType: 'clearChordTrack',
        risk: 'destructive-reversible',
        description: 'Remove every chord from the project chord track.',
        intentPhrases: ['clear chord track', 'clear the chord track', 'remove all chords', 'delete all chords'],
        targetRules: [],
        parameters: { properties: {}, required: [] },
    },
    {
        actionType: 'toggleChordTrack',
        risk: 'bounded-reversible',
        description: 'Turn the project chord track on or off without changing its chords.',
        intentPhrases: ['enable chord track', 'disable chord track', 'turn on chord track', 'turn off chord track'],
        targetRules: [],
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['enable chord track', 'turn on chord track'],
                falsePhrases: ['disable chord track', 'turn off chord track'],
            },
        ],
        parameters: {
            properties: {
                enabled: { type: 'boolean', description: 'true=enable the chord track, false=disable it' },
            },
            required: ['enabled'],
        },
    },
] as const satisfies readonly ExecutableAppActionDescriptor[];
