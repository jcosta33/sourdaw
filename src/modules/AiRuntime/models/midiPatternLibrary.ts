/**
 * MIDI Pattern Library — Curated preset patterns for quick insertion.
 *
 * Categories: chords, bass, drums, melody
 * Each pattern stores raw note data that can be directly inserted as a clip.
 */

// ── Types ──

export type PatternCategory = 'chords' | 'bass' | 'drums' | 'melody';

export type PatternNote = {
    pitch: number;
    velocity: number;
    startBeat: number;
    durationBeats: number;
};

export type MidiPattern = {
    id: string;
    name: string;
    category: PatternCategory;
    tags: string[];
    key?: string;
    timeSignature?: string;
    lengthBeats: number;
    notes: PatternNote[];
};

// ── Helpers ──

/** Build a chord (simultaneous notes) at a given beat */
const chord = (pitches: number[], startBeat: number, duration: number, velocity = 80): PatternNote[] =>
    pitches.map((pitch) => ({ pitch, velocity, startBeat, durationBeats: duration }));

/** Build a single note */
const n = (pitch: number, startBeat: number, duration: number, velocity = 80): PatternNote => ({
    pitch,
    velocity,
    startBeat,
    durationBeats: duration,
});

// ── Chord Progression Patterns ──

const CHORD_PATTERNS: MidiPattern[] = [
    {
        id: 'chord-pop-1564',
        name: 'Pop I–V–vi–IV',
        category: 'chords',
        tags: ['pop', 'common', 'major'],
        key: 'C',
        timeSignature: '4/4',
        lengthBeats: 16,
        notes: [
            // I — C major (bars 1)
            ...chord([60, 64, 67], 0, 4),
            // V — G major (bar 2)
            ...chord([55, 59, 62], 4, 4),
            // vi — A minor (bar 3)
            ...chord([57, 60, 64], 8, 4),
            // IV — F major (bar 4)
            ...chord([53, 57, 60], 12, 4),
        ],
    },
    {
        id: 'chord-jazz-251',
        name: 'Jazz ii–V–I',
        category: 'chords',
        tags: ['jazz', 'classic', 'major'],
        key: 'C',
        timeSignature: '4/4',
        lengthBeats: 12,
        notes: [
            // ii — Dm7
            ...chord([62, 65, 69, 72], 0, 4, 75),
            // V — G7
            ...chord([55, 59, 62, 65], 4, 4, 75),
            // I — Cmaj7
            ...chord([60, 64, 67, 71], 8, 4, 75),
        ],
    },
    {
        id: 'chord-minor-1-4-5',
        name: 'Minor i–iv–v',
        category: 'chords',
        tags: ['minor', 'dark', 'emotional'],
        key: 'Am',
        timeSignature: '4/4',
        lengthBeats: 12,
        notes: [
            // i — Am
            ...chord([57, 60, 64], 0, 4),
            // iv — Dm
            ...chord([62, 65, 69], 4, 4),
            // v — Em
            ...chord([64, 67, 71], 8, 4),
        ],
    },
    {
        id: 'chord-12bar-blues',
        name: '12-Bar Blues',
        category: 'chords',
        tags: ['blues', 'classic', 'rock'],
        key: 'C',
        timeSignature: '4/4',
        lengthBeats: 48,
        notes: [
            // I I I I  (bars 1-4)
            ...chord([60, 64, 67], 0, 4), ...chord([60, 64, 67], 4, 4),
            ...chord([60, 64, 67], 8, 4), ...chord([60, 64, 67], 12, 4),
            // IV IV I I  (bars 5-8)
            ...chord([65, 69, 72], 16, 4), ...chord([65, 69, 72], 20, 4),
            ...chord([60, 64, 67], 24, 4), ...chord([60, 64, 67], 28, 4),
            // V IV I V  (bars 9-12)
            ...chord([67, 71, 74], 32, 4), ...chord([65, 69, 72], 36, 4),
            ...chord([60, 64, 67], 40, 4), ...chord([67, 71, 74], 44, 4),
        ],
    },
    {
        id: 'chord-sad-6415',
        name: 'Sad vi–IV–I–V',
        category: 'chords',
        tags: ['emotional', 'ballad', 'pop'],
        key: 'C',
        timeSignature: '4/4',
        lengthBeats: 16,
        notes: [
            ...chord([57, 60, 64], 0, 4),   // vi — Am
            ...chord([53, 57, 60], 4, 4),   // IV — F
            ...chord([60, 64, 67], 8, 4),   // I  — C
            ...chord([55, 59, 62], 12, 4),  // V  — G
        ],
    },
    {
        id: 'chord-edm-power',
        name: 'EDM Power Chords',
        category: 'chords',
        tags: ['edm', 'electronic', 'big'],
        key: 'Am',
        timeSignature: '4/4',
        lengthBeats: 16,
        notes: [
            // A5
            ...chord([45, 57, 64], 0, 2, 100), ...chord([45, 57, 64], 2, 2, 90),
            // F5
            ...chord([41, 53, 60], 4, 2, 100), ...chord([41, 53, 60], 6, 2, 90),
            // C5
            ...chord([48, 60, 67], 8, 2, 100), ...chord([48, 60, 67], 10, 2, 90),
            // G5
            ...chord([43, 55, 62], 12, 2, 100), ...chord([43, 55, 62], 14, 2, 90),
        ],
    },
];

