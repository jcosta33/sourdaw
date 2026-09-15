import { resolveTemplateScale } from '../../services/scaleTheory';

import type { KeyName, PatternCategory, ScaleType } from '../../models/MidiPatternType';

type ToPublicPatternTemplateInput = {
    id: string;
    name: string;
    category: PatternCategory;
    genres: string[];
    tags: string[];
    description: string;
    lengthBeats: number;
    scaleOverride?: ScaleType;
    generate: (generation_params: { key: KeyName; scale: ScaleType; density: number; complexity: number }) => Array<{
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
