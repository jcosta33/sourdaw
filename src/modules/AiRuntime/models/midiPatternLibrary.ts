/**
 * MIDI Pattern Library — Algorithmic pattern generation from templates.
 *
 * Templates define abstract musical recipes. The generator applies user
 * parameters (key, scale, density, complexity) to produce concrete MIDI on-the-fly.
 */

// ── Scale / Key Theory ──

export const ALL_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type KeyName = (typeof ALL_KEYS)[number];

export const SCALE_TYPES = [
    'major',
    'minor',
    'pentatonic-major',
    'pentatonic-minor',
    'blues',
    'dorian',
    'mixolydian',
    'harmonic-minor',
    'chromatic',
] as const;
export type ScaleType = (typeof SCALE_TYPES)[number];

export const SCALE_LABELS: Record<ScaleType, string> = {
    major: 'Major',
    minor: 'Natural Minor',
    'pentatonic-major': 'Pentatonic Maj',
    'pentatonic-minor': 'Pentatonic Min',
    blues: 'Blues',
    dorian: 'Dorian',
    mixolydian: 'Mixolydian',
    'harmonic-minor': 'Harmonic Minor',
    chromatic: 'Chromatic',
};

const KEY_SEMITONES: Record<string, number> = {
    C: 0,
    'C#': 1,
    D: 2,
    Eb: 3,
    E: 4,
    F: 5,
    'F#': 6,
    G: 7,
    Ab: 8,
    A: 9,
    Bb: 10,
    B: 11,
};

