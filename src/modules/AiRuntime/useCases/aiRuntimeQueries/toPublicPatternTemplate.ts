import { resolveTemplateScale } from '../../models/MidiPatternLibrary';
import { type GenerationParams, type PatternNote, type PatternTemplate } from '../../models/MidiPatternType';

type ToPublicPatternTemplateOutput = {
    id: string;
    name: string;
    category: PatternTemplate['category'];
    genres: string[];
    tags: string[];
    description: string;
    generate: (generation_params: GenerationParams) => PatternNote[];
    lengthBeats: number;
};

export function toPublicPatternTemplate(template: PatternTemplate): ToPublicPatternTemplateOutput {
    return {
        id: template.id,
        name: template.name,
        category: template.category,
        genres: [...template.genres],
        tags: [...template.tags],
        description: template.description,
        generate: (generation_params: GenerationParams): PatternNote[] =>
            template
                .generate({
                    ...generation_params,
                    scale: resolveTemplateScale(template, generation_params),
                })
                .map((note) => ({ ...note })),
        lengthBeats: template.lengthBeats,
    };
}
