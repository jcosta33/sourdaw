import { searchPresets as searchInternalPresets } from '../../services/fuzzySearch';

import { toPromptPreset } from './helpers';

import type { PresetSearchContext, PromptPreset } from './helpers';

export type FuzzyResult = {
    preset: PromptPreset;
    score: number;
};

export function searchPresets(query: string, context: PresetSearchContext, limit = 12): FuzzyResult[] {
    return searchInternalPresets(query, context, limit).map((result) => ({
        preset: toPromptPreset(result.preset),
        score: result.score,
    }));
}
