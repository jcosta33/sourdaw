import { WEBLLM_CONTEXT_WINDOW_TOKENS } from '../../models/ModelInfo';

import { engineState } from './engineLifecycleState';

/**
 * The context window, in tokens, a WebLLM model loads with. The engine loads it and the planning
 * budget measures requests against it, both through this reader, so the two cannot disagree.
 */
export function getWebLlmContextWindowSize(modelId: string = engineState.activeModelId): number {
    const windowTokens = WEBLLM_CONTEXT_WINDOW_TOKENS[modelId];
    if (windowTokens === undefined) {
        throw new Error(`WebLLM model has no context window in this Sourdaw release: ${modelId}`);
    }
    return windowTokens;
}
