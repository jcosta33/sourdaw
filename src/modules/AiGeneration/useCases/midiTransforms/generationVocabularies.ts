import type {
    ChordProgressionStyle,
    ChordVoicing,
    DrumPatternStyle,
    MelodyStyle,
    ScaleType,
} from '../../models/GenerationStyles';

/**
 * The generation vocabularies as ordered value lists.
 *
 * The style unions in `models/GenerationStyles` are the source of truth, and the command contract
 * re-declares the same vocabularies because it may not import this module. These lists are what the
 * adapters admit and what the parity spec compares against both sides, so a value added to a union
 * without reaching the contract is caught rather than silently unreachable.
 */

export const CHORD_PROGRESSION_STYLES = [
    'pop',
    'jazz',
    'classical',
    'edm',
    'blues',
    'rnb',
    'folk',
    'cinematic',
    'neo-soul',
    'gospel',
    'rock',
    'lofi',
] as const satisfies readonly ChordProgressionStyle[];

export const CHORD_VOICINGS = ['close', 'open', 'spread', 'power'] as const satisfies readonly ChordVoicing[];

export const CHORD_SCALES = ['major', 'minor'] as const;

export const CHORD_RHYTHMS = ['whole', 'half', 'quarter', 'syncopated'] as const;

export const DRUM_PATTERN_STYLES = [
    'four-on-floor',
    'breakbeat',
    'trap',
    'jazz',
    'latin',
    'rock',
    'dnb',
    'half-time',
    'blues',
    'reggae',
    'lofi',
    'house',
    'techno',
    'synthwave',
    'afrobeat',
    'metal',
    'punk',
] as const satisfies readonly DrumPatternStyle[];

export const MELODY_STYLES = [
    'simple',
    'arpeggiated',
    'stepwise',
    'rhythmic',
    'ambient',
] as const satisfies readonly MelodyStyle[];

export const MELODY_SCALES = [
    'major',
    'minor',
    'pentatonic',
    'minor-pentatonic',
    'blues',
    'dorian',
    'mixolydian',
    'lydian',
    'phrygian',
    'locrian',
    'harmonic-minor',
    'melodic-minor',
    'whole-tone',
    'chromatic',
] as const satisfies readonly ScaleType[];
