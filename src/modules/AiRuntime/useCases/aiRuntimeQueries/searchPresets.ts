import { type PresetContext } from '../../models/PresetActions/Registry';
import { type PromptPreset } from '../../models/PromptPreset';
import { searchPresets as searchInternalPresets } from '../../services/fuzzySearch';

import { toPromptPreset } from './toPromptPreset';

export type FuzzyResult = {
    preset: PromptPreset;
    score: number;
};

export function searchPresets(query: string, context: PresetContext, limit = 12): FuzzyResult[] {
    return searchInternalPresets(query, context, limit).map((result) => ({
        preset: toPromptPreset(result.preset),
        score: result.score,
    }));
}
