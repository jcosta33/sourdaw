/**
 * Levain preset management.
 * Factory presets organized by instrument family and complexity level.
 */

import {
    type LevainPatch,
    type InstrumentId,
    createDefaultPatch,
} from '../models/LevainPatch';

export type PresetCategory = 'strings' | 'brass' | 'woodwinds' | 'percussion' | 'choir' | 'ensemble';
export type PresetLevel = 'play' | 'shape' | 'build';

export type PresetEntry = {
    id: string;
    name: string;
    category: PresetCategory;
    level: PresetLevel;
    description: string;
    instrumentId: InstrumentId;
};

// ---------------------------------------------------------------------------
// Factory presets
// ---------------------------------------------------------------------------

export const FACTORY_PRESETS: PresetEntry[] = [
    // Strings — Play level
    { id: 'str-vln1-legato', name: 'Violins I — Legato', category: 'strings', level: 'play', description: 'Expressive legato violins with natural vibrato', instrumentId: 'violin-1' },
    { id: 'str-vln1-spiccato', name: 'Violins I — Spiccato', category: 'strings', level: 'play', description: 'Crisp short bowing', instrumentId: 'violin-1' },
    { id: 'str-cello-sustain', name: 'Cellos — Sustain', category: 'strings', level: 'play', description: 'Warm sustained cellos', instrumentId: 'cello' },
    { id: 'str-bass-pizz', name: 'Basses — Pizzicato', category: 'strings', level: 'play', description: 'Deep plucked basses', instrumentId: 'double-bass' },
    // Brass — Play level
    { id: 'brs-horn-sustain', name: 'Horns — Sustain', category: 'brass', level: 'play', description: 'Noble French horns', instrumentId: 'horn' },
    { id: 'brs-trumpet-stac', name: 'Trumpets — Staccato', category: 'brass', level: 'play', description: 'Heroic short brass', instrumentId: 'trumpet' },
    // Woodwinds — Play level
    { id: 'ww-flute-legato', name: 'Flute — Legato', category: 'woodwinds', level: 'play', description: 'Singing solo flute', instrumentId: 'flute' },
    { id: 'ww-oboe-sustain', name: 'Oboe — Sustain', category: 'woodwinds', level: 'play', description: 'Expressive solo oboe', instrumentId: 'oboe' },
    // Percussion — Play level
    { id: 'perc-timpani', name: 'Timpani', category: 'percussion', level: 'play', description: 'Standard timpani with rolls', instrumentId: 'timpani' },
    // Ensemble — Build level
    { id: 'ens-full-strings', name: 'Full Strings', category: 'ensemble', level: 'build', description: 'Vln1 + Vln2 + Vla + Vc + Cb pre-panned', instrumentId: 'violin-1' },
    { id: 'ens-brass-section', name: 'Brass Section', category: 'ensemble', level: 'build', description: 'Hrn + Tpt + Tbn + Tba', instrumentId: 'horn' },
];

export function getPresetsByCategory(category: PresetCategory): PresetEntry[] {
    return FACTORY_PRESETS.filter((p) => p.category === category);
}

export function getPresetsByLevel(level: PresetLevel): PresetEntry[] {
    return FACTORY_PRESETS.filter((p) => p.level === level);
}

export function loadPreset(presetId: string): LevainPatch | null {
    const entry = FACTORY_PRESETS.find((p) => p.id === presetId);
    if (!entry) {
        return null;
    }

    const patch = createDefaultPatch(entry.instrumentId);
    patch.name = entry.name;

    // Apply preset-specific overrides.
    switch (presetId) {
        case 'str-vln1-legato':
            patch.currentArticulation = 'legato';
            patch.legato.enabled = true;
            patch.humanize.amount = 0.4;
            break;
        case 'str-vln1-spiccato':
            patch.currentArticulation = 'spiccato';
            patch.legato.enabled = false;
            break;
        case 'str-cello-sustain':
            patch.currentArticulation = 'sustain';
            patch.humanize.amount = 0.3;
            break;
        case 'str-bass-pizz':
            patch.currentArticulation = 'pizzicato';
            patch.legato.enabled = false;
            break;
        case 'brs-horn-sustain':
            patch.currentArticulation = 'sustain';
            patch.humanize.amount = 0.3;
            break;
        case 'brs-trumpet-stac':
            patch.currentArticulation = 'staccato';
            patch.legato.enabled = false;
            break;
    }

    return patch;
}
