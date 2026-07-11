import { PATTERN_TEMPLATES as modelPatternTemplates } from '../../models/MidiPatternLibrary';

import { toPublicPatternTemplate } from './toPublicPatternTemplate';

type PublicPatternTemplate = {
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
};

export const PATTERN_TEMPLATES: PublicPatternTemplate[] = modelPatternTemplates.map(toPublicPatternTemplate);
