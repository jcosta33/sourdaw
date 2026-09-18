import { DRUM_PATTERN_STYLES } from '../generateDrumPattern/algorithm';
import { MELODY_STYLES } from '../generateMelody/algorithm';

import type { ChordProgressionStyle, ChordVoicing, MelodyScaleType } from '../../models/GenerationStyles';

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

// Single-sourced from the algorithms that own them: the drum roster lives in
// `../generateDrumPattern/algorithm.ts`, the melody roster in
// `../generateMelody/algorithm.ts`.
export { DRUM_PATTERN_STYLES, MELODY_STYLES };

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
] as const satisfies readonly MelodyScaleType[];
