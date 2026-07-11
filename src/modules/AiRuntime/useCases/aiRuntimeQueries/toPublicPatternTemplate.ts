import { resolveTemplateScale } from '../../models/MidiPatternLibrary';

type ToPublicPatternTemplateInput = {
    id: string;
    name: string;
    category: 'chords' | 'bass' | 'drums' | 'melody';
    genres: string[];
    tags: string[];
    description: string;
    lengthBeats: number;
    scaleOverride?: 'major' | 'minor' | 'blues' | 'harmonic-minor' | 'dorian' | 'pentatonic-minor' | 'pentatonic-major';
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
};

type ToPublicPatternTemplateOutput = {
    id: string;
    name: string;
    category: ToPublicPatternTemplateInput['category'];
    genres: string[];
    tags: string[];
    description: string;
    generate: ToPublicPatternTemplateInput['generate'];
    lengthBeats: number;
};

export function toPublicPatternTemplate(template: ToPublicPatternTemplateInput): ToPublicPatternTemplateOutput {
    return {
        id: template.id,
        name: template.name,
        category: template.category,
        genres: [...template.genres],
        tags: [...template.tags],
        description: template.description,
        generate: (generation_params) =>
            template
                .generate({
                    ...generation_params,
                    scale: resolveTemplateScale(template, generation_params),
                })
                .map((note) => ({ ...note })),
        lengthBeats: template.lengthBeats,
    };
}