// ── Bass Line Patterns ──

const BASS_PATTERNS: MidiPattern[] = [
    {
        id: 'bass-walking',
        name: 'Walking Bass',
        category: 'bass',
        tags: ['jazz', 'walking', 'classic'],
        key: 'C',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(36, 0, 1, 90), n(38, 1, 1, 80), n(40, 2, 1, 85), n(41, 3, 1, 80),
            n(43, 4, 1, 90), n(41, 5, 1, 80), n(40, 6, 1, 85), n(38, 7, 1, 80),
        ],
    },
    {
        id: 'bass-octave-pump',
        name: 'Octave Pump',
        category: 'bass',
        tags: ['rock', 'driving', 'simple'],
        key: 'E',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(28, 0, 0.5, 100), n(40, 0.5, 0.5, 85),
            n(28, 1, 0.5, 100), n(40, 1.5, 0.5, 85),
            n(28, 2, 0.5, 100), n(40, 2.5, 0.5, 85),
            n(28, 3, 0.5, 100), n(40, 3.5, 0.5, 85),
            n(28, 4, 0.5, 100), n(40, 4.5, 0.5, 85),
            n(28, 5, 0.5, 100), n(40, 5.5, 0.5, 85),
            n(28, 6, 0.5, 100), n(40, 6.5, 0.5, 85),
            n(28, 7, 0.5, 100), n(40, 7.5, 0.5, 85),
        ],
    },
    {
        id: 'bass-funk-slap',
        name: 'Funk Slap',
        category: 'bass',
        tags: ['funk', 'groove', 'syncopated'],
        key: 'E',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(28, 0, 0.25, 110), n(28, 0.5, 0.25, 60), n(40, 0.75, 0.25, 95),
            n(28, 1.5, 0.25, 100), n(40, 2, 0.5, 85),
            n(28, 3, 0.25, 110), n(31, 3.5, 0.25, 80), n(33, 3.75, 0.25, 75),
            n(28, 4, 0.25, 110), n(28, 4.5, 0.25, 60), n(40, 4.75, 0.25, 95),
            n(28, 5.5, 0.25, 100), n(40, 6, 0.5, 85),
            n(28, 7, 0.25, 110), n(31, 7.5, 0.25, 80),
        ],
    },
    {
        id: 'bass-reggae-one-drop',
        name: 'Reggae One-Drop',
        category: 'bass',
        tags: ['reggae', 'dub', 'relaxed'],
        key: 'Am',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(33, 2.5, 0.5, 90),
            n(33, 3, 1, 85),
            n(33, 6.5, 0.5, 90),
            n(33, 7, 1, 85),
        ],
    },
    {
        id: 'bass-edm-sub',
        name: 'EDM Sub Bass',
        category: 'bass',
        tags: ['edm', 'electronic', 'sub'],
        key: 'A',
        timeSignature: '4/4',
        lengthBeats: 16,
        notes: [
            n(33, 0, 4, 100),  // A1 sustained
            n(29, 4, 4, 100),  // F1
            n(36, 8, 4, 100),  // C2
            n(31, 12, 4, 100), // G1
        ],
    },
];

// ── Drum Patterns ──

// GM drum map constants (used in patterns above)
const KICK = 36;
const SNARE = 38;
const CLOSED_HH = 42;
const OPEN_HH = 46;
const CLAP = 39;
const RIDE = 51;

