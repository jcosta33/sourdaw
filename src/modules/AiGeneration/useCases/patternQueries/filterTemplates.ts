import { filterTemplates as filterPatternTemplates } from '../../services/MidiPatternLibrary';

import { toPublicPatternTemplate } from './toPublicPatternTemplate';

import type { PatternCategory, ScaleType } from '../../models/MidiPatternType';

type FilterTemplatesInput = {
    category?: PatternCategory;
    genres?: string[];
    tags?: string[];
    query?: string;
};

type FilterTemplatesOutput = Array<{
    id: string;
    name: string;
    category: PatternCategory;
    genres: string[];
    tags: string[];
    description: string;
    generate: (generation_params: {
        key: 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
        scale: ScaleType;
        density: number;
        complexity: number;
    }) => Array<{
        pitch: number;
        velocity: number;
        startBeat: number;
        durationBeats: number;
    }>;
    lengthBeats: number;
}>;

export function filterTemplates(filters: FilterTemplatesInput): FilterTemplatesOutput {
    return filterPatternTemplates(filters).map(toPublicPatternTemplate);
}
