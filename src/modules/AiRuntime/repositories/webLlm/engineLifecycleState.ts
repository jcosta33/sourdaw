import { DEFAULT_WEBLLM_MODEL_ID } from '../../models/ModelInfo';

/**
 * WebLLM engine type — resolved dynamically to avoid loading the 6.2MB
 * WebLLM bundle on the main thread at import time.
 */
export type WebLlmEngine = {
    interruptGenerate: () => void;
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
    initAttemptId: string | null;
    initModelId: string | null;
    initController: AbortController | null;
    initSignal: AbortSignal | null;
    initWaiterCount: number;
    worker: Worker | null;
    activeModelId: string;
    activeArtifactSetDigest: string | null;
} = {
    engine: null,
    initPromise: null,
    initAttemptId: null,
    initModelId: null,
    initController: null,
    initSignal: null,
    initWaiterCount: 0,
    worker: null,
    activeModelId: DEFAULT_WEBLLM_MODEL_ID,
    activeArtifactSetDigest: null,
};