const DRUM_PATTERNS: MidiPattern[] = [
    {
        id: 'drums-four-on-floor',
        name: '4-on-the-Floor',
        category: 'drums',
        tags: ['house', 'disco', 'edm', 'dance'],
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            // Kick on every beat
            n(KICK, 0, 0.25, 100), n(KICK, 1, 0.25, 100), n(KICK, 2, 0.25, 100), n(KICK, 3, 0.25, 100),
            n(KICK, 4, 0.25, 100), n(KICK, 5, 0.25, 100), n(KICK, 6, 0.25, 100), n(KICK, 7, 0.25, 100),
            // Clap on 2 & 4
            n(CLAP, 1, 0.25, 95), n(CLAP, 3, 0.25, 95), n(CLAP, 5, 0.25, 95), n(CLAP, 7, 0.25, 95),
            // Hihats on 8ths
            n(CLOSED_HH, 0, 0.25, 70), n(CLOSED_HH, 0.5, 0.25, 55),
            n(CLOSED_HH, 1, 0.25, 70), n(CLOSED_HH, 1.5, 0.25, 55),
            n(CLOSED_HH, 2, 0.25, 70), n(CLOSED_HH, 2.5, 0.25, 55),
            n(CLOSED_HH, 3, 0.25, 70), n(OPEN_HH, 3.5, 0.25, 65),
            n(CLOSED_HH, 4, 0.25, 70), n(CLOSED_HH, 4.5, 0.25, 55),
            n(CLOSED_HH, 5, 0.25, 70), n(CLOSED_HH, 5.5, 0.25, 55),
            n(CLOSED_HH, 6, 0.25, 70), n(CLOSED_HH, 6.5, 0.25, 55),
            n(CLOSED_HH, 7, 0.25, 70), n(OPEN_HH, 7.5, 0.25, 65),
        ],
    },
    {
        id: 'drums-breakbeat',
        name: 'Classic Breakbeat',
        category: 'drums',
        tags: ['breakbeat', 'hip-hop', 'funk'],
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            // Kick
            n(KICK, 0, 0.25, 100), n(KICK, 2.5, 0.25, 90),
            n(KICK, 4, 0.25, 100), n(KICK, 6.5, 0.25, 90),
            // Snare on 2 & 4
            n(SNARE, 1, 0.25, 100), n(SNARE, 3, 0.25, 100),
            n(SNARE, 5, 0.25, 100), n(SNARE, 7, 0.25, 100),
            // Hihats
            n(CLOSED_HH, 0, 0.25, 80), n(CLOSED_HH, 0.5, 0.25, 60),
            n(CLOSED_HH, 1, 0.25, 80), n(CLOSED_HH, 1.5, 0.25, 60),
            n(CLOSED_HH, 2, 0.25, 80), n(CLOSED_HH, 2.5, 0.25, 60),
            n(CLOSED_HH, 3, 0.25, 80), n(CLOSED_HH, 3.5, 0.25, 60),
            n(CLOSED_HH, 4, 0.25, 80), n(CLOSED_HH, 4.5, 0.25, 60),
            n(CLOSED_HH, 5, 0.25, 80), n(CLOSED_HH, 5.5, 0.25, 60),
            n(CLOSED_HH, 6, 0.25, 80), n(CLOSED_HH, 6.5, 0.25, 60),
            n(CLOSED_HH, 7, 0.25, 80), n(CLOSED_HH, 7.5, 0.25, 60),
        ],
    },
    {
        id: 'drums-bossa-nova',
        name: 'Bossa Nova',
        category: 'drums',
        tags: ['bossa', 'latin', 'jazz', 'chill'],
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            // Cross-stick on 2 & 4
            n(SNARE, 1, 0.25, 60), n(SNARE, 3, 0.25, 60),
            n(SNARE, 5, 0.25, 60), n(SNARE, 7, 0.25, 60),
            // Kick (bossa pattern)
            n(KICK, 0, 0.25, 80), n(KICK, 2.5, 0.25, 70),
            n(KICK, 4, 0.25, 80), n(KICK, 6.5, 0.25, 70),
            // Ride 8ths
            n(RIDE, 0, 0.25, 65), n(RIDE, 0.5, 0.25, 50),
            n(RIDE, 1, 0.25, 65), n(RIDE, 1.5, 0.25, 50),
            n(RIDE, 2, 0.25, 65), n(RIDE, 2.5, 0.25, 50),
            n(RIDE, 3, 0.25, 65), n(RIDE, 3.5, 0.25, 50),
            n(RIDE, 4, 0.25, 65), n(RIDE, 4.5, 0.25, 50),
            n(RIDE, 5, 0.25, 65), n(RIDE, 5.5, 0.25, 50),
            n(RIDE, 6, 0.25, 65), n(RIDE, 6.5, 0.25, 50),
            n(RIDE, 7, 0.25, 65), n(RIDE, 7.5, 0.25, 50),
        ],
    },
    {
        id: 'drums-trap-hihats',
        name: 'Trap Hi-Hats',
        category: 'drums',
        tags: ['trap', 'hip-hop', 'modern'],
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            // 808 Kick
            n(KICK, 0, 0.25, 110), n(KICK, 3.75, 0.25, 100),
            n(KICK, 4, 0.25, 110), n(KICK, 7.75, 0.25, 100),
            // Snare/Clap on 2 & 4
            n(CLAP, 1, 0.25, 100), n(CLAP, 3, 0.25, 100),
            n(CLAP, 5, 0.25, 100), n(CLAP, 7, 0.25, 100),
            // Rapid hi-hats (16ths with rolls)
            ...[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75,
                4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75,
            ].map((beat) => n(CLOSED_HH, beat, 0.125, 50 + Math.round(Math.random() * 40))),
        ],
    },
    {
        id: 'drums-jazz-swing',
        name: 'Jazz Swing',
        category: 'drums',
        tags: ['jazz', 'swing', 'classic'],
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            // Ride pattern (swing feel — quarter + swung 8th)
            n(RIDE, 0, 0.25, 80), n(RIDE, 0.67, 0.25, 55),
            n(RIDE, 1, 0.25, 80), n(RIDE, 1.67, 0.25, 55),
            n(RIDE, 2, 0.25, 80), n(RIDE, 2.67, 0.25, 55),
            n(RIDE, 3, 0.25, 80), n(RIDE, 3.67, 0.25, 55),
            n(RIDE, 4, 0.25, 80), n(RIDE, 4.67, 0.25, 55),
            n(RIDE, 5, 0.25, 80), n(RIDE, 5.67, 0.25, 55),
            n(RIDE, 6, 0.25, 80), n(RIDE, 6.67, 0.25, 55),
            n(RIDE, 7, 0.25, 80), n(RIDE, 7.67, 0.25, 55),
            // Hi-hat foot on 2 & 4
            n(CLOSED_HH, 1, 0.25, 50), n(CLOSED_HH, 3, 0.25, 50),
            n(CLOSED_HH, 5, 0.25, 50), n(CLOSED_HH, 7, 0.25, 50),
            // Kick ghosting
            n(KICK, 0, 0.25, 70), n(KICK, 4, 0.25, 70),
        ],
    },
    {
        id: 'drums-halftime',
        name: 'Half-Time Feel',
        category: 'drums',
        tags: ['cinematic', 'ambient', 'slow'],
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(KICK, 0, 0.25, 100),
            n(SNARE, 2, 0.25, 95),
            n(KICK, 4, 0.25, 100),
            n(SNARE, 6, 0.25, 95),
            // Ride 8ths
            n(RIDE, 0, 0.25, 60), n(RIDE, 0.5, 0.25, 45),
            n(RIDE, 1, 0.25, 60), n(RIDE, 1.5, 0.25, 45),
            n(RIDE, 2, 0.25, 60), n(RIDE, 2.5, 0.25, 45),
            n(RIDE, 3, 0.25, 60), n(RIDE, 3.5, 0.25, 45),
            n(RIDE, 4, 0.25, 60), n(RIDE, 4.5, 0.25, 45),
            n(RIDE, 5, 0.25, 60), n(RIDE, 5.5, 0.25, 45),
            n(RIDE, 6, 0.25, 60), n(RIDE, 6.5, 0.25, 45),
            n(RIDE, 7, 0.25, 60), n(RIDE, 7.5, 0.25, 45),
        ],
    },
];

