/* SPDX-FileCopyrightText: 2026 Jose Costa */
/* SPDX-License-Identifier: Apache-2.0 */

/**
 * Shared types and lookup tables for MIDI pattern templates and the Pattern Browser.
 */

// ── Keys & scales ─────────────────────────────────────────────────────────

export const ALL_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type KeyName = (typeof ALL_KEYS)[number];

export const KEY_SEMITONES: Record<KeyName, number> = {
    C: 0,
    'C#': 1,
    D: 2,
    'D#': 3,
    E: 4,
    F: 5,
    'F#': 6,
    G: 7,
    'G#': 8,
    A: 9,
    'A#': 10,
    B: 11,
};

export const SCALE_TYPES = [
    'major',
    'minor',
    'blues',
    'harmonic-minor',
    'dorian',
    'pentatonic-minor',
    'pentatonic-major',
] as const;

export type ScaleType = (typeof SCALE_TYPES)[number];

export const SCALE_LABELS: Record<ScaleType, string> = {
    major: 'Major',
    minor: 'Minor',
    blues: 'Blues',
    'harmonic-minor': 'Harmonic minor',
    dorian: 'Dorian',
    'pentatonic-minor': 'Pentatonic minor',
    'pentatonic-major': 'Pentatonic major',
};

/** Semitone sets (within an octave, relative to root) for each scale name used by templates. */
export const SCALE_INTERVALS: Record<ScaleType, readonly number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    blues: [0, 3, 5, 6, 7, 10],
    'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    'pentatonic-minor': [0, 3, 5, 7, 10],
    'pentatonic-major': [0, 2, 4, 7, 9],
};

// ── Pattern metadata ──────────────────────────────────────────────────────

export type PatternCategory = 'chords' | 'bass' | 'drums' | 'melody';

export const PATTERN_CATEGORIES: readonly { id: PatternCategory; label: string }[] = [
    { id: 'chords', label: 'Chords' },
    { id: 'bass', label: 'Bass' },
    { id: 'drums', label: 'Drums' },
    { id: 'melody', label: 'Melody' },
];

/** Free-form genre tag used in templates and the pattern browser filter. */
export type PatternGenre = string;

/** Curated list for the Pattern Browser genre picker (ids match template `genres` strings). */
export const ALL_GENRES: { id: PatternGenre; label: string }[] = [
    { id: 'pop', label: 'Pop' },
    { id: 'rock', label: 'Rock' },
    { id: 'jazz', label: 'Jazz' },
    { id: 'lo-fi', label: 'Lo-fi' },
    { id: 'soul', label: 'Soul' },
    { id: 'metal', label: 'Metal' },
    { id: 'blues', label: 'Blues' },
    { id: 'r&b', label: 'R&B' },
    { id: 'classical', label: 'Classical' },
    { id: 'world', label: 'World' },
    { id: 'funk', label: 'Funk' },
    { id: 'edm', label: 'EDM' },
    { id: 'house', label: 'House' },
    { id: 'techno', label: 'Techno' },
    { id: 'gospel', label: 'Gospel' },
    { id: 'trap', label: 'Trap' },
    { id: 'hip-hop', label: 'Hip-hop' },
    { id: 'synthwave', label: 'Synthwave' },
    { id: 'ambient', label: 'Ambient' },
    { id: 'cinematic', label: 'Cinematic' },
    { id: 'reggae', label: 'Reggae' },
    { id: 'country', label: 'Country' },
    { id: 'disco', label: 'Disco' },
    { id: 'dnb', label: 'DnB' },
    { id: 'breakbeat', label: 'Breakbeat' },
];

export type PatternNote = {
    pitch: number;
    velocity: number;
    startBeat: number;
    durationBeats: number;
};

/** Parameters passed when a template generates notes (browser / AI). */
export type GenerationParams = {
    key: KeyName;
    scale: ScaleType;
    /** 0–10 — note density / subdivision. */
    density: number;
    /** 0–10 — harmonic / rhythmic complexity. */
    complexity: number;
};

export type PatternTemplate = {
    id: string;
    name: string;
    category: PatternCategory;
    genres: PatternGenre[];
    tags: string[];
    description: string;
    lengthBeats: number;
    /**
     * When set, the template's musical identity depends on a specific scale
     * (e.g. "12-Bar Blues" must use `blues`, "Dorian Vamp" must use `dorian`).
     * Callers resolve the effective scale as
     *   `scaleOverride ?? params.scale`
     * before invoking `generate`. Templates without an override honour the
     * user-selected `params.scale` — previously some templates silently
     * replaced it (`p.scale === 'major' ? 'minor' : p.scale`) which produced
     * unexpected output.
     */
    scaleOverride?: ScaleType;
    generate: (params: GenerationParams) => PatternNote[];
};

export type PatternFilters = {
    category?: PatternCategory;
    genres?: PatternGenre[];
    tags?: string[];
    query?: string;
};
