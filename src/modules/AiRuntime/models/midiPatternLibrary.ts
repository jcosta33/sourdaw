/**
 * MIDI Pattern Library — aggregated catalog of pattern templates.
 *
 * Templates are split by category under `./patterns/`. The shared types and
 * key/scale tables live in `./MidiPatternType.ts`. Pure music-theory helpers
 * (scale generation, chord building, filtering) live in
 * `../services/scaleTheory.ts`. This file only owns the aggregation.
 *
 * Re-exports the type and helper surfaces so existing consumers do not need
 * to update their import paths.
 */

import { filterTemplates as filterTemplatesImpl } from '../services/scaleTheory';

import { type PatternTemplate, type PatternFilters } from './MidiPatternType';
import { bassPatterns } from './patterns/bassPatterns';
import { chordPatterns } from './patterns/chordPatterns';
import { drumPatterns } from './patterns/drumPatterns';
import { melodyPatterns } from './patterns/melodyPatterns';

// ── Re-exports for in-module consumers (presentations, useCases, services) ──

export {
    ALL_KEYS,
    SCALE_TYPES,
    SCALE_LABELS,
    KEY_SEMITONES,
    SCALE_INTERVALS,
    PATTERN_CATEGORIES,
    ALL_GENRES,
    resolveTemplateScale,
} from './MidiPatternType';
export type {
    KeyName,
    ScaleType,
    PatternCategory,
    PatternGenre,
    PatternNote,
    GenerationParams,
    PatternTemplate,
    PatternFilters,
} from './MidiPatternType';
export { getScalePitches, snapToScale, chordFromDegrees } from '../services/scaleTheory';

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