// ── Melody / Arpeggio Patterns ──

const MELODY_PATTERNS: MidiPattern[] = [
    {
        id: 'melody-arp-cmaj',
        name: 'C Maj Arpeggio',
        category: 'melody',
        tags: ['arpeggio', 'major', 'simple'],
        key: 'C',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(60, 0, 0.5, 80), n(64, 0.5, 0.5, 75), n(67, 1, 0.5, 70), n(72, 1.5, 0.5, 75),
            n(67, 2, 0.5, 70), n(64, 2.5, 0.5, 75), n(60, 3, 0.5, 80), n(64, 3.5, 0.5, 75),
            n(60, 4, 0.5, 80), n(64, 4.5, 0.5, 75), n(67, 5, 0.5, 70), n(72, 5.5, 0.5, 75),
            n(67, 6, 0.5, 70), n(64, 6.5, 0.5, 75), n(60, 7, 0.5, 80), n(64, 7.5, 0.5, 75),
        ],
    },
    {
        id: 'melody-pentatonic-riff',
        name: 'Pentatonic Riff',
        category: 'melody',
        tags: ['riff', 'pentatonic', 'rock'],
        key: 'Am',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(57, 0, 0.5, 85), n(60, 0.5, 0.5, 80), n(62, 1, 1, 90),
            n(64, 2, 0.5, 85), n(67, 2.5, 0.5, 80), n(64, 3, 0.5, 75), n(62, 3.5, 0.5, 80),
            n(60, 4, 1, 85), n(57, 5, 0.5, 80), n(60, 5.5, 0.5, 75),
            n(62, 6, 1, 90), n(60, 7, 1, 85),
        ],
    },
    {
        id: 'melody-scale-c-major',
        name: 'C Major Scale',
        category: 'melody',
        tags: ['scale', 'major', 'educational'],
        key: 'C',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(60, 0, 1, 80), n(62, 1, 1, 80), n(64, 2, 1, 80), n(65, 3, 1, 80),
            n(67, 4, 1, 80), n(69, 5, 1, 80), n(71, 6, 1, 80), n(72, 7, 1, 80),
        ],
    },
    {
        id: 'melody-minor-arp',
        name: 'Am Arpeggio',
        category: 'melody',
        tags: ['arpeggio', 'minor', 'emotional'],
        key: 'Am',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(57, 0, 0.5, 80), n(60, 0.5, 0.5, 75), n(64, 1, 0.5, 70), n(69, 1.5, 0.5, 75),
            n(64, 2, 0.5, 70), n(60, 2.5, 0.5, 75), n(57, 3, 0.5, 80), n(60, 3.5, 0.5, 75),
            n(57, 4, 0.5, 80), n(60, 4.5, 0.5, 75), n(64, 5, 0.5, 70), n(69, 5.5, 0.5, 75),
            n(64, 6, 0.5, 70), n(60, 6.5, 0.5, 75), n(57, 7, 0.5, 80), n(60, 7.5, 0.5, 75),
        ],
    },
    {
        id: 'melody-lofi-phrase',
        name: 'Lo-Fi Melody',
        category: 'melody',
        tags: ['lofi', 'chill', 'jazzy'],
        key: 'Dm',
        timeSignature: '4/4',
        lengthBeats: 8,
        notes: [
            n(65, 0, 1, 70), n(69, 1, 0.5, 65), n(72, 1.5, 1.5, 60),
            n(70, 3, 0.5, 65), n(69, 3.5, 0.5, 70),
            n(65, 4, 1, 75), n(67, 5, 0.5, 65), n(69, 5.5, 1, 60),
            n(67, 6.5, 0.5, 65), n(65, 7, 1, 70),
        ],
    },
];

// ── Exports ──

export const ALL_PATTERNS: MidiPattern[] = [
    ...CHORD_PATTERNS,
    ...BASS_PATTERNS,
    ...DRUM_PATTERNS,
    ...MELODY_PATTERNS,
];

export const PATTERN_CATEGORIES: { id: PatternCategory; label: string }[] = [
    { id: 'chords', label: 'Chords' },
    { id: 'bass', label: 'Bass' },
    { id: 'drums', label: 'Drums' },
    { id: 'melody', label: 'Melody' },
];

export function searchPatterns(query: string, category?: PatternCategory): MidiPattern[] {
    const q = query.toLowerCase().trim();
    let results = ALL_PATTERNS;

    if (category) {
        results = results.filter((p) => p.category === category);
    }

    if (q) {
        results = results.filter(
            (p) =>
                p.name.toLowerCase().includes(q) ||
                p.tags.some((t) => t.includes(q)) ||
                (p.key && p.key.toLowerCase().includes(q))
        );
    }

    return results;
}
