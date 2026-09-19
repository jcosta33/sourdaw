import { type OpenAiCloudRuntime } from '../cloudSession';

import { isGpt56FamilyModel } from './openAiModelFamilies';

/**
 * Reasoning effort the OpenAI Responses request builders extend the request body
 * with. A configured override always wins; absent an override, the gpt-5.6 family
 * defaults to `none` and every other model sends no `reasoning` extension at all.
 */
export function buildReasoningExtension(runtime: OpenAiCloudRuntime): Record<string, unknown> {
    if (runtime.reasoning_effort !== undefined) {
        return { reasoning: { effort: runtime.reasoning_effort } };
    }
    if (isGpt56FamilyModel(runtime.model)) {
        return { reasoning: { effort: 'none' } };
    }
    return {};
}
