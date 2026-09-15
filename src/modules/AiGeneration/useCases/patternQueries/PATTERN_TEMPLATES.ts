import { PATTERN_TEMPLATES as patternTemplates } from '../../services/MidiPatternLibrary';

import { toPublicPatternTemplate } from './toPublicPatternTemplate';

import type { KeyName, PatternCategory, ScaleType } from '../../models/MidiPatternType';

type PublicPatternTemplate = {
    id: string;
    name: string;
    category: PatternCategory;
    genres: string[];
    tags: string[];
    description: string;
    generate: (generation_params: { key: KeyName; scale: ScaleType; density: number; complexity: number }) => Array<{
        pitch: number;
        velocity: number;
        startBeat: number;
        durationBeats: number;
    }>;
    lengthBeats: number;
};

export const PATTERN_TEMPLATES: PublicPatternTemplate[] = patternTemplates.map(toPublicPatternTemplate);
