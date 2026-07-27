/**
 * Store for tracking the status of the AI/LLM engine.
 * Consumed by UI components to show model loading progress, readiness, and errors.
 */

import { createStore } from '#/infra/store/createStore';

import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';

export type LlmEngineStatus =
    | { state: 'idle' }
    | { state: 'loading'; progress: number; text: string }
    | { state: 'ready'; backend: RunnableAiBackend; modelId: string }
    | { state: 'generating' }
    | { state: 'error'; message: string };

export const llmStatusStore = createStore<LlmEngineStatus>({
    initialData: { state: 'idle' },
});
