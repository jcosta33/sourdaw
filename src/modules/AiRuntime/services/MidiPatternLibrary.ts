/**
 * MIDI Pattern Library — aggregated catalog of pattern templates.
 *
 * Templates are split by category under `./Patterns/`. The shared types and
 * key/scale tables live in `../models/MidiPatternType.ts`. Pure music-theory helpers
 * (scale generation, chord building, filtering) live in
 * `./scaleTheory.ts`. This file owns the service-side aggregation.
 *
 * Re-exports the type and helper surfaces so existing consumers do not need
 * to update their import paths.
 */

import { type PatternTemplate, type PatternFilters } from '../models/MidiPatternType';
import { drumPatterns } from '../models/Patterns/DrumPatterns';

import { bassPatterns } from './Patterns/BassPatterns';
import { chordPatterns } from './Patterns/ChordPatterns';
import { melodyPatterns } from './Patterns/MelodyPatterns';
import { filterTemplates as filterTemplatesImpl } from './scaleTheory';

// ── Re-exports for in-module consumers (presentations, useCases, services) ──

export {
    ALL_KEYS,
    SCALE_TYPES,
    SCALE_LABELS,
    KEY_SEMITONES,
    SCALE_INTERVALS,
    PATTERN_CATEGORIES,
    ALL_GENRES,
} from '../models/MidiPatternType';
export type {
    KeyName,
    ScaleType,
    PatternCategory,
    PatternGenre,
    PatternNote,
    GenerationParams,
    PatternTemplate,
    PatternFilters,
} from '../models/MidiPatternType';
export { getScalePitches, snapToScale, chordFromDegrees, resolveTemplateScale } from './scaleTheory';

// ── Aggregated template registry ───────────────────────────────────────────

export const PATTERN_TEMPLATES: PatternTemplate[] = [
    ...chordPatterns,
    ...bassPatterns,
    ...drumPatterns,
    ...melodyPatterns,
];

/** Filter the aggregated catalog. */
export function filterTemplates(filters: PatternFilters): PatternTemplate[] {
    return filterTemplatesImpl(PATTERN_TEMPLATES, filters);
}