/** Interval patterns (semitones from root) for each scale */
const SCALE_INTERVALS: Record<ScaleType, number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    'pentatonic-major': [0, 2, 4, 7, 9],
    'pentatonic-minor': [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** Get MIDI pitches for a scale across a note range */
export function getScalePitches(key: KeyName, scale: ScaleType, low = 36, high = 96): number[] {
    const root = KEY_SEMITONES[key] ?? 0;
    const intervals = SCALE_INTERVALS[scale];
    const pitches: number[] = [];
    for (let midi = low; midi <= high; midi++) {
        if (intervals.includes((midi - root + 120) % 12)) {
            pitches.push(midi);
        }
    }
    return pitches;
}

/** Snap a pitch to the nearest scale tone */
function snapToScale(pitch: number, scalePitches: number[]): number {
    let best = scalePitches[0]!;
    for (const sp of scalePitches) {
        if (Math.abs(sp - pitch) < Math.abs(best - pitch)) {
            best = sp;
        }
    }
    return best;
}

// ── Types ──

export type PatternCategory = 'chords' | 'bass' | 'drums' | 'melody';
export type PatternGenre =
    | 'pop'
    | 'rock'
    | 'jazz'
    | 'blues'
    | 'edm'
    | 'hip-hop'
    | 'r&b'
    | 'funk'
    | 'latin'
    | 'reggae'
    | 'country'
    | 'metal'
    | 'classical'
    | 'ambient'
    | 'lo-fi'
    | 'trap'
    | 'house'
    | 'techno'
    | 'disco'
    | 'soul'
    | 'gospel'
    | 'cinematic'
    | 'synthwave'
    | 'dnb'
    | 'afrobeat'
    | 'world';

export type PatternNote = { pitch: number; velocity: number; startBeat: number; durationBeats: number };

export type GenerationParams = {
    key: KeyName;
    scale: ScaleType;
    density: number; // 1-10, how many notes
    complexity: number; // 1-10, rhythmic/harmonic complexity
};

/** Abstract template — degree-based, key-agnostic */
export type PatternTemplate = {
    id: string;
    name: string;
    category: PatternCategory;
    genres: PatternGenre[];
    tags: string[];
    description: string;
    /** Generator: produces notes given params. */
    generate: (params: GenerationParams) => PatternNote[];
    lengthBeats: number;
};

export const PATTERN_CATEGORIES: { id: PatternCategory; label: string }[] = [
    { id: 'chords', label: 'Chords' },
    { id: 'bass', label: 'Bass' },
    { id: 'drums', label: 'Drums' },
    { id: 'melody', label: 'Melody' },
];

export const ALL_GENRES: { id: PatternGenre; label: string }[] = [
    { id: 'pop', label: 'Pop' },
    { id: 'rock', label: 'Rock' },
    { id: 'jazz', label: 'Jazz' },
    { id: 'blues', label: 'Blues' },
    { id: 'edm', label: 'EDM' },
    { id: 'hip-hop', label: 'Hip-Hop' },
    { id: 'r&b', label: 'R&B' },
    { id: 'funk', label: 'Funk' },
    { id: 'latin', label: 'Latin' },
    { id: 'reggae', label: 'Reggae' },
    { id: 'country', label: 'Country' },
    { id: 'metal', label: 'Metal' },
    { id: 'classical', label: 'Classical' },
    { id: 'ambient', label: 'Ambient' },
    { id: 'lo-fi', label: 'Lo-Fi' },
    { id: 'trap', label: 'Trap' },
    { id: 'house', label: 'House' },
    { id: 'techno', label: 'Techno' },
    { id: 'disco', label: 'Disco' },
    { id: 'soul', label: 'Soul' },
    { id: 'gospel', label: 'Gospel' },
    { id: 'cinematic', label: 'Cinematic' },
    { id: 'synthwave', label: 'Synthwave' },
    { id: 'dnb', label: 'DnB' },
    { id: 'afrobeat', label: 'Afrobeat' },
    { id: 'world', label: 'World' },
];

// ── Generator helpers ──

/** Build chord from scale degrees (0-indexed) at a beat */
function chordFromDegrees(
    degrees: number[],
    scalePitches: number[],
    octaveBase: number,
    beat: number,
    dur: number,
    vel = 80
): PatternNote[] {
    return degrees.map((deg) => {
        const idx = Math.min(deg + octaveBase, scalePitches.length - 1);
        return { pitch: scalePitches[Math.max(0, idx)]!, velocity: vel, startBeat: beat, durationBeats: dur };
    });
}

/** GM Drum constants */
const KK = 36,
    SN = 38,
    CH = 42,
    OH = 46,
    CL = 39,
    RD = 51;

// ══════════════════════════════════════════════════════════════════════════
// TEMPLATES
// ══════════════════════════════════════════════════════════════════════════

export const PATTERN_TEMPLATES: PatternTemplate[] = [
    // ── CHORDS ──
    {
        id: 'ch-1564',
        name: 'I–V–vi–IV (Pop)',
        category: 'chords',
        genres: ['pop', 'rock'],
        tags: ['anthem', 'common'],
        description: 'The most common pop progression',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            const d = p.density > 5 ? 2 : 4;
            const beats = Array.from({ length: 16 / d }, (_, i) => i * d);
            const degs = [
                [0, 2, 4],
                [4, 6, 8],
                [5, 7, 9],
                [3, 5, 7],
            ];
            return beats.flatMap((b, i) =>
                chordFromDegrees(
                    p.complexity > 5 ? [...degs[i % 4]!, degs[i % 4]![0]! + 7] : degs[i % 4]!,
                    sp,
                    o,
                    b,
                    d,
                    75 + p.density * 2
                )
            );
        },
    },
    {
        id: 'ch-251',
        name: 'ii–V–I (Jazz)',
        category: 'chords',
        genres: ['jazz', 'lo-fi', 'soul'],
        tags: ['classic', 'smooth'],
        description: 'Classic jazz cadence',
        lengthBeats: 12,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            return [
                [1, 3, 5, 7],
                [4, 6, 8, 10],
                [0, 2, 4, 6],
            ].flatMap((deg, i) =>
                chordFromDegrees(p.complexity > 5 ? deg : deg.slice(0, 3), sp, o, i * 4, 4, 72 + p.density * 2)
            );
        },
    },
    {
        id: 'ch-minor145',
        name: 'i–iv–v (Minor)',
        category: 'chords',
        genres: ['rock', 'pop', 'metal'],
        tags: ['dark', 'moody'],
        description: 'Classic minor progression',
        lengthBeats: 12,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale === 'major' ? 'minor' : p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(57, sp)) - 0);
            return [
                [0, 2, 4],
                [3, 5, 7],
                [4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 78));
        },
    },
    {
        id: 'ch-blues12',
        name: '12-Bar Blues',
        category: 'chords',
        genres: ['blues', 'rock', 'jazz'],
        tags: ['classic', 'shuffle'],
        description: '12-bar blues form',
        lengthBeats: 48,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'blues', 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            const pat = [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4];
            return pat.flatMap((root, i) => chordFromDegrees([root, root + 2, root + 4], sp, o, i * 4, 4, 78));
        },
    },
    {
        id: 'ch-sad',
        name: 'vi–IV–I–V (Sad)',
        category: 'chords',
        genres: ['pop', 'r&b', 'soul'],
        tags: ['ballad', 'emotional'],
        description: 'Emotional descending progression',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            return [
                [5, 7, 9],
                [3, 5, 7],
                [0, 2, 4],
                [4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 75));
        },
    },
    {
        id: 'ch-andalusian',
        name: 'Andalusian Cadence',
        category: 'chords',
        genres: ['classical', 'world', 'metal'],
        tags: ['flamenco', 'dramatic'],
        description: 'Spanish cadence i–VII–VI–V',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'harmonic-minor', 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(57, sp)) - 0);
            return [
                [0, 2, 4],
                [6, 8, 10],
                [5, 7, 9],
                [4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 80));
        },
    },
    {
        id: 'ch-dorian',
        name: 'Dorian Vamp',
        category: 'chords',
        genres: ['funk', 'jazz', 'r&b'],
        tags: ['groove', 'modal'],
        description: 'Two-chord dorian groove',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'dorian', 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(62, sp)) - 0);
            return [
                [0, 2, 4, 6],
                [5, 7, 9, 11],
            ].flatMap((deg, i) => chordFromDegrees(p.complexity > 5 ? deg : deg.slice(0, 3), sp, o, i * 4, 4, 78));
        },
    },
    {
        id: 'ch-edm',
        name: 'EDM Power',
        category: 'chords',
        genres: ['edm', 'house', 'techno'],
        tags: ['big', 'anthem'],
        description: 'Big EDM chord stabs',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale === 'major' ? 'minor' : p.scale, 36, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(45, sp)) - 0);
            return [0, 3, 5, 4].flatMap((root, i) => {
                const deg = [root, root + 2, root + 4];
                const b = i * 4;
                return [...chordFromDegrees(deg, sp, o, b, 2, 100), ...chordFromDegrees(deg, sp, o, b + 2, 2, 90)];
            });
        },
    },
    {
        id: 'ch-gospel',
        name: 'Gospel IV–vi–iii',
        category: 'chords',
        genres: ['gospel', 'soul', 'r&b'],
        tags: ['worship', 'uplifting'],
        description: 'Gospel praise progression',
        lengthBeats: 12,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            return [
                [3, 5, 7, 9],
                [5, 7, 9, 11],
                [2, 4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(p.complexity > 5 ? deg : deg.slice(0, 3), sp, o, i * 4, 4, 82));
        },
    },
    {
        id: 'ch-trap',
        name: 'Trap Minor',
        category: 'chords',
        genres: ['trap', 'hip-hop'],
        tags: ['dark', '808'],
        description: 'Dark minor trap chords',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 36, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(48, sp)) - 0);
            return [0, 6, 5, 4].flatMap((root, i) => chordFromDegrees([root, root + 2, root + 4], sp, o, i * 4, 4, 85));
        },
    },
    {
        id: 'ch-synthpad',
        name: 'Synthwave Pad',
        category: 'chords',
        genres: ['synthwave', 'ambient', 'cinematic'],
        tags: ['pad', 'atmospheric'],
        description: 'Atmospheric synth pads',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(57, sp)) - 0);
            return [
                [0, 2, 4, 7],
                [3, 5, 7, 10],
                [4, 6, 8, 11],
                [2, 4, 6, 9],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 68));
        },
    },
    {
        id: 'ch-reggae',
        name: 'Reggae Skank',
        category: 'chords',
        genres: ['reggae', 'world'],
        tags: ['offbeat', 'island'],
        description: 'Offbeat reggae chords',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 60, 84);
            const o = 0;
            return [
                [0, 2, 4],
                [4, 6, 8],
                [5, 7, 9],
                [3, 5, 7],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 2 + 0.5, 0.5, 75));
        },
    },
    {
        id: 'ch-country',
        name: 'Country I–IV–V',
        category: 'chords',
        genres: ['country', 'rock', 'pop'],
        tags: ['simple', 'classic'],
        description: 'Simple three-chord country',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(55, sp)) - 0);
            return [
                [0, 2, 4],
                [0, 2, 4],
                [3, 5, 7],
                [4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 80));
        },
    },
    {
        id: 'ch-disco',
        name: 'Disco Groove',
        category: 'chords',
        genres: ['disco', 'funk', 'house'],
        tags: ['danceable', 'retro'],
        description: 'Rhythmic disco chords',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 60, 84);
            const o = 0;
            const notes: PatternNote[] = [];
            for (const [i, deg] of [
                [0, 2, 4],
                [5, 7, 9],
                [3, 5, 7],
                [4, 6, 8],
            ].entries()) {
                notes.push(...chordFromDegrees(deg, sp, o, i * 2, 1, 80));
                notes.push(...chordFromDegrees(deg, sp, o, i * 2 + 1, 0.5, 65));
            }
            return notes;
        },
    },
    {
        id: 'ch-dnb',
        name: 'DnB Stab',
        category: 'chords',
        genres: ['dnb', 'edm'],
        tags: ['stab', 'energy'],
        description: 'Quick synth stabs',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 60, 84);
            const o = 0;
            return [
                [0, 2, 4],
                [3, 5, 7],
                [4, 6, 8],
            ].flatMap((deg, i) => [
                ...chordFromDegrees(deg, sp, o, i * 2.5, 0.25, 100),
                ...chordFromDegrees(deg, sp, o, i * 2.5 + 1.5, 0.25, 85),
            ]);
        },
    },

    // ── BASS ──
    {
        id: 'bs-walking',
        name: 'Walking Bass',
        category: 'bass',
        genres: ['jazz', 'blues'],
        tags: ['classic', 'smooth'],
        description: 'Stepwise jazz walking bass',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 28, 55);
            const mid = Math.floor(sp.length / 2);
            const notes: PatternNote[] = [];
            let idx = mid;
            for (let b = 0; b < 8; b++) {
                notes.push({
                    pitch: sp[idx]!,
                    velocity: 80 + Math.round(p.density * 2),
                    startBeat: b,
                    durationBeats: 1,
                });
                idx += b < 4 ? 1 : -1;
                idx = Math.max(0, Math.min(sp.length - 1, idx));
            }
            return notes;
        },
    },
    {
        id: 'bs-octpump',
        name: 'Octave Pump',
        category: 'bass',
        genres: ['rock', 'metal'],
        tags: ['driving', 'power'],
        description: 'Root-octave pump pattern',
        lengthBeats: 4,
        generate: (p) => {
            const root = (KEY_SEMITONES[p.key] ?? 0) + 28;
            const step = p.density > 5 ? 0.25 : 0.5;
            const notes: PatternNote[] = [];
            for (let b = 0; b < 4; b += step) {
                notes.push({
                    pitch: b % (step * 2) < step ? root : root + 12,
                    velocity: b % (step * 2) < step ? 100 : 85,
                    startBeat: b,
                    durationBeats: step,
                });
            }
            return notes;
        },
    },
    {
        id: 'bs-funkslap',
        name: 'Funk Slap',
        category: 'bass',
        genres: ['funk', 'r&b', 'disco'],
        tags: ['groove', 'slap'],
        description: 'Syncopated funk bass',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'pentatonic-minor', 28, 48);
            const r = sp[0]!;
            return [
                { pitch: r, velocity: 110, startBeat: 0, durationBeats: 0.25 },
                { pitch: r + 12, velocity: 95, startBeat: 0.75, durationBeats: 0.25 },
                { pitch: r, velocity: 100, startBeat: 1.5, durationBeats: 0.25 },
                { pitch: r + 12, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: r, velocity: 110, startBeat: 3, durationBeats: 0.25 },
                { pitch: sp[1]!, velocity: 80, startBeat: 3.5, durationBeats: 0.25 },
            ];
        },
    },
    {
        id: 'bs-sub',
        name: 'Sub Bass',
        category: 'bass',
        genres: ['edm', 'house', 'techno', 'trap'],
        tags: ['sub', 'sustained'],
        description: 'Long sustained sub bass notes',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 28, 48);
            return [0, 3, 5, 4].map((deg, i) => ({
                pitch: sp[Math.min(deg, sp.length - 1)]!,
                velocity: 100,
                startBeat: i * 4,
                durationBeats: 4,
            }));
        },
    },
    {
        id: 'bs-hiphop',
        name: 'Hip-Hop Bounce',
        category: 'bass',
        genres: ['hip-hop', 'trap', 'r&b'],
        tags: ['bounce', '808'],
        description: '808-style bouncy bass',
        lengthBeats: 4,
        generate: (p) => {
            const root = (KEY_SEMITONES[p.key] ?? 0) + 36;
            return [
                { pitch: root, velocity: 110, startBeat: 0, durationBeats: 1.5 },
                { pitch: root, velocity: 90, startBeat: 2, durationBeats: 0.25 },
                { pitch: root - 2, velocity: 85, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: root, velocity: 100, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'bs-latin',
        name: 'Latin Tumbao',
        category: 'bass',
        genres: ['latin', 'afrobeat', 'world'],
        tags: ['tumbao', 'salsa'],
        description: 'Salsa/Latin tumbao bass',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 28, 55);
            const r = sp[0]!;
            return [
                { pitch: r, velocity: 90, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 80, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 85, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: r, velocity: 90, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'bs-reggae',
        name: 'Reggae Drop',
        category: 'bass',
        genres: ['reggae', 'world'],
        tags: ['offbeat', 'dub'],
        description: 'Reggae one-drop bass',
        lengthBeats: 4,
        generate: (p) => {
            const root = (KEY_SEMITONES[p.key] ?? 0) + 33;
            return [
                { pitch: root, velocity: 90, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: root, velocity: 85, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'bs-metal',
        name: 'Metal Gallop',
        category: 'bass',
        genres: ['metal', 'rock'],
        tags: ['aggressive', 'chug'],
        description: 'Galloping metal bass',
        lengthBeats: 4,
        generate: (p) => {
            const root = (KEY_SEMITONES[p.key] ?? 0) + 28;
            const notes: PatternNote[] = [];
            for (let b = 0; b < 4; b++) {
                notes.push({ pitch: root, velocity: 110, startBeat: b, durationBeats: 0.25 });
                notes.push({ pitch: root, velocity: 80, startBeat: b + 0.25, durationBeats: 0.25 });
                notes.push({ pitch: root, velocity: 110, startBeat: b + 0.5, durationBeats: 0.25 });
            }
            return notes;
        },
    },
    {
        id: 'bs-ambient',
        name: 'Ambient Drone',
        category: 'bass',
        genres: ['ambient', 'cinematic'],
        tags: ['pad', 'atmospheric'],
        description: 'Single sustained drone note',
        lengthBeats: 16,
        generate: (p) => {
            const root = (KEY_SEMITONES[p.key] ?? 0) + 36;
            return [{ pitch: root, velocity: 55 + p.density * 3, startBeat: 0, durationBeats: 16 }];
        },
    },
    {
        id: 'bs-disco',
        name: 'Disco Bass',
        category: 'bass',
        genres: ['disco', 'funk', 'house'],
        tags: ['groove', 'danceable'],
        description: 'Groovy disco bass line',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 28, 55);
            const r = sp[0]!;
            return [
                { pitch: r, velocity: 95, startBeat: 0, durationBeats: 0.5 },
                { pitch: r, velocity: 70, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: r, velocity: 95, startBeat: 1, durationBeats: 0.5 },
                { pitch: r, velocity: 70, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: r, velocity: 95, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 80, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 85, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[5] || sp[4]!, velocity: 80, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
    {
        id: 'bs-country',
        name: 'Country Root-Fifth',
        category: 'bass',
        genres: ['country', 'pop'],
        tags: ['simple', 'classic'],
        description: 'Simple root-fifth alternation',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 28, 55);
            return [
                { pitch: sp[0]!, velocity: 90, startBeat: 0, durationBeats: 1 },
                { pitch: sp[0]!, velocity: 80, startBeat: 1, durationBeats: 1 },
                { pitch: sp[4] || sp[3]!, velocity: 85, startBeat: 2, durationBeats: 1 },
                { pitch: sp[4] || sp[3]!, velocity: 80, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'bs-dnb',
        name: 'DnB Reese',
        category: 'bass',
        genres: ['dnb', 'edm'],
        tags: ['reese', 'dark'],
        description: 'Aggressive DnB bass pattern',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 28, 48);
            return [
                { pitch: sp[0]!, velocity: 100, startBeat: 0, durationBeats: 1.5 },
                { pitch: sp[Math.min(6, sp.length - 1)]!, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 90, startBeat: 3, durationBeats: 1 },
                { pitch: sp[Math.min(3, sp.length - 1)]!, velocity: 100, startBeat: 4, durationBeats: 1.5 },
                { pitch: sp[0]!, velocity: 85, startBeat: 6, durationBeats: 0.5 },
                { pitch: sp[Math.min(6, sp.length - 1)]!, velocity: 90, startBeat: 7, durationBeats: 1 },
            ];
        },
    },

    // ── DRUMS (key-agnostic) ──
    {
        id: 'dr-4floor',
        name: '4-on-the-Floor',
        category: 'drums',
        genres: ['house', 'disco', 'edm', 'techno'],
        tags: ['dance', 'classic'],
        description: 'Standard dance beat',
        lengthBeats: 4,
        generate: (p) => {
            const notes: PatternNote[] = [];
            for (let b = 0; b < 4; b++) {
                notes.push({ pitch: KK, velocity: 100, startBeat: b, durationBeats: 0.25 });
                if (b % 2 === 1) {
                    notes.push({ pitch: CL, velocity: 95, startBeat: b, durationBeats: 0.25 });
                }
            }
            const step = p.density > 7 ? 0.25 : 0.5;
            for (let b = 0; b < 4; b += step) {
                notes.push({ pitch: CH, velocity: b % 1 === 0 ? 70 : 55, startBeat: b, durationBeats: step / 2 });
            }
            return notes;
        },
    },
    {
        id: 'dr-breakbeat',
        name: 'Breakbeat',
        category: 'drums',
        genres: ['hip-hop', 'funk', 'breakbeat' as PatternGenre],
        tags: ['funky', 'classic'],
        description: 'Classic breakbeat groove',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 100, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 90, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: SN, velocity: 100, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 100, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 0, durationBeats: 0.25 },
            { pitch: CH, velocity: 60, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 60, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 60, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 60, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-trap',
        name: 'Trap Beat',
        category: 'drums',
        genres: ['trap', 'hip-hop'],
        tags: ['808', 'modern'],
        description: 'Trap with rapid hi-hats',
        lengthBeats: 4,
        generate: (p) => {
            const notes: PatternNote[] = [
                { pitch: KK, velocity: 110, startBeat: 0, durationBeats: 0.25 },
                { pitch: KK, velocity: 100, startBeat: 3.75, durationBeats: 0.25 },
                { pitch: CL, velocity: 100, startBeat: 1, durationBeats: 0.25 },
                { pitch: CL, velocity: 100, startBeat: 3, durationBeats: 0.25 },
            ];
            const step = p.density > 7 ? 0.125 : 0.25;
            for (let b = 0; b < 4; b += step) {
                notes.push({
                    pitch: CH,
                    velocity: 50 + Math.round(p.complexity * 4),
                    startBeat: b,
                    durationBeats: step / 2,
                });
            }
            return notes;
        },
    },
    {
        id: 'dr-jazz',
        name: 'Jazz Swing',
        category: 'drums',
        genres: ['jazz'],
        tags: ['swing', 'ride'],
        description: 'Swing ride pattern',
        lengthBeats: 4,
        generate: () => [
            { pitch: RD, velocity: 80, startBeat: 0, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 0.67, durationBeats: 0.25 },
            { pitch: RD, velocity: 80, startBeat: 1, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 1.67, durationBeats: 0.25 },
            { pitch: RD, velocity: 80, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 2.67, durationBeats: 0.25 },
            { pitch: RD, velocity: 80, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 3.67, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 3, durationBeats: 0.25 },
            { pitch: KK, velocity: 70, startBeat: 0, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-bossa',
        name: 'Bossa Nova',
        category: 'drums',
        genres: ['latin', 'jazz'],
        tags: ['brazilian', 'chill'],
        description: 'Bossa nova groove',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 80, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 70, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: SN, velocity: 60, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 60, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 65, startBeat: 0, durationBeats: 0.25 },
            { pitch: RD, velocity: 50, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 65, startBeat: 1, durationBeats: 0.25 },
            { pitch: RD, velocity: 50, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 65, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 50, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 65, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 50, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-halftime',
        name: 'Half-Time',
        category: 'drums',
        genres: ['cinematic', 'ambient', 'pop'],
        tags: ['slow', 'spacious'],
        description: 'Half-time feel',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 100, startBeat: 0, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 60, startBeat: 0, durationBeats: 0.25 },
            { pitch: RD, velocity: 45, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 60, startBeat: 1, durationBeats: 0.25 },
            { pitch: RD, velocity: 45, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 60, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 45, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 60, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 45, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-reggae',
        name: 'Reggae One-Drop',
        category: 'drums',
        genres: ['reggae', 'world'],
        tags: ['offbeat', 'island'],
        description: 'Reggae one-drop groove',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 90, startBeat: 2, durationBeats: 0.25 },
            { pitch: SN, velocity: 70, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-dnb',
        name: 'DnB Two-Step',
        category: 'drums',
        genres: ['dnb', 'edm'],
        tags: ['fast', 'energy'],
        description: 'Fast DnB two-step beat',
        lengthBeats: 4,
        generate: (p) => {
            const notes: PatternNote[] = [
                { pitch: KK, velocity: 110, startBeat: 0, durationBeats: 0.25 },
                { pitch: KK, velocity: 100, startBeat: 2.75, durationBeats: 0.25 },
                { pitch: SN, velocity: 100, startBeat: 0.5, durationBeats: 0.25 },
                { pitch: SN, velocity: 100, startBeat: 2, durationBeats: 0.25 },
            ];
            const step = p.density > 5 ? 0.25 : 0.5;
            for (let b = 0; b < 4; b += step) {
                notes.push({ pitch: CH, velocity: 75, startBeat: b, durationBeats: step / 2 });
            }
            return notes;
        },
    },
    {
        id: 'dr-metal',
        name: 'Blast Beat',
        category: 'drums',
        genres: ['metal'],
        tags: ['extreme', 'fast'],
        description: 'Extreme blast beat',
        lengthBeats: 4,
        generate: () =>
            Array.from({ length: 16 }, (_, i) => [
                { pitch: KK, velocity: 100, startBeat: i * 0.25, durationBeats: 0.125 },
                { pitch: SN, velocity: 95, startBeat: i * 0.25, durationBeats: 0.125 },
                { pitch: CH, velocity: 80, startBeat: i * 0.25, durationBeats: 0.125 },
            ]).flat(),
    },
    {
        id: 'dr-afrobeat',
        name: 'Afrobeat',
        category: 'drums',
        genres: ['afrobeat', 'world'],
        tags: ['african', 'polyrhythmic'],
        description: 'Afrobeat polyrhythmic groove',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 90, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 85, startBeat: 2, durationBeats: 0.25 },
            { pitch: KK, velocity: 80, startBeat: 3, durationBeats: 0.25 },
            { pitch: SN, velocity: 90, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 75, startBeat: 3.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 0, durationBeats: 0.25 },
            { pitch: OH, velocity: 60, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 55, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 2, durationBeats: 0.25 },
            { pitch: OH, velocity: 60, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 55, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-synthwave',
        name: 'Synthwave Beat',
        category: 'drums',
        genres: ['synthwave', 'pop', 'cinematic'],
        tags: ['retro', '80s'],
        description: '80s-style electronic beat',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 100, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 90, startBeat: 3, durationBeats: 0.25 },
            { pitch: CL, velocity: 95, startBeat: 1, durationBeats: 0.25 },
            { pitch: CL, velocity: 95, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 0, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-gospel',
        name: 'Gospel Groove',
        category: 'drums',
        genres: ['gospel', 'soul', 'r&b'],
        tags: ['worship', 'ride'],
        description: 'Gospel ride pattern',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 95, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 80, startBeat: 1.75, durationBeats: 0.25 },
            { pitch: KK, velocity: 85, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 70, startBeat: 0, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 70, startBeat: 1, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 70, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 70, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-country',
        name: 'Country Train',
        category: 'drums',
        genres: ['country', 'rock'],
        tags: ['train', 'twang'],
        description: 'Country train beat',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 90, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 85, startBeat: 2, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 0, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-blues',
        name: 'Blues Shuffle',
        category: 'drums',
        genres: ['blues', 'rock'],
        tags: ['shuffle', 'triplet'],
        description: 'Shuffled blues beat',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 90, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 85, startBeat: 2, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 0, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 0.67, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 1.67, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 2.67, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 3.67, durationBeats: 0.25 },
        ],
    },

    // ── MELODY ──
    {
        id: 'ml-arpmaj',
        name: 'Major Arpeggio',
        category: 'melody',
        genres: ['pop', 'edm', 'classical'],
        tags: ['arpeggio', 'bright'],
        description: 'Ascending/descending arpeggio',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 60, 84);
            const pattern = p.complexity > 5 ? [0, 2, 4, 7, 4, 2, 0, 2] : [0, 2, 4, 7, 4, 2, 0, 2];
            return pattern.map((deg, i) => ({
                pitch: sp[Math.min(deg, sp.length - 1)]!,
                velocity: 75 + p.density,
                startBeat: i * 0.5,
                durationBeats: 0.5,
            }));
        },
    },
    {
        id: 'ml-arpmin',
        name: 'Minor Arpeggio',
        category: 'melody',
        genres: ['pop', 'r&b', 'cinematic'],
        tags: ['arpeggio', 'dark'],
        description: 'Minor arpeggio pattern',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale === 'major' ? 'minor' : p.scale, 57, 84);
            return [0, 2, 4, 7, 4, 2, 0, 2].map((deg, i) => ({
                pitch: sp[Math.min(deg, sp.length - 1)]!,
                velocity: 75 + p.density,
                startBeat: i * 0.5,
                durationBeats: 0.5,
            }));
        },
    },
    {
        id: 'ml-scale',
        name: 'Scale Run',
        category: 'melody',
        genres: ['classical', 'pop'],
        tags: ['scale', 'educational'],
        description: 'Ascending scale run',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 60, 84);
            return sp.slice(0, 8).map((pitch, i) => ({ pitch, velocity: 80, startBeat: i, durationBeats: 1 }));
        },
    },
    {
        id: 'ml-pent',
        name: 'Pentatonic Riff',
        category: 'melody',
        genres: ['rock', 'blues'],
        tags: ['riff', 'guitar'],
        description: 'Pentatonic rock riff',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'pentatonic-minor', 57, 79);
            return [
                { pitch: sp[0]!, velocity: 85, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[2]!, velocity: 80, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 90, startBeat: 1, durationBeats: 1 },
                { pitch: sp[4]!, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[Math.min(6, sp.length - 1)]!, velocity: 80, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 80, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
    {
        id: 'ml-blues',
        name: 'Blues Lick',
        category: 'melody',
        genres: ['blues', 'rock'],
        tags: ['lick', 'classic'],
        description: 'Classic blues guitar lick',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'blues', 57, 79);
            return [
                { pitch: sp[2]!, velocity: 85, startBeat: 0, durationBeats: 0.25 },
                { pitch: sp[3]!, velocity: 80, startBeat: 0.25, durationBeats: 0.25 },
                { pitch: sp[4]!, velocity: 90, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[2]!, velocity: 75, startBeat: 1, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 80, startBeat: 1.5, durationBeats: 1 },
                { pitch: sp[2]!, velocity: 75, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 85, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'ml-edm',
        name: 'EDM Arp',
        category: 'melody',
        genres: ['edm', 'house', 'techno'],
        tags: ['arpeggio', 'electronic'],
        description: 'Fast electronic arpeggio',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale === 'major' ? 'minor' : p.scale, 57, 84);
            const step = p.density > 7 ? 0.125 : 0.25;
            const notes: PatternNote[] = [];
            const degs = [0, 2, 4, 7];
            for (let b = 0; b < 4; b += step) {
                notes.push({
                    pitch: sp[Math.min(degs[Math.floor(b / step) % 4]!, sp.length - 1)]!,
                    velocity: 75 + p.density * 2,
                    startBeat: b,
                    durationBeats: step,
                });
            }
            return notes;
        },
    },
    {
        id: 'ml-lofi',
        name: 'Lo-Fi Melody',
        category: 'melody',
        genres: ['lo-fi', 'jazz', 'hip-hop'],
        tags: ['chill', 'jazzy'],
        description: 'Relaxed lo-fi jazz melody',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'dorian', 60, 84);
            return [
                { pitch: sp[4]!, velocity: 70, startBeat: 0, durationBeats: 1 },
                { pitch: sp[6]!, velocity: 65, startBeat: 1, durationBeats: 0.5 },
                { pitch: sp[8] || sp[7]!, velocity: 60, startBeat: 1.5, durationBeats: 1.5 },
                { pitch: sp[7]!, velocity: 65, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[6]!, velocity: 70, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
    {
        id: 'ml-synthwave',
        name: 'Synthwave Lead',
        category: 'melody',
        genres: ['synthwave', 'cinematic'],
        tags: ['retro', '80s'],
        description: '80s-style synth lead',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 60, 84);
            return [
                { pitch: sp[7] || sp[6]!, velocity: 85, startBeat: 0, durationBeats: 1.5 },
                { pitch: sp[8] || sp[7]!, velocity: 80, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 75, startBeat: 2, durationBeats: 1 },
                { pitch: sp[6]!, velocity: 80, startBeat: 3, durationBeats: 1 },
                { pitch: sp[4]!, velocity: 85, startBeat: 4, durationBeats: 1.5 },
                { pitch: sp[6]!, velocity: 80, startBeat: 5.5, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 90, startBeat: 6, durationBeats: 2 },
            ];
        },
    },
    {
        id: 'ml-trap',
        name: 'Trap Melody',
        category: 'melody',
        genres: ['trap', 'hip-hop'],
        tags: ['dark', 'bell'],
        description: 'Dark trap bell melody',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 60, 84);
            return [
                { pitch: sp[8] || sp[7]!, velocity: 90, startBeat: 0, durationBeats: 0.25 },
                { pitch: sp[9] || sp[8]!, velocity: 85, startBeat: 0.25, durationBeats: 0.25 },
                { pitch: sp[8] || sp[7]!, velocity: 80, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[7]!, velocity: 85, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[5]!, velocity: 80, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 75, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 90, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'ml-classical',
        name: 'Classical Phrase',
        category: 'melody',
        genres: ['classical', 'cinematic'],
        tags: ['elegant', 'period'],
        description: 'Classical melodic phrase',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 60, 84);
            return [
                { pitch: sp[7] || sp[6]!, velocity: 75, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[6]!, velocity: 70, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 80, startBeat: 1, durationBeats: 1 },
                { pitch: sp[5]!, velocity: 75, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 70, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[5]!, velocity: 80, startBeat: 3, durationBeats: 1 },
                { pitch: sp[7] || sp[6]!, velocity: 85, startBeat: 4, durationBeats: 0.5 },
                { pitch: sp[8] || sp[7]!, velocity: 80, startBeat: 4.5, durationBeats: 0.5 },
                { pitch: sp[9] || sp[8]!, velocity: 85, startBeat: 5, durationBeats: 1 },
                { pitch: sp[8] || sp[7]!, velocity: 75, startBeat: 6, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 70, startBeat: 6.5, durationBeats: 0.5 },
                { pitch: sp[6]!, velocity: 80, startBeat: 7, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'ml-gospel',
        name: 'Gospel Run',
        category: 'melody',
        genres: ['gospel', 'soul', 'r&b'],
        tags: ['run', 'flashy'],
        description: 'Fast gospel piano run',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 60, 84);
            const notes: PatternNote[] = [];
            for (let i = 0; i < 8 && i < sp.length; i++) {
                notes.push({ pitch: sp[i]!, velocity: 80 + i, startBeat: i * 0.25, durationBeats: 0.25 });
            }
            if (sp[8]) {
                notes.push({ pitch: sp[8], velocity: 90, startBeat: 2, durationBeats: 0.5 });
            }
            for (let i = 7; i >= 5 && i < sp.length; i--) {
                notes.push({ pitch: sp[i]!, velocity: 75, startBeat: 2.75 + (7 - i) * 0.25, durationBeats: 0.25 });
            }
            return notes;
        },
    },
    {
        id: 'ml-country',
        name: 'Country Picking',
        category: 'melody',
        genres: ['country', 'rock'],
        tags: ['fingerpick', 'acoustic'],
        description: 'Fingerpicking pattern',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 72);
            return [
                { pitch: sp[0]!, velocity: 85, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[2]!, velocity: 80, startBeat: 1, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[2]!, velocity: 80, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
    {
        id: 'ml-afrobeat',
        name: 'Afrobeat Lick',
        category: 'melody',
        genres: ['afrobeat', 'world'],
        tags: ['african', 'rhythmic'],
        description: 'Afrobeat melodic lick',
        lengthBeats: 4,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'pentatonic-major', 60, 84);
            return [
                { pitch: sp[7] || sp[6]!, velocity: 85, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[5]!, velocity: 80, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 1, durationBeats: 0.25 },
                { pitch: sp[3]!, velocity: 80, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 80, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[5]!, velocity: 85, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 80, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
];

// ── Search / Filter ──

export type PatternFilters = {
    query?: string;
    category?: PatternCategory;
    genre?: PatternGenre;
};

export function filterTemplates(filters: PatternFilters): PatternTemplate[] {
    let results = PATTERN_TEMPLATES;
    if (filters.category) {
        results = results.filter((t) => t.category === filters.category);
    }
    if (filters.genre) {
        results = results.filter((t) => t.genres.includes(filters.genre!));
    }
    if (filters.query) {
        const q = filters.query.toLowerCase().trim();
        results = results.filter(
            (t) =>
                t.name.toLowerCase().includes(q) ||
                t.tags.some((tag) => tag.includes(q)) ||
                t.description.toLowerCase().includes(q) ||
                t.genres.some((g) => g.includes(q))
        );
    }
    return results;
}
