import { filterTemplates as filterModelTemplates } from '../../models/MidiPatternLibrary';

import { toPublicPatternTemplate } from './toPublicPatternTemplate';

type FilterTemplatesInput = {
    category?: 'chords' | 'bass' | 'drums' | 'melody';
    genres?: string[];
    tags?: string[];
    query?: string;
};

type FilterTemplatesOutput = Array<{
    id: string;
    name: string;
    category: 'chords' | 'bass' | 'drums' | 'melody';
    genres: string[];
    tags: string[];
    description: string;
    generate: (generation_params: {
        key: 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
        scale: 'major' | 'minor' | 'blues' | 'harmonic-minor' | 'dorian' | 'pentatonic-minor' | 'pentatonic-major';
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
    return filterModelTemplates(filters).map(toPublicPatternTemplate);
}
