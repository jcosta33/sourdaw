/**
 * Use case: LLM engine orchestration.
 *
 * Resolves the best backend (native llama-server vs. browser WebLLM),
 * manages lifecycle, and routes inference requests.
 * This is the single entry point for all LLM operations.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { isTauri } from '#/helpers/tauriBridge';

import { WEBLLM_MODEL_ID } from '../models/ModelInfo';
import { llmStatusStore } from '../stores/llmStatusStore';
import {
    initLlamaServer,
    isLlamaServerRunning,
    stopLlamaServer,
    generateNativeCompletion,
} from '../repositories/llamaServerEngine';
import { initWebLlmEngine, unloadWebLlmEngine, generateWebLlmCompletion } from '../repositories/webLlmRepository';
import { parseToolCallXml, type ToolCallResult } from '../transformers/toolCallParser';

export type { ToolCallResult } from '../transformers/toolCallParser';

export type AiBackend = 'webllm' | 'native';

const logger = Container.getInstance().get(Logger);

// ── Backend resolution ──────────────────────────────────────────────────

/**
 * Returns the backend that will be used: native when running in Tauri or
 * on localhost (dev mode), webllm otherwise.
 */
export function resolveBackend(): AiBackend {
    if (isTauri()) {
        return 'native';
    }
    if (
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
        return 'native';
    }
    return 'webllm';
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/**
 * Initialize the auto-detected backend. Throws on failure.
 */
export async function initEngine(): Promise<void> {
    const backend = resolveBackend();

    llmStatusStore.set({ state: 'loading', progress: 0, text: `Starting ${backend} engine...` });

    if (backend === 'native') {
        await initLlamaServer();
        llmStatusStore.set({ state: 'ready', modelId: 'native' });
        return;
    }

    await initWebLlmEngine();
}

/**
 * Unload the current engine and free memory.
 */
export async function unloadEngine(): Promise<void> {
    if (isLlamaServerRunning()) {
        await stopLlamaServer();
    }
    unloadWebLlmEngine();
    llmStatusStore.set({ state: 'idle' });
}

// ── Inference ───────────────────────────────────────────────────────────

/**
 * Send a prompt to the model and parse `<tool_call>` XML from the response.
 * Uses the auto-detected backend. Throws on failure.
 */
export async function generateToolCalls(systemPrompt: string, userMessage: string): Promise<ToolCallResult[]> {
    const backend = resolveBackend();
    llmStatusStore.set({ state: 'generating' });

    const content =
        backend === 'native' && isLlamaServerRunning()
            ? await generateNativeCompletion(systemPrompt, userMessage)
            : await generateWebLlmCompletion(systemPrompt, userMessage);

    logger.info(`[AI Engine] Raw response (${String(content.length)} chars): ${content.slice(0, 500)}`);

    const results = parseToolCallXml(content);
    logger.info(`[AI Engine] Parsed ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`);

    const modelId = backend === 'native' ? 'native' : WEBLLM_MODEL_ID;
    llmStatusStore.set({ state: 'ready', modelId });
    return results;
}

// ── Availability ────────────────────────────────────────────────────────

export function isLlmAvailable(): boolean {
    return (typeof navigator !== 'undefined' && 'gpu' in navigator) || isTauri();
}
