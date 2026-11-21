import { type RecipeObjectiveDetail } from './createPlanningCandidateView';
import { getBackendChain } from './llmOrchestration/backendResolution/getBackendChain';

/**
 * How the joint intake prints recipe objectives for this request. A chain that may answer locally prints
 * each one by recipe id and admitted scopes, leaving its title and expectations to `recipe.discover`, so
 * the local window holds every recipe objective with its headroom floor (#6706); a hosted-only chain
 * prints them inline.
 */
export function selectRecipeObjectiveDetail(): RecipeObjectiveDetail {
    return getBackendChain().includes('webllm') ? 'discovered' : 'inline';
}
