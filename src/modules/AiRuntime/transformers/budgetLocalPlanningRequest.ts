import {
    LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS,
    type LocalPlanningBudget,
    type PromptTokenCounter,
} from '../models/LocalPlanningBudget';

import { estimateConservativePromptTokens } from './estimateConservativePromptTokens';

type LocalPlanningBudgetInput = {
    /** The serialized system prompt exactly as the engine receives it, tool section included. */
    systemPrompt: string;
    userMessage: string;
    windowTokens: number;
    configuredMaxOutputTokens: number;
    countTokens?: PromptTokenCounter;
};

/**
 * Admits a local planning request only when its prompt and the reply reserve fit the window, and
 * bounds the reply to what the window has left after the prompt.
 */
export function budgetLocalPlanningRequest(input: LocalPlanningBudgetInput): LocalPlanningBudget {
    const countTokens = input.countTokens ?? estimateConservativePromptTokens;
    const promptTokens =
        countTokens(input.systemPrompt) + countTokens(input.userMessage) + LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS;
    const neededTokens = promptTokens + LOCAL_PLANNING_REPLY_RESERVE_TOKENS;
    if (neededTokens > input.windowTokens) {
        return { status: 'exceeded', neededTokens, windowTokens: input.windowTokens };
    }
    return {
        status: 'admitted',
        promptTokens,
        maxOutputTokens: Math.min(input.configuredMaxOutputTokens, input.windowTokens - promptTokens),
    };
}
