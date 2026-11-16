import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';

import { getBackendChain } from './llmOrchestration/backendResolution/getBackendChain';
import { prepareMetricIntentCatalog } from './prepareMetricIntentCatalog';
import { readStatedRecipeDescriptors } from './readStatedRecipeDescriptors';

/**
 * The metric catalog a planning request publishes. A request that may reach the local planner offers a
 * recipe objective only when the request states a term of that recipe's descriptor: the recipe objectives
 * are most of the catalog's planner text, and a local window holding all of them leaves too little room
 * for the request (#6706). Every policy, numeric and unsupported objective stays, and a hosted-only
 * request keeps every recipe objective, since its window has room for them.
 */
export function preparePlanningMetricIntentCatalog(input: { prompt: string; answer: AnswerInterpretationCatalog }) {
    if (!getBackendChain().includes('webllm')) {
        return prepareMetricIntentCatalog(input);
    }
    return prepareMetricIntentCatalog({
        ...input,
        recipeDescriptors: readStatedRecipeDescriptors(input.prompt, input.answer.context, getMixRecipeCatalog()),
    });
}
