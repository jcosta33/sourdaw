/**
 * Use case: LLM engine orchestration.
 *
 * Resolves the best backend with tiered fallback:
 *   native (llama-server) → WebLLM (browser, Hermes-2-Pro native tool calling) → cloud (Claude API)
 *
 * Manages lifecycle and routes inference requests.
 * This is the single entry point for all LLM operations.
 *
 * Backend capabilities:
 * - native:  Hermes-3-Llama-3.1-8B via llama-server; parses Hermes XML tool calls
 * - webllm:  Hermes-2-Pro-Llama-3-8B via WebGPU; uses native OpenAI tool calling API
 * - cloud:   Claude API; uses native tool-use API
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { isTauri } from '#/helpers/tauriBridge';

import { DAW_CHAT_TOOLS } from '../helpers/toolDefinitions';
import { WEBLLM_MODEL_ID } from '../models/ModelInfo';
import { llmStatusStore } from '../stores/llmStatusStore';
import {
    initLlamaServer,
    isLlamaServerRunning,
    stopLlamaServer,
    generateNativeCompletion,
} from '../repositories/llamaServerEngine';
import {
    initWebLlmEngine,
    unloadWebLlmEngine,
    isWebLlmLoaded,
    generateWebLlmToolCalls,
} from '../repositories/webLlmRepository';
import { isCloudAvailable, generateCloudToolCalls } from '../repositories/cloudLlmRepository';
import { parseToolCallXml, type ToolCallResult } from '../transformers/toolCallParser';
import { parseNativeToolCalls } from '../repositories/nativeToolRegistry';

export type { ToolCallResult } from '../transformers/toolCallParser';

export type AiBackend = 'native' | 'webllm' | 'cloud' | 'none';

const logger = Container.getInstance().get(Logger);

// ── Backend resolution ──────────────────────────────────────────────────

/**
 * Returns the preferred primary backend:
 * - native: when running in Tauri or on localhost (dev mode)
 * - webllm: when WebGPU is available in the browser (Hermes-2-Pro native tool calling)
 * - cloud: when Claude API key is configured but no local options exist
 * - none: no backend available
 */
export function resolveBackend(): AiBackend {
    if (isTauri()) {
        return 'native';
    }
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        return 'webllm';
    }
    if (isCloudAvailable()) {
        return 'cloud';
    }
    return 'none';
}

/**
 * Returns the ordered fallback chain for inference.
 * Native → WebLLM → Cloud (each only included if potentially available).
 */
function getBackendChain(): AiBackend[] {
    const chain: AiBackend[] = [];
    const primary = resolveBackend();

    if (primary === 'native') {
        chain.push('native');
        // WebGPU might also be available (dev on macOS)
        if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
            chain.push('webllm');
        }
    } else if (primary === 'webllm') {
        chain.push('webllm');
    }

    // Cloud is always the last resort (if configured)
    if (isCloudAvailable()) {
        chain.push('cloud');
    }

    return chain;
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/**
 * Initialize the auto-detected backend. Throws on failure.
 */
export async function initEngine(): Promise<void> {
    const backend = resolveBackend();

    if (backend === 'none') {
        llmStatusStore.set({ state: 'error', message: 'No AI backend available' });
        throw new Error('No AI backend available. Configure a cloud API key, or use a WebGPU-capable browser.');
    }

    llmStatusStore.set({ state: 'loading', progress: 0, text: `Starting ${backend} engine...` });

    if (backend === 'native') {
        await initLlamaServer();
        llmStatusStore.set({ state: 'ready', modelId: 'native' });
        return;
    }

    if (backend === 'cloud') {
        llmStatusStore.set({ state: 'ready', modelId: 'claude' });
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

// ── Inference with tiered fallback ──────────────────────────────────────

/**
 * Send a prompt to the model and get parsed tool calls.
 * Uses a tiered fallback chain: tries each backend in order until one succeeds.
 *
 * Backend dispatch:
 * - cloud:  Claude native tool-use API (no text parsing)
 * - webllm: Hermes-2-Pro native OpenAI tool calling API (no text parsing)
 * - native: llama-server Hermes XML output → parsed via parseToolCallXml + parseNativeToolCalls
 *
 * @param systemPrompt - The assembled system prompt (DAW context + production knowledge).
 *                       For native it includes Hermes XML schema; for webllm/cloud it is
 *                       just the DAW assistant role context (tools passed natively).
 * @param userMessage - The natural language user request.
 */
export async function generateToolCalls(systemPrompt: string, userMessage: string): Promise<ToolCallResult[]> {
    const chain = getBackendChain();

    if (chain.length === 0) {
        throw new Error('No AI backend available. Configure a cloud API key, or use a WebGPU-capable browser.');
    }

    llmStatusStore.set({ state: 'generating' });

    let lastError: Error | null = null;

    for (const backend of chain) {
        try {
            let results: ToolCallResult[];

            if (backend === 'cloud') {
                // Cloud uses native tool-use API — no text parsing needed
                results = await generateCloudToolCalls(systemPrompt, userMessage);
            } else if (backend === 'webllm') {
                // Hermes-2-Pro via WebLLM supports native OpenAI tool calling —
                // pass DAW_CHAT_TOOLS directly, no prompt engineering needed.
                if (!isWebLlmLoaded()) {
                    await initWebLlmEngine();
                }
                results = await generateWebLlmToolCalls(systemPrompt, userMessage, DAW_CHAT_TOOLS);
            } else {
                // native: llama-server with Hermes-3 XML tool call format
                if (!isLlamaServerRunning()) {
                    throw new Error('Native AI engine not running');
                }
                const content = await generateNativeCompletion(systemPrompt, userMessage);
                logger.info(
                    `[AI Engine] (native) Raw response (${String(content.length)} chars): ${content.slice(0, 500)}`
                );
                const tsParsed = parseToolCallXml(content);
                const nativeParsed = await parseNativeToolCalls(content);
                results = [...tsParsed, ...nativeParsed];
            }

            logger.info(
                `[AI Engine] (${backend}) ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`
            );

            const modelId = backend === 'native' ? 'native' : backend === 'cloud' ? 'claude' : WEBLLM_MODEL_ID;
            llmStatusStore.set({ state: 'ready', modelId });
            return results;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[AI Engine] Backend "${backend}" failed: ${lastError.message}. Trying next...`);
        }
    }

    llmStatusStore.set({ state: 'error', message: lastError?.message ?? 'All backends failed' });
    throw lastError ?? new Error('All AI backends failed');
}

// ── Availability ────────────────────────────────────────────────────────

export function isLlmAvailable(): boolean {
    return resolveBackend() !== 'none';
}
