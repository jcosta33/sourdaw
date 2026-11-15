/**
 * Store for tracking the status of the AI/LLM engine.
 * Consumed by UI components to show model loading progress, readiness, and errors.
 */

import { createStore } from '#/infra/store/createStore';

import { type HostedLlmProvider } from '../models/HostedLlmProvider';
import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import { type LocalModelRefusal } from '../models/LocalModelRefusal';

export type LlmEngineStatus =
    | { state: 'idle' }
    | { state: 'loading'; progress: number; text: string }
    | { state: 'ready'; backend: RunnableAiBackend; modelId: string }
    /** The attempt answering now; a fall-through to the next backend publishes that attempt. */
    | { state: 'generating'; backend: 'webllm'; modelId: string }
    | { state: 'generating'; backend: 'cloud'; provider: HostedLlmProvider; modelId: string }
    /** `refusal` is set when the machine cannot run the requested local model; `message` is its sentence. */
    | { state: 'error'; message: string; refusal?: LocalModelRefusal };

export const llmStatusStore = createStore<LlmEngineStatus>({
    initialData: { state: 'idle' },
});
