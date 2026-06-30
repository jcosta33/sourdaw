import { DEFAULT_WEBLLM_MODEL_ID } from '../../models/ModelInfo';

/**
 * WebLLM engine type — resolved dynamically to avoid loading the 6.2MB
 * WebLLM bundle on the main thread at import time.
 */
export type WebLlmEngine = {
    chat: {
        completions: {
            create: (params: Record<string, unknown>) => Promise<unknown>;
        };
    };
};

// §67.2 — Coalesce 4 module-level `let`s into one holder so the WebLLM
// engine lifecycle lives behind a single named handle.
export const engineState: {
    engine: WebLlmEngine | null;
    initPromise: Promise<WebLlmEngine> | null;
    worker: Worker | null;
    activeModelId: string;
} = {
    engine: null,
    initPromise: null,
    worker: null,
    activeModelId: DEFAULT_WEBLLM_MODEL_ID,
};
