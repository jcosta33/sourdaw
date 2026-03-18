/**
 * Store for tracking the status of the AI/LLM engine.
 * Consumed by UI components to show model loading progress, readiness, and errors.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

export type LlmEngineStatus =
    | { state: 'idle' }
    | { state: 'loading'; progress: number; text: string }
    | { state: 'ready'; modelId: string }
    | { state: 'generating' }
    | { state: 'error'; message: string };

const logger = Container.getInstance().get(Logger);

export const llmStatusStore = new Store<LlmEngineStatus>(logger, {
    initialData: { state: 'idle' },
});
