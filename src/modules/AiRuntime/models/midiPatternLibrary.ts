/**
 * MIDI Pattern Library — Algorithmic pattern generation from templates.
 *
 * Templates define abstract musical recipes. The generator applies user
 * parameters (key, scale, density, complexity) to produce concrete MIDI on-the-fly.
 *
 * Pattern data is split by category under `./patterns/`:
 *   - `chordPatterns.ts` — chord progressions
 *   - `bassPatterns.ts`  — bass lines
 *   - `drumPatterns.ts`  — drum grooves
 *   - `melodyPatterns.ts`— melodic phrases
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

export const KEY_SEMITONES: Record<string, number> = {
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
export function snapToScale(pitch: number, scalePitches: number[]): number {
    let best = scalePitches[0]!;
    for (const sp of scalePitches) {
        if (Math.abs(sp - pitch) < Math.abs(best - pitch)) {
            best = sp;
        }
    }
    return best;
}

/** Build chord from scale degrees (0-indexed) at a beat */
export function chordFromDegrees(
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

// ── Category sub-modules ───────────────────────────────────────────────────
import { chordPatterns } from './patterns/chordPatterns';
import { bassPatterns } from './patterns/bassPatterns';
import { drumPatterns } from './patterns/drumPatterns';
import { melodyPatterns } from './patterns/melodyPatterns';

// ── Aggregated template registry ───────────────────────────────────────────

export const PATTERN_TEMPLATES: PatternTemplate[] = [
    ...chordPatterns,
    ...bassPatterns,
    ...drumPatterns,
    ...melodyPatterns,
];

// ── Search / Filter ──

export type PatternFilters = {
    category?: PatternCategory;
    genres?: PatternGenre[];
    tags?: string[];
    query?: string;
};

export function filterTemplates(filters: PatternFilters): PatternTemplate[] {
    return PATTERN_TEMPLATES.filter((t) => {
        if (filters.category && t.category !== filters.category) {
            return false;
        }
        if (filters.genres && !filters.genres.some((g) => t.genres.includes(g))) {
            return false;
        }
        if (filters.tags && !filters.tags.some((tag) => t.tags.includes(tag))) {
            return false;
        }
        if (filters.query) {
            const q = filters.query.toLowerCase();
            const haystack = [t.name, t.description, ...t.tags, ...t.genres].join(' ').toLowerCase();
            if (!haystack.includes(q)) {
                return false;
            }
        }
        return true;
    });
}
